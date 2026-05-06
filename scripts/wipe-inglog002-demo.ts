// Companion wipe for scripts/seed-inglog002-demo.ts. Idempotent: deletes
// IngestionRun rows whose startedAt matches one of the three fixed seed
// timestamps. Mirrors scripts/wipe-inglog001-demo.ts.
//
// Run with: node --experimental-strip-types scripts/wipe-inglog002-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SEEDED_STARTED_AT = [
  new Date("2026-04-28T06:00:00.000Z"),
  new Date("2026-05-02T14:30:00.000Z"),
  new Date("2026-05-04T06:00:00.000Z"),
];

const result = await prisma.ingestionRun.deleteMany({
  where: { startedAt: { in: SEEDED_STARTED_AT } },
});

console.log(JSON.stringify({ deleted: result.count }));
await prisma.$disconnect();
