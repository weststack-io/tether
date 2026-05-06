// Throwaway seed used for the LIST-001 manual / Playwright verification
// screenshots. Creates a handful of alerts with mixed values on every
// sortable axis under the tag "list001-demo", then prints the seeded ids
// so the matching wipe script can clean them up afterwards.
//
// Run with: node --experimental-strip-types scripts/seed-list001-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

const TAG = "list001-demo";

const FIXTURES = [
  { regulator: "SEC",   severity: "high",   classification: "drifted",      status: "open",      domain: "bsa_aml",            daysAgo: 1  },
  { regulator: "FINRA", severity: "medium", classification: "ambiguous",    status: "escalated", domain: "complaint_handling", daysAgo: 3  },
  { regulator: "CFPB",  severity: "low",    classification: "drifted",      status: "open",      domain: "fair_lending",       daysAgo: 7  },
  { regulator: "OCC",   severity: "high",   classification: "contradicted", status: "open",      domain: "reg_e",              daysAgo: 12 },
  { regulator: "SEC",   severity: "medium", classification: "drifted",      status: "snoozed",   domain: "vendor_management",  daysAgo: 18 },
];

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const run = await prisma.ingestionRun.create({
  data: { trigger: "manual", status: "completed", completedAt: new Date() },
});

const domainToChunk = new Map<string, string>();
for (const f of FIXTURES) {
  if (domainToChunk.has(f.domain)) continue;
  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TAG} ${f.domain} policy`,
      domain: f.domain,
      fullText: `${TAG} body`,
      isSynthetic: true,
    },
  });
  const chunk = await prisma.policyChunk.create({
    data: {
      policyDocumentId: policy.id,
      sectionHeading: "Section 1",
      content: `${TAG} chunk content`,
      chunkIndex: 0,
    },
  });
  domainToChunk.set(f.domain, chunk.id);
}

const alertIds: string[] = [];
for (let i = 0; i < FIXTURES.length; i++) {
  const f = FIXTURES[i]!;
  const createdAt = new Date(Date.now() - f.daysAgo * 24 * 60 * 60 * 1000);
  const item = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: `https://${TAG}.example/${i}-${Math.random().toString(36).slice(2)}`,
      regulator: f.regulator,
      publicationDate: createdAt,
      documentType: "notice",
      title: `${TAG} regulatory item ${i}`,
      fullText: `${TAG} body ${i}`,
      ingestionRunId: run.id,
    },
  });
  const a = await prisma.alert.create({
    data: {
      regulatoryItemId: item.id,
      policyChunkId: domainToChunk.get(f.domain)!,
      classification: f.classification,
      confidence: 0.9,
      severity: f.severity,
      explanation: `${TAG} explanation ${i}`,
      regulatoryQuote: "regulatory quote",
      policyQuote: "policy quote",
      regulatorySourceUrl: item.sourceUrl,
      policyReference: `policy ref ${i}`,
      status: f.status,
      createdAt,
    },
  });
  alertIds.push(a.id);
}

console.log(JSON.stringify({ tag: TAG, runId: run.id, alertIds }));
await prisma.$disconnect();
