// LIST-001 verification harness.
//
// Seeds a fixed set of alerts with deliberately varied values on every
// sortable axis (severity / classification / regulator / domain / date /
// status), then fetches the rendered /alerts HTML from the live dev server
// and asserts:
//   1. The table renders with the six required column headers.
//   2. The seeded alerts appear as table rows.
//   3. Each row's per-column cell renders the expected value.
//   4. Re-fetching with ?sortBy=...&sortOrder=... re-sorts the seeded subset
//      according to the requested axis (severity rank, regulator alpha,
//      domain alpha, date desc).
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list001-verify";

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

// Six fixtures with strictly distinct values per axis where possible. Severity
// values intentionally cover all three ranks; statuses cover open / escalated
// / accepted; classifications cover drifted / contradicted / ambiguous so the
// rendered classification label can be cross-checked.
const FIXTURES: AlertSpec[] = [
  {
    regulator: "SEC",
    severity: "low",
    status: "open",
    classification: "drifted",
    domain: "vendor_management",
    createdAt: new Date("2099-01-10T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "high",
    status: "escalated",
    classification: "contradicted",
    domain: "complaint_handling",
    createdAt: new Date("2099-02-10T00:00:00Z"),
  },
  {
    regulator: "CFPB",
    severity: "medium",
    status: "accepted",
    classification: "ambiguous",
    domain: "fair_lending",
    createdAt: new Date("2099-03-10T00:00:00Z"),
  },
  {
    regulator: "OCC",
    severity: "high",
    status: "dismissed",
    classification: "drifted",
    domain: "reg_e",
    createdAt: new Date("2099-04-10T00:00:00Z"),
  },
  {
    regulator: "SEC",
    severity: "medium",
    status: "open",
    classification: "drifted",
    domain: "bsa_aml",
    createdAt: new Date("2099-05-10T00:00:00Z"),
  },
  {
    regulator: "FINRA",
    severity: "low",
    status: "open",
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
  severity: string;
  classification: string;
  regulator: string;
  domain: string;
  date: string;
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

  const attr = (chunk: string, cellId: string, attrName: string): string => {
    const re = new RegExp(
      `data-testid="${cellId}"[^>]*${attrName}="([^"]+)"`,
    );
    const cm = chunk.match(re);
    return cm ? cm[1]! : "";
  };

  const rows: RenderedRow[] = [];
  for (const alertId of rowIds) {
    const chunk = rowChunk(alertId);
    rows.push({
      alertId,
      severity: attr(chunk, "alerts-cell-severity", "data-severity"),
      classification: attr(
        chunk,
        "alerts-cell-classification",
        "data-classification",
      ),
      regulator: attr(chunk, "alerts-cell-regulator", "data-regulator"),
      domain: attr(chunk, "alerts-cell-domain", "data-domain"),
      date: attr(chunk, "alerts-cell-date", "data-date"),
      status: attr(chunk, "alerts-cell-status", "data-status"),
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

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

describe("LIST-001 alerts list page (live UI)", () => {
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

  it("renders the table with the six required columns and the seeded alerts as rows", async () => {
    const html = await fetchAlertsHtml();

    // Header markers and column labels.
    expect(html).toMatch(/data-testid="alerts-table"/);
    expect(html).toMatch(/>Severity\b/);
    expect(html).toMatch(/>Classification\b/);
    expect(html).toMatch(/>Regulator\b/);
    expect(html).toMatch(/>Policy Domain\b/);
    expect(html).toMatch(/>Date Detected\b/);
    expect(html).toMatch(/>Status\b/);

    // Each column header has a sort link.
    for (const col of [
      "severity",
      "classification",
      "regulator",
      "domain",
      "date",
      "status",
    ]) {
      expect(html).toMatch(
        new RegExp(`data-testid="alerts-sort-${col}"`),
      );
    }

    // All seeded alerts present.
    const rows = rowsFromHtml(html);
    const renderedIds = rows.map((r) => r.alertId);
    for (const id of createdAlertIds) {
      expect(renderedIds).toContain(id);
    }

    // Cell values match what was seeded for each fixture.
    const seeded = seededOnly(rows);
    for (let i = 0; i < FIXTURES.length; i++) {
      const fx = FIXTURES[i]!;
      const id = createdAlertIds[i]!;
      const r = seeded.find((row) => row.alertId === id);
      expect(r).toBeDefined();
      expect(r!.severity).toBe(fx.severity);
      expect(r!.classification).toBe(fx.classification);
      expect(r!.regulator).toBe(fx.regulator);
      expect(r!.domain).toBe(fx.domain);
      expect(r!.status).toBe(fx.status);
      expect(r!.date).toBe(fx.createdAt.toISOString());
    }
  });

  it("default sort is date desc; the seeded subset renders newest-first", async () => {
    const html = await fetchAlertsHtml();
    expect(html).toMatch(/data-sort-by="date"/);
    expect(html).toMatch(/data-sort-order="desc"/);

    const seeded = seededOnly(rowsFromHtml(html));
    // Among the seeded subset, the order should be FIXTURES sorted by
    // createdAt DESC.
    const expectedIds = [...FIXTURES.keys()]
      .sort(
        (a, b) =>
          FIXTURES[b]!.createdAt.getTime() - FIXTURES[a]!.createdAt.getTime(),
      )
      .map((idx) => createdAlertIds[idx]!);
    expect(seeded.map((r) => r.alertId)).toEqual(expectedIds);
  });

  it("re-sorts by severity when ?sortBy=severity&sortOrder=desc (high < medium < low)", async () => {
    const html = await fetchAlertsHtml("?sortBy=severity&sortOrder=desc");
    expect(html).toMatch(/data-sort-by="severity"/);
    expect(html).toMatch(/data-sort-order="desc"/);

    const seeded = seededOnly(rowsFromHtml(html));
    // Expected order among seeded subset: severity rank ASC (high before
    // medium before low), with createdAt DESC as the tiebreaker (matching the
    // page's stable secondary sort).
    const expectedOrder = [...FIXTURES.keys()]
      .sort((a, b) => {
        const fa = FIXTURES[a]!;
        const fb = FIXTURES[b]!;
        const rankDiff =
          (SEVERITY_RANK[fa.severity] ?? 999) -
          (SEVERITY_RANK[fb.severity] ?? 999);
        if (rankDiff !== 0) return rankDiff;
        return fb.createdAt.getTime() - fa.createdAt.getTime();
      })
      .map((idx) => createdAlertIds[idx]!);
    expect(seeded.map((r) => r.alertId)).toEqual(expectedOrder);
  });

  it("re-sorts by regulator alphabetically when ?sortBy=regulator&sortOrder=asc", async () => {
    const html = await fetchAlertsHtml("?sortBy=regulator&sortOrder=asc");
    expect(html).toMatch(/data-sort-by="regulator"/);
    expect(html).toMatch(/data-sort-order="asc"/);

    const seeded = seededOnly(rowsFromHtml(html));
    const seededRegulators = seeded.map((r) => r.regulator);
    const sortedRegulators = [...seededRegulators].sort();
    expect(seededRegulators).toEqual(sortedRegulators);
  });

  it("re-sorts by domain alphabetically when ?sortBy=domain&sortOrder=asc", async () => {
    const html = await fetchAlertsHtml("?sortBy=domain&sortOrder=asc");
    expect(html).toMatch(/data-sort-by="domain"/);
    expect(html).toMatch(/data-sort-order="asc"/);

    const seeded = seededOnly(rowsFromHtml(html));
    const seededDomains = seeded.map((r) => r.domain);
    const sortedDomains = [...seededDomains].sort();
    expect(seededDomains).toEqual(sortedDomains);
  });

  it("column header links carry sortBy and sortOrder query params", async () => {
    const html = await fetchAlertsHtml();
    // Default state is date desc. The "date" header should toggle to asc;
    // every other header should set its own column with a default order.
    expect(html).toMatch(
      /data-testid="alerts-sort-date"\s+[^>]*href="\/alerts\?sortBy=date(?:&amp;|&)sortOrder=asc"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-sort-severity"\s+[^>]*href="\/alerts\?sortBy=severity(?:&amp;|&)sortOrder=desc"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-sort-regulator"\s+[^>]*href="\/alerts\?sortBy=regulator(?:&amp;|&)sortOrder=asc"/,
    );
  });
});
