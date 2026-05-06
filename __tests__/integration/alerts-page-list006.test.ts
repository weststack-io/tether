// LIST-006 verification harness.
//
// Seeds a fixed set of alerts spanning a deliberate spread of createdAt dates,
// then fetches the rendered /alerts HTML from the live dev server and asserts:
//   1. The filter bar renders the date range form (From / To inputs + Apply
//      button) and no Clear link with no filter active.
//   2. ?dateFrom=YYYY-MM-DD narrows the rendered subset to alerts on or after
//      the named day, surfaces a Clear link, and echoes the value back into
//      the dateFrom input.
//   3. ?dateFrom=...&dateTo=... narrows to the closed range; dateTo is
//      inclusive of its named day (mirrors API-005's parseDateBound semantics).
//   4. The Clear link href has no dateFrom / dateTo params and returns the
//      unfiltered list.
//   5. Sort + date range compose: ?sortBy=date&dateFrom=... preserves both via
//      the Clear link and column-sort hrefs.
//   6. Date range + chip filters compose: ?dateFrom=...&regulator=SEC keeps
//      both axes; chip toggle hrefs preserve dateFrom/dateTo.
//   7. Invalid dateFrom / dateTo values (non-YYYY-MM-DD or unparseable) are
//      silently dropped.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list006-verify";

const createdAlertIds: string[] = [];
const createdRegItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

type AlertSpec = {
  regulator: string;
  severity: string;
  status: string;
  classification: string;
  domain: string;
  createdAt: Date;
};

// Six fixtures spread across distant past dates so they don't collide with
// other live-UI test fixtures or real demo seed data. Using year 2099 avoids
// any plausible overlap. Three months wide so the filter has enough variety
// to test single-bound, two-bound, and exclusion at both ends.
const FIXTURES: AlertSpec[] = [
  {
    regulator: "SEC",
    severity: "high",
    status: "open",
    classification: "drifted",
    domain: "bsa_aml",
    createdAt: new Date("2099-01-10T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "medium",
    status: "escalated",
    classification: "drifted",
    domain: "complaint_handling",
    createdAt: new Date("2099-02-05T00:00:00Z"),
  },
  {
    regulator: "OCC",
    severity: "low",
    status: "accepted",
    classification: "ambiguous",
    domain: "fair_lending",
    createdAt: new Date("2099-02-20T00:00:00Z"),
  },
  {
    regulator: "SEC",
    severity: "medium",
    status: "snoozed",
    classification: "contradicted",
    domain: "reg_e",
    createdAt: new Date("2099-03-15T00:00:00Z"),
  },
  {
    regulator: "CFPB",
    severity: "high",
    status: "open",
    classification: "drifted",
    domain: "fair_lending",
    createdAt: new Date("2099-04-01T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "low",
    status: "dismissed",
    classification: "ambiguous",
    domain: "reg_z",
    createdAt: new Date("2099-04-20T00:00:00Z"),
  },
];

async function seedFixtures(): Promise<void> {
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: "manual",
      status: "completed",
      completedAt: new Date(),
    },
  });
  createdRunIds.push(run.id);

  for (let i = 0; i < FIXTURES.length; i++) {
    const spec = FIXTURES[i]!;
    const policy = await prisma.policyDocument.create({
      data: {
        title: `${TAG} ${spec.domain} policy ${i}`,
        domain: spec.domain,
        fullText: `${TAG} body ${i}`,
        isSynthetic: true,
      },
    });
    createdPolicyIds.push(policy.id);

    const chunk = await prisma.policyChunk.create({
      data: {
        policyDocumentId: policy.id,
        sectionHeading: "Test Section",
        content: `${TAG} chunk content ${i}`,
        chunkIndex: 0,
      },
    });
    createdChunkIds.push(chunk.id);

    const regItem = await prisma.regulatoryItem.create({
      data: {
        sourceUrl: `https://${TAG}.example/${i}-${Math.random().toString(36).slice(2)}`,
        regulator: spec.regulator,
        publicationDate: spec.createdAt,
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
        classification: spec.classification,
        confidence: 0.9,
        severity: spec.severity,
        explanation: `${TAG} explanation ${i}`,
        regulatoryQuote: "regulatory quote",
        policyQuote: "policy quote",
        regulatorySourceUrl: regItem.sourceUrl,
        policyReference: `policy ref ${i}`,
        status: spec.status,
        createdAt: spec.createdAt,
      },
    });
    createdAlertIds.push(alert.id);
  }
}

type RenderedRow = {
  alertId: string;
  regulator: string;
  severity: string;
  status: string;
  domain: string;
  date: string;
};

