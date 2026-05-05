// Vector math utilities
// Implements cosine similarity and other vector operations for
// comparing embeddings in application code.

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new TypeError("cosineSimilarity expects two number[] arguments");
  }
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity vector length mismatch: a.length=${a.length}, b.length=${b.length}`,
    );
  }
  if (a.length === 0) {
    throw new Error("cosineSimilarity requires non-empty vectors");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError(`cosineSimilarity vectors must contain finite numbers (index ${i})`);
    }
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
