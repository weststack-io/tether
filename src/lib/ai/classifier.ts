// Drift detection classifiers.
//
// CLASSIFY-001 (relevance): decides whether a regulatory item is in-scope for
// any of the bank's policy domains. Calls the Claude API via callLlm with the
// LLM-002 relevance prompt and parses the structured JSON response.
//
// See app_spec.txt §5 Step 1 for pipeline contract.

import { callLlm } from "@/lib/ai/llm";
import {
  POLICY_DOMAINS,
  relevanceClassification,
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

export async function classifyDrift(
  _regulatoryText: string,
  _policyText: string,
): Promise<unknown> {
  throw new Error("Not implemented");
}
