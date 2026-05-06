// INGLOG-001 verification harness.
//
// Seeds a deterministic batch of IngestionRun rows with future-anchored
// startedAt timestamps so they sort above any pre-existing dev-DB rows, then
// fetches /ingestion from the live dev server and asserts:
//   1. The page loads (200) and exposes the ingestion-log table.
//   2. Every seeded run appears as a row with timestamp, trigger, status,
//      processed, flagged, and suppressed columns matching the DB.
//   3. Seeded rows render in startedAt-DESC order (most recent first).
//   4. Status badge classes flip per status value.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const createdRunIds: string[] = [];

type Seed = {
  trigger: "manual" | "scheduled";
  status: "completed" | "failed" | "running";
  startedAt: Date;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
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
      itemsSuppressed: seed.itemsSuppressed,
    },
  });
  createdRunIds.push(run.id);
  return run.id;
}

type ParsedRow = {
  runId: string;
  position: string;
  started: string;
  startedIso: string | null;
  trigger: string;
  triggerAttr: string;
  status: string;
  statusAttr: string;
  statusClass: string;
  processed: string;
  flagged: string;
  suppressed: string;
};

function rowsFromHtml(html: string): ParsedRow[] {
  const rowRe =
    /<tr[^>]*data-testid="ingestion-log-row"[^>]*data-run-id="([^"]+)"[^>]*data-position="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  const out: ParsedRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const runId = m[1];
    const position = m[2];
    const body = m[3];
    const cellText = (testid: string) => {
      const re = new RegExp(
        `data-testid="${testid}"[^>]*>([\\s\\S]*?)</`,
      );
      const cm = body.match(re);
      return cm ? cm[1].replace(/<[^>]+>/g, "").trim() : "";
    };
    const triggerAttr = (() => {
      const cm = body.match(
        /data-testid="ingestion-log-trigger"[^>]*data-trigger="([^"]+)"/,
      );
      return cm ? cm[1] : "";
    })();
    const statusAttr = (() => {
      const cm = body.match(
        /data-testid="ingestion-log-status"[^>]*data-status="([^"]+)"/,
      );
      return cm ? cm[1] : "";
    })();
    const statusClass = (() => {
      const cm = body.match(
        /class="([^"]*)"[^>]*data-testid="ingestion-log-status"/,
      );
      return cm ? cm[1] : "";
    })();
    const startedIso = (() => {
      const cm = body.match(
        /data-testid="ingestion-log-started"[^>]*>\s*<time dateTime="([^"]+)"/,
      );
      return cm ? cm[1] : null;
    })();
    out.push({
      runId,
      position,
      started: cellText("ingestion-log-started"),
      startedIso,
      trigger: cellText("ingestion-log-trigger"),
      triggerAttr,
      status: cellText("ingestion-log-status"),
      statusAttr,
      statusClass,
      processed: cellText("ingestion-log-processed"),
      flagged: cellText("ingestion-log-flagged"),
      suppressed: cellText("ingestion-log-suppressed"),
    });
  }
  return out;
}

