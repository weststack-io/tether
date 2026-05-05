// Severity scoring module
// Derives an alert severity from a drift classification + confidence score
// per app_spec.txt §5 Step 5. Returns null for classifications that should
// not produce an alert (aligned, no_material_impact).

import type { DriftClassification, Severity } from "@/types";

const HIGH_CONTRADICTED_THRESHOLD = 0.7;
const MEDIUM_DRIFTED_THRESHOLD = 0.8;

export function deriveSeverity(
  classification: DriftClassification,
  confidence: number,
): Severity | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw new Error(
      `deriveSeverity: confidence must be a finite number (got ${String(confidence)})`,
    );
  }
  if (confidence < 0 || confidence > 1) {
    throw new Error(
      `deriveSeverity: confidence must be in [0, 1] (got ${confidence})`,
    );
  }

  switch (classification) {
    case "contradicted":
      return confidence >= HIGH_CONTRADICTED_THRESHOLD ? "high" : "medium";
    case "drifted":
      return confidence >= MEDIUM_DRIFTED_THRESHOLD ? "medium" : "low";
    case "ambiguous":
      return "low";
    case "aligned":
    case "no_material_impact":
      return null;
    default: {
      const exhaustive: never = classification;
      throw new Error(
        `deriveSeverity: unknown classification ${String(exhaustive)}`,
      );
    }
  }
}
