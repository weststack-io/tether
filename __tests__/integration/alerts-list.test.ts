// API-003: GET /api/alerts
//
// Seeds 30+ alerts in a controlled test scope, calls the route handler with
// various page/pageSize combinations, and asserts the response shape:
//   alerts: Alert[] (with nested regulatoryItem + policyChunk summaries)
//   total, page, pageSize, totalPages
// Default pageSize is 25; ?page=2 returns the second page; nested summaries
// include the fields downstream UI consumers (DASH-*, alert detail) need.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { GET } from "@/app/api/alerts/route";
import { prisma } from "@/lib/db";

const TEST_TAG = "alerts-list-test";
const SEED_COUNT = 32;

const createdAlertIds: string[] = [];
const createdRegItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

type AlertResponseRow = {
  id: string;
  severity: string;
  status: string;
  classification: string;
  regulatoryItem: {
    id: string;
    title: string;
    regulator: string;
    sourceUrl: string;
    publicationDate: string;
    documentType: string;
  };
  policyChunk: {
    id: string;
    sectionHeading: string;
    content: string;
    chunkIndex: number;
    policyDocument: { id: string; title: string; domain: string };
  };
};

type ListResponse = {
  alerts: AlertResponseRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

async function seedAlertBatch(count: number): Promise<void> {
  // Single shared parent IngestionRun + PolicyDocument + PolicyChunk reduces
  // setup time (one Prisma chain per Alert instead of four). The list endpoint
  // doesn't care about parent uniqueness; only the nested summaries matter.
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: "manual",
      status: "completed",
      completedAt: new Date(),
    },
  });
  createdRunIds.push(run.id);

  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TEST_TAG} policy`,
      domain: "bsa_aml",
      fullText: `${TEST_TAG} policy body`,
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

  for (let i = 0; i < count; i++) {
    const regItem = await prisma.regulatoryItem.create({
      data: {
        sourceUrl: `https://${TEST_TAG}.example/${i}-${Math.random().toString(36).slice(2)}`,
        regulator: ["SEC", "FINRA", "CFPB", "OCC"][i % 4],
        publicationDate: new Date("2026-01-15T00:00:00Z"),
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
        policyChunkId: chunk.id,
        classification: "drifted",
        confidence: 0.9,
        severity: ["high", "medium", "low"][i % 3],
        explanation: `${TEST_TAG} explanation ${i}`,
        regulatoryQuote: "regulatory quote",
        policyQuote: "policy quote",
        regulatorySourceUrl: regItem.sourceUrl,
        policyReference: `${policy.title} > Test Section`,
        status: "open",
      },
    });
    createdAlertIds.push(alert.id);
  }
}

describe("GET /api/alerts (API-003)", () => {
  let baseline: { total: number };

  beforeAll(async () => {
    const baselineRes = await GET(
      new Request("http://localhost/api/alerts"),
    );
    baseline = (await baselineRes.json()) as ListResponse;
    await seedAlertBatch(SEED_COUNT);
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

  it("returns the canonical response shape with default pageSize=25", async () => {
    const response = await GET(new Request("http://localhost/api/alerts"));
    expect(response.status).toBe(200);

    const body = (await response.json()) as ListResponse;
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.total).toBe(baseline.total + SEED_COUNT);
    expect(body.totalPages).toBe(Math.ceil(body.total / 25));
    // Page 1 of a 32+ row set (plus baseline rows) returns exactly 25 alerts.
    expect(body.alerts.length).toBe(25);
  });

  it("each alert includes nested regulatoryItem and policyChunk summaries", async () => {
    const response = await GET(new Request("http://localhost/api/alerts"));
    const body = (await response.json()) as ListResponse;

    // Find a seeded row in the response (newest-first sort means our seeded
    // rows are at the top of page 1 unless something else seeded after).
    const seeded = body.alerts.find((a) => createdAlertIds.includes(a.id));
    expect(seeded).toBeDefined();
    if (!seeded) return;

    expect(typeof seeded.regulatoryItem.id).toBe("string");
    expect(typeof seeded.regulatoryItem.title).toBe("string");
    expect(typeof seeded.regulatoryItem.regulator).toBe("string");
    expect(typeof seeded.regulatoryItem.sourceUrl).toBe("string");
    expect(typeof seeded.regulatoryItem.publicationDate).toBe("string");
    expect(typeof seeded.regulatoryItem.documentType).toBe("string");

    expect(typeof seeded.policyChunk.id).toBe("string");
    expect(typeof seeded.policyChunk.sectionHeading).toBe("string");
    expect(typeof seeded.policyChunk.content).toBe("string");
    expect(typeof seeded.policyChunk.chunkIndex).toBe("number");
    expect(typeof seeded.policyChunk.policyDocument.id).toBe("string");
    expect(typeof seeded.policyChunk.policyDocument.title).toBe("string");
    expect(typeof seeded.policyChunk.policyDocument.domain).toBe("string");
  });

  it("returns the next page of results for ?page=2 with no overlap", async () => {
    const page1Res = await GET(new Request("http://localhost/api/alerts"));
    const page1 = (await page1Res.json()) as ListResponse;

    const page2Res = await GET(
      new Request("http://localhost/api/alerts?page=2"),
    );
    const page2 = (await page2Res.json()) as ListResponse;

    expect(page2.page).toBe(2);
    expect(page2.pageSize).toBe(25);
    expect(page2.alerts.length).toBeGreaterThan(0);

    // No id appears on both pages.
    const page1Ids = new Set(page1.alerts.map((a) => a.id));
    for (const alert of page2.alerts) {
      expect(page1Ids.has(alert.id)).toBe(false);
    }
  });

  it("respects custom pageSize within the 100 cap", async () => {
    const res = await GET(
      new Request("http://localhost/api/alerts?pageSize=10"),
    );
    const body = (await res.json()) as ListResponse;
    expect(body.pageSize).toBe(10);
    expect(body.alerts.length).toBe(10);
    expect(body.totalPages).toBe(Math.ceil(body.total / 10));

    const capped = await GET(
      new Request("http://localhost/api/alerts?pageSize=500"),
    );
    const cappedBody = (await capped.json()) as ListResponse;
    expect(cappedBody.pageSize).toBe(100);
  });
});
