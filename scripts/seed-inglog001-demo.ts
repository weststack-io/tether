// Throwaway seed used for INGLOG-001 manual / Playwright verification.
// Creates four IngestionRun rows with deliberately staggered startedAt
// timestamps, mixed trigger types (manual / scheduled), and varied statuses
// (completed / failed / running) under fixed UTC instants so the rendered
// /ingestion table has visibly distinct rows.
//
// Run with: node --experimental-strip-types scripts/seed-inglog001-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const TAG_NOTE = "inglog001-demo";

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Seed = {
  trigger: "manual" | "scheduled";
  status: "completed" | "failed" | "running";
  startedAt: Date;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
  errors: string[] | null;
};

const seeds: Seed[] = [
  {
    trigger: "scheduled",
    status: "completed",
    startedAt: new Date("2026-04-30T06:00:00.000Z"),
    itemsProcessed: 42,
    itemsFlagged: 5,
    itemsSuppressed: 2,
    errors: null,
  },
  {
    trigger: "manual",
    status: "failed",
    startedAt: new Date("2026-05-01T14:30:00.000Z"),
    itemsProcessed: 11,
    itemsFlagged: 0,
    itemsSuppressed: 0,
    errors: [`${TAG_NOTE}: simulated upstream timeout`],
  },
  {
    trigger: "scheduled",
    status: "completed",
    startedAt: new Date("2026-05-04T06:00:00.000Z"),
    itemsProcessed: 28,
    itemsFlagged: 3,
    itemsSuppressed: 7,
    errors: null,
  },
  {
    trigger: "manual",
    status: "running",
    startedAt: new Date("2026-05-06T08:15:00.000Z"),
    itemsProcessed: 0,
    itemsFlagged: 0,
    itemsSuppressed: 0,
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
      completedAt:
        s.status === "running"
          ? null
          : new Date(s.startedAt.getTime() + 5 * 60 * 1000),
      itemsProcessed: s.itemsProcessed,
      itemsFlagged: s.itemsFlagged,
      itemsSuppressed: s.itemsSuppressed,
      errors: s.errors === null ? null : JSON.stringify(s.errors),
    },
  });
  created.push(run.id);
}

console.log(JSON.stringify({ tag: TAG_NOTE, runIds: created }));
await prisma.$disconnect();
