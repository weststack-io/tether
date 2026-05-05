import { describe, expect, it, beforeEach, jest } from "@jest/globals";

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

const mockCreate = jest.fn<(args: CreateArgs) => Promise<FakeMessage>>();
const mockLlmLogCreate =
  jest.fn<(args: { data: Record<string, unknown>; select?: unknown }) => Promise<{ id: string }>>();

class MockAnthropic {
  apiKey: string;
  messages = { create: mockCreate };
  constructor(opts: { apiKey: string }) {
    this.apiKey = opts.apiKey;
  }
}

jest.unstable_mockModule("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: MockAnthropic,
}));

jest.unstable_mockModule("@/lib/db", () => ({
  prisma: {
    llmCallLog: { create: mockLlmLogCreate },
  },
}));

const { callLlm } = await import("@/lib/ai/llm");

describe("callLlm (LLM-001)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.CLAUDE_MODEL = "claude-opus-4-7";
    mockCreate.mockReset();
    mockLlmLogCreate.mockReset();
    mockLlmLogCreate.mockImplementation(async () => ({ id: "log-fake-id" }));
  });

  it("returns response text and writes a fully populated LlmCallLog row", async () => {
    mockCreate.mockResolvedValue({
      id: "msg_01abc",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [{ type: "text", text: "hello back" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 7 },
    });

    const result = await callLlm({ purpose: "relevance", prompt: "hello" });

    expect(result.text).toBe("hello back");
    expect(result.tokenInput).toBe(12);
    expect(result.tokenOutput).toBe(7);
    expect(result.model).toBe("claude-opus-4-7");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.logId).toBe("string");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.model).toBe("claude-opus-4-7");
    expect(createArgs.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(createArgs.max_tokens).toBeGreaterThan(0);

    expect(mockLlmLogCreate).toHaveBeenCalledTimes(1);
    const data = mockLlmLogCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.purpose).toBe("relevance");
    expect(data.model).toBe("claude-opus-4-7");
    expect(data.prompt).toBe("hello");
    expect(data.response).toBe("hello back");
    expect(data.tokenInput).toBe(12);
    expect(data.tokenOutput).toBe(7);
    expect(typeof data.latencyMs).toBe("number");
    expect(data.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("measures a positive latency when the API takes measurable time", async () => {
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                id: "msg_02",
                role: "assistant",
                model: "claude-opus-4-7",
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
            15,
          ),
        ),
    );

    const result = await callLlm({ purpose: "classification", prompt: "x" });
    expect(result.latencyMs).toBeGreaterThan(0);
    const data = mockLlmLogCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.latencyMs).toBeGreaterThan(0);
  });

  it("concatenates multiple text blocks and ignores non-text blocks", async () => {
    mockCreate.mockResolvedValue({
      id: "msg_03",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [
        { type: "text", text: "part one " },
        // Non-text content block (e.g. tool_use) is ignored by extractText.
        { type: "tool_use", id: "t", name: "x", input: {} } as unknown as {
          type: "text";
          text: string;
        },
        { type: "text", text: "part two" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
    });

    const result = await callLlm({ purpose: "explanation", prompt: "p" });
    expect(result.text).toBe("part one part two");
  });

  it("forwards an explicit model override to both the SDK call and the log", async () => {
    mockCreate.mockResolvedValue({
      id: "msg_04",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "fast" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 2, output_tokens: 1 },
    });

    const result = await callLlm({
      purpose: "relevance",
      prompt: "p",
      model: "claude-haiku-4-5-20251001",
      maxTokens: 256,
    });

    expect(result.model).toBe("claude-haiku-4-5-20251001");
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.model).toBe("claude-haiku-4-5-20251001");
    expect(createArgs.max_tokens).toBe(256);
    const data = mockLlmLogCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.model).toBe("claude-haiku-4-5-20251001");
  });

  it("includes the system prompt when provided", async () => {
    mockCreate.mockResolvedValue({
      id: "msg_05",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 1 },
    });

    await callLlm({
      purpose: "classification",
      prompt: "user content",
      system: "you are a regulator",
    });

    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.system).toBe("you are a regulator");
  });

  it("rejects empty purpose and empty prompt before calling the API", async () => {
    await expect(callLlm({ purpose: "", prompt: "x" })).rejects.toThrow(/purpose/);
    await expect(callLlm({ purpose: "ok", prompt: "" })).rejects.toThrow(/prompt/);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockLlmLogCreate).not.toHaveBeenCalled();
  });

  it("throws when CLAUDE_MODEL is unset and no override is provided", async () => {
    delete process.env.CLAUDE_MODEL;
    await expect(callLlm({ purpose: "relevance", prompt: "x" })).rejects.toThrow(
      /CLAUDE_MODEL/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
