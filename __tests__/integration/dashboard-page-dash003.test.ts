// DASH-003 verification harness.
//
// Seeds open alerts attached to RegulatoryItems whose `regulator` field
// covers SEC / FINRA / CFPB / OCC, fetches the rendered dashboard HTML from
// the live dev server, parses the regulator-card counts, and asserts the
// deltas match the seeded counts. Then cleans up. This is the live-UI
// verification step for DASH-003 and depends on the dev server being up
// on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "dash003-verify";
const REGULATORS = ["SEC", "FINRA", "CFPB", "OCC"] as const;
type Regulator = (typeof REGULATORS)[number];

const createdAlertIds: string[] = [];
const createdItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

async function seedOpenAlertForRegulator(regulator: Regulator) {
  const run = await prisma.ingestionRun.create({
    data: { trigger: "manual", status: "completed", completedAt: new Date() },
  });
  createdRunIds.push(run.id);

  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TAG} ${regulator}`,
      domain: "fair_lending",
      fullText: `${TAG} policy text`,
      isSynthetic: true,
    },
  });
  createdPolicyIds.push(policy.id);

  const chunk = await prisma.policyChunk.create({
    data: {
      policyDocumentId: policy.id,
      sectionHeading: "X",
      content: "c",
      chunkIndex: 0,
    },
  });
  createdChunkIds.push(chunk.id);

  const item = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: `https://${TAG}.example/${regulator}/${Math.random().toString(36).slice(2)}`,
      regulator,
      publicationDate: new Date(),
      documentType: "notice",
      title: `${TAG} ${regulator} item`,
      fullText: "x",
      ingestionRunId: run.id,
    },
  });
  createdItemIds.push(item.id);

  const alert = await prisma.alert.create({
    data: {
      regulatoryItemId: item.id,
      policyChunkId: chunk.id,
      classification: "drifted",
      confidence: 0.9,
      severity: "medium",
      explanation: "x",
      regulatoryQuote: "q",
      policyQuote: "q",
      regulatorySourceUrl: item.sourceUrl,
      policyReference: "ref",
      status: "open",
    },
  });
  createdAlertIds.push(alert.id);
}

async function fetchRegulatorCounts(): Promise<Record<Regulator, number>> {
  const res = await fetch("http://localhost:3000/", { cache: "no-store" });
  expect(res.status).toBe(200);
  const html = await res.text();
  const counts: Record<Regulator, number> = { SEC: NaN, FINRA: NaN, CFPB: NaN, OCC: NaN };
  for (const reg of REGULATORS) {
    const re = new RegExp(
      `data-testid="regulator-count-${reg}"[^>]*>\\s*(\\d+)\\s*<`,
    );
    const m = html.match(re);
    expect(m).not.toBeNull();
    counts[reg] = Number(m![1]);
  }
  return counts;
}

describe("DASH-003 dashboard alerts-by-regulator cards (live UI)", () => {
  let baseline: Record<Regulator, number>;

  beforeAll(async () => {
    baseline = await fetchRegulatorCounts();
  });

  afterAll(async () => {
    if (createdAlertIds.length > 0) {
      await prisma.alert.deleteMany({ where: { id: { in: createdAlertIds } } });
    }
    if (createdItemIds.length > 0) {
      await prisma.regulatoryItem.deleteMany({
        where: { id: { in: createdItemIds } },
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

  it("renders four labeled cards (SEC, FINRA, CFPB, OCC) with counts that reflect the database", async () => {
    // Seed asymmetric counts so the test catches accidental hard-coding or
    // mis-mapping between regulator keys.
    await seedOpenAlertForRegulator("SEC");
    await seedOpenAlertForRegulator("SEC");
    await seedOpenAlertForRegulator("FINRA");
    await seedOpenAlertForRegulator("CFPB");
    await seedOpenAlertForRegulator("CFPB");
    await seedOpenAlertForRegulator("CFPB");
    await seedOpenAlertForRegulator("OCC");

    const after = await fetchRegulatorCounts();

    expect(after.SEC).toBe(baseline.SEC + 2);
    expect(after.FINRA).toBe(baseline.FINRA + 1);
    expect(after.CFPB).toBe(baseline.CFPB + 3);
    expect(after.OCC).toBe(baseline.OCC + 1);

    // Lock in the visible labels so the test catches a regression where the
    // markup loses its human-readable headings.
    const html = await (
      await fetch("http://localhost:3000/", { cache: "no-store" })
    ).text();
    for (const reg of REGULATORS) {
      expect(html).toMatch(new RegExp(`>${reg}<`));
      expect(html).toMatch(new RegExp(`data-regulator="${reg}"`));
    }
    // Section heading "By regulator" is present.
    expect(html).toMatch(/>By regulator</);
  });
});