function rowsFromHtml(html: string): RenderedRow[] {
  const rowRe =
    /<tr[^>]*data-testid="alerts-row"[^>]*data-alert-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  const rows: RenderedRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const alertId = m[1]!;
    const body = m[2]!;
    const regMatch = body.match(
      /data-testid="alerts-cell-regulator"[^>]*data-regulator="([^"]+)"/,
    );
    const sevMatch = body.match(
      /data-testid="alerts-cell-severity"[^>]*data-severity="([^"]+)"/,
    );
    const stMatch = body.match(
      /data-testid="alerts-cell-status"[^>]*data-status="([^"]+)"/,
    );
    const domMatch = body.match(
      /data-testid="alerts-cell-domain"[^>]*data-domain="([^"]+)"/,
    );
    const dateMatch = body.match(
      /data-testid="alerts-cell-date"[^>]*data-date="([^"]+)"/,
    );
    rows.push({
      alertId,
      regulator: regMatch ? regMatch[1]! : "",
      severity: sevMatch ? sevMatch[1]! : "",
      status: stMatch ? stMatch[1]! : "",
      domain: domMatch ? domMatch[1]! : "",
      date: dateMatch ? dateMatch[1]! : "",
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

describe("LIST-006 alerts list date range filter (live UI)", () => {
  beforeAll(async () => {
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

  it("renders the date range form with empty inputs and no Clear link by default", async () => {
    const html = await fetchAlertsHtml();
    expect(html).toMatch(/data-testid="alerts-filter-date-range"/);
    expect(html).toMatch(/data-testid="alerts-filter-date-from"/);
    expect(html).toMatch(/data-testid="alerts-filter-date-to"/);
    expect(html).toMatch(/data-testid="alerts-filter-date-apply"/);
    // The bar's data-attributes echo "no filter".
    expect(html).toMatch(/data-filter-date-from=""/);
    expect(html).toMatch(/data-filter-date-to=""/);
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);

    // All seeded fixtures render.
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("?dateFrom=2099-02-15 narrows to alerts on or after the named day", async () => {
    const html = await fetchAlertsHtml("?dateFrom=2099-02-15");
    expect(html).toMatch(/data-filter-date-from="2099-02-15"/);
    expect(html).toMatch(/data-testid="alerts-filter-clear"/);
    // The dateFrom input echoes the value back.
    expect(html).toMatch(
      /data-testid="alerts-filter-date-from"[^>]*value="2099-02-15"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    const cutoffMs = new Date("2099-02-15T00:00:00Z").getTime();
    expect(rendered.length).toBeGreaterThan(0);
    for (const r of rendered) {
      expect(new Date(r.date).getTime()).toBeGreaterThanOrEqual(cutoffMs);
    }

    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.createdAt.getTime() >= cutoffMs)
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());
  });

  it("?dateFrom=...&dateTo=... narrows to the closed range (inclusive of dateTo)", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2099-02-01&dateTo=2099-03-15",
    );
    expect(html).toMatch(/data-filter-date-from="2099-02-01"/);
    expect(html).toMatch(/data-filter-date-to="2099-03-15"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-date-to"[^>]*value="2099-03-15"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    const fromMs = new Date("2099-02-01T00:00:00Z").getTime();
    // dateTo is inclusive of its named day -> upper bound is the start of the
    // following day in UTC.
    const toMs = new Date("2099-03-16T00:00:00Z").getTime();
    expect(rendered.length).toBeGreaterThan(0);
    for (const r of rendered) {
      const ms = new Date(r.date).getTime();
      expect(ms).toBeGreaterThanOrEqual(fromMs);
      expect(ms).toBeLessThan(toMs);
    }
    // The 2099-03-15 fixture is included (inclusive boundary), the
    // 2099-04-01 / 2099-04-20 / 2099-01-10 fixtures are excluded.
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(
        ({ fx }) =>
          fx.createdAt.getTime() >= fromMs && fx.createdAt.getTime() < toMs,
      )
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());
    // Confirm 2099-03-15 IS included (inclusive boundary).
    const inclusiveIdx = FIXTURES.findIndex(
      (fx) => fx.createdAt.toISOString() === "2099-03-15T00:00:00.000Z",
    );
    expect(inclusiveIdx).toBeGreaterThanOrEqual(0);
    expect(rendered.map((r) => r.alertId)).toContain(
      createdAlertIds[inclusiveIdx]!,
    );
  });

  it("the Clear link href has no dateFrom / dateTo params and returns the unfiltered list", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2099-02-01&dateTo=2099-03-15",
    );
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).not.toMatch(/[?&]dateFrom=/);
    expect(clearHref).not.toMatch(/[?&]dateTo=/);

    const cleared = await fetchAlertsHtml(clearHref.slice("/alerts".length));
    const renderedIds = seededOnly(rowsFromHtml(cleared)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("sort and date range compose: ?sortBy=date&dateFrom=... preserves both axes", async () => {
    const html = await fetchAlertsHtml("?sortBy=date&dateFrom=2099-02-15");
    expect(html).toMatch(/data-sort-by="date"/);
    expect(html).toMatch(/data-filter-date-from="2099-02-15"/);

    // Clear link keeps sortBy=date but drops dateFrom.
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).toMatch(/sortBy=date/);
    expect(clearHref).not.toMatch(/dateFrom=/);

    // Date sort header link keeps dateFrom=2099-02-15.
    const sortMatch = html.match(
      /data-testid="alerts-sort-date"[^>]*href="([^"]+)"/,
    );
    expect(sortMatch).not.toBeNull();
    const sortHref = sortMatch![1]!.replace(/&amp;/g, "&");
    expect(sortHref).toMatch(/dateFrom=2099-02-15/);
  });

  it("date range and chip filters compose: each preserves the others' selections", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=2099-02-01&dateTo=2099-04-30&regulator=SEC&severity=medium",
    );
    expect(html).toMatch(/data-filter-date-from="2099-02-01"/);
    expect(html).toMatch(/data-filter-date-to="2099-04-30"/);
    expect(html).toMatch(/data-filter-regulator="SEC"/);
    expect(html).toMatch(/data-filter-severity="medium"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-SEC"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-medium"[^>]*data-active="true"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    const fromMs = new Date("2099-02-01T00:00:00Z").getTime();
    const toMs = new Date("2099-05-01T00:00:00Z").getTime();
    for (const r of rendered) {
      expect(r.regulator).toBe("SEC");
      expect(r.severity).toBe("medium");
      const ms = new Date(r.date).getTime();
      expect(ms).toBeGreaterThanOrEqual(fromMs);
      expect(ms).toBeLessThan(toMs);
    }
    // Only the SEC + medium + 2099-03-15 (reg_e) fixture matches all four
    // axes; SEC + high + 2099-01-10 fails the dateFrom and severity bounds.
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(
        ({ fx }) =>
          fx.regulator === "SEC" &&
          fx.severity === "medium" &&
          fx.createdAt.getTime() >= fromMs &&
          fx.createdAt.getTime() < toMs,
      )
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());

    // The regulator-SEC chip's toggle href preserves dateFrom, dateTo, and
    // severity; toggling it would deselect the regulator filter.
    const secChipMatch = html.match(
      /data-testid="alerts-filter-regulator-SEC"[^>]*href="([^"]+)"/,
    );
    expect(secChipMatch).not.toBeNull();
    const secChipHref = secChipMatch![1]!.replace(/&amp;/g, "&");
    expect(secChipHref).toMatch(/dateFrom=2099-02-01/);
    expect(secChipHref).toMatch(/dateTo=2099-04-30/);
    expect(secChipHref).toMatch(/severity=medium/);
    expect(secChipHref).not.toMatch(/regulator=/);

    // The severity-medium chip's toggle href preserves dateFrom, dateTo, and
    // regulator.
    const medChipMatch = html.match(
      /data-testid="alerts-filter-severity-medium"[^>]*href="([^"]+)"/,
    );
    expect(medChipMatch).not.toBeNull();
    const medChipHref = medChipMatch![1]!.replace(/&amp;/g, "&");
    expect(medChipHref).toMatch(/dateFrom=2099-02-01/);
    expect(medChipHref).toMatch(/dateTo=2099-04-30/);
    expect(medChipHref).toMatch(/regulator=SEC/);
    expect(medChipHref).not.toMatch(/severity=/);

    // The date form's hidden inputs round-trip the chip filters back into the
    // submitted query string when the user clicks Apply.
    const formMatch = html.match(
      /<form[^>]*data-testid="alerts-filter-date-range"[^>]*>([\s\S]*?)<\/form>/,
    );
    expect(formMatch).not.toBeNull();
    const formBody = formMatch![1]!;
    expect(formBody).toMatch(
      /<input[^>]+type="hidden"[^>]+name="regulator"[^>]+value="SEC"/,
    );
    expect(formBody).toMatch(
      /<input[^>]+type="hidden"[^>]+name="severity"[^>]+value="medium"/,
    );
  });

  it("invalid dateFrom / dateTo values in the query string are silently ignored", async () => {
    const html = await fetchAlertsHtml(
      "?dateFrom=not-a-date&dateTo=2099/13/40",
    );
    expect(html).toMatch(/data-filter-date-from=""/);
    expect(html).toMatch(/data-filter-date-to=""/);
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });
});
