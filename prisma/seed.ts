import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@libsql/client";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

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

    await client.execute("DELETE FROM PolicyChunk");
    await client.execute("DELETE FROM PolicyDocument");

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

      for (const chunk of parsed.chunks) {
        await client.execute({
          sql: `INSERT INTO PolicyChunk (id, policyDocumentId, sectionHeading, content, chunkIndex, embedding, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            cuid(),
            documentId,
            chunk.sectionHeading,
            chunk.content,
            chunk.chunkIndex,
            null,
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
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
