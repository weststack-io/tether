// Embedding generation module
// Generates vector embeddings for policy chunks and regulatory items
// using the configured embedding provider (OpenAI or Voyage).

type EmbeddingProvider = "openai" | "voyage";

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index?: number }>;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/embeddings";
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

function readProvider(): EmbeddingProvider {
  const raw = process.env.EMBEDDING_PROVIDER;
  if (raw !== "openai" && raw !== "voyage") {
    throw new Error(
      `EMBEDDING_PROVIDER must be "openai" or "voyage", got: ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function readRequired(key: string): string {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

async function callEmbeddingApi(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<EmbeddingResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Embedding API request failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  const json = (await response.json()) as EmbeddingResponse;
  if (!json?.data?.[0]?.embedding || !Array.isArray(json.data[0].embedding)) {
    throw new Error(
      `Embedding API returned malformed response: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

function endpointFor(provider: EmbeddingProvider): string {
  return provider === "openai" ? OPENAI_ENDPOINT : VOYAGE_ENDPOINT;
}

function apiKeyFor(provider: EmbeddingProvider): string {
  return readRequired(provider === "openai" ? "OPENAI_API_KEY" : "VOYAGE_API_KEY");
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("generateEmbedding requires a non-empty text string");
  }

  const provider = readProvider();
  const model = readRequired("EMBEDDING_MODEL");
  const json = await callEmbeddingApi(endpointFor(provider), apiKeyFor(provider), {
    input: text,
    model,
  });
  return json.data[0].embedding;
}

export async function generateEmbeddings(
  texts: string[],
): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("generateEmbeddings requires a non-empty array of strings");
  }
  for (const t of texts) {
    if (typeof t !== "string" || t.length === 0) {
      throw new Error("generateEmbeddings requires non-empty text strings");
    }
  }

  const provider = readProvider();
  const model = readRequired("EMBEDDING_MODEL");
  const json = await callEmbeddingApi(endpointFor(provider), apiKeyFor(provider), {
    input: texts,
    model,
  });

  if (json.data.length !== texts.length) {
    throw new Error(
      `Embedding API returned ${json.data.length} vectors for ${texts.length} inputs`,
    );
  }

  // OpenAI and Voyage both return data with an `index` field that maps each
  // vector back to its input position. Sort by index to be order-safe.
  const ordered = json.data
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((d) => d.embedding);
}
