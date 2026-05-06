// API-006: GET /api/alerts/:id alert detail endpoint.
//
// Seeds a single alert tied to a regulatory item, policy chunk + parent
// policy document, and a couple of audit entries. Asserts the response
// surfaces the full regulatoryItem (including fullText/sourceUrl/title), the
// policyChunk with its parent policyDocument, and the auditEntries array in
// chronological order. Also exercises the 404 path.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { GET } from "@/app/api/alerts/[id]/route";
import { prisma } from "@/lib/db";

const TEST_TAG = "alerts-detail-test";

let createdRunId: string | null = null;
let createdRegItemId: string | null = null;
let createdPolicyId: string | null = null;
let createdChunkId: string | null = null;
let createdAlertId: string | null = null;
const createdAuditIds: string[] = [];

const REG_TITLE = `${TEST_TAG} regulatory item`;
const REG_FULL_TEXT = `${TEST_TAG} regulatory full text body for assertions`;
const REG_SOURCE_URL = `https://${TEST_TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const POLICY_TITLE = `${TEST_TAG} policy doc`;
const POLICY_DOMAIN = "bsa_aml";
const POLICY_FULL_TEXT = `${TEST_TAG} policy full text body`;
const CHUNK_CONTENT = `${TEST_TAG} chunk content body`;
const CHUNK_HEADING = `${TEST_TAG} section heading`;

async function seedAlert(): Promise<void> {
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: "manual",
      status: "completed",
      completedAt: new Date(),
    },
  });
  createdRunId = run.id;

  const policy = await prisma.policyDocument.create({
    data: {
      title: POLICY_TITLE,
      domain: POLICY_DOMAIN,
      fullText: POLICY_FULL_TEXT,
      isSynthetic: true,
    },
  });
  createdPolicyId = policy.id;

  const chunk = await prisma.policyChunk.create({
    data: {
      policyDocumentId: policy.id,
      sectionHeading: CHUNK_HEADING,
      content: CHUNK_CONTENT,
      chunkIndex: 3,
    },
  });
  createdChunkId = chunk.id;

  const regItem = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: REG_SOURCE_URL,
      regulator: "SEC",
      publicationDate: new Date("2026-04-01T00:00:00Z"),
      documentType: "final_rule",
      title: REG_TITLE,
      fullText: REG_FULL_TEXT,
      ingestionRunId: run.id,
    },
  });
  createdRegItemId = regItem.id;

  const alert = await prisma.alert.create({
    data: {
      regulatoryItemId: regItem.id,
      policyChunkId: chunk.id,
      classification: "drifted",
      confidence: 0.88,
      severity: "high",
      explanation: `${TEST_TAG} explanation`,
      regulatoryQuote: `${TEST_TAG} regulatory quote`,
      policyQuote: `${TEST_TAG} policy quote`,
      regulatorySourceUrl: REG_SOURCE_URL,
      policyReference: `${POLICY_TITLE} > ${CHUNK_HEADING}`,
      status: "open",
    },
  });
  createdAlertId = alert.id;

  // Two audit entries with strictly ordered timestamps so we can assert the
  // route returns them in chronological order. The "created" entry is what
  // the alert-creation code path would normally emit; we add a second
  // "snoozed" entry to prove ordering works for >1 entry.
  const created1 = await prisma.auditEntry.create({
    data: {
      alertId: alert.id,
      actor: "system",
      action: "created",
      afterState: JSON.stringify({ status: "open" }),
      timestamp: new Date("2026-04-01T01:00:00Z"),
    },
  });
  createdAuditIds.push(created1.id);

  const created2 = await prisma.auditEntry.create({
    data: {
      alertId: alert.id,
      actor: "reviewer",
      action: "snoozed",
      beforeState: JSON.stringify({ status: "open" }),
      afterState: JSON.stringify({ status: "snoozed" }),
      note: `${TEST_TAG} reviewer note`,
      timestamp: new Date("2026-04-02T01:00:00Z"),
    },
  });
  createdAuditIds.push(created2.id);
}

async function fetchAlert(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/alerts/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/alerts/:id (API-006)", () => {
  beforeAll(async () => {
    await seedAlert();
  });

  afterAll(async () => {
    if (createdAuditIds.length > 0) {
      await prisma.auditEntry.deleteMany({
        where: { id: { in: createdAuditIds } },
      });
    }
    if (createdAlertId) {
      await prisma.alert.delete({ where: { id: createdAlertId } });
    }
    if (createdRegItemId) {
      await prisma.regulatoryItem.delete({ where: { id: createdRegItemId } });
    }
    if (createdChunkId) {
      await prisma.policyChunk.delete({ where: { id: createdChunkId } });
    }
    if (createdPolicyId) {
      await prisma.policyDocument.delete({ where: { id: createdPolicyId } });
    }
    if (createdRunId) {
      await prisma.ingestionRun.delete({ where: { id: createdRunId } });
    }
    await prisma.$disconnect();
  });

  it("returns the alert with full regulatoryItem (sourceUrl/title/fullText)", async () => {
    const res = await fetchAlert(createdAlertId!);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.id).toBe(createdAlertId);
    expect(body.severity).toBe("high");
    expect(body.classification).toBe("drifted");
    expect(body.status).toBe("open");

    const regItem = body.regulatoryItem as Record<string, unknown>;
    expect(regItem).toBeDefined();
    expect(regItem.id).toBe(createdRegItemId);
    expect(regItem.sourceUrl).toBe(REG_SOURCE_URL);
    expect(regItem.title).toBe(REG_TITLE);
    expect(regItem.fullText).toBe(REG_FULL_TEXT);
    expect(regItem.regulator).toBe("SEC");
    expect(regItem.documentType).toBe("final_rule");
  });

  it("returns the policyChunk with content and parent policyDocument", async () => {
    const res = await fetchAlert(createdAlertId!);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    const chunk = body.policyChunk as Record<string, unknown>;
    expect(chunk).toBeDefined();
    expect(chunk.id).toBe(createdChunkId);
    expect(chunk.content).toBe(CHUNK_CONTENT);
    expect(chunk.sectionHeading).toBe(CHUNK_HEADING);
    expect(chunk.chunkIndex).toBe(3);

    const doc = chunk.policyDocument as Record<string, unknown>;
    expect(doc).toBeDefined();
    expect(doc.id).toBe(createdPolicyId);
    expect(doc.title).toBe(POLICY_TITLE);
    expect(doc.domain).toBe(POLICY_DOMAIN);
    expect(doc.fullText).toBe(POLICY_FULL_TEXT);
  });

  it("returns auditEntries[] in chronological order", async () => {
    const res = await fetchAlert(createdAlertId!);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    const entries = body.auditEntries as Array<Record<string, unknown>>;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(2);

    expect(entries[0]!.action).toBe("created");
    expect(entries[0]!.actor).toBe("system");
    expect(entries[1]!.action).toBe("snoozed");
    expect(entries[1]!.actor).toBe("reviewer");
    expect(entries[1]!.note).toBe(`${TEST_TAG} reviewer note`);

    const t0 = new Date(entries[0]!.timestamp as string).getTime();
    const t1 = new Date(entries[1]!.timestamp as string).getTime();
    expect(t1).toBeGreaterThan(t0);
  });

  it("returns 404 when the alert id does not exist", async () => {
    const res = await fetchAlert("does-not-exist-id");
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Alert not found");
    expect(body.id).toBe("does-not-exist-id");
  });
});
