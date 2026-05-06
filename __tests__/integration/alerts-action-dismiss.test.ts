// API-008: POST /api/alerts/:id/action dismiss path.
//
// Seeds an alert in status='open', POSTs { action: 'dismiss', reason: ... },
// asserts the alert row is now status='dismissed' with dismissReason populated,
// the response payload reflects the updated status, and a single AuditEntry
// was written with actor='reviewer', action='dismissed', the reason in the
// note field, and before/after state JSON containing the prior and new status.
// Also exercises the missing-reason validation and 404 (unknown id) negative
// paths.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { POST } from "@/app/api/alerts/[id]/action/route";
import { prisma } from "@/lib/db";

const TEST_TAG = "alerts-action-dismiss-test";

let createdRunId: string | null = null;
let createdRegItemId: string | null = null;
let createdPolicyId: string | null = null;
let createdChunkId: string | null = null;
let createdAlertId: string | null = null;

const REG_TITLE = `${TEST_TAG} regulatory item`;
const REG_FULL_TEXT = `${TEST_TAG} regulatory full text`;
const REG_SOURCE_URL = `https://${TEST_TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const POLICY_TITLE = `${TEST_TAG} policy doc`;
const POLICY_DOMAIN = "fair_lending";
const POLICY_FULL_TEXT = `${TEST_TAG} policy full text`;
const CHUNK_CONTENT = `${TEST_TAG} chunk content`;
const CHUNK_HEADING = `${TEST_TAG} section heading`;

const REASON = "false_positive";

async function seedOpenAlert(): Promise<void> {
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
      chunkIndex: 0,
    },
  });
  createdChunkId = chunk.id;

  const regItem = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: REG_SOURCE_URL,
      regulator: "CFPB",
      publicationDate: new Date("2026-04-01T00:00:00Z"),
      documentType: "guidance",
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
      classification: "ambiguous",
      confidence: 0.62,
      severity: "medium",
      explanation: `${TEST_TAG} explanation`,
      regulatoryQuote: `${TEST_TAG} regulatory quote`,
      policyQuote: `${TEST_TAG} policy quote`,
      regulatorySourceUrl: REG_SOURCE_URL,
      policyReference: `${POLICY_TITLE} > ${CHUNK_HEADING}`,
      status: "open",
    },
  });
  createdAlertId = alert.id;
}

async function resetAlertToOpen(): Promise<void> {
  if (!createdAlertId) return;
  await prisma.auditEntry.deleteMany({ where: { alertId: createdAlertId } });
  await prisma.alert.update({
    where: { id: createdAlertId },
    data: { status: "open", dismissReason: null },
  });
}

async function postAction(id: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/alerts/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("POST /api/alerts/:id/action dismiss (API-008)", () => {
  beforeAll(async () => {
    await seedOpenAlert();
  });

  beforeEach(async () => {
    await resetAlertToOpen();
  });

  afterAll(async () => {
    if (createdAlertId) {
      await prisma.auditEntry.deleteMany({
        where: { alertId: createdAlertId },
      });
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

  it("transitions an open alert to dismissed and stores dismissReason", async () => {
    const res = await postAction(createdAlertId!, {
      action: "dismiss",
      reason: REASON,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.id).toBe(createdAlertId);
    expect(body.status).toBe("dismissed");
    expect(body.dismissReason).toBe(REASON);

    const row = await prisma.alert.findUnique({
      where: { id: createdAlertId! },
    });
    expect(row?.status).toBe("dismissed");
    expect(row?.dismissReason).toBe(REASON);
  });

  it("creates an AuditEntry with action='dismissed' and reason in note", async () => {
    const res = await postAction(createdAlertId!, {
      action: "dismiss",
      reason: REASON,
    });
    expect(res.status).toBe(200);

    const entries = await prisma.auditEntry.findMany({
      where: { alertId: createdAlertId! },
      orderBy: { timestamp: "asc" },
    });
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.actor).toBe("reviewer");
    expect(entry.action).toBe("dismissed");
    expect(entry.note).toBe(REASON);
  });

  it("audit entry beforeState contains 'open' and afterState contains 'dismissed'", async () => {
    const res = await postAction(createdAlertId!, {
      action: "dismiss",
      reason: REASON,
    });
    expect(res.status).toBe(200);

    const entries = await prisma.auditEntry.findMany({
      where: { alertId: createdAlertId! },
    });
    expect(entries.length).toBe(1);
    const entry = entries[0]!;

    expect(typeof entry.beforeState).toBe("string");
    expect(typeof entry.afterState).toBe("string");
    expect(entry.beforeState).toContain("open");
    expect(entry.afterState).toContain("dismissed");

    const before = JSON.parse(entry.beforeState as string) as Record<string, unknown>;
    const after = JSON.parse(entry.afterState as string) as Record<string, unknown>;
    expect(before.status).toBe("open");
    expect(after.status).toBe("dismissed");
    expect(after.dismissReason).toBe(REASON);
  });

  it("response payload includes the new audit entry in auditEntries[]", async () => {
    const res = await postAction(createdAlertId!, {
      action: "dismiss",
      reason: REASON,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    const entries = body.auditEntries as Array<Record<string, unknown>>;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(1);
    expect(entries[0]!.action).toBe("dismissed");
    expect(entries[0]!.actor).toBe("reviewer");
    expect(entries[0]!.note).toBe(REASON);
  });

  it("returns 400 when 'reason' is missing from the body", async () => {
    const res = await postAction(createdAlertId!, { action: "dismiss" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect((body.error as string).toLowerCase()).toContain("reason");

    const row = await prisma.alert.findUnique({
      where: { id: createdAlertId! },
    });
    expect(row?.status).toBe("open");
    expect(row?.dismissReason).toBeNull();
  });

  it("returns 400 when 'reason' is an empty string", async () => {
    const res = await postAction(createdAlertId!, {
      action: "dismiss",
      reason: "   ",
    });
    expect(res.status).toBe(400);

    const row = await prisma.alert.findUnique({
      where: { id: createdAlertId! },
    });
    expect(row?.status).toBe("open");
    expect(row?.dismissReason).toBeNull();
  });

  it("returns 404 when the alert does not exist", async () => {
    const res = await postAction("does-not-exist-id", {
      action: "dismiss",
      reason: REASON,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Alert not found");
    expect(body.id).toBe("does-not-exist-id");
  });
});
