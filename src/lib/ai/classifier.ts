// Drift detection classifiers.
//
// CLASSIFY-001 (relevance): decides whether a regulatory item is in-scope for
// any of the bank's policy domains. Calls the Claude API via callLlm with the
// LLM-002 relevance prompt and parses the structured JSON response.
//
// CLASSIFY-002 (drift): compares a regulatory item against a single policy
// chunk and returns a structured classification with confidence, explanation,
// and verbatim quotes. Implements the retry-once-on-timeout policy from
// app_spec.txt §12 at this call site (not in callLlm).
//
// See app_spec.txt §5 Steps 1 + 3 for the pipeline contract.

import { callLlm } from "@/lib/ai/llm";
import {
  DRIFT_CLASSIFICATIONS,
  POLICY_DOMAINS,
  driftClassification,
  relevanceClassification,
  type DriftClassification,
  type DriftInput,
  type PolicyDomain,
} from "@/lib/ai/prompts";

export interface RegulatoryItemInput {
  title: string;
  fullText: string;
}

export interface RelevanceResult {
  isRelevant: boolean;
  relevantDomains: PolicyDomain[];
  reasoning: string;
}

const RELEVANCE_TEXT_LIMIT = 2000;
const RELEVANCE_MAX_TOKENS = 400;

export function parseLlmJson(response: string): unknown {
  if (typeof response !== "string") {
    throw new Error("parseLlmJson: response must be a string");
  }
  let text = response.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("parseLlmJson: no JSON object found in response");
  }
  const body = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`parseLlmJson: invalid JSON (${message})`);
  }
}

function isPolicyDomain(value: unknown): value is PolicyDomain {
  return typeof value === "string" && (POLICY_DOMAINS as readonly string[]).includes(value);
}

export async function classifyRelevance(
  item: RegulatoryItemInput,
): Promise<RelevanceResult> {
  if (!item || typeof item !== "object") {
    throw new Error("classifyRelevance: item is required");
  }
  const { title, fullText } = item;
  if (typeof title !== "string" || title.length === 0) {
    throw new Error("classifyRelevance: item.title must be a non-empty string");
  }
  if (typeof fullText !== "string" || fullText.length === 0) {
    throw new Error("classifyRelevance: item.fullText must be a non-empty string");
  }

  const prompt = relevanceClassification({
    title,
    text: fullText.slice(0, RELEVANCE_TEXT_LIMIT),
  });

  const { text } = await callLlm({
    purpose: "relevance",
    prompt,
    maxTokens: RELEVANCE_MAX_TOKENS,
  });

  const parsed = parseLlmJson(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("classifyRelevance: response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.isRelevant !== "boolean") {
    throw new Error("classifyRelevance: response.isRelevant must be boolean");
  }
  if (typeof obj.reasoning !== "string") {
    throw new Error("classifyRelevance: response.reasoning must be a string");
  }
  if (!Array.isArray(obj.relevantDomains)) {
    throw new Error("classifyRelevance: response.relevantDomains must be an array");
  }

  const relevantDomains = obj.isRelevant ? obj.relevantDomains.filter(isPolicyDomain) : [];

  return {
    isRelevant: obj.isRelevant,
    relevantDomains,
    reasoning: obj.reasoning,
  };
}

export interface DriftResult {
  classification: DriftClassification;
  confidence: number;
  explanation: string;
  regulatoryQuote: string;
  policyQuote: string;
}

const DRIFT_MAX_TOKENS = 2000;
const DRIFT_RETRY_BACKOFF_MS = 500;

function isDriftClassification(value: unknown): value is DriftClassification {
  return (
    typeof value === "string" &&
    (DRIFT_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; status?: unknown; message?: unknown };
  if (typeof e.name === "string" && /timeout/i.test(e.name)) return true;
  if (typeof e.code === "string" && /timeout|etimedout/i.test(e.code)) return true;
  if (e.status === 408 || e.status === 504) return true;
  if (typeof e.message === "string" && /timeout|timed out/i.test(e.message)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function classifyDrift(input: DriftInput): Promise<DriftResult> {
  if (!input || typeof input !== "object") {
    throw new Error("classifyDrift: input is required");
  }
  const { regulatoryText, policyText, policySection, policyDocument } = input;
  if (typeof regulatoryText !== "string" || regulatoryText.length === 0) {
    throw new Error("classifyDrift: input.regulatoryText must be a non-empty string");
  }
  if (typeof policyText !== "string" || policyText.length === 0) {
    throw new Error("classifyDrift: input.policyText must be a non-empty string");
  }
  if (typeof policySection !== "string" || policySection.length === 0) {
    throw new Error("classifyDrift: input.policySection must be a non-empty string");
  }
  if (typeof policyDocument !== "string" || policyDocument.length === 0) {
    throw new Error("classifyDrift: input.policyDocument must be a non-empty string");
  }

  const prompt = driftClassification({
    regulatoryText,
    policyText,
    policySection,
    policyDocument,
  });

  let response;
  try {
    response = await callLlm({
      purpose: "classification",
      prompt,
      maxTokens: DRIFT_MAX_TOKENS,
    });
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    await sleep(DRIFT_RETRY_BACKOFF_MS);
    response = await callLlm({
      purpose: "classification",
      prompt,
      maxTokens: DRIFT_MAX_TOKENS,
    });
  }

  const parsed = parseLlmJson(response.text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("classifyDrift: response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (!isDriftClassification(obj.classification)) {
    throw new Error(
      `classifyDrift: response.classification must be one of ${DRIFT_CLASSIFICATIONS.join(", ")}`,
    );
  }
  if (typeof obj.confidence !== "number" || !Number.isFinite(obj.confidence)) {
    throw new Error("classifyDrift: response.confidence must be a finite number");
  }
  if (obj.confidence < 0 || obj.confidence > 1) {
    throw new Error("classifyDrift: response.confidence must be between 0 and 1");
  }
  if (typeof obj.explanation !== "string" || obj.explanation.length === 0) {
    throw new Error("classifyDrift: response.explanation must be a non-empty string");
  }
  if (typeof obj.regulatoryQuote !== "string" || obj.regulatoryQuote.length === 0) {
    throw new Error("classifyDrift: response.regulatoryQuote must be a non-empty string");
  }
  if (typeof obj.policyQuote !== "string" || obj.policyQuote.length === 0) {
    throw new Error("classifyDrift: response.policyQuote must be a non-empty string");
  }

  return {
    classification: obj.classification,
    confidence: obj.confidence,
    explanation: obj.explanation,
    regulatoryQuote: obj.regulatoryQuote,
    policyQuote: obj.policyQuote,
  };
}
