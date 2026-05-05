import { describe, expect, it, beforeEach, afterAll, jest } from "@jest/globals";

describe("env loader (INFRA-003)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("loads every required key from process.env", async () => {
    process.env.DATABASE_URL = "file:./prisma/dev.db";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.VOYAGE_API_KEY = "test-voyage";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.CLAUDE_MODEL = "claude-opus-4.7";
    process.env.INGESTION_INTERVAL_HOURS = "6";
    process.env.LOG_LEVEL = "info";

    const { env, REQUIRED_ENV_KEYS } = await import("@/lib/env");

    expect(env.DATABASE_URL).toBe("file:./prisma/dev.db");
    expect(env.ANTHROPIC_API_KEY).toBe("test-anthropic");
    expect(env.EMBEDDING_PROVIDER).toBe("openai");
    expect(env.OPENAI_API_KEY).toBe("test-openai");
    expect(env.VOYAGE_API_KEY).toBe("test-voyage");
    expect(env.EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(env.CLAUDE_MODEL).toBe("claude-opus-4.7");
    expect(env.INGESTION_INTERVAL_HOURS).toBe(6);
    expect(env.LOG_LEVEL).toBe("info");

    expect(REQUIRED_ENV_KEYS).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "ANTHROPIC_API_KEY",
        "EMBEDDING_PROVIDER",
        "OPENAI_API_KEY",
        "VOYAGE_API_KEY",
        "EMBEDDING_MODEL",
        "CLAUDE_MODEL",
        "INGESTION_INTERVAL_HOURS",
        "LOG_LEVEL",
      ]),
    );
  });

  it("throws a descriptive error when a required key is missing", async () => {
    process.env.DATABASE_URL = "file:./prisma/dev.db";
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test";
    process.env.VOYAGE_API_KEY = "test";
    process.env.EMBEDDING_MODEL = "test";
    process.env.CLAUDE_MODEL = "test";
    process.env.INGESTION_INTERVAL_HOURS = "6";
    delete process.env.LOG_LEVEL;

    await expect(import("@/lib/env")).rejects.toThrow(/LOG_LEVEL/);
  });
});
