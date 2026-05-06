// LIST-005 verification harness.
//
// Seeds a fixed set of alerts with a deliberately mixed domain distribution
// across all ten policy domains (bsa_aml, complaint_handling, fair_lending,
// reg_e, reg_z, vendor_management, info_security, cip, overdraft, marketing),
// then fetches the rendered /alerts HTML from the live dev server and asserts:
//   1. The filter bar renders one toggle per domain (10 chips) and no Clear
//      link with no filter active.
//   2. ?domain=bsa_aml narrows the rendered subset to bsa_aml alerts only,
//      sets the bsa_aml chip to data-active="true", and surfaces a Clear link.
//   3. ?domain=bsa_aml,fair_lending renders the union.
//   4. The Clear link href has no domain= param and returns the unfiltered
//      list.
//   5. Sort + domain filter compose: ?sortBy=date&domain=bsa_aml preserves
//      both via the Clear link and column-sort hrefs.
//   6. Domain + regulator + severity + status filters compose: each chip
//      group's toggle hrefs preserve the OTHER groups' selections.
//   7. Invalid domain values (e.g. "spaceflight") are silently dropped.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "list005-verify";

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

// Seven fixtures spanning five distinct domains. `bsa_aml` and `fair_lending`
// each appear twice so the single-filter and union-of-two assertions have
// multi-row behavior; `complaint_handling`, `reg_e`, and `reg_z` appear once
// each. The SEC + high + open + bsa_aml row is the unique intersection used
// by the four-axis composition test.
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
  {
    regulator: "CFPB",
    severity: "medium",
    status: "open",
    classification: "drifted",
    domain: "bsa_aml",
    createdAt: new Date("2099-07-15T00:00:00Z"),
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

  // Each fixture gets its own (policy, chunk) pair so the alerts->chunk
  // join is unambiguous, but rows with the same domain share a domain string
  // so the where-clause `policyDocument.domain = { in: [...] }` matches all
  // of them. (Distinct chunk ids keep the per-row data isolated; a shared
  // domain string is the dimension we filter on.)
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
    const domMatch = chunk.match(
      /data-testid="alerts-cell-domain"[^>]*data-domain="([^"]+)"/,
    );
    rows.push({
      alertId,
      regulator: regMatch ? regMatch[1]! : "",
      severity: sevMatch ? sevMatch[1]! : "",
      status: stMatch ? stMatch[1]! : "",
      domain: domMatch ? domMatch[1]! : "",
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

const ALL_DOMAINS = [
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

describe("LIST-005 alerts list domain filter (live UI)", () => {
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

  it("renders the domain filter group with one toggle per domain and no Clear link by default", async () => {
    const html = await fetchAlertsHtml();
    expect(html).toMatch(/data-testid="alerts-filter-bar"/);
    for (const dom of ALL_DOMAINS) {
      expect(html).toMatch(
        new RegExp(`data-testid="alerts-filter-domain-${dom}"`),
      );
    }
    for (const dom of ALL_DOMAINS) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-domain-${dom}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);

    // All seeded fixtures render.
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("?domain=bsa_aml narrows the rendered subset to bsa_aml alerts only", async () => {
    const html = await fetchAlertsHtml("?domain=bsa_aml");
    expect(html).toMatch(/data-filter-domain="bsa_aml"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-domain-bsa_aml"[^>]*data-active="true"/,
    );
    for (const dom of ALL_DOMAINS.filter((d) => d !== "bsa_aml")) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-domain-${dom}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).toMatch(/data-testid="alerts-filter-clear"/);

    const rendered = seededOnly(rowsFromHtml(html));
    expect(rendered.length).toBeGreaterThan(0);
    for (const r of rendered) expect(r.domain).toBe("bsa_aml");

    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(({ fx }) => fx.domain === "bsa_aml")
      .map(({ id }) => id);
    const renderedIds = rendered.map((r) => r.alertId).sort();
    expect(renderedIds).toEqual(expectedIds.sort());
  });

  it("?domain=bsa_aml,fair_lending renders the union of both domains", async () => {
    const html = await fetchAlertsHtml("?domain=bsa_aml,fair_lending");
    expect(html).toMatch(
      /data-testid="alerts-filter-domain-bsa_aml"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-domain-fair_lending"[^>]*data-active="true"/,
    );
    for (const dom of ALL_DOMAINS.filter(
      (d) => d !== "bsa_aml" && d !== "fair_lending",
    )) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-domain-${dom}"[^>]*data-active="false"`,
        ),
      );
    }

    const rendered = seededOnly(rowsFromHtml(html));
    for (const r of rendered) {
      expect(["bsa_aml", "fair_lending"]).toContain(r.domain);
    }
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(
        ({ fx }) => fx.domain === "bsa_aml" || fx.domain === "fair_lending",
      )
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());
  });

  it("the Clear link href has no domain param and returns the unfiltered list", async () => {
    const html = await fetchAlertsHtml("?domain=bsa_aml");
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).not.toMatch(/[?&]domain=/);

    const cleared = await fetchAlertsHtml(clearHref.slice("/alerts".length));
    const renderedIds = seededOnly(rowsFromHtml(cleared)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });

  it("sort and domain filter compose: ?sortBy=date&domain=bsa_aml preserves both axes", async () => {
    const html = await fetchAlertsHtml("?sortBy=date&domain=bsa_aml");
    expect(html).toMatch(/data-sort-by="date"/);
    expect(html).toMatch(/data-filter-domain="bsa_aml"/);

    // Clear link keeps sortBy=date but drops domain.
    const clearMatch = html.match(
      /data-testid="alerts-filter-clear"[^>]*href="([^"]+)"/,
    );
    expect(clearMatch).not.toBeNull();
    const clearHref = clearMatch![1]!.replace(/&amp;/g, "&");
    expect(clearHref).toMatch(/sortBy=date/);
    expect(clearHref).not.toMatch(/domain=/);

    // Date sort header link keeps domain=bsa_aml.
    const sortMatch = html.match(
      /data-testid="alerts-sort-date"[^>]*href="([^"]+)"/,
    );
    expect(sortMatch).not.toBeNull();
    const sortHref = sortMatch![1]!.replace(/&amp;/g, "&");
    expect(sortHref).toMatch(/domain=bsa_aml/);
  });

  it("domain + regulator + severity + status filters compose: each chip group preserves the others", async () => {
    const html = await fetchAlertsHtml(
      "?domain=bsa_aml&regulator=SEC&severity=high&status=open",
    );
    expect(html).toMatch(/data-filter-domain="bsa_aml"/);
    expect(html).toMatch(/data-filter-regulator="SEC"/);
    expect(html).toMatch(/data-filter-severity="high"/);
    expect(html).toMatch(/data-filter-status="open"/);
    expect(html).toMatch(
      /data-testid="alerts-filter-domain-bsa_aml"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-regulator-SEC"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-severity-high"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /data-testid="alerts-filter-status-open"[^>]*data-active="true"/,
    );

    const rendered = seededOnly(rowsFromHtml(html));
    for (const r of rendered) {
      expect(r.domain).toBe("bsa_aml");
      expect(r.regulator).toBe("SEC");
      expect(r.severity).toBe("high");
      expect(r.status).toBe("open");
    }
    const expectedIds = FIXTURES
      .map((fx, i) => ({ fx, id: createdAlertIds[i]! }))
      .filter(
        ({ fx }) =>
          fx.domain === "bsa_aml" &&
          fx.regulator === "SEC" &&
          fx.severity === "high" &&
          fx.status === "open",
      )
      .map(({ id }) => id);
    expect(rendered.map((r) => r.alertId).sort()).toEqual(expectedIds.sort());

    // Each chip group's toggle href must preserve the other three filters.
    // The domain-bsa_aml chip's toggle (which would deselect bsa_aml) keeps
    // regulator, severity, and status.
    const domainChipMatch = html.match(
      /data-testid="alerts-filter-domain-bsa_aml"[^>]*href="([^"]+)"/,
    );
    expect(domainChipMatch).not.toBeNull();
    const domainChipHref = domainChipMatch![1]!.replace(/&amp;/g, "&");
    expect(domainChipHref).toMatch(/regulator=SEC/);
    expect(domainChipHref).toMatch(/severity=high/);
    expect(domainChipHref).toMatch(/status=open/);
    expect(domainChipHref).not.toMatch(/domain=/);

    // The regulator-SEC chip's toggle keeps domain, severity, and status.
    const secChipMatch = html.match(
      /data-testid="alerts-filter-regulator-SEC"[^>]*href="([^"]+)"/,
    );
    expect(secChipMatch).not.toBeNull();
    const secChipHref = secChipMatch![1]!.replace(/&amp;/g, "&");
    expect(secChipHref).toMatch(/domain=bsa_aml/);
    expect(secChipHref).toMatch(/severity=high/);
    expect(secChipHref).toMatch(/status=open/);
    expect(secChipHref).not.toMatch(/regulator=/);

    // The severity-high chip's toggle keeps domain, regulator, and status.
    const highChipMatch = html.match(
      /data-testid="alerts-filter-severity-high"[^>]*href="([^"]+)"/,
    );
    expect(highChipMatch).not.toBeNull();
    const highChipHref = highChipMatch![1]!.replace(/&amp;/g, "&");
    expect(highChipHref).toMatch(/domain=bsa_aml/);
    expect(highChipHref).toMatch(/regulator=SEC/);
    expect(highChipHref).toMatch(/status=open/);
    expect(highChipHref).not.toMatch(/severity=/);

    // The status-open chip's toggle keeps domain, regulator, and severity.
    const openChipMatch = html.match(
      /data-testid="alerts-filter-status-open"[^>]*href="([^"]+)"/,
    );
    expect(openChipMatch).not.toBeNull();
    const openChipHref = openChipMatch![1]!.replace(/&amp;/g, "&");
    expect(openChipHref).toMatch(/domain=bsa_aml/);
    expect(openChipHref).toMatch(/regulator=SEC/);
    expect(openChipHref).toMatch(/severity=high/);
    expect(openChipHref).not.toMatch(/status=/);
  });

  it("invalid domain values in the query string are silently ignored", async () => {
    const html = await fetchAlertsHtml("?domain=spaceflight");
    for (const dom of ALL_DOMAINS) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="alerts-filter-domain-${dom}"[^>]*data-active="false"`,
        ),
      );
    }
    expect(html).not.toMatch(/data-testid="alerts-filter-clear"/);
    const renderedIds = seededOnly(rowsFromHtml(html)).map((r) => r.alertId);
    for (const id of createdAlertIds) expect(renderedIds).toContain(id);
  });
});
