// API-004: GET /api/alerts filtering by regulator / severity / status / domain
// / dateFrom / dateTo.
//
// Seeds a controlled fixture spanning every filter axis, then asserts that
// each query param narrows the response correctly. Each test scopes its
// assertions to the seeded ids so it remains robust to whatever the dev
// SQLite already contains.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { GET } from "@/app/api/alerts/route";
import { prisma } from "@/lib/db";

const TEST_TAG = "alerts-filter-test";

const createdAlertIds: string[] = [];
const createdRegItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

type AlertRow = {
  id: string;
  severity: string;
  status: string;
  createdAt: string;
  regulatoryItem: { id: string; regulator: string };
  policyChunk: { policyDocument: { id: string; domain: string } };
};

type ListResponse = {
  alerts: AlertRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type AlertSpec = {
  regulator: string;
  severity: string;
  status: string;
  domain: string;
  createdAt: Date;
};

// Six fixtures span every axis the route filters on. Each `domain` gets its
// own PolicyDocument (so the domain-filter selectivity test isn't muddied by
// a single shared parent document covering all alerts). The createdAt values
// straddle the dateFrom/dateTo boundary used in the date-range test.
const FIXTURES: AlertSpec[] = [
  {
    regulator: "SEC",
    severity: "high",
    status: "open",
    domain: "bsa_aml",
    createdAt: new Date("2026-02-15T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "medium",
    status: "open",
    domain: "complaint_handling",
    createdAt: new Date("2026-03-15T00:00:00Z"),
  },
  {
    regulator: "CFPB",
    severity: "low",
    status: "accepted",
    domain: "fair_lending",
    createdAt: new Date("2026-04-15T00:00:00Z"),
  },
  {
    regulator: "OCC",
    severity: "high",
    status: "dismissed",
    domain: "reg_e",
    createdAt: new Date("2026-05-15T00:00:00Z"),
  },
  {
    regulator: "SEC",
    severity: "low",
    status: "open",
    domain: "vendor_management",
    createdAt: new Date("2025-12-15T00:00:00Z"), // outside dateFrom=2026-01-01
  },
  {
    regulator: "SEC",
    severity: "medium",
    status: "escalated",
    domain: "bsa_aml",
    createdAt: new Date("2026-07-15T00:00:00Z"), // outside dateTo=2026-06-01
  },
];

async function seedFixtures(): Promise<void> {
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: "manual",
      status: "completed",
      completedAt: new Date(),
    },
  });
  createdRunIds.push(run.id);

  // One PolicyDocument per distinct domain so the domain filter has clean
  // selectivity (a shared doc would collapse multiple alerts onto one domain).
  const domainToChunkId = new Map<string, string>();
  for (const spec of FIXTURES) {
    if (domainToChunkId.has(spec.domain)) continue;
    const policy = await prisma.policyDocument.create({
      data: {
        title: `${TEST_TAG} ${spec.domain} policy`,
        domain: spec.domain,
        fullText: `${TEST_TAG} body`,
        isSynthetic: true,
      },
    });
    createdPolicyIds.push(policy.id);

    const chunk = await prisma.policyChunk.create({
      data: {
        policyDocumentId: policy.id,
        sectionHeading: "Test Section",
        content: `${TEST_TAG} chunk content`,
        chunkIndex: 0,
      },
    });
    createdChunkIds.push(chunk.id);
    domainToChunkId.set(spec.domain, chunk.id);
  }

  for (let i = 0; i < FIXTURES.length; i++) {
    const spec = FIXTURES[i]!;
    const regItem = await prisma.regulatoryItem.create({
      data: {
        sourceUrl: `https://${TEST_TAG}.example/${i}-${Math.random().toString(36).slice(2)}`,
        regulator: spec.regulator,
        publicationDate: spec.createdAt,
        documentType: "notice",
        title: `${TEST_TAG} regulatory item ${i}`,
        fullText: `${TEST_TAG} body ${i}`,
        ingestionRunId: run.id,
      },
    });
    createdRegItemIds.push(regItem.id);

    const alert = await prisma.alert.create({
      data: {
        regulatoryItemId: regItem.id,
        policyChunkId: domainToChunkId.get(spec.domain)!,
        classification: "drifted",
        confidence: 0.9,
        severity: spec.severity,
        explanation: `${TEST_TAG} explanation ${i}`,
        regulatoryQuote: "regulatory quote",
        policyQuote: "policy quote",
        regulatorySourceUrl: regItem.sourceUrl,
        policyReference: `policy ref ${i}`,
        status: spec.status,
        createdAt: spec.createdAt,
      },
    });
    createdAlertIds.push(alert.id);
  }
}

