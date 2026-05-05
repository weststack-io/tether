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

const { classifyDrift, classifyRelevance, parseLlmJson } = await import(
  "@/lib/ai/classifier"
);

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

describe("classifyDrift (CLASSIFY-002)", () => {
  const validDriftInput = {
    regulatoryText:
      "Banks must file a Currency Transaction Report for transactions exceeding $10,000 within 15 days.",
    policyText:
      "All cash transactions over $5,000 are reported to the BSA team for review within 30 days.",
    policySection: "BSA-AML §3.2 CTR Filing Thresholds",
    policyDocument: "BSA/AML Compliance Policy v4.2",
  };

  function fakeDriftBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      classification: "contradicted",
      confidence: 0.88,
      explanation:
        "The regulation requires CTR filing only for transactions over $10,000 within 15 days. The policy lowers the threshold to $5,000 and extends the timeline to 30 days, both of which conflict with the regulatory requirement. This is a direct contradiction in two material ways.",
      regulatoryQuote: "transactions exceeding $10,000 within 15 days",
      policyQuote: "cash transactions over $5,000",
      ...overrides,
    });
  }

  beforeEach(() => {
    mockCallLlm.mockReset();
  });

  it("returns a fully-typed DriftResult for a contradicting policy chunk", async () => {
    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody()));

    const result = await classifyDrift(validDriftInput);

    expect(result.classification).toBe("contradicted");
    expect(result.confidence).toBeCloseTo(0.88);
    expect(typeof result.explanation).toBe("string");
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.regulatoryQuote).toBe("transactions exceeding $10,000 within 15 days");
    expect(result.policyQuote).toBe("cash transactions over $5,000");
  });

  it("issues callLlm with purpose=classification and the drift prompt", async () => {
    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody()));

    await classifyDrift(validDriftInput);

    expect(mockCallLlm).toHaveBeenCalledTimes(1);
    const call = mockCallLlm.mock.calls[0][0];
    expect(call.purpose).toBe("classification");
    expect(call.maxTokens).toBeGreaterThanOrEqual(2000);
    expect(call.prompt).toContain(validDriftInput.regulatoryText);
    expect(call.prompt).toContain(validDriftInput.policyText);
    expect(call.prompt).toContain(validDriftInput.policySection);
    expect(call.prompt).toContain(validDriftInput.policyDocument);
  });

  it("strips markdown fences in the response before parsing", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse("```json\n" + fakeDriftBody({ classification: "drifted" }) + "\n```"),
    );

    const result = await classifyDrift(validDriftInput);
    expect(result.classification).toBe("drifted");
  });

  it.each(["aligned", "drifted", "contradicted", "ambiguous", "no_material_impact"] as const)(
    "accepts the valid classification %s",
    async (classification) => {
      mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody({ classification })));
      const result = await classifyDrift(validDriftInput);
      expect(result.classification).toBe(classification);
    },
  );

  it("throws when classification is not in the enum", async () => {
    mockCallLlm.mockResolvedValue(
      fakeLlmResponse(fakeDriftBody({ classification: "invalid_label" })),
    );
    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/classification/);
  });

  it("throws when confidence is out of [0, 1]", async () => {
    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody({ confidence: 1.5 })));
    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/confidence/);

    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody({ confidence: -0.1 })));
    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/confidence/);
  });

  it("throws when confidence is not a finite number", async () => {
    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody({ confidence: "high" })));
    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/confidence/);
  });

  it("throws when explanation is missing or empty", async () => {
    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody({ explanation: "" })));
    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/explanation/);
  });

  it("throws when regulatoryQuote or policyQuote is empty", async () => {
    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody({ regulatoryQuote: "" })));
    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/regulatoryQuote/);

    mockCallLlm.mockResolvedValue(fakeLlmResponse(fakeDriftBody({ policyQuote: "" })));
    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/policyQuote/);
  });

  it("rejects empty inputs before calling the LLM", async () => {
    await expect(
      classifyDrift({ ...validDriftInput, regulatoryText: "" }),
    ).rejects.toThrow(/regulatoryText/);
    await expect(
      classifyDrift({ ...validDriftInput, policyText: "" }),
    ).rejects.toThrow(/policyText/);
    await expect(
      classifyDrift({ ...validDriftInput, policySection: "" }),
    ).rejects.toThrow(/policySection/);
    await expect(
      classifyDrift({ ...validDriftInput, policyDocument: "" }),
    ).rejects.toThrow(/policyDocument/);
    expect(mockCallLlm).not.toHaveBeenCalled();
  });

  it("retries once on a timeout error per app_spec §12", async () => {
    const timeoutErr = Object.assign(new Error("Request timed out"), {
      name: "APITimeoutError",
    });
    mockCallLlm
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce(fakeLlmResponse(fakeDriftBody({ classification: "aligned" })));

    const result = await classifyDrift(validDriftInput);
    expect(result.classification).toBe("aligned");
    expect(mockCallLlm).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a non-timeout error", async () => {
    const apiErr = Object.assign(new Error("invalid api key"), { status: 401 });
    mockCallLlm.mockRejectedValueOnce(apiErr);

    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/invalid api key/);
    expect(mockCallLlm).toHaveBeenCalledTimes(1);
  });

  it("propagates the second timeout error if the retry also times out", async () => {
    const timeoutErr = Object.assign(new Error("timed out again"), {
      name: "APITimeoutError",
    });
    mockCallLlm.mockRejectedValue(timeoutErr);

    await expect(classifyDrift(validDriftInput)).rejects.toThrow(/timed out/);
    expect(mockCallLlm).toHaveBeenCalledTimes(2);
  });
});
