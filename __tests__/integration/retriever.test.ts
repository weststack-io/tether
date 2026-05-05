import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";
import { createHash } from "node:crypto";

// Mirror prisma/seed.ts's deterministicEmbedding exactly so a chunk's
// content embeds to the same vector that was stored at seed time.
const FALLBACK_DIM = 384;
function deterministicEmbedding(text: string): number[] {
  const out: number[] = [];
  let counter = 0;
  while (out.length < FALLBACK_DIM) {
    const hash = createHash("sha256")
      .update(`${counter}::${text}`)
      .digest();
    for (let i = 0; i + 1 < hash.length && out.length < FALLBACK_DIM; i += 2) {
      const u16 = hash.readUInt16BE(i);
      out.push((u16 / 0xffff) * 2 - 1);
    }
    counter++;
  }
  return out;
}

const mockGenerateEmbedding = jest.fn<(text: string) => Promise<number[]>>(
  async (text: string) => deterministicEmbedding(text),
);

jest.unstable_mockModule("@/lib/ai/embeddings", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const { retrieveCandidates } = await import("@/lib/drift/retriever");
const { prisma } = await import("@/lib/db");

describe("retrieveCandidates against seeded database (RETRIEVE-001)", () => {
  beforeAll(async () => {
    const count = await prisma.policyChunk.count({
      where: { embedding: { not: null } },
    });
    if (count === 0) {
      throw new Error(
        "No seeded PolicyChunk rows with embeddings found. Run `npx prisma db seed` first.",
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns at most 15 chunks, all with similarity >= 0.3, sorted desc", async () => {
    // Use the content of a real seeded chunk so the deterministic embedding
    // produces an exact match against that chunk's stored embedding.
    const sample = await prisma.policyChunk.findFirst({
      where: { embedding: { not: null } },
      orderBy: { chunkIndex: "asc" },
    });
    expect(sample).not.toBeNull();
    if (!sample) throw new Error("unreachable");

    const queryText = `${sample.sectionHeading}\n\n${sample.content}`;

    const result = await retrieveCandidates(queryText);

    expect(result.length).toBeLessThanOrEqual(15);
    expect(result.length).toBeGreaterThan(0);

    for (const r of result) {
      expect(r.similarity).toBeGreaterThanOrEqual(0.3);
      expect(typeof r.chunk.id).toBe("string");
      expect(typeof r.chunk.sectionHeading).toBe("string");
    }

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity);
    }

    // The query is the seed-time content of `sample`, so the deterministic
    // embedding should reproduce sample's stored vector exactly -> similarity 1.
    expect(result[0].chunk.id).toBe(sample.id);
    expect(result[0].similarity).toBeCloseTo(1, 6);
  });
});
