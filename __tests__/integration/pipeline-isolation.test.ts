// INGEST-007: a failed ingestion run does not block subsequent runs.
//
// The orchestrator's per-call design already gives us this contract -- there
// is no shared mutable state between calls to runIngestion(), and the
// IngestionRun row created for run A has no foreign-key relationship to
// the row created for run B. The verification below makes that explicit:
// (1) drive a run where every parser-fetch fails, observe status='failed';
// (2) drive a fresh run immediately after, observe status='completed';
// (3) verify run B's identity, items, and counters are independent of A.
//
// Companion integration tests (pipeline.test.ts) cover the partial-failure
// cases (one parser fails, the rest succeed -> completed-with-errors) and
// the happy/dedupe paths. This file is the dedicated isolation contract.

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

const TEST_TAG = "pipeline-isolation-test";
const createdRunIds: string[] = [];

function makeRaw(overrides: Partial<RawRegulatoryItem>): RawRegulatoryItem {
  return {
    sourceUrl: `https://${TEST_TAG}.example.com/${Math.random().toString(36).slice(2)}`,
    regulator: "SEC",
    publicationDate: new Date("2025-04-01T00:00:00Z"),
    documentType: "press_release",
    title: "Test item",
    fullText: "Test full text body",
    ...overrides,
  };
}

describe("runIngestion failed-run isolation (INGEST-007)", () => {
  beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    mockRunDriftDetection.mockReset();
  });

  afterAll(async () => {
    // Items first (FK), then runs.
    await prisma.regulatoryItem.deleteMany({
      where: { sourceUrl: { contains: TEST_TAG } },
    });
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  it("a run with all parsers failing is marked 'failed' with error details, and a subsequent run still executes independently", async () => {
    // ---- Run A: every parser fails. ----
    const failingFetch = (regulator: string) =>
      async (): Promise<RawRegulatoryItem[]> => {
        throw new Error(`simulated ${regulator} failure for run A`);
      };

    const runA = await runIngestion({
      trigger: "manual",
      parsers: [
        { regulator: "SEC", fetch: failingFetch("SEC") },
        { regulator: "FINRA", fetch: failingFetch("FINRA") },
        { regulator: "CFPB", fetch: failingFetch("CFPB") },
        { regulator: "OCC", fetch: failingFetch("OCC") },
      ],
    });
    createdRunIds.push(runA.runId);

    expect(runA.status).toBe("failed");
    expect(runA.itemsProcessed).toBe(0);
    expect(runA.parserErrors).toHaveLength(4);
    const failedRegulators = runA.parserErrors.map((e) => e.regulator).sort();
    expect(failedRegulators).toEqual(["CFPB", "FINRA", "OCC", "SEC"]);

    const persistedRunA = await prisma.ingestionRun.findUnique({
      where: { id: runA.runId },
    });
    expect(persistedRunA).not.toBeNull();
    expect(persistedRunA?.status).toBe("failed");
    expect(persistedRunA?.completedAt).not.toBeNull();
    expect(persistedRunA?.errors).not.toBeNull();
    const errorsA = JSON.parse(persistedRunA?.errors ?? "{}");
    expect(errorsA.parserErrors).toHaveLength(4);
    expect(errorsA.parserErrors.map((e: { regulator: string }) => e.regulator).sort()).toEqual([
      "CFPB",
      "FINRA",
      "OCC",
      "SEC",
    ]);

    // No drift detection ran -- nothing was persisted.
    expect(mockRunDriftDetection).not.toHaveBeenCalled();

    // ---- Run B: triggered immediately after A; should succeed cleanly. ----
    mockRunDriftDetection.mockResolvedValue({
      regulatoryItemId: "stub",
      isRelevant: true,
      candidatesEvaluated: 0,
      alertsCreated: [],
      citationFailures: 0,
      classificationErrors: 0,
    });

    const runB = await runIngestion({
      trigger: "manual",
      parsers: [
        {
          regulator: "SEC",
          fetch: async () => [
            makeRaw({
              sourceUrl: `https://${TEST_TAG}.runB.example/sec-1`,
              regulator: "SEC",
              title: "SEC Press Release After Failure",
            }),
          ],
        },
        { regulator: "FINRA", fetch: async () => [] },
        { regulator: "CFPB", fetch: async () => [] },
        { regulator: "OCC", fetch: async () => [] },
      ],
    });
    createdRunIds.push(runB.runId);

    expect(runB.status).toBe("completed");
    expect(runB.runId).not.toBe(runA.runId);
    expect(runB.itemsProcessed).toBe(1);
    expect(runB.parserErrors).toEqual([]);
    expect(runB.driftErrors).toEqual([]);

    const persistedRunB = await prisma.ingestionRun.findUnique({
      where: { id: runB.runId },
    });
    expect(persistedRunB?.status).toBe("completed");
    expect(persistedRunB?.itemsProcessed).toBe(1);
    expect(persistedRunB?.errors).toBeNull();

    // Run B's items belong to run B, not run A.
    const runBItems = await prisma.regulatoryItem.findMany({
      where: { ingestionRunId: runB.runId },
    });
    expect(runBItems).toHaveLength(1);
    expect(runBItems[0]?.sourceUrl).toBe(
      `https://${TEST_TAG}.runB.example/sec-1`,
    );

    // Run A still has zero items.
    const runAItems = await prisma.regulatoryItem.findMany({
      where: { ingestionRunId: runA.runId },
    });
    expect(runAItems).toHaveLength(0);

    // Drift detection ran exactly once -- for run B's single item.
    expect(mockRunDriftDetection).toHaveBeenCalledTimes(1);
    expect(mockRunDriftDetection).toHaveBeenCalledWith(runBItems[0]?.id);

    // Run A's failure state is unchanged after run B finishes.
    const runAReread = await prisma.ingestionRun.findUnique({
      where: { id: runA.runId },
    });
    expect(runAReread?.status).toBe("failed");
  });

  it("partial-failure runs (some parsers fail) remain status='completed' -- only ALL-failed flips to 'failed'", async () => {
    // Reaffirms the failed-isolation contract carved out in INGEST-006:
    // partial failures keep the run completed-with-errors. Only universal
    // failure across all sources flips status to 'failed'. This guards
    // against the INGEST-007 status refinement regressing the partial case.
    const result = await runIngestion({
      trigger: "manual",
      parsers: [
        {
          regulator: "SEC",
          fetch: async () => {
            throw new Error("SEC simulated outage");
          },
        },
        {
          regulator: "FINRA",
          fetch: async () => [
            makeRaw({
              sourceUrl: `https://${TEST_TAG}.partial.example/finra-1`,
              regulator: "FINRA",
              title: "FINRA Notice After SEC Outage",
            }),
          ],
        },
        {
          regulator: "CFPB",
          fetch: async () => {
            throw new Error("CFPB simulated outage");
          },
        },
        {
          regulator: "OCC",
          fetch: async () => {
            throw new Error("OCC simulated outage");
          },
        },
      ],
    });
    createdRunIds.push(result.runId);

    expect(result.status).toBe("completed");
    expect(result.itemsProcessed).toBe(1);
    expect(result.parserErrors).toHaveLength(3);

    const finalRun = await prisma.ingestionRun.findUnique({
      where: { id: result.runId },
    });
    expect(finalRun?.status).toBe("completed");
    expect(finalRun?.errors).not.toBeNull();
  });
});
