const REQUIRED_KEYS = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "EMBEDDING_PROVIDER",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "EMBEDDING_MODEL",
  "CLAUDE_MODEL",
  "INGESTION_INTERVAL_HOURS",
  "LOG_LEVEL",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

function read(key: RequiredKey): string {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Copy .env.example to .env.local and populate it (run ./init.sh).`,
    );
  }
  return value;
}

export const env = {
  DATABASE_URL: read("DATABASE_URL"),
  ANTHROPIC_API_KEY: read("ANTHROPIC_API_KEY"),
  EMBEDDING_PROVIDER: read("EMBEDDING_PROVIDER"),
  OPENAI_API_KEY: read("OPENAI_API_KEY"),
  VOYAGE_API_KEY: read("VOYAGE_API_KEY"),
  EMBEDDING_MODEL: read("EMBEDDING_MODEL"),
  CLAUDE_MODEL: read("CLAUDE_MODEL"),
  INGESTION_INTERVAL_HOURS: Number.parseInt(read("INGESTION_INTERVAL_HOURS"), 10),
  LOG_LEVEL: read("LOG_LEVEL"),
};

export const REQUIRED_ENV_KEYS: readonly RequiredKey[] = REQUIRED_KEYS;
