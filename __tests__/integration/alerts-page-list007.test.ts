// LIST-007 verification harness.
//
// Seeds 32 alerts spread across two pages at the default page size of 25 and
// asserts that the rendered /alerts HTML from the live dev server:
//   1. Renders the pagination nav with the correct totals + summary text and
//      shows exactly the first 25 of the seeded rows on page 1.
//   2. Disables Prev on page 1 (renders as a non-link sentinel).
//   3. ?page=2 advances to the next page, surfaces a different alert subset,
//      and disables Next on the last page.
//   4. The page-link hrefs preserve sortBy/sortOrder and any active filter
//      selections.
//   5. Filter / sort hrefs do NOT thread the active page through -- changing
//      a filter resets pagination to page 1.
//   6. ?page=999 over-shoot renders an empty table but the pagination
//      controls clamp the highlighted page to a sensible value.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list007-verify";
const PAGE_SIZE = 25;
const SEED_COUNT = 32;

const createdAlertIds: string[] = [];
const createdRegItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

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

// Fixtures use createdAt in the year 2098 to avoid colliding with other
// live-UI test seeds (the LIST-006 set uses 2099). The default sort is
// date-desc, so within these 32 rows the ordering is i=0 first (newest)
// through i=31 last (oldest).
async function purgeStaleFixtures(): Promise<void> {
  // Defensive: clean up any rows from prior interrupted runs of this same
  // suite so the total-count assertions are reliable.
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

  const baseMs = new Date("2098-06-01T00:00:00Z").getTime();
  // Make sure each domain has its own chunk so the row data is realistic.
  const domainToChunkId = new Map<string, string>();
  for (const domain of DOMAINS) {
    const policy = await prisma.policyDocument.create({
      data: {
        title: `${TAG} ${domain} policy`,
        domain,
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
    domainToChunkId.set(domain, chunk.id);
  }

  for (let i = 0; i < SEED_COUNT; i++) {
    const reg = REGULATORS[i % REGULATORS.length]!;
    const sev = SEVERITIES[i % SEVERITIES.length]!;
    const st = STATUSES[i % STATUSES.length]!;
    const cls = CLASSIFICATIONS[i % CLASSIFICATIONS.length]!;
    const dom = DOMAINS[i % DOMAINS.length]!;
    const createdAt = new Date(baseMs - i * 60 * 60 * 1000);
    const regItem = await prisma.regulatoryItem.create({
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
    createdRegItemIds.push(regItem.id);

    const alert = await prisma.alert.create({
      data: {
        regulatoryItemId: regItem.id,
        policyChunkId: domainToChunkId.get(dom)!,
        classification: cls,
        confidence: 0.9,
        severity: sev,
        explanation: `${TAG} explanation ${i}`,
        regulatoryQuote: "regulatory quote",
        policyQuote: "policy quote",
        regulatorySourceUrl: regItem.sourceUrl,
        policyReference: `policy ref ${i}`,
        status: st,
        createdAt,
      },
    });
    createdAlertIds.push(alert.id);
  }
}

type RenderedRow = { alertId: string; regulator: string };

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
    return lastIndex === -1 ? "" : html.slice(lastIndex, lastIndex + 12_000);
  };

  const rows: RenderedRow[] = [];
  for (const alertId of rowIds) {
    const regMatch = rowChunk(alertId).match(
      /data-testid="alerts-cell-regulator"[^>]*data-regulator="([^"]+)"/,
    );
    rows.push({
      alertId,
      regulator: regMatch ? regMatch[1]! : "",
    });
  }
  return rows;
}

async function fetchAlertsHtml(query = ""): Promise<string> {
  const url = `http://localhost:3000/alerts${query}`;
  const res = await fetch(url, { cache: "no-store" });
  expect(res.status).toBe(200);
  return res.text();
}

function seededOnly(rows: RenderedRow[]): RenderedRow[] {
  const idSet = new Set(createdAlertIds);
  return rows.filter((r) => idSet.has(r.alertId));
}

// To keep the assertions independent of any pre-existing alerts in the dev
// database, the verification scopes itself to alerts created by this suite
// (pageSize=25, but other live-UI fixtures may bleed real-but-unrelated
// alerts onto the page). We test the pagination structure directly via the
// nav's data-* attributes for global counts, and assert seeded-row identity
// to validate that the slicing actually advances across pages.

describe("LIST-007 alerts list pagination (live UI)", () => {
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

  it("renders pagination nav with correct totals and exactly 25 rows on page 1", async () => {
    // Scope the query to this suite's seeded rows so other live-UI fixtures
    // don't leak total/page counts. We filter by status=open which one fifth
    // of the seeded rows have -- not helpful. Instead, scope by createdAt to
    // the year 2098 window via dateFrom/dateTo so total = SEED_COUNT.
    const html = await fetchAlertsHtml(
      "?dateFrom=2098-01-01&dateTo=2098-12-31",
    );
    expect(html).toMatch(/data-testid="alerts-pagination"/);
    expect(html).toMatch(
      new RegExp(`data-total="${SEED_COUNT}"`),
    );
    const expectedTotalPages = Math.ceil(SEED_COUNT / PAGE_SIZE);
    expect(html).toMatch(
      new RegExp(`data-total-pages="${expectedTotalPages}"`),
    );
    expect(html).toMatch(/data-page="1"/);
    expect(html).toMatch(new RegExp(`data-page-size="${PAGE_SIZE}"`));

    // Summary text shows "1–25 of 32" and "Page 1 of 2".
    expect(html).toMatch(/Showing[\s\S]*?1[\s\S]*?[–\-][\s\S]*?25[\s\S]*?of[\s\S]*?32/);
    expect(html).toMatch(/Page[\s\S]*?1[\s\S]*?of[\s\S]*?2/);

    const rendered = seededOnly(rowsFromHtml(html));
    expect(rendered).toHaveLength(PAGE_SIZE);
  });

  it("Prev is disabled on page 1; the page-1 and page-2 controls render", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2098-01-01&dateTo=2098-12-31",
    );
    // Prev should render as a span with aria-disabled="true", not as a link.
    const prevTagMatch = html.match(
      /<(span|a)[^>]*data-testid="alerts-pagination-prev"[^>]*>/,
    );
    expect(prevTagMatch).not.toBeNull();
    expect(prevTagMatch![1]).toBe("span");
    expect(prevTagMatch![0]).toMatch(/aria-disabled="true"/);

    // Next should render as a link on page 1 (since totalPages > 1).
    const nextTagMatch = html.match(
      /<(span|a)[^>]*data-testid="alerts-pagination-next"[^>]*>/,
    );
    expect(nextTagMatch).not.toBeNull();
    expect(nextTagMatch![1]).toBe("a");

    // Page 1 link is marked active; page 2 link is rendered but inactive.
    expect(html).toMatch(
      /data-testid="alerts-pagination-page-1"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-pagination-page-2"[^>]*data-active="false"/,
    );
  });

  it("?page=2 advances to the next page; Next is disabled on the last page", async () => {
    const page1Html = await fetchAlertsHtml(
      "?dateFrom=2098-01-01&dateTo=2098-12-31",
    );
    const page1Ids = seededOnly(rowsFromHtml(page1Html)).map((r) => r.alertId);

    const page2Html = await fetchAlertsHtml(
      "?dateFrom=2098-01-01&dateTo=2098-12-31&page=2",
    );
    expect(page2Html).toMatch(/data-page="2"/);
    expect(page2Html).toMatch(
      /data-testid="alerts-pagination-page-2"[^>]*data-active="true"/,
    );
    // Page 2 summary: "26-32 of 32" + "Page 2 of 2".
    expect(page2Html).toMatch(/Showing[\s\S]*?26[\s\S]*?[–\-][\s\S]*?32[\s\S]*?of[\s\S]*?32/);
    expect(page2Html).toMatch(/Page[\s\S]*?2[\s\S]*?of[\s\S]*?2/);

    const page2Ids = seededOnly(rowsFromHtml(page2Html)).map((r) => r.alertId);
    // 32 total, 25 on page 1, 7 on page 2.
    expect(page2Ids).toHaveLength(SEED_COUNT - PAGE_SIZE);
    // No overlap between the two pages.
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id);
    }
    // Concatenated they cover all seeded rows.
    expect(new Set([...page1Ids, ...page2Ids]).size).toBe(SEED_COUNT);

    // Next is disabled on the last page; Prev becomes a link.
    const nextTagMatch = page2Html.match(
      /<(span|a)[^>]*data-testid="alerts-pagination-next"[^>]*>/,
    );
    expect(nextTagMatch).not.toBeNull();
    expect(nextTagMatch![1]).toBe("span");
    expect(nextTagMatch![0]).toMatch(/aria-disabled="true"/);

    const prevTagMatch = page2Html.match(
      /<(span|a)[^>]*data-testid="alerts-pagination-prev"[^>]*>/,
    );
    expect(prevTagMatch).not.toBeNull();
    expect(prevTagMatch![1]).toBe("a");
    // Prev link should point back to page 1 (which omits the page param).
    const prevHref = prevTagMatch![0]!
      .match(/href="([^"]+)"/)![1]!
      .replace(/&amp;/g, "&");
    expect(prevHref).not.toMatch(/[?&]page=/);
  });

  it("page-link hrefs preserve sort and active filter selections", async () => {
    const html = await fetchAlertsHtml(
      "?sortBy=regulator&sortOrder=asc&dateFrom=2098-01-01&dateTo=2098-12-31&regulator=SEC",
    );
    const page1Match = html.match(
      /data-testid="alerts-pagination-page-1"[^>]*href="([^"]+)"/,
    );
    expect(page1Match).not.toBeNull();
    const page1Href = page1Match![1]!.replace(/&amp;/g, "&");
    expect(page1Href).toMatch(/sortBy=regulator/);
    expect(page1Href).toMatch(/sortOrder=asc/);
    expect(page1Href).toMatch(/dateFrom=2098-01-01/);
    expect(page1Href).toMatch(/dateTo=2098-12-31/);
    expect(page1Href).toMatch(/regulator=SEC/);
    // Page 1 is canonical so the URL omits page=.
    expect(page1Href).not.toMatch(/[?&]page=/);

    // The narrowed result set (regulator=SEC) is small enough that there's
    // only one page; the page-2 control may or may not render depending on
    // the count. The pagination block itself should still render.
    expect(html).toMatch(/data-testid="alerts-pagination"/);
  });

  it("filter and sort hrefs do NOT thread the active page through", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2098-01-01&dateTo=2098-12-31&page=2",
    );

    // Each chip toggle href should drop the page param so toggling a filter
    // resets to page 1.
    const secChipMatch = html.match(
      /data-testid="alerts-filter-regulator-SEC"[^>]*href="([^"]+)"/,
    );
    expect(secChipMatch).not.toBeNull();
    const secHref = secChipMatch![1]!.replace(/&amp;/g, "&");
    expect(secHref).not.toMatch(/[?&]page=/);
    // It should still preserve dateFrom/dateTo.
    expect(secHref).toMatch(/dateFrom=2098-01-01/);
    expect(secHref).toMatch(/dateTo=2098-12-31/);

    // Column-sort hrefs should also drop page.
    const dateSortMatch = html.match(
      /data-testid="alerts-sort-date"[^>]*href="([^"]+)"/,
    );
    expect(dateSortMatch).not.toBeNull();
    const dateSortHref = dateSortMatch![1]!.replace(/&amp;/g, "&");
    expect(dateSortHref).not.toMatch(/[?&]page=/);

    // The Clear link should also drop page (along with all filters).
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).not.toMatch(/[?&]page=/);
  });

  it("?page=999 over-shoots; controls clamp the highlighted page to totalPages", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2098-01-01&dateTo=2098-12-31&page=999",
    );
    // The query is honored as-is and the response is empty, but the rendered
    // pagination clamps so the user can recover. data-page reflects the
    // clamped page (totalPages), so the highlighted control is page 2 here.
    expect(html).toMatch(/data-total="32"/);
    expect(html).toMatch(/data-total-pages="2"/);
    expect(html).toMatch(/data-page="2"/);
    // Next is disabled on the clamped final page.
    const nextTagMatch = html.match(
      /<(span|a)[^>]*data-testid="alerts-pagination-next"[^>]*>/,
    );
    expect(nextTagMatch).not.toBeNull();
    expect(nextTagMatch![1]).toBe("span");
  });
});
