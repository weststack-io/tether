import { describe, expect, it, beforeEach, jest } from "@jest/globals";

type CallLlmArgs = {
  purpose: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  system?: string;
};

type CallLlmResult = {
  text: string;
  model: string;
  tokenInput: number;
  tokenOutput: number;
  latencyMs: number;
  logId: string;
};

const mockCallLlm = jest.fn<(args: CallLlmArgs) => Promise<CallLlmResult>>();

jest.unstable_mockModule("@/lib/ai/llm", () => ({
  callLlm: mockCallLlm,
}));

const { classifyRelevance, parseLlmJson } = await import("@/lib/ai/classifier");

function fakeLlmResponse(text: string): CallLlmResult {
  return {
    text,
    model: "claude-opus-4-7",
    tokenInput: 100,
    tokenOutput: 50,
    latencyMs: 12,
    logId: "log-fake",
  };
}

describe("parseLlmJson", () => {
  it("parses a bare JSON object", () => {
    expect(parseLlmJson('{"a": 1, "b": "two"}')).toEqual({ a: 1, b: "two" });
  });

  it("strips markdown code fences", () => {
    const fenced = '```json\n{"x": true}\n```';
    expect(parseLlmJson(fenced)).toEqual({ x: true });
  });

  it("strips bare ``` fences without a language tag", () => {
    expect(parseLlmJson("```\n{\"x\": 1}\n```")).toEqual({ x: 1 });
  });

  it("extracts a JSON object surrounded by prose", () => {
    const messy = 'Sure! Here is the JSON: {"isRelevant": false, "relevantDomains": []} Hope this helps.';
    expect(parseLlmJson(messy)).toEqual({ isRelevant: false, relevantDomains: [] });
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseLlmJson("nothing here")).toThrow(/no JSON object/);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseLlmJson('{"a": ,}')).toThrow(/invalid JSON/);
  });
});

describe("classifyRelevance (CLASSIFY-001)", () => {
  beforeEach(() => {
    mockCallLlm.mockReset();
  });

  it("returns isRelevant:true with valid relevantDomains for AML content", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(
        JSON.stringify({
          isRelevant: true,
          relevantDomains: ["bsa_aml"],
          reasoning: "The publication updates AML/BSA reporting thresholds applicable to banks.",
        }),
      ),
    );

    const result = await classifyRelevance({
      title: "FinCEN Final Rule on AML/CFT Program",
      fullText: "FinCEN finalizes new AML program requirements for covered financial institutions...",
    });

    expect(result.isRelevant).toBe(true);
    expect(result.relevantDomains).toEqual(["bsa_aml"]);
    expect(typeof result.reasoning).toBe("string");
    expect(result.reasoning.length).toBeGreaterThan(0);

    expect(mockCallLlm).toHaveBeenCalledTimes(1);
    const call = mockCallLlm.mock.calls[0][0];
    expect(call.purpose).toBe("relevance");
    expect(call.prompt).toContain("FinCEN Final Rule on AML/CFT Program");
    expect(call.prompt).toContain("bsa_aml");
  });

  it("returns isRelevant:false with empty domains for unrelated content", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(
        JSON.stringify({
          isRelevant: false,
          relevantDomains: [],
          reasoning: "Agricultural regulation has no nexus to banking compliance domains.",
        }),
      ),
    );

    const result = await classifyRelevance({
      title: "USDA Final Rule on Soybean Subsidies",
      fullText: "The USDA announces new soybean subsidy thresholds for the 2026 crop year...",
    });

    expect(result.isRelevant).toBe(false);
    expect(result.relevantDomains).toEqual([]);
    expect(typeof result.reasoning).toBe("string");
  });

  it("strips markdown fences in the response before parsing", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(
        '```json\n{"isRelevant": true, "relevantDomains": ["fair_lending"], "reasoning": "ECOA-related guidance."}\n```',
      ),
    );

    const result = await classifyRelevance({
      title: "Updated ECOA Adverse Action Notice Requirements",
      fullText: "The CFPB clarifies adverse action notice requirements under ECOA...",
    });

    expect(result.isRelevant).toBe(true);
    expect(result.relevantDomains).toEqual(["fair_lending"]);
  });

  it("filters out unknown domain values from relevantDomains", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(
        JSON.stringify({
          isRelevant: true,
          relevantDomains: ["bsa_aml", "totally_made_up", "reg_e"],
          reasoning: "Multiple domains apply.",
        }),
      ),
    );

    const result = await classifyRelevance({
      title: "Multi-domain rule",
      fullText: "Affects AML and electronic transfers...",
    });

    expect(result.isRelevant).toBe(true);
    expect(result.relevantDomains).toEqual(["bsa_aml", "reg_e"]);
  });

  it("forces relevantDomains to [] when isRelevant is false even if model lists domains", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(
        JSON.stringify({
          isRelevant: false,
          relevantDomains: ["bsa_aml"],
          reasoning: "Mixed signal: defer to isRelevant=false.",
        }),
      ),
    );

    const result = await classifyRelevance({
      title: "Edge case rule",
      fullText: "Some content...",
    });

    expect(result.isRelevant).toBe(false);
    expect(result.relevantDomains).toEqual([]);
  });

  it("truncates fullText to 2000 chars in the prompt", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(
        JSON.stringify({ isRelevant: false, relevantDomains: [], reasoning: "irrelevant" }),
      ),
    );

    const longText = "A".repeat(5000) + "ZZZZZ_TAIL";
    await classifyRelevance({ title: "long rule", fullText: longText });

    const prompt = mockCallLlm.mock.calls[0][0].prompt;
    expect(prompt).not.toContain("ZZZZZ_TAIL");
    // The 2000-char prefix of A's should be present
    expect(prompt).toContain("A".repeat(2000));
  });

  it("rejects empty title or empty fullText before calling the LLM", async () => {
    await expect(classifyRelevance({ title: "", fullText: "x" })).rejects.toThrow(/title/);
    await expect(classifyRelevance({ title: "ok", fullText: "" })).rejects.toThrow(/fullText/);
    expect(mockCallLlm).not.toHaveBeenCalled();
  });

  it("throws when the LLM response is malformed JSON", async () => {
    mockCallLlm.mockResolvedValue(fakeLlmResponse("not even close to json"));
    await expect(
      classifyRelevance({ title: "t", fullText: "x" }),
    ).rejects.toThrow(/no JSON object/);
  });

  it("throws when isRelevant is missing or wrong type", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(JSON.stringify({ relevantDomains: [], reasoning: "x" })),
    );
    await expect(
      classifyRelevance({ title: "t", fullText: "x" }),
    ).rejects.toThrow(/isRelevant/);
  });

  it("throws when relevantDomains is not an array", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(
        JSON.stringify({ isRelevant: true, relevantDomains: "bsa_aml", reasoning: "x" }),
      ),
    );
    await expect(
      classifyRelevance({ title: "t", fullText: "x" }),
    ).rejects.toThrow(/relevantDomains/);
  });
});
