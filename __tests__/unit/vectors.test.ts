import { describe, expect, it } from "@jest/globals";

import { cosineSimilarity } from "@/lib/vectors";

describe("cosineSimilarity (VECTORS-001)", () => {
  it("returns ~1.0 for identical vectors", () => {
    const v = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it("returns ~1.0 for parallel vectors of different magnitudes", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  it("returns ~0.0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 1, 0, 0], [0, 0, 1, 1])).toBeCloseTo(0, 10);
  });

  it("returns ~-1.0 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
    expect(cosineSimilarity([0.5, -0.25, 0.75], [-0.5, 0.25, -0.75])).toBeCloseTo(-1, 10);
  });

  it("returns 0 when either vector is the zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("throws when vectors have different lengths", () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(/length mismatch/);
  });

  it("throws when given empty vectors", () => {
    expect(() => cosineSimilarity([], [])).toThrow(/non-empty/);
  });

  it("throws when vectors contain non-finite values", () => {
    expect(() => cosineSimilarity([1, 2, NaN], [1, 2, 3])).toThrow(/finite/);
    expect(() => cosineSimilarity([1, 2, 3], [1, Infinity, 3])).toThrow(/finite/);
  });
});
