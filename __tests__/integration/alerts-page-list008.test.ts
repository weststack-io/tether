// LIST-008 verification harness.
//
// Asserts that each row in the rendered /alerts table has a navigation link
// pointing at /alerts/[id], so that clicking the row routes to the alert
// detail page.
//
// Verified behavior:
//   1. Every rendered alerts-row contains exactly one alerts-row-link <a>
//      whose href matches /alerts/<that row's data-alert-id>.
//   2. The link is an absolute-positioned overlay so it covers the full row.
//   3. The link declares an accessible name via aria-label.
//   4. The detail page at the resolved href returns 200 (the placeholder is
//      live-routed for now; LIST-008 only requires that navigation works).
//
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list008-verify";
const SEED_COUNT = 4;

const createdAlertIds: string[] = [];
const createdRegItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

async function purgeStaleFixtures(): Promise<void> {
  const stale = await prisma.regulatoryItem.findMany({
    where: { title: { startsWith: `${TAG} ` } },
    select: { id: true, ingestionRunId: true },
  });
  if (stale.length === 0) return;
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
  const policies = await prisma.policyDocument.findMany({
    where: { title: { startsWith: `${TAG} ` } },
    select: { id: true },
  });
  const policyIds = policies.map((p) => p.id);
  if (policyIds.length > 0) {
    await prisma.policyChunk.deleteMany({
      where: { policyDocumentId: { in: policyIds } },
    });
    await prisma.policyDocument.deleteMany({
      where: { id: { in: policyIds } },
    });
  }
  if (runIds.length > 0) {
    await prisma.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
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
  createdRunIds.push(run.id);

  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TAG} policy`,
      domain: "bsa_aml",
      fullText: `${TAG} body`,
      isSynthetic: true,
    },
  });
  createdPolicyIds.push(policy.id);

  const chunk = await prisma.policyChunk.create({
    data: {
      policyDocumentId: policy.id,
      sectionHeading: "Section 1",
      content: `${TAG} chunk content`,
      chunkIndex: 0,
    },
  });
  createdChunkIds.push(chunk.id);

  // Use 2097 to avoid colliding with LIST-006 (2099) and LIST-007 (2098)
  // live-UI seeds.
  const baseMs = new Date("2097-06-01T00:00:00Z").getTime();
  for (let i = 0; i < SEED_COUNT; i++) {
    const createdAt = new Date(baseMs - i * 60 * 60 * 1000);
    const regItem = await prisma.regulatoryItem.create({
      data: {
        sourceUrl: `https://${TAG}.example/${i}-${Math.random().toString(36).slice(2)}`,
        regulator: "SEC",
        publicationDate: createdAt,
        documentType: "notice",
        title: `${TAG} regulatory item ${i}`,
        fullText: `${TAG} body ${i}`,
        ingestionRunId: run.id,
      },
    });
    createdRegItemIds.push(regItem.id);

    const alert = await prisma.alert.create({
      data: {
        regulatoryItemId: regItem.id,
        policyChunkId: chunk.id,
        classification: "drifted",
        confidence: 0.9,
        severity: "high",
        explanation: `${TAG} explanation ${i}`,
        regulatoryQuote: "regulatory quote",
        policyQuote: "policy quote",
        regulatorySourceUrl: regItem.sourceUrl,
        policyReference: `policy ref ${i}`,
        status: "open",
        createdAt,
      },
    });
    createdAlertIds.push(alert.id);
  }
}

async function fetchAlertsHtml(query = ""): Promise<string> {
  const url = `http://localhost:3000/alerts${query}`;
  const res = await fetch(url, { cache: "no-store" });
  expect(res.status).toBe(200);
  return res.text();
}

type RenderedRow = {
  alertId: string;
  body: string;
};

function rowsFromHtml(html: string): RenderedRow[] {
  const rowIds = new Set<string>();
  const rowIdRe =
    /data-testid="alerts-row"[^>]*data-alert-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rowIdRe.exec(html)) !== null) {
    rowIds.add(m[1]!);
  }

  const rowChunk = (alertId: string): string => {
    const re = new RegExp(
      `data-testid="alerts-row"[^>]*data-alert-id="${alertId}"`,
      "g",
    );
    let lastIndex = -1;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      lastIndex = match.index;
    }
    if (lastIndex === -1) return "";
    const nextIndex = html.indexOf('data-testid="alerts-row"', lastIndex + 1);
    return html.slice(
      lastIndex,
      nextIndex === -1 ? lastIndex + 12_000 : nextIndex,
    );
  };

  return [...rowIds].map((alertId) => ({
    alertId,
    body: rowChunk(alertId),
  }));
}

