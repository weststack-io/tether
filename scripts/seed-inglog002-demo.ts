// Throwaway seed used for INGLOG-002 manual / Playwright verification.
// Creates a small set of IngestionRun rows with errors blobs covering the
// three shapes the page handles: structured pipeline-shape JSON (with
// topLevel + parserErrors + driftErrors), legacy array-of-strings, and a
// non-JSON verbatim string. Plus one clean completed run as a control.
//
// Run with: node --experimental-strip-types scripts/seed-inglog002-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const TAG_NOTE = "inglog002-demo";

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Seed = {
  trigger: "manual" | "scheduled";
  status: "completed" | "failed";
  startedAt: Date;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
  errors: string | null;
};

const seeds: Seed[] = [
  {
    trigger: "scheduled",
    status: "failed",
    startedAt: new Date("2026-04-28T06:00:00.000Z"),
    itemsProcessed: 0,
    itemsFlagged: 0,
    itemsSuppressed: 0,
    errors: JSON.stringify({
      topLevel: `${TAG_NOTE}: pipeline aborted — Anthropic API returned 401 invalid x-api-key`,
      parserErrors: [
        { regulator: "SEC", error: "503 Service Unavailable from sec.gov RSS" },
        { regulator: "FINRA", error: "ETIMEDOUT after 30s" },
      ],
      driftErrors: [
        {
          regulatoryItemId: "demo-item-abc",
          error: "401 invalid x-api-key (Anthropic)",
        },
      ],
    }),
  },
  {
    trigger: "manual",
    status: "failed",
    startedAt: new Date("2026-05-02T14:30:00.000Z"),
    itemsProcessed: 0,
    itemsFlagged: 0,
    itemsSuppressed: 0,
    errors: JSON.stringify([
      `${TAG_NOTE}: simulated upstream timeout`,
      `${TAG_NOTE}: simulated rate-limit 429`,
    ]),
  },
  {
    trigger: "scheduled",
    status: "completed",
    startedAt: new Date("2026-05-04T06:00:00.000Z"),
    itemsProcessed: 19,
    itemsFlagged: 4,
    itemsSuppressed: 1,
    errors: null,
  },
];

const created: string[] = [];
for (const s of seeds) {
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: s.trigger,
      status: s.status,
      startedAt: s.startedAt,
      completedAt: new Date(s.startedAt.getTime() + 5 * 60 * 1000),
      itemsProcessed: s.itemsProcessed,
      itemsFlagged: s.itemsFlagged,
      itemsSuppressed: s.itemsSuppressed,
      errors: s.errors,
    },
  });
  created.push(run.id);
}

console.log(JSON.stringify({ tag: TAG_NOTE, runIds: created }));
await prisma.$disconnect();
