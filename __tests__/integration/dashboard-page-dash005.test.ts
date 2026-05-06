// DASH-005 verification harness.
//
// Seeds five ingestion runs with deliberately staggered startedAt timestamps,
// asymmetric itemsProcessed/itemsFlagged counts, mixed trigger types
// (manual / scheduled), and a mix of completed / failed statuses, then fetches
// the rendered dashboard HTML from the live dev server and asserts:
//   1. The five seeded runs appear in the recent-runs table.
//   2. They render in startedAt-DESC order (most recent first).
//   3. Only the latest 5 are shown (the table caps to 5 even after seeding
//      additional runs that should fall off the bottom).
//   4. Each row shows trigger, status, processed, and flagged values that
//      match the DB.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "dash005-verify";

const createdRunIds: string[] = [];

type Seed = {
  trigger: "manual" | "scheduled";
  status: "completed" | "failed" | "running";
  startedAt: Date;
  itemsProcessed: number;
  itemsFlagged: number;
};

async function seedRun(seed: Seed): Promise<string> {
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: seed.trigger,
      status: seed.status,
      startedAt: seed.startedAt,
      completedAt: seed.status === "running" ? null : seed.startedAt,
      itemsProcessed: seed.itemsProcessed,
      itemsFlagged: seed.itemsFlagged,
    },
  });
  createdRunIds.push(run.id);
  return run.id;
}

function rowsFromHtml(html: string): Array<{
  runId: string;
  started: string;
  trigger: string;
  status: string;
  processed: string;
  flagged: string;
}> {
  // Extract each <tr data-testid="recent-run-row" data-run-id="..."> ... </tr>
  // block, then pull out the per-cell values by their data-testid markers.
  const rowRe =
    /<tr[^>]*data-testid="recent-run-row"[^>]*data-run-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  const out: ReturnType<typeof rowsFromHtml> = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const runId = m[1];
    const body = m[2];
    const cell = (testid: string) => {
      const cellRe = new RegExp(
        `data-testid="${testid}"[^>]*>([\\s\\S]*?)<`,
      );
      const cm = body.match(cellRe);
      return cm ? cm[1].trim() : "";
    };
    out.push({
      runId,
      started: cell("recent-run-started"),
      trigger: cell("recent-run-trigger"),
      status: cell("recent-run-status"),
      processed: cell("recent-run-processed"),
      flagged: cell("recent-run-flagged"),
    });
  }
  return out;
}

async function fetchDashboardHtml(): Promise<string> {
  const res = await fetch("http://localhost:3000/", { cache: "no-store" });
  expect(res.status).toBe(200);
  return res.text();
}

describe("DASH-005 dashboard recent ingestion activity (live UI)", () => {
  beforeAll(async () => {
    // Wipe nothing — coexist with whatever runs are in the DB. We seed a fresh
    // batch with the LATEST timestamps so they monopolize the top 5 slots
    // regardless of pre-existing rows.
  });

  afterAll(async () => {
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("shows the most recent five runs with timestamp, trigger, status, and item counts in DESC order", async () => {
    // Use a future-anchored base so these seeds always sort above any
    // pre-existing IngestionRun rows on the dev DB.
    const base = Date.now() + 365 * 24 * 60 * 60 * 1000; // +1 year

    // Seed 6 runs total: 5 will appear in the table, 1 (the oldest, pushed off
    // by being older than the others) will be excluded. Using deliberately
    // asymmetric per-run counts so a hard-coded or mis-mapped column value
    // gets caught.
    const seeds: Seed[] = [
      // index 0 (oldest of the seeded set; should be EXCLUDED from table)
      {
        trigger: "scheduled",
        status: "completed",
        startedAt: new Date(base + 0),
        itemsProcessed: 99,
        itemsFlagged: 11,
      },
      // indexes 1..5 (newest 5; should appear in DESC order: 5,4,3,2,1)
      {
        trigger: "manual",
        status: "completed",
        startedAt: new Date(base + 1_000),
        itemsProcessed: 1,
        itemsFlagged: 0,
      },
      {
        trigger: "scheduled",
        status: "failed",
        startedAt: new Date(base + 2_000),
        itemsProcessed: 5,
        itemsFlagged: 2,
      },
      {
        trigger: "manual",
        status: "completed",
        startedAt: new Date(base + 3_000),
        itemsProcessed: 12,
        itemsFlagged: 4,
      },
      {
        trigger: "scheduled",
        status: "completed",
        startedAt: new Date(base + 4_000),
        itemsProcessed: 7,
        itemsFlagged: 1,
      },
      {
        trigger: "manual",
        status: "completed",
        startedAt: new Date(base + 5_000),
        itemsProcessed: 3,
        itemsFlagged: 3,
      },
    ];

    const seededIds: string[] = [];
    for (const s of seeds) {
      seededIds.push(await seedRun(s));
    }
    const oldestId = seededIds[0];
    const expectedTopFiveIds = seededIds.slice(1).reverse(); // newest first

    const html = await fetchDashboardHtml();

    // Section heading and table markers are present.
    expect(html).toMatch(/>Recent ingestion activity</);
    expect(html).toMatch(/data-testid="recent-runs-table"/);
    expect(html).toMatch(/>Started</);
    expect(html).toMatch(/>Trigger</);
    expect(html).toMatch(/>Status</);
    expect(html).toMatch(/>Processed</);
    expect(html).toMatch(/>Flagged</);

    const rows = rowsFromHtml(html);

    // Cap to 5 rows.
    expect(rows.length).toBe(5);

    // The five seeded latest-runs are present, in DESC order, and the oldest
    // seeded run is NOT in the rendered table.
    const renderedIds = rows.map((r) => r.runId);
    expect(renderedIds).toEqual(expectedTopFiveIds);
    expect(renderedIds).not.toContain(oldestId);

    // Each row's trigger/status/processed/flagged match what was seeded.
    for (let i = 0; i < expectedTopFiveIds.length; i += 1) {
      const seedIndex = 5 - i; // rows are newest-first, seeds[5] is newest
      const seed = seeds[seedIndex];
      const row = rows[i];
      expect(row.trigger.toLowerCase()).toBe(seed.trigger);
      expect(row.status.toLowerCase()).toBe(seed.status);
      expect(row.processed).toBe(String(seed.itemsProcessed));
      expect(row.flagged).toBe(String(seed.itemsFlagged));
      // Timestamp formatted as ISO-ish "YYYY-MM-DD HH:MM:SSZ".
      expect(row.started).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/);
    }
  });
});
