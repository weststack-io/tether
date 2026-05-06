// DETAIL-007 verification harness.
//
// Asserts the alert detail page (/alerts/[id]/page.tsx) exposes a Snooze
// disclosure with a date picker for a required snoozeUntil date, and that
// the snoozeAlert server action transitions the alert from "open" to
// "snoozed" while persisting the snoozeUntil DateTime on the alert row +
// audit entry.
//
// The Snooze button is wired to a Next.js server action (snoozeAlert /
// snoozeAlertFromForm in src/app/alerts/[id]/actions.ts). For this test we
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
import { snoozeAlert } from "@/app/alerts/[id]/actions";

const TAG = "detail007-verify";

const REG_TITLE = `${TAG} regulatory item title`;
const REG_FULL_TEXT = `${TAG} regulatory full body`;
const REG_QUOTE = `${TAG} regulatory quote`;
const REG_SOURCE_URL = `https://${TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const REG_REGULATOR = "SEC";
const REG_DOCUMENT_TYPE = "final_rule";
const REG_PUBLICATION_DATE = new Date("2095-04-12T00:00:00Z");

const POLICY_TITLE = `${TAG} snooze policy`;
const POLICY_DOMAIN = "bsa_aml";
const POLICY_FULL_TEXT = `${TAG} policy full text`;
const CHUNK_HEADING = `${TAG} Section 1.0`;
const CHUNK_CONTENT = `${TAG} chunk content`;
const POLICY_QUOTE = `${TAG} policy quote`;

const POLICY_REFERENCE = `${POLICY_TITLE} > ${CHUNK_HEADING}`;

const EXPLANATION = `${TAG} snooze-button verification body.`;

// 14 days in the future — well after `tomorrowIso` so it should always pass
// the API-010 future-date validation regardless of timezone.
const SNOOZE_UNTIL_DATE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const SNOOZE_UNTIL_DATE_STR = SNOOZE_UNTIL_DATE.toISOString().slice(0, 10);
const SNOOZE_UNTIL_ISO = new Date(
  `${SNOOZE_UNTIL_DATE_STR}T00:00:00.000Z`,
).toISOString();

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
  const re = new RegExp(
    `<form[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</form>`,
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

describe("DETAIL-007 alert detail snooze button (live UI)", () => {
  jest.setTimeout(30000);

  beforeAll(async () => {
    await purgeStaleFixtures();
    await seedAlert();
    if (createdAlertId) {
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

  it("renders the Snooze disclosure with a required date-picker", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    const statusBadgeOpening = findTagOpening(html, "alert-detail-status-badge");
    expect(statusBadgeOpening).not.toBeNull();
    expect(statusBadgeOpening!).toContain('data-status="open"');

    // Snooze control is rendered as a <details> disclosure with a summary
    // acting as the trigger button.
    const controlOpening = findTagOpening(html, "alert-detail-snooze-control");
    expect(controlOpening).not.toBeNull();
    expect(controlOpening!.startsWith("<details ")).toBe(true);

    const snoozeButtonOpening = findTagOpening(
      html,
      "alert-detail-snooze-button",
    );
    expect(snoozeButtonOpening).not.toBeNull();
    expect(snoozeButtonOpening!.startsWith("<summary ")).toBe(true);
    expect(snoozeButtonOpening!).toContain('data-action="snooze"');

    const formHtml = findFormHtml(html, "alert-detail-snooze-form");
    expect(formHtml).not.toBeNull();

    // Date input is present, named "snoozeUntil", required, and has a `min`
    // attribute restricting selection to future calendar dates.
    const inputOpening = findTagOpening(
      html,
      "alert-detail-snooze-until-input",
    );
    expect(inputOpening).not.toBeNull();
    expect(inputOpening!.startsWith("<input ")).toBe(true);
    expect(inputOpening!).toContain('type="date"');
    expect(inputOpening!).toContain('name="snoozeUntil"');
    expect(/(?<=\s)required(\s|=|>|\/)/.test(inputOpening!)).toBe(true);
    // min is a YYYY-MM-DD string and must be >= tomorrow's UTC date.
    const minMatch = inputOpening!.match(/min="(\d{4}-\d{2}-\d{2})"/);
    expect(minMatch).not.toBeNull();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // The `min` is computed at render time, so it should match today+1 in UTC.
    // We allow it to be either tomorrow OR the day after (to account for the
    // tiny race where the test runs across a UTC midnight boundary).
    const dayAfterTomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect([tomorrow, dayAfterTomorrow]).toContain(minMatch![1]);

    // Confirm submit button.
    const confirmOpening = findTagOpening(
      html,
      "alert-detail-snooze-confirm-button",
    );
    expect(confirmOpening).not.toBeNull();
    expect(confirmOpening!.startsWith("<button ")).toBe(true);
    expect(confirmOpening!).toContain('type="submit"');
  });

  it("transitions status to 'snoozed' and persists the snoozeUntil date when the server action runs", async () => {
    await snoozeAlert(createdAlertId!, SNOOZE_UNTIL_DATE_STR);

    const updated = await prisma.alert.findUnique({
      where: { id: createdAlertId! },
      include: { auditEntries: true },
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("snoozed");
    expect(updated!.snoozeUntil).not.toBeNull();
    expect(updated!.snoozeUntil!.toISOString()).toBe(SNOOZE_UNTIL_ISO);

    expect(updated!.auditEntries.length).toBe(1);
    const entry = updated!.auditEntries[0]!;
    expect(entry.action).toBe("snoozed");
    expect(entry.actor).toBe("reviewer");
    expect(entry.note).toBe(SNOOZE_UNTIL_ISO);
    expect(entry.beforeState).not.toBeNull();
    expect(entry.afterState).not.toBeNull();
    expect(JSON.parse(entry.beforeState!)).toEqual({ status: "open" });
    expect(JSON.parse(entry.afterState!)).toEqual({
      status: "snoozed",
      snoozeUntil: SNOOZE_UNTIL_ISO,
    });
  });

  it("re-renders the detail page with the snoozed status badge + locked Snooze button", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    const statusBadgeOpening = findTagOpening(html, "alert-detail-status-badge");
    expect(statusBadgeOpening).not.toBeNull();
    expect(statusBadgeOpening!).toContain('data-status="snoozed"');
    // amber palette is the snoozed-status color in STATUS_BADGE_CLASS.
    expect(statusBadgeOpening!).toMatch(/bg-amber-50/);

    // The summary block now exposes the snoozeUntil ISO via data-attribute.
    const summaryOpening = findTagOpening(html, "alert-detail-summary");
    expect(summaryOpening).not.toBeNull();
    expect(summaryOpening!).toContain(
      `data-snooze-until="${SNOOZE_UNTIL_ISO}"`,
    );

    // Snooze disclosure is replaced by a disabled <button>.
    const snoozeButtonOpening = findTagOpening(
      html,
      "alert-detail-snooze-button",
    );
    expect(snoozeButtonOpening).not.toBeNull();
    expect(snoozeButtonOpening!.startsWith("<button ")).toBe(true);
    expect(/(?<=\s)disabled(\s|=|>)/.test(snoozeButtonOpening!)).toBe(true);

    const lockedHint = findTagOpening(
      html,
      "alert-detail-snooze-locked-hint",
    );
    expect(lockedHint).not.toBeNull();
  });

  it("renders the snooze audit entry inside the audit history list", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const auditList = findTagOpening(html, "alert-detail-audit-list");
    expect(auditList).not.toBeNull();
    // DETAIL-008: the timeline synthesizes a "created" pseudo-row from
    // alert.createdAt whenever the DB lacks a real created entry. Count
    // is 2; the snoozed action is newest at idx 0, created at idx 1.
    expect(auditList!).toContain('data-audit-count="2"');

    const entries = findAllTagOpenings(html, "alert-detail-audit-entry");
    expect(entries.length).toBe(2);
    expect(entries[0]!).toContain('data-action="snoozed"');
    expect(entries[0]!).toContain('data-actor="reviewer"');
    expect(entries[1]!).toContain('data-action="created"');
    expect(entries[1]!).toContain('data-actor="system"');
  });

  it("rejects snooze attempts with a past or invalid date", async () => {
    // Re-seed a fresh open alert (the previous one is now snoozed).
    const fresh = await prisma.alert.create({
      data: {
        regulatoryItemId: createdRegItemId!,
        policyChunkId: createdChunkId!,
        classification: "drifted",
        confidence: 0.5,
        severity: "low",
        explanation: `${TAG} fresh`,
        regulatoryQuote: REG_QUOTE,
        policyQuote: POLICY_QUOTE,
        regulatorySourceUrl: REG_SOURCE_URL,
        policyReference: POLICY_REFERENCE,
        status: "open",
      },
    });
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await expect(snoozeAlert(fresh.id, yesterday)).rejects.toThrow(
        /must be in the future/,
      );
      await expect(snoozeAlert(fresh.id, "not-a-date")).rejects.toThrow(
        /Invalid snoozeUntil/,
      );
      await expect(snoozeAlert(fresh.id, "")).rejects.toThrow(
        /Missing snoozeUntil/,
      );

      // Ensure no DB mutation happened.
      const stillOpen = await prisma.alert.findUnique({
        where: { id: fresh.id },
        include: { auditEntries: true },
      });
      expect(stillOpen!.status).toBe("open");
      expect(stillOpen!.snoozeUntil).toBeNull();
      expect(stillOpen!.auditEntries.length).toBe(0);
    } finally {
      await prisma.auditEntry.deleteMany({ where: { alertId: fresh.id } });
      await prisma.alert.delete({ where: { id: fresh.id } });
    }
  });
});
