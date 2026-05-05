import { describe, expect, it } from "@jest/globals";

import { quoteAppearsIn, verifyCitations } from "@/lib/drift/citation";

describe("quoteAppearsIn (CITE-001 helper)", () => {
  it("returns true when the quote is a literal substring", () => {
    const source =
      "Banks must file a Currency Transaction Report for transactions exceeding $10,000 within 15 days.";
    const quote = "transactions exceeding $10,000";
    expect(quoteAppearsIn(quote, source)).toBe(true);
  });

  it("returns false when the quote does not appear in the source", () => {
    const source = "All cash transactions over $5,000 are reported within 30 days.";
    const quote = "transactions exceeding $10,000";
    expect(quoteAppearsIn(quote, source)).toBe(false);
  });

  it("normalizes runs of whitespace before comparing", () => {
    const source = "Banks must file a Currency\nTransaction\tReport\n   within 15 days.";
    const quote = "Currency Transaction Report";
    expect(quoteAppearsIn(quote, source)).toBe(true);
  });

  it("trims leading and trailing whitespace from the quote", () => {
    const source = "Banks must file a Currency Transaction Report.";
    const quote = "  \n Currency Transaction Report \t";
    expect(quoteAppearsIn(quote, source)).toBe(true);
  });

  it("is case-sensitive (legal text distinguishes MUST from must)", () => {
    const source = "Banks MUST file the report within 15 days.";
    const quote = "Banks must file the report";
    expect(quoteAppearsIn(quote, source)).toBe(false);
  });

  it("returns false for an empty quote", () => {
    expect(quoteAppearsIn("", "any source text")).toBe(false);
  });

  it("returns false for a whitespace-only quote", () => {
    expect(quoteAppearsIn("   \n\t", "any source text")).toBe(false);
  });

  it("returns false when the source is empty", () => {
    expect(quoteAppearsIn("anything", "")).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(quoteAppearsIn(undefined as unknown as string, "source")).toBe(false);
    expect(quoteAppearsIn("quote", null as unknown as string)).toBe(false);
    expect(quoteAppearsIn(42 as unknown as string, "source")).toBe(false);
  });
});

describe("verifyCitations (CITE-001)", () => {
  const regulatoryText =
    "Banks must file a Currency Transaction Report for transactions exceeding $10,000 within 15 days.";
  const policyText =
    "All cash transactions over $5,000 are reported to the BSA team for review within 30 days.";

  it("returns true when both quotes appear in their respective source texts", () => {
    expect(
      verifyCitations({
        regulatoryText,
        regulatoryQuote: "transactions exceeding $10,000 within 15 days",
        policyText,
        policyQuote: "cash transactions over $5,000",
      }),
    ).toBe(true);
  });

  it("returns false when the regulatoryQuote is fabricated", () => {
    expect(
      verifyCitations({
        regulatoryText,
        regulatoryQuote: "transactions over $50,000 within 7 days",
        policyText,
        policyQuote: "cash transactions over $5,000",
      }),
    ).toBe(false);
  });

  it("returns false when the policyQuote is fabricated", () => {
    expect(
      verifyCitations({
        regulatoryText,
        regulatoryQuote: "transactions exceeding $10,000",
        policyText,
        policyQuote: "automated wire-transfer freezes above $25,000",
      }),
    ).toBe(false);
  });

  it("returns false when both quotes are fabricated", () => {
    expect(
      verifyCitations({
        regulatoryText,
        regulatoryQuote: "Banks shall report nothing ever",
        policyText,
        policyQuote: "Policies are merely suggestions",
      }),
    ).toBe(false);
  });

  it("returns false when either quote is empty", () => {
    expect(
      verifyCitations({
        regulatoryText,
        regulatoryQuote: "",
        policyText,
        policyQuote: "cash transactions over $5,000",
      }),
    ).toBe(false);
    expect(
      verifyCitations({
        regulatoryText,
        regulatoryQuote: "transactions exceeding $10,000",
        policyText,
        policyQuote: "",
      }),
    ).toBe(false);
  });

  it("tolerates whitespace differences between the quote and the source", () => {
    const wrappedRegulatory =
      "Banks must file a\nCurrency Transaction\tReport for transactions\n  exceeding $10,000 within 15 days.";
    expect(
      verifyCitations({
        regulatoryText: wrappedRegulatory,
        regulatoryQuote: "Currency Transaction Report for transactions exceeding $10,000",
        policyText,
        policyQuote: "cash transactions over $5,000",
      }),
    ).toBe(true);
  });

  it("does not case-fold (preserves regulatory casing semantics)", () => {
    expect(
      verifyCitations({
        regulatoryText: "Banks MUST file the report.",
        regulatoryQuote: "Banks must file the report",
        policyText,
        policyQuote: "cash transactions over $5,000",
      }),
    ).toBe(false);
  });

  it("returns false when the input object is missing or malformed", () => {
    expect(verifyCitations(undefined as unknown as never)).toBe(false);
    expect(verifyCitations(null as unknown as never)).toBe(false);
  });
});
