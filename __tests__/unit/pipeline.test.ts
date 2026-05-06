import { describe, expect, it } from "@jest/globals";
import { normalizeDocumentType } from "@/lib/ingestion/pipeline";
import type { RawRegulatoryItem } from "@/types";

function raw(partial: Partial<RawRegulatoryItem>): RawRegulatoryItem {
  return {
    sourceUrl: "https://example.test/x",
    regulator: "SEC",
    publicationDate: new Date("2025-01-01T00:00:00Z"),
    documentType: "press_release",
    title: "",
    fullText: "",
    ...partial,
  };
}

describe("normalizeDocumentType", () => {
  it("classifies 'Final Rule' titles as final_rule", () => {
    expect(normalizeDocumentType(raw({ title: "SEC Adopts Final Rule on X" }))).toBe(
      "final_rule",
    );
  });

  it("classifies 'Finalizes Rule' titles as final_rule", () => {
    expect(
      normalizeDocumentType(
        raw({ regulator: "CFPB", documentType: "publication", title: "CFPB Finalizes Rule on Overdraft Fees" }),
      ),
    ).toBe("final_rule");
  });

  it("classifies 'Proposed Rule' titles as proposed_rule", () => {
    expect(
      normalizeDocumentType(raw({ title: "FINRA Issues Proposed Rule on Margin" })),
    ).toBe("proposed_rule");
  });

  it("classifies enforcement titles (charges) as enforcement", () => {
    expect(
      normalizeDocumentType(raw({ title: "SEC Charges Investment Adviser" })),
    ).toBe("enforcement");
  });

  it("classifies enforcement titles ('enforcement results') as enforcement", () => {
    expect(
      normalizeDocumentType(raw({ title: "SEC Announces Enforcement Results" })),
    ).toBe("enforcement");
  });

  it("classifies CFPB circulars as guidance", () => {
    expect(
      normalizeDocumentType(
        raw({ regulator: "CFPB", documentType: "publication", title: "CFPB Issues Circular on Fair Lending" }),
      ),
    ).toBe("guidance");
  });

  it("classifies titles mentioning 'guidance' as guidance", () => {
    expect(
      normalizeDocumentType(
        raw({ regulator: "FINRA", documentType: "regulatory_notice", title: "FINRA Provides Guidance on Generative AI" }),
      ),
    ).toBe("guidance");
  });

  it("classifies titles containing 'Bulletin' as bulletin", () => {
    expect(
      normalizeDocumentType(
        raw({ regulator: "OCC", documentType: "bulletin", title: "OCC Bulletin 2025-3: BSA/AML Examination Priorities" }),
      ),
    ).toBe("bulletin");
  });

  it("falls back to per-regulator default when no signal is present (SEC -> enforcement)", () => {
    expect(
      normalizeDocumentType(raw({ regulator: "SEC", title: "SEC Update" })),
    ).toBe("enforcement");
  });

  it("falls back to per-regulator default (FINRA -> notice)", () => {
    expect(
      normalizeDocumentType(
        raw({ regulator: "FINRA", documentType: "regulatory_notice", title: "FINRA Reminds Member Firms of Customer Reporting Obligations" }),
      ),
    ).toBe("notice");
  });

  it("falls back to per-regulator default (CFPB -> guidance)", () => {
    expect(
      normalizeDocumentType(
        raw({ regulator: "CFPB", documentType: "publication", title: "CFPB Update" }),
      ),
    ).toBe("guidance");
  });

  it("falls back to per-regulator default (OCC -> bulletin)", () => {
    expect(
      normalizeDocumentType(
        raw({ regulator: "OCC", documentType: "bulletin", title: "OCC Update" }),
      ),
    ).toBe("bulletin");
  });
});
