import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type {
  DriftDetectionResult,
} from "@/lib/drift/detector";
import type { RawRegulatoryItem } from "@/types";

// Mock the drift detector so the orchestrator's per-item calls don't need
// embeddings or the Anthropic SDK. The mock observes which item IDs the
// orchestrator drove through, and (mirroring the real detector) increments
// the IngestionRun.itemsFlagged counter for the run associated with each
// item, so the orchestrator's read-back of itemsFlagged stays meaningful.
const mockRunDriftDetection = jest.fn<
  (regulatoryItemId: string) => Promise<DriftDetectionResult>
>();

jest.unstable_mockModule("@/lib/drift/detector", () => ({
  runDriftDetection: mockRunDriftDetection,
}));

const { runIngestion } = await import("@/lib/ingestion/pipeline");
const { prisma } = await import("@/lib/db");

const TEST_TAG = "pipeline-int-test";
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

describe("runIngestion (INGEST-006)", () => {
  beforeAll(() => {
    // Quiet expected console.warn output from parser-failure / persist-failure
    // paths (we still assert on counts, not stdout).
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    mockRunDriftDetection.mockReset();
    // Remove all RegulatoryItem rows tagged by this test so each test sees a
    // fresh dedupe state. Runs are removed in afterAll once all their items
    // are gone (FK constraint: items must be deleted before their parent run).
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

  it("creates an IngestionRun, persists new items, and finalizes status='completed'", async () => {
    const secItems = [
      makeRaw({
        sourceUrl: `https://${TEST_TAG}.sec.example/a`,
        regulator: "SEC",
        title: "SEC Charges Adviser",
      }),
      makeRaw({
        sourceUrl: `https://${TEST_TAG}.sec.example/b`,
        regulator: "SEC",
        title: "SEC Adopts Final Rule on X",
      }),
    ];
    const finraItems = [
      makeRaw({
        sourceUrl: `https://${TEST_TAG}.finra.example/c`,
        regulator: "FINRA",
        title: "FINRA Provides Guidance on AI",
        documentType: "regulatory_notice",
      }),
    ];
    const cfpbItems = [
      makeRaw({
        sourceUrl: `https://${TEST_TAG}.cfpb.example/d`,
        regulator: "CFPB",
        title: "CFPB Issues Circular on Fair Lending",
        documentType: "publication",
      }),
    ];
    const occItems = [
      makeRaw({
        sourceUrl: `https://${TEST_TAG}.occ.example/e`,
        regulator: "OCC",
        title: "OCC Bulletin 2025-9: Vendor Risk",
        documentType: "bulletin",
      }),
    ];

    // Track whether the run was observably 'running' while the parser was
    // in flight -- the parser is awaited synchronously after the create, so
    // querying mid-parse proves the transition running -> completed.
    let runStatusDuringParse: string | null = null;

    const result = await runIngestion({
      trigger: "manual",
      parsers: [
        {
          regulator: "SEC",
          fetch: async () => {
            const runs = await prisma.ingestionRun.findMany({
              orderBy: { startedAt: "desc" },
              take: 1,
            });
            runStatusDuringParse = runs[0]?.status ?? null;
            return secItems;
          },
        },
        { regulator: "FINRA", fetch: async () => finraItems },
        { regulator: "CFPB", fetch: async () => cfpbItems },
        { regulator: "OCC", fetch: async () => occItems },
      ],
    });

    expect(runStatusDuringParse).toBe("running");
    expect(result.status).toBe("completed");
    expect(result.itemsProcessed).toBe(5);
    expect(result.parserErrors).toEqual([]);
    expect(result.driftErrors).toEqual([]);
    expect(result.duplicatesSkipped).toBe(0);

    const finalRun = await prisma.ingestionRun.findUnique({ where: { id: result.runId } });
    expect(finalRun).not.toBeNull();
    expect(finalRun?.status).toBe("completed");
    expect(finalRun?.completedAt).not.toBeNull();
    expect(finalRun?.trigger).toBe("manual");
    expect(finalRun?.itemsProcessed).toBe(5);
    expect(finalRun?.errors).toBeNull();

    const persisted = await prisma.regulatoryItem.findMany({
      where: { ingestionRunId: result.runId },
    });
    expect(persisted).toHaveLength(5);

    // Each new item drove exactly one drift-detection call.
    expect(mockRunDriftDetection).toHaveBeenCalledTimes(5);
    const drivenIds = mockRunDriftDetection.mock.calls.map((c) => c[0]).sort();
    const persistedIds = persisted.map((p) => p.id).sort();
    expect(drivenIds).toEqual(persistedIds);

    // documentType normalization happened on the way in.
    const byUrl = new Map(persisted.map((p) => [p.sourceUrl, p]));
    expect(byUrl.get(`https://${TEST_TAG}.sec.example/a`)?.documentType).toBe("enforcement");
    expect(byUrl.get(`https://${TEST_TAG}.sec.example/b`)?.documentType).toBe("final_rule");
    expect(byUrl.get(`https://${TEST_TAG}.finra.example/c`)?.documentType).toBe("guidance");
    expect(byUrl.get(`https://${TEST_TAG}.cfpb.example/d`)?.documentType).toBe("guidance");
    expect(byUrl.get(`https://${TEST_TAG}.occ.example/e`)?.documentType).toBe("bulletin");

    createdRunIds.push(result.runId);
  });

  it("itemsProcessed reflects only NEW items (duplicate sourceUrls are skipped)", async () => {
    // Pre-seed a prior run with one item already in the DB.
    const priorRun = await prisma.ingestionRun.create({
      data: { trigger: "manual", status: "completed" },
    });
    const dupUrl = `https://${TEST_TAG}.dup.example/already-seen`;
    await prisma.regulatoryItem.create({
      data: {
        sourceUrl: dupUrl,
        regulator: "SEC",
        publicationDate: new Date("2025-03-01T00:00:00Z"),
        documentType: "press_release",
        title: "Already ingested",
        fullText: "old body",
        ingestionRunId: priorRun.id,
      },
    });

    const result = await runIngestion({
      trigger: "manual",
      parsers: [
        {
          regulator: "SEC",
          fetch: async () => [
            makeRaw({ sourceUrl: dupUrl, regulator: "SEC", title: "Already ingested (re-fetched)" }),
            makeRaw({ sourceUrl: `https://${TEST_TAG}.dup.example/new`, regulator: "SEC", title: "Brand New SEC Item" }),
          ],
        },
        // Same in-batch sourceUrl across two parsers -> only counted once.
        { regulator: "FINRA", fetch: async () => [makeRaw({ sourceUrl: `https://${TEST_TAG}.dup.example/shared`, regulator: "FINRA", title: "Shared Item" })] },
        { regulator: "CFPB", fetch: async () => [makeRaw({ sourceUrl: `https://${TEST_TAG}.dup.example/shared`, regulator: "CFPB", title: "Shared Item (dup)" })] },
        { regulator: "OCC", fetch: async () => [] },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.itemsProcessed).toBe(2); // brand-new SEC + shared (FINRA wins, CFPB dup) -- 2 new
    expect(result.duplicatesSkipped).toBe(2); // 1 in-batch (CFPB shared) + 1 cross-run (dupUrl)
    expect(mockRunDriftDetection).toHaveBeenCalledTimes(2);

    const newItems = await prisma.regulatoryItem.findMany({
      where: { ingestionRunId: result.runId },
    });
    expect(newItems).toHaveLength(2);
    const newUrls = newItems.map((i) => i.sourceUrl).sort();
    expect(newUrls).toEqual([
      `https://${TEST_TAG}.dup.example/new`,
      `https://${TEST_TAG}.dup.example/shared`,
    ]);

    // The pre-existing item was NOT re-persisted; it still belongs to priorRun.
    const stillOld = await prisma.regulatoryItem.findFirst({
      where: { sourceUrl: dupUrl },
    });
    expect(stillOld?.ingestionRunId).toBe(priorRun.id);

    createdRunIds.push(result.runId, priorRun.id);
  });

  it("completes the run even when one parser throws (failed-isolation)", async () => {
    const result = await runIngestion({
      trigger: "manual",
      parsers: [
        {
          regulator: "SEC",
          fetch: async () => {
            throw new Error("simulated SEC parser network failure");
          },
        },
        { regulator: "FINRA", fetch: async () => [makeRaw({ sourceUrl: `https://${TEST_TAG}.iso.example/finra-1`, regulator: "FINRA", title: "FINRA Notice" })] },
        { regulator: "CFPB", fetch: async () => [makeRaw({ sourceUrl: `https://${TEST_TAG}.iso.example/cfpb-1`, regulator: "CFPB", title: "CFPB Update" })] },
        { regulator: "OCC", fetch: async () => [makeRaw({ sourceUrl: `https://${TEST_TAG}.iso.example/occ-1`, regulator: "OCC", title: "OCC Bulletin 2025-12" })] },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.itemsProcessed).toBe(3);
    expect(result.parserErrors).toHaveLength(1);
    expect(result.parserErrors[0]?.regulator).toBe("SEC");
    expect(result.parserErrors[0]?.error).toMatch(/simulated SEC parser network failure/);

    const finalRun = await prisma.ingestionRun.findUnique({ where: { id: result.runId } });
    expect(finalRun?.status).toBe("completed");
    expect(finalRun?.itemsProcessed).toBe(3);
    expect(finalRun?.errors).not.toBeNull();
    const errBlob = JSON.parse(finalRun?.errors ?? "{}");
    expect(errBlob.parserErrors).toEqual([
      { regulator: "SEC", error: "simulated SEC parser network failure" },
    ]);

    expect(mockRunDriftDetection).toHaveBeenCalledTimes(3);

    createdRunIds.push(result.runId);
  });

  it("isolates per-item drift errors so the run still completes", async () => {
    // First call throws, second resolves -- both items should still get
    // persisted; only the second drives a successful drift run.
    let callCount = 0;
    mockRunDriftDetection.mockImplementation(async (id: string) => {
      callCount++;
      if (callCount === 1) throw new Error("simulated drift failure");
      return {
        regulatoryItemId: id,
        isRelevant: true,
        candidatesEvaluated: 0,
        alertsCreated: [],
        citationFailures: 0,
        classificationErrors: 0,
      };
    });

    const result = await runIngestion({
      trigger: "manual",
      parsers: [
        { regulator: "SEC", fetch: async () => [
          makeRaw({ sourceUrl: `https://${TEST_TAG}.drift.example/1`, regulator: "SEC", title: "First" }),
          makeRaw({ sourceUrl: `https://${TEST_TAG}.drift.example/2`, regulator: "SEC", title: "Second" }),
        ] },
        { regulator: "FINRA", fetch: async () => [] },
        { regulator: "CFPB", fetch: async () => [] },
        { regulator: "OCC", fetch: async () => [] },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.itemsProcessed).toBe(2);
    expect(result.driftErrors).toHaveLength(1);
    expect(result.driftErrors[0]?.error).toMatch(/simulated drift failure/);

    createdRunIds.push(result.runId);
  });
});
