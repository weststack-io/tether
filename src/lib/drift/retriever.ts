// Semantic similarity retrieval module
// Embeds regulatory text and retrieves the most relevant policy chunks
// using cosine similarity against stored embeddings.

import type { PolicyChunk } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { cosineSimilarity } from "@/lib/vectors";

export interface RetrievedChunk {
  chunk: PolicyChunk;
  similarity: number;
}

export const SIMILARITY_THRESHOLD = 0.3;
export const TOP_K = 15;

export async function retrieveCandidates(text: string): Promise<RetrievedChunk[]> {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("retrieveCandidates requires a non-empty text string");
  }

  const queryVector = await generateEmbedding(text);

  const chunks = await prisma.policyChunk.findMany({
    where: { embedding: { not: null } },
  });

  const scored: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    if (!chunk.embedding) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(chunk.embedding);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length !== queryVector.length) {
      continue;
    }

    const similarity = cosineSimilarity(queryVector, parsed as number[]);
    if (similarity >= SIMILARITY_THRESHOLD) {
      scored.push({ chunk, similarity });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, TOP_K);
}
