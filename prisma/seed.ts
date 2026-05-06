import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@libsql/client";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { generateEmbeddings } from "../src/lib/ai/embeddings.ts";
import { seedDemoAlerts } from "../src/lib/seed/demo-alerts.ts";
import { seedDemoIngestionRuns } from "../src/lib/seed/ingestion-runs.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Configure it in .env.local (or .env) before seeding.",
  );
}

const POLICY_DIR = resolve(process.cwd(), "data/policies");

const FILE_TO_DOMAIN: Record<string, string> = {
  "bsa-aml.md": "bsa_aml",
  "complaint-handling.md": "complaint_handling",
  "fair-lending.md": "fair_lending",
  "reg-e.md": "reg_e",
  "reg-z.md": "reg_z",
  "vendor-management.md": "vendor_management",
  "info-security.md": "info_security",
  "cip.md": "cip",
  "overdraft.md": "overdraft",
  "marketing.md": "marketing",
};

type ParsedPolicy = {
  title: string;
  fullText: string;
  chunks: Array<{ sectionHeading: string; content: string; chunkIndex: number }>;
};

function parsePolicy(fullText: string, fileName: string): ParsedPolicy {
  const lines = fullText.split("\n");

  let title = fileName.replace(/\.md$/, "");
  for (const line of lines) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match) {
      title = match[1];
      break;
    }
  }

  const chunks: ParsedPolicy["chunks"] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentHeading === null) return;
    chunks.push({
      sectionHeading: currentHeading,
      content: currentBody.join("\n").replace(/^\n+|\n+$/g, ""),
      chunkIndex: chunks.length,
    });
  };

  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1];
      currentBody = [];
    } else if (currentHeading !== null) {
      currentBody.push(line);
    }
  }
  flush();

  return { title, fullText, chunks };
}

function cuid(): string {
  return "c" + Date.now().toString(36) + randomBytes(8).toString("hex");
}

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

function isPlaceholderKey(provider: string): boolean {
  const key = provider === "openai"
    ? process.env.OPENAI_API_KEY
    : process.env.VOYAGE_API_KEY;
  // Matches the .env.example placeholders ("your-openai-api-key" /
  // "your-voyage-api-key") so seed runs cleanly before a real key is wired up.
  return !key || /^your-.*-api-key$/.test(key);
}

async function embedChunkBatch(texts: string[]): Promise<number[][]> {
  const provider = process.env.EMBEDDING_PROVIDER ?? "openai";
  if (isPlaceholderKey(provider)) {
    return texts.map(deterministicEmbedding);
  }
  return generateEmbeddings(texts);
}

async function main(): Promise<void> {
  const client = createClient({ url: databaseUrl as string });

  try {
    const entries = await readdir(POLICY_DIR);
    const policyFiles = entries
      .filter((name) => name.endsWith(".md"))
      .sort();

    const unknown = policyFiles.filter((name) => !(name in FILE_TO_DOMAIN));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown policy files (no domain mapping): ${unknown.join(", ")}`,
      );
    }
    const missing = Object.keys(FILE_TO_DOMAIN).filter(
      (name) => !policyFiles.includes(name),
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing policy files referenced in domain mapping: ${missing.join(", ")}`,
      );
    }

    // Clear dependent rows first to satisfy SQLite foreign-key constraints.
    await client.execute("DELETE FROM AuditEntry");
    await client.execute("DELETE FROM Alert");
    await client.execute("DELETE FROM RegulatoryItem");
    await client.execute("DELETE FROM IngestionRun");
    await client.execute("DELETE FROM PolicyChunk");
    await client.execute("DELETE FROM PolicyDocument");

    const usingFallback = isPlaceholderKey(
      process.env.EMBEDDING_PROVIDER ?? "openai",
    );
    if (usingFallback) {
      console.log(
        "EMBEDDING_PROVIDER key is a placeholder; using deterministic local fallback vectors.",
      );
    }

    let totalChunks = 0;
    for (const fileName of policyFiles) {
      const fullText = await readFile(resolve(POLICY_DIR, fileName), "utf8");
      const parsed = parsePolicy(fullText, fileName);
      const domain = FILE_TO_DOMAIN[fileName];
      const documentId = cuid();
      const now = new Date().toISOString();

      await client.execute({
        sql: `INSERT INTO PolicyDocument (id, title, domain, fullText, version, isSynthetic, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [documentId, parsed.title, domain, parsed.fullText, "1.0", 1, now, now],
      });

      const embeddings = await embedChunkBatch(
        parsed.chunks.map((c) => `${c.sectionHeading}\n\n${c.content}`),
      );

      for (let i = 0; i < parsed.chunks.length; i++) {
        const chunk = parsed.chunks[i];
        await client.execute({
          sql: `INSERT INTO PolicyChunk (id, policyDocumentId, sectionHeading, content, chunkIndex, embedding, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            cuid(),
            documentId,
            chunk.sectionHeading,
            chunk.content,
            chunk.chunkIndex,
            JSON.stringify(embeddings[i]),
            now,
          ],
        });
      }

      totalChunks += parsed.chunks.length;
      console.log(
        `seeded ${fileName} -> ${parsed.title} (${parsed.chunks.length} chunks)`,
      );
    }

    console.log(
      `\nDone: ${policyFiles.length} PolicyDocument rows, ${totalChunks} PolicyChunk rows.`,
    );

    const demoResult = await seedDemoAlerts(client);
    console.log(
      `Seeded ${demoResult.alertIds.length} demo alerts under run ${demoResult.runId}.`,
    );

    const ingestionResult = await seedDemoIngestionRuns(client);
    console.log(
      `Seeded ${ingestionResult.runIds.length} demo ingestion runs for dashboard/ingestion log bootstrap.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
