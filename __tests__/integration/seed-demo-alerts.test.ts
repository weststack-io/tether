// SEED-002: Database seeded with pre-built demo alerts covering all five
// classification types, drawn from real regulatory publications matched
// against the dummy policy corpus.
//
// The seed is invoked via `npx prisma db seed`, which calls
// prisma/seed.ts → src/lib/seed/demo-alerts.ts. This test invokes
// seedDemoAlerts directly against the live test DB (after ensuring the
// policy corpus is in place) so the assertions don't depend on whether
// the operator has run the CLI seed in the current dev environment.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { quoteAppearsIn } from "@/lib/drift/citation";
import { prisma } from "@/lib/db";
import {
  DEMO_RUN_ID,
  seedDemoAlerts,
} from "@/lib/seed/demo-alerts";

const POLICY_DIR = resolve(process.cwd(), "data/policies");

const FILE_TO_DOMAIN: Record<string, string> = {
  "bsa-aml.md": "bsa_aml",
  "complaint-handling.md": "complaint_handling",
  "fair-lending.md": "fair_lending",
  "reg-e.md": "reg_e",
  "reg-z.md": "reg_z",
  "vendor-management.md": "vendor_management",
  "info-security.md": "info_security",
  "cip.md": "cip",
  "overdraft.md": "overdraft",
  "marketing.md": "marketing",
};

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const libsql = createClient({ url: databaseUrl });

async function ensurePolicyCorpus(): Promise<void> {
  // The seed script wipes + reseeds policies. Here we only verify the
  // required chunks already exist so failures point operators back to the
  // canonical seed flow instead of silently mutating the fixture corpus.
  const requiredPairs: Array<{ domain: string; sectionHeading: string }> = [
    { domain: "marketing", sectionHeading: "5. Pre-Publication Review Workflow" },
    { domain: "vendor_management", sectionHeading: "5. Risk Assessment and Tiering" },
    { domain: "overdraft", sectionHeading: "8. Fee Structure and Limits" },
    { domain: "fair_lending", sectionHeading: "5. Marketing and Outreach" },
    { domain: "bsa_aml", sectionHeading: "5. Risk Assessment" },
    { domain: "complaint_handling", sectionHeading: "10. Reporting" },
    { domain: "bsa_aml", sectionHeading: "16. Compliance Monitoring" },
  ];

  for (const { domain, sectionHeading } of requiredPairs) {
    const found = await prisma.policyChunk.findFirst({
      where: {
        sectionHeading,
        policyDocument: { domain },
      },
    });
    if (!found) {
      throw new Error(
        `seed-demo-alerts.test: PolicyChunk missing for domain=${domain} section="${sectionHeading}". Run \`npx prisma db seed\` to populate the policy corpus.`,
      );
    }
  }
}

beforeAll(async () => {
  // Sanity check the corpus, then seed (idempotent).
  await ensurePolicyCorpus();
  await seedDemoAlerts(libsql);
}, 30_000);

afterAll(async () => {
  await libsql.close();
  await prisma.$disconnect();
});

