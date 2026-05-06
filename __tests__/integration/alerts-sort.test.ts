// API-005: GET /api/alerts sorting by severity / date / regulator / domain /
// status, in either order. Default sort is date desc.
//
// Seeds a fixed set of alerts with deliberately varied data on every sort
// axis, then asserts the response order matches the expected ordering for
// each (sortBy, sortOrder) combination. Each test scopes its assertions to
// the seeded ids so it remains robust to whatever the dev SQLite already
// contains.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { GET } from "@/app/api/alerts/route";
import { prisma } from "@/lib/db";

const TEST_TAG = "alerts-sort-test";

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

// Six fixtures spanning every sortable axis. Severities/regulators/statuses
// repeat to make tiebreaker behavior observable; domains and createdAt are
// strictly distinct so the per-axis ordering is unambiguous.
const FIXTURES: AlertSpec[] = [
  {
    regulator: "SEC",
    severity: "low",
    status: "open",
    domain: "vendor_management",
    createdAt: new Date("2026-01-10T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "high",
    status: "escalated",
    domain: "complaint_handling",
    createdAt: new Date("2026-02-10T00:00:00Z"),
  },
  {
    regulator: "CFPB",
    severity: "medium",
    status: "accepted",
    domain: "fair_lending",
    createdAt: new Date("2026-03-10T00:00:00Z"),
  },
  {
    regulator: "OCC",
    severity: "high",
    status: "dismissed",
    domain: "reg_e",
    createdAt: new Date("2026-04-10T00:00:00Z"),
  },
  {
    regulator: "SEC",
    severity: "medium",
    status: "open",
    domain: "bsa_aml",
    createdAt: new Date("2026-05-10T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "low",
    status: "open",
    domain: "reg_z",
    createdAt: new Date("2026-06-10T00:00:00Z"),
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

  // One PolicyDocument per distinct domain, mirroring the API-004 fixture
  // setup, so the domain-sort ordering reflects the seeded values exactly.
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
// other rows can be in the dev DB. Restrict ordering assertions to the
// seeded subset by filtering the response to seeded ids in input order.
function seededOnly(body: ListResponse): AlertRow[] {
  const idSet = new Set(createdAlertIds);
  return body.alerts.filter((a) => idSet.has(a.id));
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

describe("GET /api/alerts sorting (API-005)", () => {
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

  it("?sortBy=severity&sortOrder=desc places high before medium before low", async () => {
    const body = await fetchAlerts(
      "?sortBy=severity&sortOrder=desc&pageSize=100",
    );
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);

    // The first seeded row's severity must be `high` (the highest rank).
    expect(seeded[0]!.severity).toBe("high");

    // Adjacent ranks must be non-decreasing in severity rank
    // (high=0 -> medium=1 -> low=2).
    for (let i = 1; i < seeded.length; i++) {
      const prev = SEVERITY_RANK[seeded[i - 1]!.severity]!;
      const curr = SEVERITY_RANK[seeded[i]!.severity]!;
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("?sortBy=severity&sortOrder=asc places low before medium before high", async () => {
    const body = await fetchAlerts(
      "?sortBy=severity&sortOrder=asc&pageSize=100",
    );
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);

    expect(seeded[0]!.severity).toBe("low");
    for (let i = 1; i < seeded.length; i++) {
      const prev = SEVERITY_RANK[seeded[i - 1]!.severity]!;
      const curr = SEVERITY_RANK[seeded[i]!.severity]!;
      expect(curr).toBeLessThanOrEqual(prev);
    }
  });

  it("?sortBy=date&sortOrder=asc returns oldest first", async () => {
    const body = await fetchAlerts("?sortBy=date&sortOrder=asc&pageSize=100");
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);

    for (let i = 1; i < seeded.length; i++) {
      const prev = new Date(seeded[i - 1]!.createdAt).getTime();
      const curr = new Date(seeded[i]!.createdAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
    // First seeded row must be the earliest fixture (2026-01-10).
    expect(new Date(seeded[0]!.createdAt).toISOString()).toBe(
      "2026-01-10T00:00:00.000Z",
    );
  });

  it("default sort is date descending (no sort params)", async () => {
    const body = await fetchAlerts("?pageSize=100");
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);

    for (let i = 1; i < seeded.length; i++) {
      const prev = new Date(seeded[i - 1]!.createdAt).getTime();
      const curr = new Date(seeded[i]!.createdAt).getTime();
      expect(curr).toBeLessThanOrEqual(prev);
    }
    // First seeded row must be the latest fixture (2026-06-10).
    expect(new Date(seeded[0]!.createdAt).toISOString()).toBe(
      "2026-06-10T00:00:00.000Z",
    );
  });

  it("?sortBy=regulator&sortOrder=asc orders by regulator alphabetically", async () => {
    const body = await fetchAlerts(
      "?sortBy=regulator&sortOrder=asc&pageSize=100",
    );
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);
    for (let i = 1; i < seeded.length; i++) {
      const prev = seeded[i - 1]!.regulatoryItem.regulator;
      const curr = seeded[i]!.regulatoryItem.regulator;
      expect(curr >= prev).toBe(true);
    }
  });

  it("?sortBy=domain&sortOrder=desc orders by policyDocument.domain reverse-alphabetically", async () => {
    const body = await fetchAlerts(
      "?sortBy=domain&sortOrder=desc&pageSize=100",
    );
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);
    for (let i = 1; i < seeded.length; i++) {
      const prev = seeded[i - 1]!.policyChunk.policyDocument.domain;
      const curr = seeded[i]!.policyChunk.policyDocument.domain;
      expect(curr <= prev).toBe(true);
    }
  });

  it("?sortBy=status&sortOrder=asc orders by status alphabetically", async () => {
    const body = await fetchAlerts(
      "?sortBy=status&sortOrder=asc&pageSize=100",
    );
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);
    for (let i = 1; i < seeded.length; i++) {
      const prev = seeded[i - 1]!.status;
      const curr = seeded[i]!.status;
      expect(curr >= prev).toBe(true);
    }
  });

  it("severity sort still respects pagination (page=2 returns the next slice)", async () => {
    const page1 = await fetchAlerts(
      "?sortBy=severity&sortOrder=desc&pageSize=3&page=1",
    );
    const page2 = await fetchAlerts(
      "?sortBy=severity&sortOrder=desc&pageSize=3&page=2",
    );

    const ids1 = new Set(page1.alerts.map((a) => a.id));
    for (const a of page2.alerts) {
      expect(ids1.has(a.id)).toBe(false);
    }
    // total/totalPages should be the same across pages and reflect the full
    // (filtered) set, not just the current page.
    expect(page1.total).toBe(page2.total);
    expect(page1.totalPages).toBe(page2.totalPages);
  });

  it("unknown sortBy falls back to date desc and unknown sortOrder falls back to desc", async () => {
    const body = await fetchAlerts(
      "?sortBy=garbage&sortOrder=sideways&pageSize=100",
    );
    const seeded = seededOnly(body);
    expect(seeded.length).toBe(FIXTURES.length);
    for (let i = 1; i < seeded.length; i++) {
      const prev = new Date(seeded[i - 1]!.createdAt).getTime();
      const curr = new Date(seeded[i]!.createdAt).getTime();
      expect(curr).toBeLessThanOrEqual(prev);
    }
  });
});
