import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";

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

// The mock inspects the prompt to decide which scenario to play back. The drift
// branch fires when the prompt contains the LLM-002 driftClassification
// "REGULATORY TEXT" / "POLICY PASSAGE" header pair; otherwise the relevance
// branch handles AML vs. agriculture cases. One mock SDK serves both
// CLASSIFY-001 and CLASSIFY-002 integration tests against real prisma.
const mockCreate = jest.fn<(args: CreateArgs) => Promise<FakeMessage>>(async (args) => {
  const userContent = args.messages[0]?.content ?? "";
  const isDriftPrompt =
    userContent.includes("REGULATORY TEXT") && userContent.includes("POLICY PASSAGE");

  let body: unknown;
  if (isDriftPrompt) {
    body = {
      classification: "contradicted",
      confidence: 0.82,
      explanation:
        "The regulation requires CTR filing for transactions exceeding $10,000 within 15 days. The policy lowers that threshold to $5,000 and extends the deadline to 30 days. Both the threshold and the timeline conflict with the regulatory requirement.",
      regulatoryQuote: "transactions exceeding $10,000 within 15 days",
      policyQuote: "cash transactions over $5,000",
    };
  } else {
    const isAgriculture = userContent.toLowerCase().includes("soybean");
    body = isAgriculture
      ? {
          isRelevant: false,
          relevantDomains: [],
          reasoning: "Agricultural subsidy rule has no banking compliance nexus.",
        }
      : {
          isRelevant: true,
          relevantDomains: ["bsa_aml"],
          reasoning:
            "Updates AML reporting thresholds for covered financial institutions.",
        };
  }

  return {
    id: "msg_classify_int",
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "text", text: JSON.stringify(body) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 80, output_tokens: 40 },
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

const { classifyDrift, classifyRelevance } = await import("@/lib/ai/classifier");
const { prisma } = await import("@/lib/db");

describe("classifyRelevance against real prisma DB (CLASSIFY-001)", () => {
  const createdLogIds: string[] = [];

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-test";
    process.env.CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-7";
  });

  afterAll(async () => {
    if (createdLogIds.length > 0) {
      await prisma.llmCallLog.deleteMany({ where: { id: { in: createdLogIds } } });
    }
    await prisma.$disconnect();
  });

  it("classifies an AML-related item as relevant with the bsa_aml domain", async () => {
    const before = await prisma.llmCallLog.count();

    const result = await classifyRelevance({
      title: "FinCEN Final Rule on AML/CFT Program Requirements",
      fullText:
        "FinCEN finalizes new AML program requirements for covered financial institutions, " +
        "including updated thresholds for Currency Transaction Reports and SAR filings...",
    });

    expect(result.isRelevant).toBe(true);
    expect(result.relevantDomains).toEqual(["bsa_aml"]);
    expect(result.reasoning.length).toBeGreaterThan(0);

    const after = await prisma.llmCallLog.count();
    expect(after).toBe(before + 1);

    const latest = await prisma.llmCallLog.findFirst({
      orderBy: { createdAt: "desc" },
    });
    expect(latest).not.toBeNull();
    if (!latest) throw new Error("unreachable");
    expect(latest.purpose).toBe("relevance");
    createdLogIds.push(latest.id);
  });

  it("classifies an agricultural item as not relevant with empty domains", async () => {
    const result = await classifyRelevance({
      title: "USDA Final Rule on Soybean Subsidies",
      fullText: "The USDA announces new soybean subsidy thresholds for the 2026 crop year.",
    });

    expect(result.isRelevant).toBe(false);
    expect(result.relevantDomains).toEqual([]);
    expect(typeof result.reasoning).toBe("string");
    expect(result.reasoning.length).toBeGreaterThan(0);

    const latest = await prisma.llmCallLog.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (latest) createdLogIds.push(latest.id);
  });
});

describe("classifyDrift against real prisma DB (CLASSIFY-002)", () => {
  const createdLogIds: string[] = [];

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-test";
    process.env.CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-7";
  });

  afterAll(async () => {
    if (createdLogIds.length > 0) {
      await prisma.llmCallLog.deleteMany({ where: { id: { in: createdLogIds } } });
    }
    await prisma.$disconnect();
  });

  it("returns a structured DriftResult and logs a classification call", async () => {
    const before = await prisma.llmCallLog.count();

    const result = await classifyDrift({
      regulatoryText:
        "Banks must file a Currency Transaction Report for transactions exceeding $10,000 within 15 days.",
      policyText:
        "All cash transactions over $5,000 are reported to the BSA team for review within 30 days.",
      policySection: "BSA-AML §3.2 CTR Filing Thresholds",
      policyDocument: "BSA/AML Compliance Policy v4.2",
    });

    // Required CLASSIFY-002 acceptance: enum membership + bounded confidence +
    // explanation present + non-empty quotes.
    expect([
      "aligned",
      "drifted",
      "contradicted",
      "ambiguous",
      "no_material_impact",
    ]).toContain(result.classification);
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(typeof result.explanation).toBe("string");
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(typeof result.regulatoryQuote).toBe("string");
    expect(result.regulatoryQuote.length).toBeGreaterThan(0);
    expect(typeof result.policyQuote).toBe("string");
    expect(result.policyQuote.length).toBeGreaterThan(0);

    const after = await prisma.llmCallLog.count();
    expect(after).toBe(before + 1);

    const latest = await prisma.llmCallLog.findFirst({
      orderBy: { createdAt: "desc" },
    });
    expect(latest).not.toBeNull();
    if (!latest) throw new Error("unreachable");
    expect(latest.purpose).toBe("classification");
    createdLogIds.push(latest.id);
  });
});
