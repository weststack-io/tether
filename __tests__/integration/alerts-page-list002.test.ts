// LIST-002 verification harness.
//
// Seeds a fixed set of alerts with a deliberately mixed regulator distribution
// (SEC x2, FINRA x2, OCC x1, CFPB x1), then fetches the rendered /alerts HTML
// from the live dev server and asserts:
//   1. The filter bar renders with one toggle per regulator
//      (SEC / FINRA / CFPB / OCC).
//   2. With no filter active, all seeded rows render.
//   3. ?regulator=SEC narrows the rendered subset to SEC alerts only,
//      sets the SEC chip to data-active="true", and surfaces a Clear link.
//   4. ?regulator=SEC,FINRA narrows to the union of SEC + FINRA.
//   5. The "Clear" link href has no regulator param (returns all alerts).
//   6. Sort + filter compose: ?sortBy=severity&regulator=SEC preserves both
//      via the Clear link and chip hrefs (so sort survives a filter clear,
//      and filters survive a header sort click).
//   7. Invalid regulator values in the query string (e.g. CIA) are silently
//      dropped — the filter has no effect.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list002-verify";

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

// Six fixtures spanning all four regulators with SEC and FINRA each appearing
// twice so the "filter to one regulator" assertions can verify multi-row
// behavior, not just single-row trivial passes.
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
    status: "open",
    classification: "drifted",
    domain: "complaint_handling",
    createdAt: new Date("2099-02-10T00:00:00Z"),
  },
  {
    regulator: "OCC",
    severity: "low",
    status: "accepted",
    classification: "ambiguous",
    domain: "fair_lending",
    createdAt: new Date("2099-03-10T00:00:00Z"),
  },
  {
    regulator: "SEC",
    severity: "medium",
    status: "escalated",
    classification: "contradicted",
    domain: "reg_e",
    createdAt: new Date("2099-04-10T00:00:00Z"),
  },
  {
    regulator: "CFPB",
    severity: "high",
    status: "open",
    classification: "drifted",
    domain: "fair_lending",
    createdAt: new Date("2099-05-10T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "low",
    status: "dismissed",
    classification: "ambiguous",
    domain: "reg_z",
    createdAt: new Date("2099-06-10T00:00:00Z"),
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

  const domainToChunkId = new Map<string, string>();
  for (const spec of FIXTURES) {
    if (domainToChunkId.has(spec.domain)) continue;
    const policy = await prisma.policyDocument.create({
      data: {
        title: `${TAG} ${spec.domain} policy`,
        domain: spec.domain,
        fullText: `${TAG} body`,
        isSynthetic: true,
      },
    });
    createdPolicyIds.push(policy.id);

    const chunk = await prisma.policyChunk.create({
      data: {
        policyDocumentId: policy.id,
        sectionHeading: "Test Section",
        content: `${TAG} chunk content`,
        chunkIndex: 0,
      },
    });
    createdChunkIds.push(chunk.id);
    domainToChunkId.set(spec.domain, chunk.id);
  }

  for (let i = 0; i < FIXTURES.length; i++) {
    const spec = FIXTURES[i]!;
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
        policyChunkId: domainToChunkId.get(spec.domain)!,
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
    rows.push({ alertId, regulator: regMatch ? regMatch[1]! : "" });
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

describe("LIST-002 alerts list regulator filter (live UI)", () => {
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

  it("renders the filter bar with one toggle per regulator and no Clear link by default", async () => {
    const html = await fetchAlertsHtml();
    expect(html).toMatch(/data-testid="alerts-filter-bar"/);
    for (const reg of ["SEC", "FINRA", "CFPB", "OCC"]) {
      expect(html).toMatch(
        new RegExp(`data-testid="alerts-filter-regulator-${reg}"`),
      );
    }
    // None of the chips should be active when no filter is applied.
    for (const reg of ["SEC", "FINRA", "CFPB", "OCC"]) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-regulator-${reg}"[^>]*data-active="false"`,
        ),
      );
    }
    // No Clear link without an active filter.
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);

    // All seeded fixtures render.
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("?regulator=SEC narrows the rendered subset to SEC alerts only", async () => {
    const html = await fetchAlertsHtml("?regulator=SEC");
    expect(html).toMatch(/data-filter-regulator="SEC"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-SEC"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-FINRA"[^>]*data-active="false"/,
    );
    expect(html).toMatch(/data-testid="alerts-filter-clear"/);

    // Only seeded SEC rows; non-SEC seeded rows must not render.
    const rendered = seededOnly(rowsFromHtml(html));
    expect(rendered.length).toBeGreaterThan(0);
    for (const r of rendered) expect(r.regulator).toBe("SEC");

    const expectedSecIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.regulator === "SEC")
      .map(({ id }) => id);
    const renderedIds = rendered.map((r) => r.alertId).sort();
    expect(renderedIds).toEqual(expectedSecIds.sort());
  });

  it("?regulator=SEC,FINRA renders the union of both regulators", async () => {
    const html = await fetchAlertsHtml("?regulator=SEC,FINRA");
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-SEC"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-FINRA"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-OCC"[^>]*data-active="false"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    for (const r of rendered) {
      expect(["SEC", "FINRA"]).toContain(r.regulator);
    }
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.regulator === "SEC" || fx.regulator === "FINRA")
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());
  });

  it("the Clear link href has no regulator param and returns the unfiltered list", async () => {
    const html = await fetchAlertsHtml("?regulator=SEC");
    // The Clear link must point at /alerts with sort params but without a
    // `regulator=` query string.
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).not.toMatch(/[?&]regulator=/);

    // Following the Clear link returns the unfiltered list.
    const cleared = await fetchAlertsHtml(clearHref.slice("/alerts".length));
    const renderedIds = seededOnly(rowsFromHtml(cleared)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("sort and filter compose: ?sortBy=severity&regulator=SEC preserves both axes", async () => {
    const html = await fetchAlertsHtml("?sortBy=severity&regulator=SEC");
    expect(html).toMatch(/data-sort-by="severity"/);
    expect(html).toMatch(/data-filter-regulator="SEC"/);

    // The Clear link must keep sortBy=severity (so clearing the filter
    // doesn't reset the user's sort choice).
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).toMatch(/sortBy=severity/);

    // The Severity sort header link must keep regulator=SEC (so clicking the
    // header doesn't reset the user's filter).
    const sortMatch = html.match(
      /data-testid="alerts-sort-severity"[^>]*href="([^"]+)"/,
    );
    expect(sortMatch).not.toBeNull();
    const sortHref = sortMatch![1]!.replace(/&amp;/g, "&");
    expect(sortHref).toMatch(/regulator=SEC/);
  });

  it("invalid regulator values in the query string are silently ignored", async () => {
    const html = await fetchAlertsHtml("?regulator=CIA");
    // No chip becomes active.
    for (const reg of ["SEC", "FINRA", "CFPB", "OCC"]) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-regulator-${reg}"[^>]*data-active="false"`,
        ),
      );
    }
    // No Clear link, since the filter parsed to null.
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);
    // All seeded rows still render (filter had no effect).
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });
});
