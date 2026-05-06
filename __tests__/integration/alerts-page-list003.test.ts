// LIST-003 verification harness.
//
// Seeds a fixed set of alerts with a deliberately mixed severity distribution
// (high x2, medium x2, low x2), then fetches the rendered /alerts HTML from
// the live dev server and asserts:
//   1. The filter bar renders one toggle per severity (high / medium / low)
//      and no Clear link with no filter active.
//   2. ?severity=high narrows the rendered subset to high-severity alerts only,
//      sets the high chip to data-active="true", and surfaces a Clear link.
//   3. ?severity=high,medium renders the union of high + medium.
//   4. The Clear link href has no severity param and returns all alerts.
//   5. Sort + severity filter compose: ?sortBy=date&severity=high preserves
//      both via the Clear link and chip hrefs.
//   6. Severity + regulator filter compose: ?severity=high&regulator=SEC
//      narrows to (high AND SEC), and each chip group's toggle hrefs preserve
//      the other group's selection.
//   7. Invalid severity values (e.g. "critical") are silently dropped.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list003-verify";

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

// Six fixtures spanning all three severities with each appearing twice so the
// "filter to one severity" assertions verify multi-row behavior. SEC and
// FINRA appear so the severity+regulator composition test has overlap and
// non-overlap to detect.
const FIXTURES: AlertSpec[] = [
  {
    regulator: "SEC",
    severity: "high",
    status: "open",
    classification: "drifted",
    domain: "bsa_aml",
    createdAt: new Date("2099-01-15T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "medium",
    status: "open",
    classification: "drifted",
    domain: "complaint_handling",
    createdAt: new Date("2099-02-15T00:00:00Z"),
  },
  {
    regulator: "OCC",
    severity: "low",
    status: "accepted",
    classification: "ambiguous",
    domain: "fair_lending",
    createdAt: new Date("2099-03-15T00:00:00Z"),
  },
  {
    regulator: "SEC",
    severity: "medium",
    status: "escalated",
    classification: "contradicted",
    domain: "reg_e",
    createdAt: new Date("2099-04-15T00:00:00Z"),
  },
  {
    regulator: "CFPB",
    severity: "high",
    status: "open",
    classification: "drifted",
    domain: "fair_lending",
    createdAt: new Date("2099-05-15T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "low",
    status: "dismissed",
    classification: "ambiguous",
    domain: "reg_z",
    createdAt: new Date("2099-06-15T00:00:00Z"),
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
  severity: string;
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
    rows.push({
      alertId,
      regulator: regMatch ? regMatch[1]! : "",
      severity: sevMatch ? sevMatch[1]! : "",
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

describe("LIST-003 alerts list severity filter (live UI)", () => {
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

  it("renders the severity filter group with one toggle per severity and no Clear link by default", async () => {
    const html = await fetchAlertsHtml();
    expect(html).toMatch(/data-testid="alerts-filter-bar"/);
    for (const sev of ["high", "medium", "low"]) {
      expect(html).toMatch(
        new RegExp(`data-testid="alerts-filter-severity-${sev}"`),
      );
    }
    for (const sev of ["high", "medium", "low"]) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-severity-${sev}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);

    // All seeded fixtures render.
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("?severity=high narrows the rendered subset to high-severity alerts only", async () => {
    const html = await fetchAlertsHtml("?severity=high");
    expect(html).toMatch(/data-filter-severity="high"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-high"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-medium"[^>]*data-active="false"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-low"[^>]*data-active="false"/,
    );
    expect(html).toMatch(/data-testid="alerts-filter-clear"/);

    const rendered = seededOnly(rowsFromHtml(html));
    expect(rendered.length).toBeGreaterThan(0);
    for (const r of rendered) expect(r.severity).toBe("high");

    const expectedHighIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.severity === "high")
      .map(({ id }) => id);
    const renderedIds = rendered.map((r) => r.alertId).sort();
    expect(renderedIds).toEqual(expectedHighIds.sort());
  });

  it("?severity=high,medium renders the union of both severities", async () => {
    const html = await fetchAlertsHtml("?severity=high,medium");
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-high"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-medium"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-low"[^>]*data-active="false"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    for (const r of rendered) {
      expect(["high", "medium"]).toContain(r.severity);
    }
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.severity === "high" || fx.severity === "medium")
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());
  });

  it("the Clear link href has no severity param and returns the unfiltered list", async () => {
    const html = await fetchAlertsHtml("?severity=high");
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).not.toMatch(/[?&]severity=/);

    const cleared = await fetchAlertsHtml(clearHref.slice("/alerts".length));
    const renderedIds = seededOnly(rowsFromHtml(cleared)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("sort and severity filter compose: ?sortBy=date&severity=high preserves both axes", async () => {
    const html = await fetchAlertsHtml("?sortBy=date&severity=high");
    expect(html).toMatch(/data-sort-by="date"/);
    expect(html).toMatch(/data-filter-severity="high"/);

    // Clear link keeps sortBy=date.
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).toMatch(/sortBy=date/);
    expect(clearHref).not.toMatch(/severity=/);

    // Date sort header link keeps severity=high.
    const sortMatch = html.match(
      /data-testid="alerts-sort-date"[^>]*href="([^"]+)"/,
    );
    expect(sortMatch).not.toBeNull();
    const sortHref = sortMatch![1]!.replace(/&amp;/g, "&");
    expect(sortHref).toMatch(/severity=high/);
  });

  it("severity and regulator filters compose: ?severity=high&regulator=SEC narrows to the intersection", async () => {
    const html = await fetchAlertsHtml("?severity=high&regulator=SEC");
    expect(html).toMatch(/data-filter-severity="high"/);
    expect(html).toMatch(/data-filter-regulator="SEC"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-high"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-SEC"[^>]*data-active="true"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    for (const r of rendered) {
      expect(r.severity).toBe("high");
      expect(r.regulator).toBe("SEC");
    }
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.severity === "high" && fx.regulator === "SEC")
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());

    // The severity-high chip's toggle href (which deselects high) must still
    // carry regulator=SEC, so toggling severity off doesn't drop the
    // regulator filter.
    const highChipMatch = html.match(
      /data-testid="alerts-filter-severity-high"[^>]*href="([^"]+)"/,
    );
    expect(highChipMatch).not.toBeNull();
    const highChipHref = highChipMatch![1]!.replace(/&amp;/g, "&");
    expect(highChipHref).toMatch(/regulator=SEC/);
    expect(highChipHref).not.toMatch(/severity=/);

    // The regulator-SEC chip's toggle href (which deselects SEC) must still
    // carry severity=high.
    const secChipMatch = html.match(
      /data-testid="alerts-filter-regulator-SEC"[^>]*href="([^"]+)"/,
    );
    expect(secChipMatch).not.toBeNull();
    const secChipHref = secChipMatch![1]!.replace(/&amp;/g, "&");
    expect(secChipHref).toMatch(/severity=high/);
    expect(secChipHref).not.toMatch(/regulator=/);
  });

  it("invalid severity values in the query string are silently ignored", async () => {
    const html = await fetchAlertsHtml("?severity=critical");
    for (const sev of ["high", "medium", "low"]) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-severity-${sev}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });
});
