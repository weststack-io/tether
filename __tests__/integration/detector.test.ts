import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";
import { createHash } from "node:crypto";

// Reuse the same deterministic embedding used by prisma/seed.ts so a query
// built from a real seeded chunk's content matches that chunk exactly.
const FALLBACK_DIM = 384;
function deterministicEmbedding(text: string): number[] {
  const out: number[] = [];
  let counter = 0;
  while (out.length < FALLBACK_DIM) {
    const hash = createHash("sha256").update(`${counter}::${text}`).digest();
    for (let i = 0; i + 1 < hash.length && out.length < FALLBACK_DIM; i += 2) {
      const u16 = hash.readUInt16BE(i);
      out.push((u16 / 0xffff) * 2 - 1);
    }
    counter++;
  }
  return out;
}

const mockGenerateEmbedding = jest.fn<(text: string) => Promise<number[]>>(
  async (text: string) => deterministicEmbedding(text),
);

jest.unstable_mockModule("@/lib/ai/embeddings", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

// LLM mock: relevance + drift in one harness, mirroring classifier.test.ts.
// The drift branch always returns a "contradicted" classification with quotes
// that DO appear in the source texts, so verifyCitations passes and an
// alert is created.
type FakeMessage = {
  id: string;
  role: "assistant";
  model: string;
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
};

type CreateArgs = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

let driftRegulatoryQuote = "";
let driftPolicyQuote = "";

const mockCreate = jest.fn<(args: CreateArgs) => Promise<FakeMessage>>(async (args) => {
  const userContent = args.messages[0]?.content ?? "";
  const isDriftPrompt =
    userContent.includes("REGULATORY TEXT") && userContent.includes("POLICY PASSAGE");

  let body: unknown;
  if (isDriftPrompt) {
    body = {
      classification: "contradicted",
      confidence: 0.85,
      explanation:
        "The regulation imposes a stricter requirement than the policy reflects. The policy's threshold is materially below what the regulation mandates. Together these create a compliance gap that requires reviewer attention.",
      regulatoryQuote: driftRegulatoryQuote,
      policyQuote: driftPolicyQuote,
    };
  } else {
    body = {
      isRelevant: true,
      relevantDomains: ["bsa_aml"],
      reasoning: "Updates AML reporting thresholds for covered financial institutions.",
    };
  }

  return {
    id: "msg_pipe_int",
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "text", text: JSON.stringify(body) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 60 },
  };
});

class MockAnthropic {
  messages = { create: mockCreate };
  constructor(_opts: { apiKey: string }) {}
}

jest.unstable_mockModule("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: MockAnthropic,
}));

const { runDriftDetection } = await import("@/lib/drift/detector");
const { prisma } = await import("@/lib/db");

