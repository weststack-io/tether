// Throwaway seed used for DETAIL-008 manual / Playwright verification.
// Creates one alert with a four-event audit history (created → escalated
// → reopened → accepted) under the tag "detail008-demo" and prints the
// alert id so the matching wipe script can clean it up.
//
// Run with: node --experimental-strip-types scripts/seed-detail008-demo.ts

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const TAG = "detail008-demo";

const adapter = new PrismaLibSql({ url: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const T_BASE = new Date("2026-04-12T09:00:00.000Z");
const T_ESCALATED = new Date(T_BASE.getTime() + 60 * 1000);
const T_REOPENED = new Date(T_BASE.getTime() + 10 * 60 * 1000);
const T_ACCEPTED = new Date(T_BASE.getTime() + 30 * 60 * 1000);

const run = await prisma.ingestionRun.create({
  data: { trigger: "manual", status: "completed", completedAt: new Date() },
});

const policy = await prisma.policyDocument.create({
  data: {
    title: `${TAG} timeline policy`,
    domain: "bsa_aml",
    fullText: `${TAG} body`,
    isSynthetic: true,
  },
});

const chunk = await prisma.policyChunk.create({
  data: {
    policyDocumentId: policy.id,
    sectionHeading: `${TAG} Section 1.0`,
    content: `${TAG} chunk content`,
    chunkIndex: 0,
  },
});

const item = await prisma.regulatoryItem.create({
  data: {
    sourceUrl: `https://${TAG}.example/${Math.random().toString(36).slice(2)}`,
    regulator: "SEC",
    publicationDate: T_BASE,
    documentType: "final_rule",
    title: `${TAG} regulatory item`,
    fullText: `${TAG} body`,
    ingestionRunId: run.id,
  },
});

const alert = await prisma.alert.create({
  data: {
    regulatoryItemId: item.id,
    policyChunkId: chunk.id,
    classification: "drifted",
    confidence: 0.81,
    severity: "medium",
    explanation: `${TAG} explanation`,
    regulatoryQuote: "regulatory quote",
    policyQuote: "policy quote",
    regulatorySourceUrl: item.sourceUrl,
    policyReference: `${policy.title} > ${chunk.sectionHeading}`,
    status: "accepted",
    createdAt: T_BASE,
  },
});

await prisma.auditEntry.create({
  data: {
    alertId: alert.id,
    actor: "system",
    action: "created",
    timestamp: T_BASE,
  },
});
await prisma.auditEntry.create({
  data: {
    alertId: alert.id,
    actor: "reviewer",
    action: "escalated",
    note: "Needs legal review — concurrent jurisdiction question",
    beforeState: JSON.stringify({ status: "open" }),
    afterState: JSON.stringify({ status: "escalated" }),
    timestamp: T_ESCALATED,
  },
});
await prisma.auditEntry.create({
  data: {
    alertId: alert.id,
    actor: "reviewer",
    action: "reopened",
    beforeState: JSON.stringify({ status: "escalated" }),
    afterState: JSON.stringify({ status: "open" }),
    timestamp: T_REOPENED,
  },
});
await prisma.auditEntry.create({
  data: {
    alertId: alert.id,
    actor: "reviewer",
    action: "accepted",
    beforeState: JSON.stringify({ status: "open" }),
    afterState: JSON.stringify({ status: "accepted" }),
    timestamp: T_ACCEPTED,
  },
});

console.log(JSON.stringify({ tag: TAG, runId: run.id, alertId: alert.id }));
await prisma.$disconnect();
