// LIST-004 verification harness.
//
// Seeds a fixed set of alerts with a deliberately mixed status distribution
// across all five status values (open / accepted / dismissed / escalated /
// snoozed), then fetches the rendered /alerts HTML from the live dev server
// and asserts:
//   1. The filter bar renders one toggle per status (5 chips) and no Clear
//      link with no filter active.
//   2. ?status=open narrows the rendered subset to open alerts only, sets the
//      open chip to data-active="true", and surfaces a Clear link.
//   3. ?status=open,escalated renders the union.
//   4. The Clear link href has no status param and returns all alerts.
//   5. Sort + status filter compose: ?sortBy=date&status=open preserves both
//      via the Clear link and column-sort hrefs.
//   6. Status + regulator + severity filters compose: each chip group's
//      toggle hrefs preserve the OTHER groups' selections.
//   7. Invalid status values (e.g. "queued") are silently dropped.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list004-verify";

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

// Six fixtures spanning all five statuses. `open` appears twice so the single
// status filter assertion has multi-row behavior; the other four statuses
// each appear once. SEC + high-severity overlaps with status=open so the
// triple-axis composition test has both intersection (SEC AND high AND open)
// and non-overlap to detect.
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
    status: "escalated",
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
    status: "snoozed",
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
  status: string;
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
    return lastIndex === -1 ? "" : html.slice(lastIndex, lastIndex + 12_000);
  };

  const rows: RenderedRow[] = [];
  for (const alertId of rowIds) {
    const chunk = rowChunk(alertId);
    const regMatch = chunk.match(
      /data-testid="alerts-cell-regulator"[^>]*data-regulator="([^"]+)"/,
    );
    const sevMatch = chunk.match(
      /data-testid="alerts-cell-severity"[^>]*data-severity="([^"]+)"/,
    );
    const stMatch = chunk.match(
      /data-testid="alerts-cell-status"[^>]*data-status="([^"]+)"/,
    );
    rows.push({
      alertId,
      regulator: regMatch ? regMatch[1]! : "",
      severity: sevMatch ? sevMatch[1]! : "",
      status: stMatch ? stMatch[1]! : "",
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

const ALL_STATUSES = [
  "open",
  "accepted",
  "dismissed",
  "escalated",
  "snoozed",
] as const;

describe("LIST-004 alerts list status filter (live UI)", () => {
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

  it("renders the status filter group with one toggle per status and no Clear link by default", async () => {
    const html = await fetchAlertsHtml();
    expect(html).toMatch(/data-testid="alerts-filter-bar"/);
    for (const st of ALL_STATUSES) {
      expect(html).toMatch(
        new RegExp(`data-testid="alerts-filter-status-${st}"`),
      );
    }
    for (const st of ALL_STATUSES) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-status-${st}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);

    // All seeded fixtures render.
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("?status=open narrows the rendered subset to open alerts only", async () => {
    const html = await fetchAlertsHtml("?status=open");
    expect(html).toMatch(/data-filter-status="open"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-status-open"[^>]*data-active="true"/,
    );
    for (const st of ALL_STATUSES.filter((s) => s !== "open")) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-status-${st}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).toMatch(/data-testid="alerts-filter-clear"/);

    const rendered = seededOnly(rowsFromHtml(html));
    expect(rendered.length).toBeGreaterThan(0);
    for (const r of rendered) expect(r.status).toBe("open");

    const expectedOpenIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.status === "open")
      .map(({ id }) => id);
    const renderedIds = rendered.map((r) => r.alertId).sort();
    expect(renderedIds).toEqual(expectedOpenIds.sort());
  });

  it("?status=open,escalated renders the union of both statuses", async () => {
    const html = await fetchAlertsHtml("?status=open,escalated");
    expect(html).toMatch(
      /data-testid="alerts-filter-status-open"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-status-escalated"[^>]*data-active="true"/,
    );
    for (const st of ["accepted", "dismissed", "snoozed"] as const) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-status-${st}"[^>]*data-active="false"`,
        ),
      );
    }

    const rendered = seededOnly(rowsFromHtml(html));
    for (const r of rendered) {
      expect(["open", "escalated"]).toContain(r.status);
    }
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.status === "open" || fx.status === "escalated")
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());
  });

  it("the Clear link href has no status param and returns the unfiltered list", async () => {
    const html = await fetchAlertsHtml("?status=open");
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).not.toMatch(/[?&]status=/);

    const cleared = await fetchAlertsHtml(clearHref.slice("/alerts".length));
    const renderedIds = seededOnly(rowsFromHtml(cleared)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("sort and status filter compose: ?sortBy=date&status=open preserves both axes", async () => {
    const html = await fetchAlertsHtml("?sortBy=date&status=open");
    expect(html).toMatch(/data-sort-by="date"/);
    expect(html).toMatch(/data-filter-status="open"/);

    // Clear link keeps sortBy=date but drops status.
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).toMatch(/sortBy=date/);
    expect(clearHref).not.toMatch(/status=/);

    // Date sort header link keeps status=open.
    const sortMatch = html.match(
      /data-testid="alerts-sort-date"[^>]*href="([^"]+)"/,
    );
    expect(sortMatch).not.toBeNull();
    const sortHref = sortMatch![1]!.replace(/&amp;/g, "&");
    expect(sortHref).toMatch(/status=open/);
  });

  it("status + regulator + severity filters compose: each chip group preserves the others", async () => {
    const html = await fetchAlertsHtml(
      "?status=open&regulator=SEC&severity=high",
    );
    expect(html).toMatch(/data-filter-status="open"/);
    expect(html).toMatch(/data-filter-regulator="SEC"/);
    expect(html).toMatch(/data-filter-severity="high"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-status-open"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-SEC"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-high"[^>]*data-active="true"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    for (const r of rendered) {
      expect(r.status).toBe("open");
      expect(r.regulator).toBe("SEC");
      expect(r.severity).toBe("high");
    }
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(
        ({ fx }) =>
          fx.status === "open" &&
          fx.regulator === "SEC" &&
          fx.severity === "high",
      )
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());

    // Each chip group's toggle href must preserve the other two filters.
    // The status-open chip's toggle (which would deselect open) keeps regulator
    // and severity.
    const openChipMatch = html.match(
      /data-testid="alerts-filter-status-open"[^>]*href="([^"]+)"/,
    );
    expect(openChipMatch).not.toBeNull();
    const openChipHref = openChipMatch![1]!.replace(/&amp;/g, "&");
    expect(openChipHref).toMatch(/regulator=SEC/);
    expect(openChipHref).toMatch(/severity=high/);
    expect(openChipHref).not.toMatch(/status=/);

    // The severity-high chip's toggle keeps status and regulator.
    const highChipMatch = html.match(
      /data-testid="alerts-filter-severity-high"[^>]*href="([^"]+)"/,
    );
    expect(highChipMatch).not.toBeNull();
    const highChipHref = highChipMatch![1]!.replace(/&amp;/g, "&");
    expect(highChipHref).toMatch(/regulator=SEC/);
    expect(highChipHref).toMatch(/status=open/);
    expect(highChipHref).not.toMatch(/severity=/);

    // The regulator-SEC chip's toggle keeps status and severity.
    const secChipMatch = html.match(
      /data-testid="alerts-filter-regulator-SEC"[^>]*href="([^"]+)"/,
    );
    expect(secChipMatch).not.toBeNull();
    const secChipHref = secChipMatch![1]!.replace(/&amp;/g, "&");
    expect(secChipHref).toMatch(/status=open/);
    expect(secChipHref).toMatch(/severity=high/);
    expect(secChipHref).not.toMatch(/regulator=/);
  });

  it("invalid status values in the query string are silently ignored", async () => {
    const html = await fetchAlertsHtml("?status=queued");
    for (const st of ALL_STATUSES) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-status-${st}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });
});
