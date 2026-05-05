import { describe, expect, it } from "@jest/globals";

import {
  DRIFT_CLASSIFICATIONS,
  POLICY_DOMAINS,
  driftClassification,
  relevanceClassification,
} from "@/lib/ai/prompts";

describe("relevanceClassification (LLM-002)", () => {
  const baseInput = {
    title: "SEC Risk Alert: AML Program Deficiencies",
    text: "The Division of Examinations observed deficiencies in broker-dealer anti-money-laundering programs...",
  };

  it("includes the title and text in the rendered prompt", () => {
    const out = relevanceClassification(baseInput);
    expect(out).toContain(baseInput.title);
    expect(out).toContain(baseInput.text);
  });

  it("enumerates every supported policy domain", () => {
    const out = relevanceClassification(baseInput);
    for (const domain of POLICY_DOMAINS) {
      expect(out).toContain(domain);
    }
  });

  it("instructs the model to produce a JSON object with the required keys", () => {
    const out = relevanceClassification(baseInput);
    expect(out).toMatch(/single JSON object/i);
    expect(out).toContain('"isRelevant"');
    expect(out).toContain('"relevantDomains"');
    expect(out).toContain('"reasoning"');
  });

  it("forbids markdown / preamble around the JSON response", () => {
    const out = relevanceClassification(baseInput);
    expect(out).toMatch(/no markdown fences|no prose/i);
  });

  it("throws when title is empty or missing", () => {
    expect(() => relevanceClassification({ title: "", text: "hello" })).toThrow(/title/);
    expect(() =>
      relevanceClassification({ text: "hello" } as unknown as { title: string; text: string }),
    ).toThrow(/title/);
  });

  it("throws when text is empty or missing", () => {
    expect(() => relevanceClassification({ title: "Some title", text: "" })).toThrow(/text/);
    expect(() =>
      relevanceClassification({ title: "Some title" } as unknown as { title: string; text: string }),
    ).toThrow(/text/);
  });
});

describe("driftClassification (LLM-002)", () => {
  const baseInput = {
    regulatoryText: "Banks must verify customer identity using documentary methods at account opening.",
    policyText: "We collect a name and address at account opening and may request ID at our discretion.",
    policySection: "3. Identity Verification",
    policyDocument: "Customer Identification Program Policy",
  };

  it("includes every input variable in the rendered prompt", () => {
    const out = driftClassification(baseInput);
    expect(out).toContain(baseInput.regulatoryText);
    expect(out).toContain(baseInput.policyText);
    expect(out).toContain(baseInput.policySection);
    expect(out).toContain(baseInput.policyDocument);
  });

  it("enumerates every supported drift classification", () => {
    const out = driftClassification(baseInput);
    for (const c of DRIFT_CLASSIFICATIONS) {
      expect(out).toContain(c);
    }
  });

  it("instructs the model to produce a JSON object with the required keys", () => {
    const out = driftClassification(baseInput);
    expect(out).toMatch(/single JSON object/i);
    expect(out).toContain('"classification"');
    expect(out).toContain('"confidence"');
    expect(out).toContain('"explanation"');
    expect(out).toContain('"regulatoryQuote"');
    expect(out).toContain('"policyQuote"');
  });

  it("constrains confidence to the 0.0-1.0 range and explanation length", () => {
    const out = driftClassification(baseInput);
    expect(out).toMatch(/0\.0\s*to\s*1\.0/);
    expect(out).toMatch(/2-4 sentences/);
  });

  it("requires verbatim quotes from the source texts", () => {
    const out = driftClassification(baseInput);
    expect(out).toMatch(/verbatim/i);
  });

  it("throws when any required input is empty or missing", () => {
    const fields = ["regulatoryText", "policyText", "policySection", "policyDocument"] as const;
    for (const field of fields) {
      const broken = { ...baseInput, [field]: "" };
      expect(() => driftClassification(broken)).toThrow(new RegExp(field));
    }
  });
});
