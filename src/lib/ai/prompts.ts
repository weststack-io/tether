// LLM prompt templates for the drift detection pipeline.
//
// Each template is a pure function that takes the required input variables
// and returns a fully-formed prompt string. Both templates instruct the model
// to return a single JSON object and nothing else, so callers can JSON.parse
// the response without stripping markdown fences or preambles.
//
// See app_spec.txt §5 for the full pipeline contract.

export const POLICY_DOMAINS = [
  "bsa_aml",
  "complaint_handling",
  "fair_lending",
  "reg_e",
  "reg_z",
  "vendor_management",
  "info_security",
  "cip",
  "overdraft",
  "marketing",
] as const;

export type PolicyDomain = (typeof POLICY_DOMAINS)[number];

export const DRIFT_CLASSIFICATIONS = [
  "aligned",
  "drifted",
  "contradicted",
  "ambiguous",
  "no_material_impact",
] as const;

export type DriftClassification = (typeof DRIFT_CLASSIFICATIONS)[number];

export interface RelevanceInput {
  title: string;
  text: string;
}

export interface DriftInput {
  regulatoryText: string;
  policyText: string;
  policySection: string;
  policyDocument: string;
}

function requireNonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`prompts: ${name} must be a non-empty string`);
  }
  return value;
}

const DOMAIN_LIST = POLICY_DOMAINS.join(", ");
const CLASSIFICATION_LIST = DRIFT_CLASSIFICATIONS.join(", ");

export function relevanceClassification(input: RelevanceInput): string {
  const title = requireNonEmpty(input?.title, "title");
  const text = requireNonEmpty(input?.text, "text");

  return [
    "You are a regulatory compliance analyst for a US bank.",
    "Decide whether the regulatory publication below is relevant to any of the bank's compliance policy domains.",
    "",
    `Valid policy domains: ${DOMAIN_LIST}`,
    "",
    "A publication is relevant if it could plausibly affect how the bank should write or apply policies in one or more of these domains. General-interest news, agricultural rules, foreign-only rules, or matters with no banking nexus are not relevant.",
    "",
    "Respond with a single JSON object and nothing else (no prose, no markdown fences). The object must match this schema exactly:",
    "{",
    '  "isRelevant": boolean,',
    '  "relevantDomains": string[],   // subset of the valid domains above; [] when isRelevant is false',
    '  "reasoning": string            // 1-3 sentences explaining the decision',
    "}",
    "",
    "REGULATORY PUBLICATION",
    `Title: ${title}`,
    "Text:",
    text,
  ].join("\n");
}

export function driftClassification(input: DriftInput): string {
  const regulatoryText = requireNonEmpty(input?.regulatoryText, "regulatoryText");
  const policyText = requireNonEmpty(input?.policyText, "policyText");
  const policySection = requireNonEmpty(input?.policySection, "policySection");
  const policyDocument = requireNonEmpty(input?.policyDocument, "policyDocument");

  return [
    "You are a regulatory compliance analyst comparing a regulatory publication against a single passage from a US bank's internal policy.",
    "Decide whether the policy passage is consistent with the regulatory publication.",
    "",
    `Valid classifications: ${CLASSIFICATION_LIST}`,
    "  - aligned: the policy already satisfies what the regulation requires.",
    "  - drifted: the policy is out of step with the regulation in a material way (e.g., outdated thresholds, missing required steps).",
    "  - contradicted: the policy directly conflicts with what the regulation requires or prohibits.",
    "  - ambiguous: the regulation is unclear or the passage does not give enough context to decide.",
    "  - no_material_impact: the regulation is on-topic but does not change anything in this passage.",
    "",
    "Quotes must be copied verbatim from the inputs (exact characters, including punctuation). Do not paraphrase. If you cannot find a verbatim supporting quote in either side, return classification \"ambiguous\" with low confidence.",
    "",
    "Respond with a single JSON object and nothing else (no prose, no markdown fences). The object must match this schema exactly:",
    "{",
    `  "classification": "aligned" | "drifted" | "contradicted" | "ambiguous" | "no_material_impact",`,
    '  "confidence": number,         // 0.0 to 1.0',
    '  "explanation": string,        // 2-4 sentences in plain language',
    '  "regulatoryQuote": string,    // exact substring of the regulatory text',
    '  "policyQuote": string         // exact substring of the policy passage',
    "}",
    "",
    "REGULATORY TEXT",
    regulatoryText,
    "",
    "POLICY PASSAGE",
    `Document: ${policyDocument}`,
    `Section: ${policySection}`,
    "Text:",
    policyText,
  ].join("\n");
}
