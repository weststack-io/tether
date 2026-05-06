// DETAIL-004 verification harness.
//
// Asserts the alert detail page (/alerts/[id]/page.tsx) exposes an Accept
// button + status badge that, when invoked, transitions the alert from
// "open" to "accepted", creates an audit entry, and re-renders the page
// with the updated status badge.
//
// The Accept button is wired to a Next.js server action (acceptAlert in
// src/app/alerts/[id]/actions.ts). For this test we exercise the server
// action directly (it's a regular async function once imported) and then
// refetch the rendered HTML to verify the page reflects the new state.
//
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { prisma } from "@/lib/db";
import { acceptAlert } from "@/app/alerts/[id]/actions";

const TAG = "detail004-verify";

const REG_TITLE = `${TAG} regulatory item title`;
const REG_FULL_TEXT = `${TAG} regulatory full body`;
const REG_QUOTE = `${TAG} regulatory quote`;
const REG_SOURCE_URL = `https://${TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const REG_REGULATOR = "SEC";
const REG_DOCUMENT_TYPE = "final_rule";
const REG_PUBLICATION_DATE = new Date("2095-04-12T00:00:00Z");

const POLICY_TITLE = `${TAG} acceptance policy`;
const POLICY_DOMAIN = "bsa_aml";
const POLICY_FULL_TEXT = `${TAG} policy full text`;
const CHUNK_HEADING = `${TAG} Section 1.0`;
const CHUNK_CONTENT = `${TAG} chunk content`;
const POLICY_QUOTE = `${TAG} policy quote`;

const POLICY_REFERENCE = `${POLICY_TITLE} > ${CHUNK_HEADING}`;

const EXPLANATION = `${TAG} accept-button verification body.`;

let createdRunId: string | null = null;
let createdRegItemId: string | null = null;
let createdPolicyId: string | null = null;
let createdChunkId: string | null = null;
let createdAlertId: string | null = null;

async function purgeStaleFixtures(): Promise<void> {
  const stale = await prisma.regulatoryItem.findMany({
    where: { title: { startsWith: `${TAG} ` } },
    select: { id: true, ingestionRunId: true },
  });
  if (stale.length > 0) {
    const itemIds = stale.map((s) => s.id);
    const runIds = [
      ...new Set(stale.map((s) => s.ingestionRunId).filter(Boolean) as string[]),
    ];
    const alerts = await prisma.alert.findMany({
      where: { regulatoryItemId: { in: itemIds } },
      select: { id: true },
    });
    const alertIds = alerts.map((a) => a.id);
    if (alertIds.length > 0) {
      await prisma.auditEntry.deleteMany({
        where: { alertId: { in: alertIds } },
      });
      await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
    }
    await prisma.regulatoryItem.deleteMany({ where: { id: { in: itemIds } } });
    if (runIds.length > 0) {
      await prisma.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
    }
  }
  const stalePolicies = await prisma.policyDocument.findMany({
    where: { title: { startsWith: `${TAG} ` } },
    select: { id: true },
  });
  if (stalePolicies.length > 0) {
    const policyIds = stalePolicies.map((p) => p.id);
    await prisma.policyChunk.deleteMany({
      where: { policyDocumentId: { in: policyIds } },
    });
    await prisma.policyDocument.deleteMany({
      where: { id: { in: policyIds } },
    });
  }
}

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
      chunkIndex: 0,
    },
  });
  createdChunkId = chunk.id;

  const regItem = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: REG_SOURCE_URL,
      regulator: REG_REGULATOR,
      publicationDate: REG_PUBLICATION_DATE,
      documentType: REG_DOCUMENT_TYPE,
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
      confidence: 0.77,
      severity: "medium",
      explanation: EXPLANATION,
      regulatoryQuote: REG_QUOTE,
      policyQuote: POLICY_QUOTE,
      regulatorySourceUrl: REG_SOURCE_URL,
      policyReference: POLICY_REFERENCE,
      status: "open",
    },
  });
  createdAlertId = alert.id;
}

async function fetchDetailHtml(
  id: string,
): Promise<{ status: number; html: string }> {
  const url = `http://localhost:3000/alerts/${id}`;
  const res = await fetch(url, { cache: "no-store" });
  return { status: res.status, html: await res.text() };
}

function findTag(html: string, testId: string): string | null {
  const re = new RegExp(
    `<[a-zA-Z]+[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</[a-zA-Z]+>`,
  );
  const m = html.match(re);
  return m ? m[1]! : null;
}

function findTagOpening(html: string, testId: string): string | null {
  const re = new RegExp(`<[a-zA-Z]+[^>]*data-testid="${testId}"[^>]*>`);
  const m = html.match(re);
  return m ? m[0] : null;
}

