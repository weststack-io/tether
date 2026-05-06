// API-012: runIngestion single-URL branch.
//
// When `url` is supplied, the orchestrator skips the regulator-wide RSS
// fan-out and instead invokes a single-URL fetcher (production:
// fetchSingleRegulatoryItem; tests: an injected mock via the
// `singleUrlFetcher` test seam). The dedupe + persist + drift-detection
// downstream stages are unchanged.
//
// Coverage:
//   1. happy path -- exactly one RegulatoryItem persisted with the supplied
//      sourceUrl, drift detector invoked once for that item, run completed
//   2. fetcher returns null -- run finalizes as 'failed', no item persisted,
//      drift detector not invoked
//   3. duplicate URL -- already-ingested URL is skipped, duplicatesSkipped=1,
//      no new item, no drift detection

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { DriftDetectionResult } from "@/lib/drift/detector";
import type { RawRegulatoryItem } from "@/types";

const mockRunDriftDetection = jest.fn<
  (regulatoryItemId: string) => Promise<DriftDetectionResult>
>();

jest.unstable_mockModule("@/lib/drift/detector", () => ({
  runDriftDetection: mockRunDriftDetection,
}));

const { runIngestion } = await import("@/lib/ingestion/pipeline");
const { prisma } = await import("@/lib/db");

const TEST_TAG = "api-012-pipeline";
const SEC_URL = `https://www.sec.gov/news/press-release/${TEST_TAG}`;
const createdRunIds: string[] = [];

describe("runIngestion single-URL branch (API-012)", () => {
  beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    mockRunDriftDetection.mockReset();
    await prisma.regulatoryItem.deleteMany({
      where: { sourceUrl: { contains: TEST_TAG } },
    });
  });

  afterAll(async () => {
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  it("processes only the specified URL and persists exactly one RegulatoryItem with that sourceUrl", async () => {
    mockRunDriftDetection.mockResolvedValue({
      regulatoryItemId: "stub",
      isRelevant: false,
      candidatesEvaluated: 0,
      alertsCreated: [],
      citationFailures: 0,
      classificationErrors: 0,
    });

    const fetcherCalls: string[] = [];
    const singleUrlFetcher = async (
      url: string,
    ): Promise<RawRegulatoryItem | null> => {
      fetcherCalls.push(url);
      return {
        sourceUrl: url,
        regulator: "SEC",
        publicationDate: new Date("2026-05-01T00:00:00Z"),
        documentType: "publication",
        title: `${TEST_TAG}: SEC Charges Adviser With Disclosure Failures`,
        fullText:
          "The Securities and Exchange Commission today announced charges " +
          "against an investment adviser for material disclosure failures.",
      };
    };

    const result = await runIngestion({
      trigger: "manual",
      url: SEC_URL,
      singleUrlFetcher,
    });

    createdRunIds.push(result.runId);

    expect(result.status).toBe("completed");
    expect(result.itemsProcessed).toBe(1);
    expect(result.duplicatesSkipped).toBe(0);

    // The fetcher was called exactly once, with the URL we asked for.
    expect(fetcherCalls).toEqual([SEC_URL]);

    // Exactly one RegulatoryItem was persisted, with that sourceUrl.
    const items = await prisma.regulatoryItem.findMany({
      where: { ingestionRunId: result.runId },
    });
    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe(SEC_URL);
    expect(items[0].regulator).toBe("SEC");
    expect(items[0].title).toContain("SEC Charges Adviser");

    // Drift detection ran for that item (and only that item).
    expect(mockRunDriftDetection).toHaveBeenCalledTimes(1);
    expect(mockRunDriftDetection).toHaveBeenCalledWith(items[0].id);
  });

  it("marks the run failed when the single-URL fetcher returns null", async () => {
    const result = await runIngestion({
      trigger: "manual",
      url: `${SEC_URL}/missing`,
      singleUrlFetcher: async () => null,
    });
    createdRunIds.push(result.runId);

    expect(result.status).toBe("failed");
    expect(result.itemsProcessed).toBe(0);
    expect(mockRunDriftDetection).not.toHaveBeenCalled();
  });

  it("skips persisting a duplicate URL (already-ingested) and reports duplicatesSkipped", async () => {
    // Pre-seed the URL so the run sees it as a cross-run duplicate.
    const seedRun = await prisma.ingestionRun.create({
      data: { trigger: "manual", status: "completed" },
    });
    createdRunIds.push(seedRun.id);
    const dupUrl = `${SEC_URL}/dup`;
    await prisma.regulatoryItem.create({
      data: {
        sourceUrl: dupUrl,
        regulator: "SEC",
        publicationDate: new Date("2026-05-01T00:00:00Z"),
        documentType: "publication",
        title: `${TEST_TAG}: pre-existing item`,
        fullText: "Pre-existing body",
        ingestionRunId: seedRun.id,
      },
    });

    const result = await runIngestion({
      trigger: "manual",
      url: dupUrl,
      singleUrlFetcher: async (url) => ({
        sourceUrl: url,
        regulator: "SEC",
        publicationDate: new Date("2026-05-02T00:00:00Z"),
        documentType: "publication",
        title: `${TEST_TAG}: re-fetched item`,
        fullText: "Re-fetched body",
      }),
    });
    createdRunIds.push(result.runId);

    expect(result.status).toBe("completed");
    expect(result.itemsProcessed).toBe(0);
    expect(result.duplicatesSkipped).toBe(1);

    const itemsForThisRun = await prisma.regulatoryItem.findMany({
      where: { ingestionRunId: result.runId },
    });
    expect(itemsForThisRun).toHaveLength(0);
    expect(mockRunDriftDetection).not.toHaveBeenCalled();
  });
});