describe("SEED-002 demo alerts", () => {
  it("creates a demo IngestionRun with itemsFlagged = alerts created", async () => {
    const run = await prisma.ingestionRun.findUnique({
      where: { id: DEMO_RUN_ID },
    });
    expect(run).not.toBeNull();
    expect(run!.status).toBe("completed");
    expect(run!.trigger).toBe("manual");
    const alertCount = await prisma.alert.count({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
    });
    expect(alertCount).toBeGreaterThan(0);
    expect(run!.itemsFlagged).toBe(alertCount);
    expect(run!.itemsProcessed).toBe(alertCount);
  });

  it("includes at least one alert for each of drifted, contradicted, ambiguous", async () => {
    // Verification step 2.
    const alerts = await prisma.alert.findMany({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
      select: { classification: true },
    });
    const classes = new Set(alerts.map((a) => a.classification));
    expect(classes.has("drifted")).toBe(true);
    expect(classes.has("contradicted")).toBe(true);
    expect(classes.has("ambiguous")).toBe(true);
    // The description (not verification) calls for all 5 — best-effort check.
    expect(classes.has("aligned")).toBe(true);
    expect(classes.has("no_material_impact")).toBe(true);
  });

  it("spans multiple regulators across SEC / FINRA / CFPB / OCC", async () => {
    // Verification step 3.
    const alerts = await prisma.alert.findMany({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
      include: { regulatoryItem: { select: { regulator: true } } },
    });
    const regulators = new Set(alerts.map((a) => a.regulatoryItem.regulator));
    // At minimum 2; the seed actually covers all 4.
    expect(regulators.size).toBeGreaterThanOrEqual(2);
    for (const r of regulators) {
      expect(["SEC", "FINRA", "CFPB", "OCC"]).toContain(r);
    }
    expect(regulators.has("SEC")).toBe(true);
    expect(regulators.has("FINRA")).toBe(true);
    expect(regulators.has("CFPB")).toBe(true);
    expect(regulators.has("OCC")).toBe(true);
  });

  it("spans multiple policy domains", async () => {
    // Verification step 4.
    const alerts = await prisma.alert.findMany({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
      include: {
        policyChunk: {
          select: { policyDocument: { select: { domain: true } } },
        },
      },
    });
    const domains = new Set(
      alerts.map((a) => a.policyChunk.policyDocument.domain),
    );
    expect(domains.size).toBeGreaterThanOrEqual(2);
    // Every seeded domain must be one of the canonical 10 from FILE_TO_DOMAIN.
    const known = new Set(Object.values(FILE_TO_DOMAIN));
    for (const d of domains) expect(known.has(d)).toBe(true);
  });

  it("each alert carries valid citations: regulatoryQuote/policyQuote substrings, sourceUrl, policyReference", async () => {
    // Verification step 5.
    const alerts = await prisma.alert.findMany({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
      include: {
        regulatoryItem: { select: { fullText: true, sourceUrl: true } },
        policyChunk: {
          select: {
            content: true,
            sectionHeading: true,
            policyDocument: { select: { title: true } },
          },
        },
      },
    });
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      expect(a.regulatoryQuote.length).toBeGreaterThan(0);
      expect(a.policyQuote.length).toBeGreaterThan(0);
      expect(a.regulatorySourceUrl.length).toBeGreaterThan(0);
      expect(a.regulatorySourceUrl).toBe(a.regulatoryItem.sourceUrl);
      expect(a.policyReference.length).toBeGreaterThan(0);
      expect(a.policyReference).toBe(
        `${a.policyChunk.policyDocument.title} > ${a.policyChunk.sectionHeading}`,
      );
      // The drift pipeline's citation verifier requires that the quote appear
      // (modulo whitespace normalization) inside the source. The seeded
      // demo data must satisfy the same contract as a live-pipeline alert.
      expect(quoteAppearsIn(a.regulatoryQuote, a.regulatoryItem.fullText)).toBe(
        true,
      );
      expect(quoteAppearsIn(a.policyQuote, a.policyChunk.content)).toBe(true);
    }
  });

  it("creates a 'created' AuditEntry for each demo alert (system actor)", async () => {
    const alerts = await prisma.alert.findMany({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
      select: { id: true },
    });
    for (const a of alerts) {
      const entries = await prisma.auditEntry.findMany({
        where: { alertId: a.id },
      });
      expect(entries.length).toBeGreaterThan(0);
      const created = entries.find((e) => e.action === "created");
      expect(created).toBeDefined();
      expect(created!.actor).toBe("system");
    }
  });

  it("re-running the seed is idempotent (no duplicate rows)", async () => {
    const before = await prisma.alert.count({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
    });
    await seedDemoAlerts(libsql);
    const after = await prisma.alert.count({
      where: { id: { startsWith: "seed-demo-alerts-alt-" } },
    });
    expect(after).toBe(before);
    // Also: the run, regulatory items, and audit entries should not duplicate.
    const runs = await prisma.ingestionRun.count({
      where: { id: DEMO_RUN_ID },
    });
    expect(runs).toBe(1);
    const regItems = await prisma.regulatoryItem.count({
      where: { id: { startsWith: "seed-demo-alerts-reg-" } },
    });
    expect(regItems).toBe(before);
  });

  // Sanity: the policy markdowns we quote from are still on disk under the
  // exact names the seed script assumes. If a developer renames or removes
  // one, the seed will start failing with a "no PolicyChunk" error; this
  // test gives a clearer failure earlier.
  it("expected policy files exist on disk", async () => {
    const entries = await readdir(POLICY_DIR);
    for (const file of Object.keys(FILE_TO_DOMAIN)) {
      expect(entries).toContain(file);
      const text = await readFile(resolve(POLICY_DIR, file), "utf8");
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
