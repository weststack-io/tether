import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";

import { generateEmbedding } from "@/lib/ai/embeddings";

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };
type FetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function makeJsonResponse(payload: unknown): FetchResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe("generateEmbedding (EMBED-001)", () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchSpy: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    fetchSpy = jest.fn();
    (globalThis as unknown as { fetch: typeof fetchSpy }).fetch = fetchSpy;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("returns a numeric array using the OpenAI provider when EMBEDDING_PROVIDER=openai", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.OPENAI_API_KEY = "sk-test-openai";

    const fakeVector = [0.1, 0.2, -0.3, 0.4];
    fetchSpy.mockResolvedValue(
      makeJsonResponse({ data: [{ embedding: fakeVector }] }),
    );

    const result = await generateEmbedding("hello world");

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(fakeVector);
    expect(result.every((n) => typeof n === "number")).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, FetchInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-openai",
    });
    const body = JSON.parse(init.body ?? "{}") as { input: string; model: string };
    expect(body).toEqual({ input: "hello world", model: "text-embedding-3-small" });
  });

  it("routes to Voyage when EMBEDDING_PROVIDER=voyage and uses VOYAGE_API_KEY", async () => {
    process.env.EMBEDDING_PROVIDER = "voyage";
    process.env.EMBEDDING_MODEL = "voyage-3";
    process.env.VOYAGE_API_KEY = "vk-test-voyage";

    fetchSpy.mockResolvedValue(
      makeJsonResponse({ data: [{ embedding: [0.5, 0.6] }] }),
    );

    const result = await generateEmbedding("policy text");

    expect(result).toEqual([0.5, 0.6]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, FetchInit];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(init.headers?.Authorization).toBe("Bearer vk-test-voyage");
    const body = JSON.parse(init.body ?? "{}") as { input: string; model: string };
    expect(body.model).toBe("voyage-3");
  });

  it("throws when EMBEDDING_PROVIDER is unset or invalid", async () => {
    delete process.env.EMBEDDING_PROVIDER;
    await expect(generateEmbedding("x")).rejects.toThrow(/EMBEDDING_PROVIDER/);

    process.env.EMBEDDING_PROVIDER = "cohere";
    await expect(generateEmbedding("x")).rejects.toThrow(/EMBEDDING_PROVIDER/);
  });

  it("throws when the matching API key is missing", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    delete process.env.OPENAI_API_KEY;

    await expect(generateEmbedding("x")).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("throws when the API responds with a non-OK status", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.OPENAI_API_KEY = "sk-test";

    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
      text: async () => "invalid api key",
    });

    await expect(generateEmbedding("x")).rejects.toThrow(/401/);
  });
});
