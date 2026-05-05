import { describe, expect, it, beforeEach, jest } from "@jest/globals";

type FakeChunk = {
  id: string;
  policyDocumentId: string;
  sectionHeading: string;
  content: string;
  chunkIndex: number;
  embedding: string | null;
  createdAt: Date;
};

const mockGenerateEmbedding = jest.fn<(text: string) => Promise<number[]>>();
const mockFindMany = jest.fn<(args?: unknown) => Promise<FakeChunk[]>>();

jest.unstable_mockModule("@/lib/db", () => ({
  prisma: {
    policyChunk: { findMany: mockFindMany },
  },
}));

jest.unstable_mockModule("@/lib/ai/embeddings", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const { retrieveCandidates } = await import("@/lib/drift/retriever");

function makeChunk(id: string, embedding: number[] | null): FakeChunk {
  return {
    id,
    policyDocumentId: `doc-${id}`,
    sectionHeading: `Section ${id}`,
    content: `Content of chunk ${id}`,
    chunkIndex: parseInt(id.replace(/[^0-9]/g, ""), 10) || 0,
    embedding: embedding === null ? null : JSON.stringify(embedding),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("retrieveCandidates (RETRIEVE-001)", () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockReset();
    mockFindMany.mockReset();
  });

  it("returns at most 15 PolicyChunk records sorted by similarity descending", async () => {
    // Query vector and 20 chunks at varying angles to it.
    // We construct 2D vectors so cosine similarity is just cos(angle).
    const queryVector = [1, 0];
    mockGenerateEmbedding.mockResolvedValue(queryVector);

    // Generate 20 chunks: similarities from 1.0 down to ~0.05 in steps.
    // 0.3 threshold should keep ~16 of them, then top 15 returned.
    const chunks: FakeChunk[] = [];
    for (let i = 0; i < 20; i++) {
      // angle from 0 to ~85 degrees (similarity from 1 down to ~0.087)
      const angleDeg = (i * 85) / 19;
      const angleRad = (angleDeg * Math.PI) / 180;
      chunks.push(makeChunk(`c${i}`, [Math.cos(angleRad), Math.sin(angleRad)]));
    }
    mockFindMany.mockResolvedValue(chunks);

    const result = await retrieveCandidates("sample regulatory text about AML");

    expect(result.length).toBeLessThanOrEqual(15);
    expect(result.length).toBeGreaterThan(0);

    for (const r of result) {
      expect(r.similarity).toBeGreaterThanOrEqual(0.3);
    }

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity);
    }

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("sample regulatory text about AML");
  });

  it("filters out chunks with similarity below 0.3", async () => {
    const queryVector = [1, 0];
    mockGenerateEmbedding.mockResolvedValue(queryVector);

    const chunks: FakeChunk[] = [
      // similarity 1.0
      makeChunk("a", [1, 0]),
      // similarity ~0.866 (cos 30deg)
      makeChunk("b", [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]),
      // similarity 0 (orthogonal) - below threshold
      makeChunk("c", [0, 1]),
      // similarity -1 (opposite) - below threshold
      makeChunk("d", [-1, 0]),
    ];
    mockFindMany.mockResolvedValue(chunks);

    const result = await retrieveCandidates("query");

    expect(result.length).toBe(2);
    expect(result.map((r) => r.chunk.id)).toEqual(["a", "b"]);
    for (const r of result) {
      expect(r.similarity).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("returns results sorted by similarity descending", async () => {
    const queryVector = [1, 0, 0];
    mockGenerateEmbedding.mockResolvedValue(queryVector);

    const chunks: FakeChunk[] = [
      // sim 0.5
      makeChunk("low", [0.5, Math.sqrt(0.75), 0]),
      // sim 1.0
      makeChunk("high", [1, 0, 0]),
      // sim ~0.87
      makeChunk("mid", [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]),
    ];
    mockFindMany.mockResolvedValue(chunks);

    const result = await retrieveCandidates("query");

    expect(result.map((r) => r.chunk.id)).toEqual(["high", "mid", "low"]);
  });

  it("skips chunks with mismatched embedding dimensions", async () => {
    mockGenerateEmbedding.mockResolvedValue([1, 0, 0]);

    const chunks: FakeChunk[] = [
      makeChunk("ok", [1, 0, 0]),
      makeChunk("wrong-dim", [1, 0]), // 2D vs 3D
      makeChunk("null", null),
      makeChunk("malformed", [0.9, 0.1, 0.1]),
    ];
    // null and malformed JSON simulation
    chunks[3].embedding = "not-json";
    mockFindMany.mockResolvedValue(chunks);

    const result = await retrieveCandidates("query");

    expect(result.map((r) => r.chunk.id)).toEqual(["ok"]);
  });

  it("throws when given an empty or whitespace-only string", async () => {
    await expect(retrieveCandidates("")).rejects.toThrow(/non-empty/);
    await expect(retrieveCandidates("   ")).rejects.toThrow(/non-empty/);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns an empty array when no chunks meet the threshold", async () => {
    mockGenerateEmbedding.mockResolvedValue([1, 0]);
    mockFindMany.mockResolvedValue([
      makeChunk("a", [0, 1]), // sim 0
      makeChunk("b", [-1, 0]), // sim -1
    ]);

    const result = await retrieveCandidates("query");

    expect(result).toEqual([]);
  });
});
