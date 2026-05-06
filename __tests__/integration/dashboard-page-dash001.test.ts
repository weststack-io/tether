// DASH-001 verification harness.
//
// Seeds an open alert at each severity (high, medium, low), fetches the
// rendered dashboard page HTML from the live dev server, parses out the
// severity-card counts, and asserts the deltas equal +1 per severity. Then
// cleans up. This is the live-UI verification step for DASH-001 and is run
// once per session (it depends on the dev server being up on :3000).

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "dash001-verify";

const createdAlertIds: string[] = [];
const createdItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

async function seedOpenAlert(severity: "high" | "medium" | "low") {
  const run = await prisma.ingestionRun.create({
    data: { trigger: "manual", status: "completed", completedAt: new Date() },
  });
  createdRunIds.push(run.id);

  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TAG} ${severity}`,
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
      sourceUrl: `https://${TAG}.example/${severity}/${Math.random().toString(36).slice(2)}`,
      regulator: "SEC",
      publicationDate: new Date(),
      documentType: "notice",
      title: `${TAG} ${severity} item`,
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
      severity,
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

async function fetchDashboardCounts(): Promise<Record<"high" | "medium" | "low", number>> {
  const res = await fetch("http://localhost:3000/", { cache: "no-store" });
  expect(res.status).toBe(200);
  const html = await res.text();
  const counts: Record<"high" | "medium" | "low", number> = {
    high: NaN,
    medium: NaN,
    low: NaN,
  };
  for (const sev of ["high", "medium", "low"] as const) {
    const re = new RegExp(
      `data-testid="severity-count-${sev}"[^>]*>\\s*(\\d+)\\s*<`,
    );
    const m = html.match(re);
    expect(m).not.toBeNull();
    counts[sev] = Number(m![1]);
  }
  return counts;
}

describe("DASH-001 dashboard severity cards (live UI)", () => {
  let baseline: Record<"high" | "medium" | "low", number>;

  beforeAll(async () => {
    baseline = await fetchDashboardCounts();
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

  it("renders three labeled cards (High, Medium, Low) with counts that reflect the database", async () => {
    await seedOpenAlert("high");
    await seedOpenAlert("medium");
    await seedOpenAlert("low");

    const after = await fetchDashboardCounts();

    expect(after.high).toBe(baseline.high + 1);
    expect(after.medium).toBe(baseline.medium + 1);
    expect(after.low).toBe(baseline.low + 1);

    // Sanity-check the severity color classes appear in the HTML so the visual
    // contract from the spec (red / amber / blue) is also locked in. The
    // class attribute precedes data-severity in the rendered output so the
    // regex matches `bg-...` then any non-`>` chars then the severity tag.
    const html = await (await fetch("http://localhost:3000/", { cache: "no-store" })).text();
    expect(html).toMatch(/bg-red-50[^>]*data-severity="high"/);
    expect(html).toMatch(/bg-amber-50[^>]*data-severity="medium"/);
    expect(html).toMatch(/bg-blue-50[^>]*data-severity="low"/);
    expect(html).toMatch(/>High</);
    expect(html).toMatch(/>Medium</);
    expect(html).toMatch(/>Low</);
  });
});