async function fetchIngestionHtml(): Promise<string> {
  const res = await fetch("http://localhost:3000/ingestion", {
    cache: "no-store",
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe("INGLOG-001 ingestion log page (live UI)", () => {
  let seededIds: string[] = [];
  let seeds: Seed[] = [];

  beforeAll(async () => {
    const base = Date.now() + 365 * 24 * 60 * 60 * 1000; // +1 year, future-anchor
    seeds = [
      {
        trigger: "manual",
        status: "completed",
        startedAt: new Date(base + 1_000),
        itemsProcessed: 1,
        itemsFlagged: 0,
        itemsSuppressed: 0,
      },
      {
        trigger: "scheduled",
        status: "failed",
        startedAt: new Date(base + 2_000),
        itemsProcessed: 5,
        itemsFlagged: 2,
        itemsSuppressed: 1,
      },
      {
        trigger: "scheduled",
        status: "completed",
        startedAt: new Date(base + 3_000),
        itemsProcessed: 12,
        itemsFlagged: 4,
        itemsSuppressed: 3,
      },
      {
        trigger: "manual",
        status: "running",
        startedAt: new Date(base + 4_000),
        itemsProcessed: 0,
        itemsFlagged: 0,
        itemsSuppressed: 0,
      },
    ];
    seededIds = [];
    for (const s of seeds) {
      seededIds.push(await seedRun(s));
    }
  });

  afterAll(async () => {
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("renders the page heading and ingestion-log card with table markers", async () => {
    const html = await fetchIngestionHtml();
    expect(html).toMatch(/>Ingestion Log</);
    expect(html).toMatch(/data-testid="ingestion-log-card"/);
    expect(html).toMatch(/data-testid="ingestion-log-table"/);
    expect(html).toMatch(/>Started</);
    expect(html).toMatch(/>Trigger</);
    expect(html).toMatch(/>Status</);
    expect(html).toMatch(/>Processed</);
    expect(html).toMatch(/>Flagged</);
    expect(html).toMatch(/>Suppressed</);
  });

  it("renders one row per seeded run with matching trigger, status, processed, flagged, suppressed", async () => {
    const html = await fetchIngestionHtml();
    const rows = rowsFromHtml(html);
    const seededRows = rows.filter((r) => seededIds.includes(r.runId));
    expect(seededRows.length).toBe(seededIds.length);

    // Each seeded row's column values match what we wrote.
    for (let i = 0; i < seeds.length; i += 1) {
      const seed = seeds[i];
      const id = seededIds[i];
      const row = seededRows.find((r) => r.runId === id);
      expect(row).toBeDefined();
      if (!row) continue;
      expect(row.triggerAttr).toBe(seed.trigger);
      expect(row.trigger.toLowerCase()).toBe(seed.trigger);
      expect(row.statusAttr).toBe(seed.status);
      expect(row.status.toLowerCase()).toBe(seed.status);
      expect(row.processed).toBe(String(seed.itemsProcessed));
      expect(row.flagged).toBe(String(seed.itemsFlagged));
      expect(row.suppressed).toBe(String(seed.itemsSuppressed));
      expect(row.startedIso).toBe(seed.startedAt.toISOString());
      expect(row.started).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/);
    }
  });

  it("orders runs by startedAt DESC (most recent first)", async () => {
    const html = await fetchIngestionHtml();
    const rows = rowsFromHtml(html);
    const seededRows = rows.filter((r) => seededIds.includes(r.runId));
    // seeds[] is oldest -> newest, so DESC = reverse.
    const expectedOrder = seededIds.slice().reverse();
    expect(seededRows.map((r) => r.runId)).toEqual(expectedOrder);

    // Sanity: across the FULL rendered table (including any pre-existing rows)
    // positions are monotonically non-decreasing from 0 with strictly DESC
    // startedAt timestamps among those carrying an ISO.
    const allWithIso = rows.filter((r) => r.startedIso !== null);
    for (let i = 1; i < allWithIso.length; i += 1) {
      const prev = new Date(allWithIso[i - 1].startedIso!).getTime();
      const curr = new Date(allWithIso[i].startedIso!).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("renders status-aware badge classes (completed=emerald, failed=red, running=blue)", async () => {
    const html = await fetchIngestionHtml();
    const rows = rowsFromHtml(html);
    const seededRows = rows.filter((r) => seededIds.includes(r.runId));

    const completed = seededRows.find((r) => r.statusAttr === "completed");
    const failed = seededRows.find((r) => r.statusAttr === "failed");
    const running = seededRows.find((r) => r.statusAttr === "running");
    expect(completed).toBeDefined();
    expect(failed).toBeDefined();
    expect(running).toBeDefined();

    expect(completed?.statusClass).toMatch(/bg-emerald-50/);
    expect(failed?.statusClass).toMatch(/bg-red-50/);
    expect(running?.statusClass).toMatch(/bg-blue-50/);
  });

  it("exposes a total-count description matching the rendered row count", async () => {
    const html = await fetchIngestionHtml();
    const totalAttr = html.match(
      /data-testid="ingestion-log-total"[^>]*data-total="([^"]+)"/,
    );
    expect(totalAttr).not.toBeNull();
    const total = totalAttr ? Number.parseInt(totalAttr[1], 10) : NaN;
    const rows = rowsFromHtml(html);
    expect(rows.length).toBe(total);
  });
});
