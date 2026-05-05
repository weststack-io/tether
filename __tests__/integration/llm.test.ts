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

const mockCreate = jest.fn<(args: CreateArgs) => Promise<FakeMessage>>(async () => {
  // Inject a small delay so latencyMs is reliably > 0 even on a fast box.
  await new Promise((r) => setTimeout(r, 10));
  return {
    id: "msg_int_01",
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "text", text: "integration response" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 42, output_tokens: 17 },
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

const { callLlm } = await import("@/lib/ai/llm");
const { prisma } = await import("@/lib/db");

describe("callLlm against real prisma DB (LLM-001)", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-test";
    process.env.CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-7";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an LlmCallLog row with all required fields populated", async () => {
    const before = await prisma.llmCallLog.count();

    const result = await callLlm({
      purpose: "relevance",
      prompt: "Is this regulatory item relevant to AML/KYC policy?",
    });

    const after = await prisma.llmCallLog.count();
    expect(after).toBe(before + 1);

    const row = await prisma.llmCallLog.findUnique({ where: { id: result.logId } });
    expect(row).not.toBeNull();
    if (!row) throw new Error("unreachable");

    expect(row.purpose).toBe("relevance");
    expect(row.model).toBe(result.model);
    expect(row.model.length).toBeGreaterThan(0);
    expect(row.prompt).toBe("Is this regulatory item relevant to AML/KYC policy?");
    expect(row.response).toBe("integration response");
    expect(row.tokenInput).toBe(42);
    expect(row.tokenOutput).toBe(17);
    expect(row.latencyMs).toBeGreaterThan(0);
    expect(row.createdAt).toBeInstanceOf(Date);

    // Tidy up so the row count stays stable across re-runs.
    await prisma.llmCallLog.delete({ where: { id: row.id } });
  });
});
