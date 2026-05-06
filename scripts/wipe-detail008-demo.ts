// Wipe matching seed-detail008-demo.ts fixtures. Idempotent.
// Run with: node --experimental-strip-types scripts/wipe-detail008-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const TAG = "detail008-demo";

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const items = await prisma.regulatoryItem.findMany({
  where: { title: { startsWith: `${TAG} ` } },
  select: { id: true, ingestionRunId: true },
});
const itemIds = items.map((i) => i.id);
const runIds = [...new Set(items.map((i) => i.ingestionRunId).filter(Boolean) as string[])];

if (itemIds.length > 0) {
  const alerts = await prisma.alert.findMany({
    where: { regulatoryItemId: { in: itemIds } },
    select: { id: true },
  });
  const alertIds = alerts.map((a) => a.id);
  if (alertIds.length > 0) {
    await prisma.auditEntry.deleteMany({ where: { alertId: { in: alertIds } } });
    await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
  }
  await prisma.regulatoryItem.deleteMany({ where: { id: { in: itemIds } } });
  if (runIds.length > 0) {
    await prisma.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
  }
}

const policies = await prisma.policyDocument.findMany({
  where: { title: { startsWith: `${TAG} ` } },
  select: { id: true },
});
const policyIds = policies.map((p) => p.id);
if (policyIds.length > 0) {
  await prisma.policyChunk.deleteMany({ where: { policyDocumentId: { in: policyIds } } });
  await prisma.policyDocument.deleteMany({ where: { id: { in: policyIds } } });
}

console.log(JSON.stringify({ tag: TAG, items: itemIds.length, policies: policyIds.length }));
await prisma.$disconnect();