function rowLinkHref(row: RenderedRow): string | null {
  const m = row.body.match(
    /<a[^>]*data-testid="alerts-row-link"[^>]*href="([^"]+)"[^>]*>/,
  );
  if (!m) return null;
  return m[1]!.replace(/&amp;/g, "&");
}

function rowLinkAttrs(row: RenderedRow): string | null {
  const m = row.body.match(
    /<a[^>]*data-testid="alerts-row-link"[^>]*>/,
  );
  return m ? m[0] : null;
}

describe("LIST-008 alert row click-through (live UI)", () => {
  beforeAll(async () => {
    await purgeStaleFixtures();
    await seedFixtures();
  });

  afterAll(async () => {
    if (createdAlertIds.length > 0) {
      await prisma.auditEntry.deleteMany({
        where: { alertId: { in: createdAlertIds } },
      });
      await prisma.alert.deleteMany({
        where: { id: { in: createdAlertIds } },
      });
    }
    if (createdRegItemIds.length > 0) {
      await prisma.regulatoryItem.deleteMany({
        where: { id: { in: createdRegItemIds } },
      });
    }
    if (createdChunkIds.length > 0) {
      await prisma.policyChunk.deleteMany({
        where: { id: { in: createdChunkIds } },
      });
    }
    if (createdPolicyIds.length > 0) {
      await prisma.policyDocument.deleteMany({
        where: { id: { in: createdPolicyIds } },
      });
    }
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("every seeded row renders an alerts-row-link <a> targeting /alerts/[id]", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2097-01-01&dateTo=2097-12-31",
    );
    const rendered = rowsFromHtml(html);
    const seededRows = rendered.filter((r) =>
      createdAlertIds.includes(r.alertId),
    );
    expect(seededRows).toHaveLength(SEED_COUNT);

    for (const row of seededRows) {
      const href = rowLinkHref(row);
      expect(href).toBe(`/alerts/${row.alertId}`);
    }
  });

  it("the row link is an absolute-positioned overlay with an aria-label", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2097-01-01&dateTo=2097-12-31",
    );
    const rendered = rowsFromHtml(html);
    const seededRows = rendered.filter((r) =>
      createdAlertIds.includes(r.alertId),
    );
    expect(seededRows.length).toBeGreaterThan(0);

    for (const row of seededRows) {
      const attrs = rowLinkAttrs(row);
      expect(attrs).not.toBeNull();
      // Must cover the row (absolute inset-0) and carry an accessible name.
      expect(attrs!).toMatch(/class="[^"]*\babsolute\b[^"]*"/);
      expect(attrs!).toMatch(/class="[^"]*\binset-0\b[^"]*"/);
      expect(attrs!).toMatch(/aria-label="[^"]+"/);
    }

    // The <tr> itself must establish the positioning context for the overlay.
    const trMatches = html.match(
      /<tr[^>]*data-testid="alerts-row"[^>]*>/g,
    );
    expect(trMatches).not.toBeNull();
    for (const tr of trMatches!) {
      expect(tr).toMatch(/class="[^"]*\brelative\b[^"]*"/);
    }
  });

  it("the alert detail page at the row's href returns 200", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2097-01-01&dateTo=2097-12-31",
    );
    const rendered = rowsFromHtml(html);
    const seededRows = rendered.filter((r) =>
      createdAlertIds.includes(r.alertId),
    );
    expect(seededRows.length).toBeGreaterThan(0);

    const sample = seededRows[0]!;
    const href = rowLinkHref(sample);
    expect(href).toBe(`/alerts/${sample.alertId}`);

    const res = await fetch(`http://localhost:3000${href}`, {
      cache: "no-store",
    });
    expect(res.status).toBe(200);
    // Sanity check that the placeholder uses the alert id from the route.
    const detailHtml = await res.text();
    expect(detailHtml).toContain(sample.alertId);
  });

  it("row links coexist with the column-sort header links (no nested <a>)", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2097-01-01&dateTo=2097-12-31",
    );
    const rendered = rowsFromHtml(html);
    const seededRows = rendered.filter((r) =>
      createdAlertIds.includes(r.alertId),
    );
    expect(seededRows.length).toBeGreaterThan(0);

    // Each row body must contain exactly one alerts-row-link <a>; no
    // accidental duplicates from cell-level wrapping.
    for (const row of seededRows) {
      const matches = row.body.match(
        /data-testid="alerts-row-link"/g,
      );
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(1);
    }

    // The header sort links must NOT carry the row-link testid.
    const headerLinks = html.match(/data-testid="alerts-sort-[^"]+"/g);
    expect(headerLinks).not.toBeNull();
    for (const headerLink of headerLinks!) {
      expect(headerLink).not.toContain("alerts-row-link");
    }
  });
});
