import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import Database from "libsql";

loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl?.startsWith("file:")) {
  const sqlitePath = databaseUrl.slice("file:".length).split("?")[0];
  if (sqlitePath.length > 0) {
    const db = new Database(sqlitePath);
    try {
      // The dev server and live-route integration tests share one SQLite file.
      // WAL mode allows readers and writers to coexist instead of timing out.
      try {
        db.pragma("journal_mode = WAL");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/database is locked/i.test(message)) {
          throw error;
        }
      }
    } finally {
      db.close();
    }
  }
}