function findAllTagOpenings(html: string, testId: string): string[] {
  const re = new RegExp(
    `<[a-zA-Z]+[^>]*data-testid="${testId}"[^>]*>`,
    "g",
  );
  return Array.from(html.matchAll(re)).map((m) => m[0]);
}

describe("DETAIL-004 alert detail accept button (live UI)", () => {
  // First detail-page render after a dev-server bounce can exceed the default
  // 5s Jest timeout; also, the server action submits a transaction that the
  // page then reloads, so give the suite extra headroom.
  jest.setTimeout(30000);

  beforeAll(async () => {
    await purgeStaleFixtures();
    await seedAlert();
    if (createdAlertId) {
      // Warm up the route compile.
      await fetchDetailHtml(createdAlertId);
    }
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

  it("renders the alert with status 'open' and an enabled Accept button", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    // Status badge reflects the seeded "open" status.
    const statusBadgeOpening = findTagOpening(html, "alert-detail-status-badge");
    expect(statusBadgeOpening).not.toBeNull();
    expect(statusBadgeOpening!).toContain('data-status="open"');

    const statusBadgeInner = findTag(html, "alert-detail-status-badge");
    expect(statusBadgeInner).not.toBeNull();
    expect(statusBadgeInner!.toLowerCase()).toContain("open");

    // Accept button is rendered inside an action bar card.
    const actionsCardOpening = findTagOpening(html, "alert-detail-actions");
    expect(actionsCardOpening).not.toBeNull();

    const acceptOpening = findTagOpening(html, "alert-detail-accept-button");
    expect(acceptOpening).not.toBeNull();
    // Must be a real submit button, not a styled span.
    expect(acceptOpening!.startsWith("<button ")).toBe(true);
    expect(acceptOpening!).toContain('type="submit"');
    expect(acceptOpening!).toContain('data-action="accept"');
    // Open status -> button is enabled (no disabled attribute on the opening tag).
    expect(/(?<=\s)disabled(\s|=|>)/.test(acceptOpening!)).toBe(false);

    // Audit history starts empty (no actions taken yet).
    const auditEmpty = findTagOpening(html, "alert-detail-audit-empty");
    expect(auditEmpty).not.toBeNull();
  });

  it("transitions status to 'accepted' when the Accept server action runs", async () => {
    await acceptAlert(createdAlertId!);

    // DB state: alert status flipped, an audit entry recorded.
    const updated = await prisma.alert.findUnique({
      where: { id: createdAlertId! },
      include: { auditEntries: true },
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("accepted");
    expect(updated!.auditEntries.length).toBe(1);
    const entry = updated!.auditEntries[0]!;
    expect(entry.action).toBe("accepted");
    expect(entry.actor).toBe("reviewer");
    expect(entry.beforeState).not.toBeNull();
    expect(entry.afterState).not.toBeNull();
    expect(JSON.parse(entry.beforeState!)).toEqual({ status: "open" });
    expect(JSON.parse(entry.afterState!)).toEqual({ status: "accepted" });
  });

  it("re-renders the detail page with the updated status badge", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    // Status badge now reflects accepted.
    const statusBadgeOpening = findTagOpening(html, "alert-detail-status-badge");
    expect(statusBadgeOpening).not.toBeNull();
    expect(statusBadgeOpening!).toContain('data-status="accepted"');

    const statusBadgeInner = findTag(html, "alert-detail-status-badge");
    expect(statusBadgeInner).not.toBeNull();
    expect(statusBadgeInner!.toLowerCase()).toContain("accepted");
    // emerald palette is the accepted-status color in STATUS_BADGE_CLASS.
    expect(statusBadgeOpening!).toMatch(/bg-emerald-50/);

    // Accept button is now disabled (already accepted).
    const acceptOpening = findTagOpening(html, "alert-detail-accept-button");
    expect(acceptOpening).not.toBeNull();
    expect(/(?<=\s)disabled(\s|=|>)/.test(acceptOpening!)).toBe(true);
  });

  it("renders the new audit entry inside the audit history list", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const auditList = findTagOpening(html, "alert-detail-audit-list");
    expect(auditList).not.toBeNull();
    expect(auditList!).toContain('data-audit-count="1"');

    // Empty-state placeholder is gone now that an entry exists.
    const auditEmpty = findTagOpening(html, "alert-detail-audit-empty");
    expect(auditEmpty).toBeNull();

    const entries = findAllTagOpenings(html, "alert-detail-audit-entry");
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry).toContain('data-action="accepted"');
    expect(entry).toContain('data-actor="reviewer"');
  });
});