describe("runDriftDetection against seeded database (PIPE-001)", () => {
  const createdAlertIds: string[] = [];
  const createdAuditIds: string[] = [];
  const createdItemIds: string[] = [];
  const createdRunIds: string[] = [];
  const createdLogIds: string[] = [];

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-test";
    process.env.CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-7";

    const seededChunks = await prisma.policyChunk.count({
      where: { embedding: { not: null } },
    });
    if (seededChunks === 0) {
      throw new Error(
        "No seeded PolicyChunk rows with embeddings. Run `npx prisma db seed` first.",
      );
    }
  });

  afterAll(async () => {
    if (createdAuditIds.length > 0) {
      await prisma.auditEntry.deleteMany({ where: { id: { in: createdAuditIds } } });
    }
    if (createdAlertIds.length > 0) {
      await prisma.alert.deleteMany({ where: { id: { in: createdAlertIds } } });
    }
    if (createdItemIds.length > 0) {
      await prisma.regulatoryItem.deleteMany({ where: { id: { in: createdItemIds } } });
    }
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
    if (createdLogIds.length > 0) {
      await prisma.llmCallLog.deleteMany({ where: { id: { in: createdLogIds } } });
    }
    await prisma.$disconnect();
  });

  it("creates an Alert + AuditEntry per qualifying chunk and increments itemsFlagged", async () => {
    // Pick a small seeded chunk so the orchestrator's
    // `${title}\n\n${fullText.slice(0, 4000)}` query text byte-matches the
    // chunk's seed-time embedding input -- only then does the deterministic
    // fallback embedding produce a vector with similarity == 1.0.
    const allChunks = await prisma.policyChunk.findMany({
      where: { embedding: { not: null } },
    });
    const sampleChunk = allChunks
      .filter((c) => c.content.length < 3500)
      .sort((a, b) => a.content.length - b.content.length)[0];
    expect(sampleChunk).toBeDefined();
    if (!sampleChunk) throw new Error("unreachable");

    // Make item.title === chunk.sectionHeading and item.fullText === chunk.content
    // so queryText reproduces the exact bytes that were embedded at seed time.
    // Both LLM-returned quotes are substrings of chunk.content, so
    // verifyCitations passes (regulatoryText === policyText === content here).
    const quoteRegulatory = sampleChunk.content.slice(0, 80).trim();
    const quotePolicy = sampleChunk.content.slice(0, 60).trim();
    driftRegulatoryQuote = quoteRegulatory;
    driftPolicyQuote = quotePolicy;

    const run = await prisma.ingestionRun.create({
      data: { trigger: "manual", status: "running" },
    });
    createdRunIds.push(run.id);

    const item = await prisma.regulatoryItem.create({
      data: {
        sourceUrl: `https://test.example.com/pipe-001/${run.id}`,
        regulator: "FINRA",
        publicationDate: new Date(),
        documentType: "final_rule",
        title: sampleChunk.sectionHeading,
        fullText: sampleChunk.content,
        ingestionRunId: run.id,
      },
    });
    createdItemIds.push(item.id);

    const alertCountBefore = await prisma.alert.count();
    const auditCountBefore = await prisma.auditEntry.count();
    const llmCountBefore = await prisma.llmCallLog.count();

    const result = await runDriftDetection(item.id);

    expect(result.regulatoryItemId).toBe(item.id);
    expect(result.isRelevant).toBe(true);
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.alertsCreated.length).toBeGreaterThan(0);
    expect(result.classificationErrors).toBe(0);
    expect(result.citationFailures).toBe(0);

    const alertCountAfter = await prisma.alert.count();
    expect(alertCountAfter - alertCountBefore).toBe(result.alertsCreated.length);

    const auditCountAfter = await prisma.auditEntry.count();
    expect(auditCountAfter - auditCountBefore).toBe(result.alertsCreated.length);

    // Track for cleanup BEFORE assertions on individual rows so a later
    // failure still leaves a clean DB.
    createdAlertIds.push(...result.alertsCreated);

    for (const alertId of result.alertsCreated) {
      const alert = await prisma.alert.findUnique({ where: { id: alertId } });
      expect(alert).not.toBeNull();
      if (!alert) throw new Error("unreachable");

      expect(alert.regulatoryItemId).toBe(item.id);
      expect(typeof alert.policyChunkId).toBe("string");
      expect([
        "aligned",
        "drifted",
        "contradicted",
        "ambiguous",
        "no_material_impact",
      ]).toContain(alert.classification);
      expect(alert.confidence).toBeGreaterThanOrEqual(0);
      expect(alert.confidence).toBeLessThanOrEqual(1);
      expect(["high", "medium", "low"]).toContain(alert.severity);
      expect(alert.explanation.length).toBeGreaterThan(0);
      expect(alert.regulatoryQuote.length).toBeGreaterThan(0);
      expect(alert.policyQuote.length).toBeGreaterThan(0);
      expect(alert.regulatorySourceUrl).toBe(item.sourceUrl);
      expect(alert.policyReference).toMatch(/ > /);
      expect(alert.status).toBe("open");

      const audits = await prisma.auditEntry.findMany({ where: { alertId } });
      expect(audits.length).toBe(1);
      expect(audits[0].actor).toBe("system");
      expect(audits[0].action).toBe("created");
      createdAuditIds.push(audits[0].id);
    }

    const updatedRun = await prisma.ingestionRun.findUnique({
      where: { id: run.id },
    });
    expect(updatedRun).not.toBeNull();
    if (!updatedRun) throw new Error("unreachable");
    expect(updatedRun.itemsFlagged).toBe(result.alertsCreated.length);

    const updatedItem = await prisma.regulatoryItem.findUnique({
      where: { id: item.id },
    });
    expect(updatedItem?.isRelevant).toBe(true);

    const llmCountAfter = await prisma.llmCallLog.count();
    // 1 relevance call + 1 classification call per evaluated candidate.
    expect(llmCountAfter - llmCountBefore).toBe(1 + result.candidatesEvaluated);

    // Track newly created LlmCallLog rows for teardown.
    const newLogs = await prisma.llmCallLog.findMany({
      orderBy: { createdAt: "desc" },
      take: llmCountAfter - llmCountBefore,
    });
    createdLogIds.push(...newLogs.map((l) => l.id));
  });

  it("stops after relevance check when item is not relevant", async () => {
    // Force the relevance branch to return false by using non-banking content
    // and a custom one-shot mock override.
    const oneShot = jest.fn<(args: CreateArgs) => Promise<FakeMessage>>(async () => ({
      id: "msg_pipe_irrelevant",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            isRelevant: false,
            relevantDomains: [],
            reasoning: "Out-of-scope agricultural rule.",
          }),
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 20 },
    }));
    mockCreate.mockImplementationOnce(oneShot);

    const run = await prisma.ingestionRun.create({
      data: { trigger: "manual", status: "running" },
    });
    createdRunIds.push(run.id);

    const item = await prisma.regulatoryItem.create({
      data: {
        sourceUrl: `https://test.example.com/pipe-001-irrelevant/${run.id}`,
        regulator: "SEC",
        publicationDate: new Date(),
        documentType: "notice",
        title: "USDA Soybean Subsidy Notice",
        fullText: "USDA announces 2026 soybean subsidy adjustments unrelated to banking.",
        ingestionRunId: run.id,
      },
    });
    createdItemIds.push(item.id);

    const alertCountBefore = await prisma.alert.count();
    const llmCountBefore = await prisma.llmCallLog.count();

    const result = await runDriftDetection(item.id);

    expect(result.isRelevant).toBe(false);
    expect(result.alertsCreated).toEqual([]);
    expect(result.candidatesEvaluated).toBe(0);

    const alertCountAfter = await prisma.alert.count();
    expect(alertCountAfter).toBe(alertCountBefore);

    const updatedItem = await prisma.regulatoryItem.findUnique({
      where: { id: item.id },
    });
    expect(updatedItem?.isRelevant).toBe(false);

    const updatedRun = await prisma.ingestionRun.findUnique({
      where: { id: run.id },
    });
    expect(updatedRun?.itemsFlagged).toBe(0);

    // Only the relevance call should have been logged (no classifications).
    const llmCountAfter = await prisma.llmCallLog.count();
    expect(llmCountAfter - llmCountBefore).toBe(1);

    const newLogs = await prisma.llmCallLog.findMany({
      orderBy: { createdAt: "desc" },
      take: llmCountAfter - llmCountBefore,
    });
    createdLogIds.push(...newLogs.map((l) => l.id));
  });

  it("suppresses alerts when citation verification fails and increments itemsSuppressed (PIPE-002)", async () => {
    // Pick the same shape of seeded chunk as the happy-path test so retrieval
    // returns at least one candidate (ensuring the citation-verification gate
    // actually runs). The drift mock then returns FABRICATED quotes -- strings
    // that do NOT appear in either the regulatory text or the policy chunk.
    const allChunks = await prisma.policyChunk.findMany({
      where: { embedding: { not: null } },
    });
    const sampleChunk = allChunks
      .filter((c) => c.content.length < 3500)
      .sort((a, b) => a.content.length - b.content.length)[0];
    expect(sampleChunk).toBeDefined();
    if (!sampleChunk) throw new Error("unreachable");

    // Set the module-scoped mock state to fabricated quotes. The mock uses
    // these for every drift call, so every retrieved candidate will fail
    // verifyCitations.
    driftRegulatoryQuote = "this exact phrase never appears in any seeded chunk xyzzy 4242";
    driftPolicyQuote = "another fabricated phrase plugh 9999 not in corpus";

    const run = await prisma.ingestionRun.create({
      data: { trigger: "manual", status: "running" },
    });
    createdRunIds.push(run.id);

    const item = await prisma.regulatoryItem.create({
      data: {
        sourceUrl: `https://test.example.com/pipe-002/${run.id}`,
        regulator: "FINRA",
        publicationDate: new Date(),
        documentType: "final_rule",
        title: sampleChunk.sectionHeading,
        fullText: sampleChunk.content,
        ingestionRunId: run.id,
      },
    });
    createdItemIds.push(item.id);

    const alertCountBefore = await prisma.alert.count();
    const llmCountBefore = await prisma.llmCallLog.count();

    const result = await runDriftDetection(item.id);

    expect(result.regulatoryItemId).toBe(item.id);
    expect(result.isRelevant).toBe(true);
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.alertsCreated).toEqual([]);
    expect(result.citationFailures).toBeGreaterThan(0);
    // Every evaluated candidate should fail the citation gate (the mock
    // always returns the fabricated quotes) -- this codifies the "ALL
    // candidates suppressed" branch.
    expect(result.citationFailures).toBe(result.candidatesEvaluated);

    const alertCountAfter = await prisma.alert.count();
    expect(alertCountAfter).toBe(alertCountBefore);

    const updatedRun = await prisma.ingestionRun.findUnique({
      where: { id: run.id },
    });
    expect(updatedRun).not.toBeNull();
    if (!updatedRun) throw new Error("unreachable");
    expect(updatedRun.itemsSuppressed).toBe(result.citationFailures);
    expect(updatedRun.itemsFlagged).toBe(0);

    // Track LLM logs for cleanup.
    const llmCountAfter = await prisma.llmCallLog.count();
    const newLogs = await prisma.llmCallLog.findMany({
      orderBy: { createdAt: "desc" },
      take: llmCountAfter - llmCountBefore,
    });
    createdLogIds.push(...newLogs.map((l) => l.id));
  });
});
