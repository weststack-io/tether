// Wipes IngestionRun rows seeded by scripts/seed-inglog001-demo.ts.
// Identifies them by the fixed startedAt UTC instants used by the seeder.
// Idempotent — re-running has no effect once the rows are gone.
//
// Run with: node --experimental-strip-types scripts/wipe-inglog001-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SEED_TIMESTAMPS = [
  new Date("2026-04-30T06:00:00.000Z"),
  new Date("2026-05-01T14:30:00.000Z"),
  new Date("2026-05-04T06:00:00.000Z"),
  new Date("2026-05-06T08:15:00.000Z"),
];

const result = await prisma.ingestionRun.deleteMany({
  where: { startedAt: { in: SEED_TIMESTAMPS } },
});

console.log(JSON.stringify({ deleted: result.count }));
await prisma.$disconnect();
