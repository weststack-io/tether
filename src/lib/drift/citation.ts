// Citation extraction and verification module
// Verifies that regulatory and policy quotes appear in their source texts.
// Suppresses alerts where citation verification fails.

export interface CitationInput {
  regulatoryText: string;
  regulatoryQuote: string;
  policyText: string;
  policyQuote: string;
}

// Whitespace runs (including newlines, tabs) are collapsed to a single space
// before comparison so minor formatting drift between source text and the
// model's quote (e.g. line wraps in PDFs, leading indentation) doesn't cause
// a false rejection. Casing is preserved -- legal text distinguishes "MUST"
// from "must" and case-folding would be unsafe.
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  if (typeof quote !== "string" || typeof sourceText !== "string") return false;
  const normalizedQuote = normalizeWhitespace(quote);
  if (normalizedQuote.length === 0) return false;
  const normalizedSource = normalizeWhitespace(sourceText);
  return normalizedSource.includes(normalizedQuote);
}

export function verifyCitations(input: CitationInput): boolean {
  if (!input || typeof input !== "object") return false;
  const { regulatoryText, regulatoryQuote, policyText, policyQuote } = input;
  return (
    quoteAppearsIn(regulatoryQuote, regulatoryText) &&
    quoteAppearsIn(policyQuote, policyText)
  );
}
