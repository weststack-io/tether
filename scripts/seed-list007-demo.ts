// Throwaway seed for the LIST-007 manual / Playwright pagination
// verification screenshots. Creates 32 alerts under the tag
// "list007-demo" -- enough to span 2 pages at PAGE_SIZE=25.
//
// Run with: node --experimental-strip-types scripts/seed-list007-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

const TAG = "list007-demo";
const COUNT = 32;

const REGULATORS = ["SEC", "FINRA", "CFPB", "OCC"] as const;
const SEVERITIES = ["high", "medium", "low"] as const;
const STATUSES = ["open", "accepted", "dismissed", "escalated", "snoozed"] as const;
const CLASSIFICATIONS = [
  "drifted",
  "ambiguous",
  "contradicted",
  "aligned",
  "no_material_impact",
] as const;
const DOMAINS = [
  "bsa_aml",
  "complaint_handling",
  "fair_lending",
  "reg_e",
  "reg_z",
  "vendor_management",
  "info_security",
  "cip",
  "overdraft",
  "marketing",
] as const;

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const run = await prisma.ingestionRun.create({
  data: { trigger: "manual", status: "completed", completedAt: new Date() },
});

// One policy/chunk per domain, reused across alerts.
const domainToChunk = new Map<string, string>();
for (const domain of DOMAINS) {
  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TAG} ${domain} policy`,
      domain,
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
  domainToChunk.set(domain, chunk.id);
}

const alertIds: string[] = [];
for (let i = 0; i < COUNT; i++) {
  const reg = REGULATORS[i % REGULATORS.length]!;
  const sev = SEVERITIES[i % SEVERITIES.length]!;
  const st = STATUSES[i % STATUSES.length]!;
  const cls = CLASSIFICATIONS[i % CLASSIFICATIONS.length]!;
  const dom = DOMAINS[i % DOMAINS.length]!;
  // Stagger createdAt by hours so the date-desc default sort produces a
  // deterministic ordering across the 32 rows.
  const createdAt = new Date(Date.now() - i * 60 * 60 * 1000);
  const item = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: `https://${TAG}.example/${i}-${Math.random().toString(36).slice(2)}`,
      regulator: reg,
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
      policyChunkId: domainToChunk.get(dom)!,
      classification: cls,
      confidence: 0.9,
      severity: sev,
      explanation: `${TAG} explanation ${i}`,
      regulatoryQuote: "regulatory quote",
      policyQuote: "policy quote",
      regulatorySourceUrl: item.sourceUrl,
      policyReference: `policy ref ${i}`,
      status: st,
      createdAt,
    },
  });
  alertIds.push(a.id);
}

console.log(JSON.stringify({ tag: TAG, runId: run.id, count: alertIds.length }));
await prisma.$disconnect();
