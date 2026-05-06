// DETAIL-005 verification harness.
//
// Asserts the alert detail page (/alerts/[id]/page.tsx) exposes a Dismiss
// disclosure with a reason-code <select> listing the six spec-defined codes,
// and that the dismissAlert server action transitions the alert from "open"
// to "dismissed" while persisting the chosen reason on the alert row + audit
// entry.
//
// The Dismiss button is wired to a Next.js server action (dismissAlert /
// dismissAlertFromForm in src/app/alerts/[id]/actions.ts). For this test we
// exercise the server action directly (it's a regular async function once
// imported) and then refetch the rendered HTML to verify the page reflects
// the new state.
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
import { dismissAlert } from "@/app/alerts/[id]/actions";
import { DISMISS_REASON_CODES } from "@/app/alerts/[id]/dismiss-reasons";

const TAG = "detail005-verify";

const REG_TITLE = `${TAG} regulatory item title`;
const REG_FULL_TEXT = `${TAG} regulatory full body`;
const REG_QUOTE = `${TAG} regulatory quote`;
const REG_SOURCE_URL = `https://${TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const REG_REGULATOR = "SEC";
const REG_DOCUMENT_TYPE = "final_rule";
const REG_PUBLICATION_DATE = new Date("2095-04-12T00:00:00Z");

const POLICY_TITLE = `${TAG} dismiss policy`;
const POLICY_DOMAIN = "bsa_aml";
const POLICY_FULL_TEXT = `${TAG} policy full text`;
const CHUNK_HEADING = `${TAG} Section 1.0`;
const CHUNK_CONTENT = `${TAG} chunk content`;
const POLICY_QUOTE = `${TAG} policy quote`;

const POLICY_REFERENCE = `${POLICY_TITLE} > ${CHUNK_HEADING}`;

const EXPLANATION = `${TAG} dismiss-button verification body.`;

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
      confidence: 0.81,
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

function findFormHtml(html: string, testId: string): string | null {
  // Match the entire <form ...>...</form> block whose data-testid matches.
  const re = new RegExp(
    `<form[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</form>`,
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

describe("DETAIL-005 alert detail dismiss button (live UI)", () => {
  // First detail-page render after a dev-server bounce can exceed the default
  // 5s Jest timeout; also, the server action submits a transaction that the
  // page then reloads.
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

  it("renders the Dismiss disclosure with a reason-code selector listing the six spec codes", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    // Status badge reflects the seeded "open" status.
    const statusBadgeOpening = findTagOpening(html, "alert-detail-status-badge");
    expect(statusBadgeOpening).not.toBeNull();
    expect(statusBadgeOpening!).toContain('data-status="open"');

    // Dismiss control is rendered as a <details> disclosure with a summary
    // acting as the trigger button.
    const controlOpening = findTagOpening(
      html,
      "alert-detail-dismiss-control",
    );
    expect(controlOpening).not.toBeNull();
    expect(controlOpening!.startsWith("<details ")).toBe(true);

    const dismissButtonOpening = findTagOpening(
      html,
      "alert-detail-dismiss-button",
    );
    expect(dismissButtonOpening).not.toBeNull();
    // While open, the dismiss trigger is the <summary> of the <details>.
    expect(dismissButtonOpening!.startsWith("<summary ")).toBe(true);
    expect(dismissButtonOpening!).toContain('data-action="dismiss"');

    // The form is server-rendered inside the disclosure.
    const formHtml = findFormHtml(html, "alert-detail-dismiss-form");
    expect(formHtml).not.toBeNull();

    // The select exposes all six DETAIL-005 reason codes from app_spec.txt.
    const selectOpening = findTagOpening(
      html,
      "alert-detail-dismiss-reason-select",
    );
    expect(selectOpening).not.toBeNull();
    expect(selectOpening!.startsWith("<select ")).toBe(true);
    expect(selectOpening!).toContain('name="reason"');

    const optionOpenings = findAllTagOpenings(
      html,
      "alert-detail-dismiss-reason-option",
    );
    const optionCodes = optionOpenings
      .map((tag) => {
        const m = tag.match(/data-reason-code="([^"]+)"/);
        return m ? m[1]! : null;
      })
      .filter((c): c is string => c !== null);
    expect(new Set(optionCodes)).toEqual(new Set(DISMISS_REASON_CODES));
    // No duplicates.
    expect(optionCodes.length).toBe(DISMISS_REASON_CODES.length);

    // Confirm submit button.
    const confirmOpening = findTagOpening(
      html,
      "alert-detail-dismiss-confirm-button",
    );
    expect(confirmOpening).not.toBeNull();
    expect(confirmOpening!.startsWith("<button ")).toBe(true);
    expect(confirmOpening!).toContain('type="submit"');
  });

  it("transitions status to 'dismissed' and persists the reason when the server action runs", async () => {
    await dismissAlert(createdAlertId!, "false_positive");

    const updated = await prisma.alert.findUnique({
      where: { id: createdAlertId! },
      include: { auditEntries: true },
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("dismissed");
    expect(updated!.dismissReason).toBe("false_positive");
    expect(updated!.auditEntries.length).toBe(1);
    const entry = updated!.auditEntries[0]!;
    expect(entry.action).toBe("dismissed");
    expect(entry.actor).toBe("reviewer");
    expect(entry.note).toBe("false_positive");
    expect(entry.beforeState).not.toBeNull();
    expect(entry.afterState).not.toBeNull();
    expect(JSON.parse(entry.beforeState!)).toEqual({ status: "open" });
    expect(JSON.parse(entry.afterState!)).toEqual({
      status: "dismissed",
      dismissReason: "false_positive",
    });
  });

  it("re-renders the detail page with the dismissed status badge + locked Dismiss button", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    const statusBadgeOpening = findTagOpening(html, "alert-detail-status-badge");
    expect(statusBadgeOpening).not.toBeNull();
    expect(statusBadgeOpening!).toContain('data-status="dismissed"');
    // zinc palette is the dismissed-status color in STATUS_BADGE_CLASS.
    expect(statusBadgeOpening!).toMatch(/bg-zinc-100/);

    // The summary block now exposes the dismissReason via data-attribute.
    const summaryOpening = findTagOpening(html, "alert-detail-summary");
    expect(summaryOpening).not.toBeNull();
    expect(summaryOpening!).toContain('data-dismiss-reason="false_positive"');

    // Dismiss disclosure is replaced by a disabled <button>.
    const dismissButtonOpening = findTagOpening(
      html,
      "alert-detail-dismiss-button",
    );
    expect(dismissButtonOpening).not.toBeNull();
    expect(dismissButtonOpening!.startsWith("<button ")).toBe(true);
    expect(/(?<=\s)disabled(\s|=|>)/.test(dismissButtonOpening!)).toBe(true);

    const lockedHint = findTagOpening(
      html,
      "alert-detail-dismiss-locked-hint",
    );
    expect(lockedHint).not.toBeNull();
  });

  it("renders the dismiss audit entry inside the audit history list", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const auditList = findTagOpening(html, "alert-detail-audit-list");
    expect(auditList).not.toBeNull();
    // DETAIL-008: timeline now includes a synthesized "created" pseudo-row
    // (alert.createdAt) whenever the DB lacks a real `action: "created"`
    // entry. Count is 2 (dismissed action + created event), newest first.
    expect(auditList!).toContain('data-audit-count="2"');

    const entries = findAllTagOpenings(html, "alert-detail-audit-entry");
    expect(entries.length).toBe(2);
    expect(entries[0]!).toContain('data-action="dismissed"');
    expect(entries[0]!).toContain('data-actor="reviewer"');
    expect(entries[1]!).toContain('data-action="created"');
    expect(entries[1]!).toContain('data-actor="system"');
  });
});
