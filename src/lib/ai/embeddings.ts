// Embedding generation module
// Generates vector embeddings for policy chunks and regulatory items
// using the configured embedding provider (OpenAI or Voyage).

type EmbeddingProvider = "openai" | "voyage";

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
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

export async function generateEmbedding(text: string): Promise<number[]> {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("generateEmbedding requires a non-empty text string");
  }

  const provider = readProvider();
  const model = readRequired("EMBEDDING_MODEL");

  if (provider === "openai") {
    const apiKey = readRequired("OPENAI_API_KEY");
    const json = await callEmbeddingApi(OPENAI_ENDPOINT, apiKey, {
      input: text,
      model,
    });
    return json.data[0].embedding;
  }

  const apiKey = readRequired("VOYAGE_API_KEY");
  const json = await callEmbeddingApi(VOYAGE_ENDPOINT, apiKey, {
    input: text,
    model,
  });
  return json.data[0].embedding;
}
