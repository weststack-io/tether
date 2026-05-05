import { describe, expect, it } from "@jest/globals";

import { deriveSeverity } from "@/lib/drift/scorer";

describe("deriveSeverity (SCORE-001)", () => {
  describe("acceptance step input/output pairs", () => {
    it("contradicted at 0.8 -> high", () => {
      expect(deriveSeverity("contradicted", 0.8)).toBe("high");
    });

    it("contradicted at 0.5 -> medium", () => {
      expect(deriveSeverity("contradicted", 0.5)).toBe("medium");
    });

    it("drifted at 0.9 -> medium", () => {
      expect(deriveSeverity("drifted", 0.9)).toBe("medium");
    });

    it("drifted at 0.6 -> low", () => {
      expect(deriveSeverity("drifted", 0.6)).toBe("low");
    });

    it("ambiguous at 0.9 -> low", () => {
      expect(deriveSeverity("ambiguous", 0.9)).toBe("low");
    });
  });

  describe("threshold boundaries", () => {
    it("contradicted at exactly 0.7 -> high (>= threshold)", () => {
      expect(deriveSeverity("contradicted", 0.7)).toBe("high");
    });

    it("contradicted at 0.69 -> medium (just under threshold)", () => {
      expect(deriveSeverity("contradicted", 0.69)).toBe("medium");
    });

    it("drifted at exactly 0.8 -> medium (>= threshold)", () => {
      expect(deriveSeverity("drifted", 0.8)).toBe("medium");
    });

    it("drifted at 0.79 -> low (just under threshold)", () => {
      expect(deriveSeverity("drifted", 0.79)).toBe("low");
    });
  });

  describe("ambiguous classification ignores confidence", () => {
    it.each([0, 0.1, 0.5, 0.95, 1])(
      "ambiguous at %s -> low",
      (confidence) => {
        expect(deriveSeverity("ambiguous", confidence)).toBe("low");
      },
    );
  });

  describe("classifications that produce no alert", () => {
    it.each([0, 0.5, 0.99, 1])(
      "aligned at %s -> null",
      (confidence) => {
        expect(deriveSeverity("aligned", confidence)).toBeNull();
      },
    );

    it.each([0, 0.5, 0.99, 1])(
      "no_material_impact at %s -> null",
      (confidence) => {
        expect(deriveSeverity("no_material_impact", confidence)).toBeNull();
      },
    );
  });

  describe("invalid input rejection", () => {
    it("rejects NaN confidence", () => {
      expect(() => deriveSeverity("contradicted", Number.NaN)).toThrow(
        /finite number/,
      );
    });

    it("rejects Infinity confidence", () => {
      expect(() =>
        deriveSeverity("contradicted", Number.POSITIVE_INFINITY),
      ).toThrow(/finite number/);
    });

    it("rejects negative confidence", () => {
      expect(() => deriveSeverity("contradicted", -0.1)).toThrow(
        /\[0, 1\]/,
      );
    });

    it("rejects confidence above 1", () => {
      expect(() => deriveSeverity("contradicted", 1.1)).toThrow(/\[0, 1\]/);
    });

    it("rejects non-number confidence", () => {
      expect(() =>
        deriveSeverity("contradicted", "0.8" as unknown as number),
      ).toThrow(/finite number/);
    });

    it("rejects unknown classification at runtime", () => {
      expect(() =>
        deriveSeverity("bogus" as unknown as "aligned", 0.5),
      ).toThrow(/unknown classification/);
    });
  });
});
