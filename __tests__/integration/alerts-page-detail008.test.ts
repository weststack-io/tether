// DETAIL-008 verification harness.
//
// Asserts the alert detail page (/alerts/[id]/page.tsx) renders a polished
// audit history timeline at the bottom of the page that:
//   - shows entries newest-first,
//   - exposes timestamp / actor / action label / note for each entry,
//   - includes the initial "created" event from the system (synthesized
//     from alert.createdAt when no real created entry is present in the DB),
//   - prefers a real `action: "created"` AuditEntry over the synthesized
//     row when one exists.
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

const TAG = "detail008-verify";

const REG_TITLE = `${TAG} regulatory item title`;
const REG_FULL_TEXT = `${TAG} regulatory full body`;
const REG_QUOTE = `${TAG} regulatory quote`;
const REG_SOURCE_URL = `https://${TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const REG_REGULATOR = "SEC";
const REG_DOCUMENT_TYPE = "final_rule";
const REG_PUBLICATION_DATE = new Date("2095-04-12T00:00:00Z");

const POLICY_TITLE = `${TAG} timeline policy`;
const POLICY_DOMAIN = "bsa_aml";
const POLICY_FULL_TEXT = `${TAG} policy full text`;
const CHUNK_HEADING = `${TAG} Section 1.0`;
const CHUNK_CONTENT = `${TAG} chunk content`;
const POLICY_QUOTE = `${TAG} policy quote`;

const POLICY_REFERENCE = `${POLICY_TITLE} > ${CHUNK_HEADING}`;

const EXPLANATION = `${TAG} timeline verification body.`;

// Three audit entries are inserted on the multi-action alert with
// distinct timestamps so we can verify the newest-first ordering. The
// alert.createdAt is set to T0; the entries are at T0+1m, T0+10m, and
// T0+30m. The synthesized "created" row is suppressed for this fixture
// because we explicitly insert one with action:"created" (the real-DB
// path).
const T_BASE = new Date("2026-04-12T09:00:00.000Z");
const T_CREATED = new Date(T_BASE.getTime());
const T_ESCALATED = new Date(T_BASE.getTime() + 60 * 1000);
const T_REOPENED = new Date(T_BASE.getTime() + 10 * 60 * 1000);
const T_ACCEPTED = new Date(T_BASE.getTime() + 30 * 60 * 1000);

const ESCALATION_NOTE_TEXT = "Escalated for legal review";

let createdRunId: string | null = null;
let createdRegItemId: string | null = null;
let createdPolicyId: string | null = null;
let createdChunkId: string | null = null;
// Two alerts: one with explicit "created" + multi-action history (real-DB
// path), one with NO audit entries (synthesized "created" path).
let createdMultiActionAlertId: string | null = null;
let createdEmptyAlertId: string | null = null;

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

async function seedFixtures(): Promise<void> {
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

  // Multi-action alert: explicit "created" + escalated + reopened + accepted.
  // createdAt is set to T_CREATED so the synthesized fallback would also
  // line up with that timestamp — but it shouldn't fire because we insert
  // a real created row.
  const multi = await prisma.alert.create({
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
      status: "accepted",
      createdAt: T_CREATED,
    },
  });
  createdMultiActionAlertId = multi.id;

  await prisma.auditEntry.create({
    data: {
      alertId: multi.id,
      actor: "system",
      action: "created",
      timestamp: T_CREATED,
    },
  });
  await prisma.auditEntry.create({
    data: {
      alertId: multi.id,
      actor: "reviewer",
      action: "escalated",
      note: ESCALATION_NOTE_TEXT,
      beforeState: JSON.stringify({ status: "open" }),
      afterState: JSON.stringify({ status: "escalated" }),
      timestamp: T_ESCALATED,
    },
  });
  await prisma.auditEntry.create({
    data: {
      alertId: multi.id,
      actor: "reviewer",
      action: "reopened",
      beforeState: JSON.stringify({ status: "escalated" }),
      afterState: JSON.stringify({ status: "open" }),
      timestamp: T_REOPENED,
    },
  });
  await prisma.auditEntry.create({
    data: {
      alertId: multi.id,
      actor: "reviewer",
      action: "accepted",
      beforeState: JSON.stringify({ status: "open" }),
      afterState: JSON.stringify({ status: "accepted" }),
      timestamp: T_ACCEPTED,
    },
  });

  // Empty-history alert: no audit entries at all. The detail page should
  // synthesize a "created" pseudo-row from alert.createdAt.
  const empty = await prisma.alert.create({
    data: {
      regulatoryItemId: regItem.id,
      policyChunkId: chunk.id,
      classification: "drifted",
      confidence: 0.6,
      severity: "low",
      explanation: `${TAG} empty-history alert`,
      regulatoryQuote: REG_QUOTE,
      policyQuote: POLICY_QUOTE,
      regulatorySourceUrl: REG_SOURCE_URL,
      policyReference: POLICY_REFERENCE,
      status: "open",
      // pin createdAt so we can assert the synthesized row's timestamp.
      createdAt: T_CREATED,
    },
  });
  createdEmptyAlertId = empty.id;
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

// Walk the HTML once and split it on alert-detail-audit-entry openings so
// we can read the *body* (label, timestamp, actor, note) of each entry.
function findAuditEntryBlocks(html: string): string[] {
  const re = /<li[^>]*data-testid="alert-detail-audit-entry"[^>]*>[\s\S]*?<\/li>/g;
  return Array.from(html.matchAll(re)).map((m) => m[0]);
}

describe("DETAIL-008 alert detail audit history timeline (live UI)", () => {
  jest.setTimeout(30000);

  beforeAll(async () => {
    await purgeStaleFixtures();
    await seedFixtures();
    if (createdMultiActionAlertId) {
      await fetchDetailHtml(createdMultiActionAlertId);
    }
  });

  afterAll(async () => {
    for (const id of [createdMultiActionAlertId, createdEmptyAlertId]) {
      if (!id) continue;
      await prisma.auditEntry.deleteMany({ where: { alertId: id } });
      await prisma.alert.delete({ where: { id } });
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

  it("renders the audit history Card with the timeline rail", async () => {
    const { status, html } = await fetchDetailHtml(createdMultiActionAlertId!);
    expect(status).toBe(200);

    const auditCard = findTagOpening(html, "alert-detail-audit");
    expect(auditCard).not.toBeNull();

    // Card header still says "Audit history".
    expect(html).toContain("Audit history");

    const auditList = findTagOpening(html, "alert-detail-audit-list");
    expect(auditList).not.toBeNull();
    // 4 real entries — synthesis is suppressed because a real "created"
    // row exists.
    expect(auditList!).toContain('data-audit-count="4"');
    expect(auditList!).toContain('data-audit-synthetic-created="false"');

    const rail = findTagOpening(html, "alert-detail-audit-rail");
    expect(rail).not.toBeNull();
  });

  it("renders all entries newest-first with timestamp, actor, action, and note", async () => {
    const { html } = await fetchDetailHtml(createdMultiActionAlertId!);

    const blocks = findAuditEntryBlocks(html);
    expect(blocks.length).toBe(4);

    // Newest-first — accepted (T+30m), reopened (T+10m), escalated (T+1m),
    // created (T0).
    const expected = [
      { action: "accepted", actor: "reviewer" },
      { action: "reopened", actor: "reviewer" },
      { action: "escalated", actor: "reviewer" },
      { action: "created", actor: "system" },
    ];
    expected.forEach((exp, idx) => {
      expect(blocks[idx]).toContain(`data-action="${exp.action}"`);
      expect(blocks[idx]).toContain(`data-actor="${exp.actor}"`);
      expect(blocks[idx]).toContain(`data-position="${idx}"`);
    });

    // Each block exposes the action label, the actor, and a <time> with a
    // dateTime attribute carrying the full ISO.
    for (const block of blocks) {
      // Action label dot is present (testid scoped to the block).
      expect(block).toMatch(/data-testid="alert-detail-audit-dot"/);
      // Action label.
      expect(block).toMatch(
        /data-testid="alert-detail-audit-action-label"[^>]*>\s*[A-Z][a-z]+/,
      );
      // <time> tag with both dateTime= and data-testid= attributes; React
      // serializes them in source order, but Next can reorder, so just
      // assert both exist on the same tag.
      const timeTag = block.match(/<time[^>]*>/);
      expect(timeTag).not.toBeNull();
      expect(timeTag![0]).toContain(
        'data-testid="alert-detail-audit-timestamp"',
      );
      expect(timeTag![0]).toMatch(
        /dateTime="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/,
      );
      // Actor line.
      expect(block).toMatch(/data-testid="alert-detail-audit-actor-line"/);
      // Capitalized actor name span.
      expect(block).toMatch(/data-testid="alert-detail-audit-actor"/);
    }

    // The escalated block should also carry its note.
    const escalatedBlock = blocks[2]!;
    expect(escalatedBlock).toMatch(/data-testid="alert-detail-audit-note"/);
    expect(escalatedBlock).toContain(ESCALATION_NOTE_TEXT);

    // The accepted/reopened/created blocks should NOT have a note span.
    expect(blocks[0]!).not.toMatch(/data-testid="alert-detail-audit-note"/);
    expect(blocks[1]!).not.toMatch(/data-testid="alert-detail-audit-note"/);
    expect(blocks[3]!).not.toMatch(/data-testid="alert-detail-audit-note"/);
  });

  it("color-codes timeline dots per action", async () => {
    const { html } = await fetchDetailHtml(createdMultiActionAlertId!);

    const dots = findAllTagOpenings(html, "alert-detail-audit-dot");
    expect(dots.length).toBe(4);
    // Match by data-action since dots appear in newest-first order.
    const dotByAction = new Map<string, string>();
    for (const dot of dots) {
      const m = dot.match(/data-action="([^"]+)"/);
      if (m) dotByAction.set(m[1]!, dot);
    }
    expect(dotByAction.get("accepted")!).toMatch(/bg-emerald-500/);
    expect(dotByAction.get("reopened")!).toMatch(/bg-slate-500/);
    expect(dotByAction.get("escalated")!).toMatch(/bg-red-500/);
    expect(dotByAction.get("created")!).toMatch(/bg-blue-500/);
  });

  it("formats timestamps as YYYY-MM-DD HH:MM UTC and preserves the ISO on the dateTime attribute", async () => {
    const { html } = await fetchDetailHtml(createdMultiActionAlertId!);
    const blocks = findAuditEntryBlocks(html);

    // The accepted entry's timestamp is T_ACCEPTED — assert both the
    // human-readable display string and the raw ISO via the dateTime attr.
    const acceptedBlock = blocks[0]!;
    expect(acceptedBlock).toContain(
      `dateTime="${T_ACCEPTED.toISOString()}"`,
    );
    expect(acceptedBlock).toContain("2026-04-12 09:30 UTC");

    // The created entry's timestamp is T_CREATED.
    const createdBlock = blocks[3]!;
    expect(createdBlock).toContain(
      `dateTime="${T_CREATED.toISOString()}"`,
    );
    expect(createdBlock).toContain("2026-04-12 09:00 UTC");
  });

  it("synthesizes a 'created' pseudo-row when the DB has no created entry", async () => {
    const { status, html } = await fetchDetailHtml(createdEmptyAlertId!);
    expect(status).toBe(200);

    const auditList = findTagOpening(html, "alert-detail-audit-list");
    expect(auditList).not.toBeNull();
    expect(auditList!).toContain('data-audit-count="1"');
    // The synthesized-created marker tells us the timeline filled in a
    // pseudo-row from alert.createdAt rather than rendering a real entry.
    expect(auditList!).toContain('data-audit-synthetic-created="true"');

    const blocks = findAuditEntryBlocks(html);
    expect(blocks.length).toBe(1);
    const onlyBlock = blocks[0]!;
    expect(onlyBlock).toContain('data-action="created"');
    expect(onlyBlock).toContain('data-actor="system"');
    expect(onlyBlock).toContain('data-synthetic="true"');
    expect(onlyBlock).toContain(`dateTime="${T_CREATED.toISOString()}"`);

    // Empty-state placeholder is not rendered when the synthesized row
    // takes its place.
    const auditEmpty = findTagOpening(html, "alert-detail-audit-empty");
    expect(auditEmpty).toBeNull();
  });

  it("places the audit history Card at the bottom of the page (after the action bar)", async () => {
    const { html } = await fetchDetailHtml(createdMultiActionAlertId!);

    const actionsIdx = html.indexOf('data-testid="alert-detail-actions"');
    const auditIdx = html.indexOf('data-testid="alert-detail-audit"');
    expect(actionsIdx).toBeGreaterThan(0);
    expect(auditIdx).toBeGreaterThan(actionsIdx);
  });
});