async function fetchAlerts(query: string): Promise<ListResponse> {
  const res = await GET(new Request(`http://localhost/api/alerts${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as ListResponse;
}

// All fixtures fit on a single page (default pageSize=25 >> 6 fixtures), but
// other rows can be in the dev DB. Restrict assertions to the seeded subset.
function seededOnly(body: ListResponse): AlertRow[] {
  const idSet = new Set(createdAlertIds);
  return body.alerts.filter((a) => idSet.has(a.id));
}

describe("GET /api/alerts filtering (API-004)", () => {
  beforeAll(async () => {
    await seedFixtures();
  });

  afterAll(async () => {
    if (createdAlertIds.length > 0) {
      await prisma.auditEntry.deleteMany({
        where: { alertId: { in: createdAlertIds } },
      });
      await prisma.alert.deleteMany({
        where: { id: { in: createdAlertIds } },
      });
    }
    if (createdRegItemIds.length > 0) {
      await prisma.regulatoryItem.deleteMany({
        where: { id: { in: createdRegItemIds } },
      });
    }
    if (createdChunkIds.length > 0) {
      await prisma.policyChunk.deleteMany({
        where: { id: { in: createdChunkIds } },
      });
    }
    if (createdPolicyIds.length > 0) {
      await prisma.policyDocument.deleteMany({
        where: { id: { in: createdPolicyIds } },
      });
    }
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("?regulator=SEC returns only SEC alerts (and excludes other seeded regulators)", async () => {
    const body = await fetchAlerts("?regulator=SEC&pageSize=100");
    for (const alert of body.alerts) {
      expect(alert.regulatoryItem.regulator).toBe("SEC");
    }
    const seeded = seededOnly(body);
    // Three of the six fixtures are SEC.
    expect(seeded.length).toBe(3);
    expect(seeded.every((a) => a.regulatoryItem.regulator === "SEC")).toBe(true);
  });

  it("?regulator=SEC,CFPB accepts a comma-separated list", async () => {
    const body = await fetchAlerts("?regulator=SEC,CFPB&pageSize=100");
    for (const alert of body.alerts) {
      expect(["SEC", "CFPB"]).toContain(alert.regulatoryItem.regulator);
    }
    const seeded = seededOnly(body);
    // Three SEC + one CFPB = four seeded fixtures.
    expect(seeded.length).toBe(4);
  });

  it("?severity=high returns only high-severity alerts", async () => {
    const body = await fetchAlerts("?severity=high&pageSize=100");
    for (const alert of body.alerts) {
      expect(alert.severity).toBe("high");
    }
    const seeded = seededOnly(body);
    // Two of the six fixtures are high severity (SEC/bsa_aml + OCC/reg_e).
    expect(seeded.length).toBe(2);
  });

  it("?status=open returns only open alerts", async () => {
    const body = await fetchAlerts("?status=open&pageSize=100");
    for (const alert of body.alerts) {
      expect(alert.status).toBe("open");
    }
    const seeded = seededOnly(body);
    // Three of the six fixtures are open (SEC/high, FINRA/medium, SEC/low).
    expect(seeded.length).toBe(3);
  });

  it("?domain=bsa_aml returns only BSA/AML alerts", async () => {
    const body = await fetchAlerts("?domain=bsa_aml&pageSize=100");
    for (const alert of body.alerts) {
      expect(alert.policyChunk.policyDocument.domain).toBe("bsa_aml");
    }
    const seeded = seededOnly(body);
    // Two of the six fixtures use the bsa_aml domain.
    expect(seeded.length).toBe(2);
  });

  it("?dateFrom=2026-01-01&dateTo=2026-06-01 filters by createdAt range", async () => {
    const body = await fetchAlerts(
      "?dateFrom=2026-01-01&dateTo=2026-06-01&pageSize=100",
    );
    const lower = new Date("2026-01-01T00:00:00Z").getTime();
    // dateTo is inclusive of the named day -> upper bound is 2026-06-02 midnight.
    const upper = new Date("2026-06-02T00:00:00Z").getTime();
    for (const alert of body.alerts) {
      const t = new Date(alert.createdAt).getTime();
      expect(t).toBeGreaterThanOrEqual(lower);
      expect(t).toBeLessThan(upper);
    }
    const seeded = seededOnly(body);
    // Of the six fixtures, four lie inside the [Jan 1 .. Jun 1] window:
    // Feb 15, Mar 15, Apr 15, May 15. Dec 15 (2025) is below; Jul 15 is above.
    expect(seeded.length).toBe(4);
  });

  it("combines multiple filters with AND semantics", async () => {
    const body = await fetchAlerts(
      "?regulator=SEC&status=open&pageSize=100",
    );
    for (const alert of body.alerts) {
      expect(alert.regulatoryItem.regulator).toBe("SEC");
      expect(alert.status).toBe("open");
    }
    const seeded = seededOnly(body);
    // SEC + open hits two fixtures: the high/bsa_aml/Feb-15 and low/vendor/Dec-15.
    expect(seeded.length).toBe(2);
  });
});
