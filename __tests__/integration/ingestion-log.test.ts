// API-013: GET /api/ingestion/log
//
// Verifies the route's contract:
//   1. returns { runs, total, page, totalPages } shape
//   2. each IngestionRun in `runs` carries id, trigger, status, startedAt,
//      completedAt, itemsProcessed, itemsFlagged, itemsSuppressed
//   3. pagination via ?page= and ?pageSize= works (skip/take semantics, total
//      stable across pages, page count consistent)
//   4. runs are ordered by startedAt descending
//
// Tests seed a controlled set of IngestionRun rows tagged with sentinel
// statuses we can filter to in assertions, so the suite is robust to
// whatever the dev SQLite already contains (prior runs from API-011/012).

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { GET } from "@/app/api/ingestion/log/route";
import { prisma } from "@/lib/db";

// Sentinel status keys for this suite's seeded rows. We use them as the
// `status` field on the seeded IngestionRuns so we can filter the response
// down to just our seeds without touching pre-existing rows. They look like
// the real "completed" / "running" / "failed" values but are namespaced.
const TAG = "ing-log-test";
const STATUS_A = `${TAG}-a-completed`;
const STATUS_B = `${TAG}-b-completed`;
const STATUS_C = `${TAG}-c-failed`;
const STATUS_D = `${TAG}-d-running`;
const STATUS_E = `${TAG}-e-completed`;

const SEEDED_STATUSES = [STATUS_A, STATUS_B, STATUS_C, STATUS_D, STATUS_E];

const createdRunIds: string[] = [];

type RunRow = {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
};

type LogResponse = {
  runs: RunRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

async function getLog(query?: string): Promise<{
  status: number;
  body: LogResponse;
}> {
  const url = `http://localhost/api/ingestion/log${query ?? ""}`;
  const res = await GET(new Request(url));
  return { status: res.status, body: (await res.json()) as LogResponse };
}

describe("GET /api/ingestion/log (API-013)", () => {
  beforeAll(async () => {
    // Seed five runs with strictly increasing startedAt so descending order
    // is unambiguous. Each row carries a sentinel status that the assertions
    // use to filter down to just this suite's seeds.
    const base = Date.now();
    const seeds = [
      {
        status: STATUS_A,
        trigger: "manual",
        startedAt: new Date(base - 5_000),
        completedAt: new Date(base - 4_000),
        itemsProcessed: 10,
        itemsFlagged: 2,
        itemsSuppressed: 1,
      },
      {
        status: STATUS_B,
        trigger: "scheduled",
        startedAt: new Date(base - 4_000),
        completedAt: new Date(base - 3_000),
        itemsProcessed: 7,
        itemsFlagged: 3,
        itemsSuppressed: 0,
      },
      {
        status: STATUS_C,
        trigger: "manual",
        startedAt: new Date(base - 3_000),
        completedAt: new Date(base - 2_500),
        itemsProcessed: 0,
        itemsFlagged: 0,
        itemsSuppressed: 0,
      },
      {
        status: STATUS_D,
        trigger: "scheduled",
        startedAt: new Date(base - 2_000),
        completedAt: null,
        itemsProcessed: 4,
        itemsFlagged: 1,
        itemsSuppressed: 0,
      },
      {
        status: STATUS_E,
        trigger: "manual",
        startedAt: new Date(base - 1_000),
        completedAt: new Date(base - 500),
        itemsProcessed: 12,
        itemsFlagged: 5,
        itemsSuppressed: 2,
      },
    ];
    for (const s of seeds) {
      const run = await prisma.ingestionRun.create({ data: s });
      createdRunIds.push(run.id);
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

  it("returns the expected response shape with default pagination", async () => {
    const { status, body } = await getLog();
    expect(status).toBe(200);

    expect(Array.isArray(body.runs)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(typeof body.totalPages).toBe("number");

    // total must be at least the seeded count (other rows may exist from
    // prior sessions / dev DB; we don't assert exact equality).
    expect(body.total).toBeGreaterThanOrEqual(SEEDED_STATUSES.length);

    // totalPages = ceil(total / pageSize)
    expect(body.totalPages).toBe(Math.ceil(body.total / body.pageSize));

    // Every returned row must carry the spec-required fields with the
    // correct types.
    for (const r of body.runs) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.trigger).toBe("string");
      expect(typeof r.status).toBe("string");
      expect(typeof r.startedAt).toBe("string");
      expect(r.completedAt === null || typeof r.completedAt === "string").toBe(
        true,
      );
      expect(typeof r.itemsProcessed).toBe("number");
      expect(typeof r.itemsFlagged).toBe("number");
      expect(typeof r.itemsSuppressed).toBe("number");
    }
  });

  it("orders runs by startedAt descending (newest first)", async () => {
    // Pull enough rows to definitely include all seeded ones.
    const { body } = await getLog("?pageSize=100");

    // Filter down to just our seeds so other rows in the dev DB don't
    // confuse the ordering check.
    const seeded = body.runs.filter((r) =>
      SEEDED_STATUSES.includes(r.status),
    );
    expect(seeded.length).toBe(SEEDED_STATUSES.length);

    // Among our seeds, the order must be E (newest) -> D -> C -> B -> A.
    expect(seeded.map((r) => r.status)).toEqual([
      STATUS_E,
      STATUS_D,
      STATUS_C,
      STATUS_B,
      STATUS_A,
    ]);

    // And on the full response, every consecutive pair must satisfy
    // startedAt descending.
    for (let i = 1; i < body.runs.length; i++) {
      const prev = new Date(body.runs[i - 1].startedAt).getTime();
      const cur = new Date(body.runs[i].startedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });

  it("surfaces the seeded metrics on the response rows", async () => {
    const { body } = await getLog("?pageSize=100");
    const seedById = new Map(
      body.runs
        .filter((r) => SEEDED_STATUSES.includes(r.status))
        .map((r) => [r.status, r]),
    );

    const a = seedById.get(STATUS_A)!;
    expect(a.trigger).toBe("manual");
    expect(a.itemsProcessed).toBe(10);
    expect(a.itemsFlagged).toBe(2);
    expect(a.itemsSuppressed).toBe(1);
    expect(a.completedAt).not.toBeNull();

    const d = seedById.get(STATUS_D)!;
    expect(d.trigger).toBe("scheduled");
    expect(d.itemsProcessed).toBe(4);
    // Running row: completedAt is null on the source row; it must come back
    // as null on the response too.
    expect(d.completedAt).toBeNull();

    const e = seedById.get(STATUS_E)!;
    expect(e.itemsProcessed).toBe(12);
    expect(e.itemsFlagged).toBe(5);
    expect(e.itemsSuppressed).toBe(2);
  });

  it("paginates: pageSize=2 returns 2 rows, total stays stable, totalPages = ceil(total/2)", async () => {
    const { body: page1 } = await getLog("?page=1&pageSize=2");
    const { body: page2 } = await getLog("?page=2&pageSize=2");

    expect(page1.runs.length).toBe(2);
    expect(page2.runs.length).toBe(2);
    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
    expect(page1.pageSize).toBe(2);
    expect(page2.pageSize).toBe(2);

    // Total is consistent across pages (within the same beforeAll seed).
    expect(page1.total).toBe(page2.total);
    expect(page1.totalPages).toBe(page2.totalPages);
    expect(page1.totalPages).toBe(Math.ceil(page1.total / 2));

    // Page 1 and page 2 must be disjoint.
    const idsP1 = new Set(page1.runs.map((r) => r.id));
    for (const r of page2.runs) {
      expect(idsP1.has(r.id)).toBe(false);
    }

    // Within each page, ordering is descending by startedAt.
    const allStarted = [...page1.runs, ...page2.runs].map((r) =>
      new Date(r.startedAt).getTime(),
    );
    for (let i = 1; i < allStarted.length; i++) {
      expect(allStarted[i - 1]).toBeGreaterThanOrEqual(allStarted[i]);
    }
  });

  it("invalid pagination values fall back to defaults (page=1, pageSize=20)", async () => {
    const { body } = await getLog("?page=abc&pageSize=-5");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it("a page beyond totalPages returns an empty runs array but preserves total", async () => {
    const { body: first } = await getLog("?pageSize=100");
    const beyond = first.totalPages + 5;
    const { body: empty } = await getLog(
      `?page=${beyond}&pageSize=100`,
    );
    expect(empty.runs.length).toBe(0);
    expect(empty.total).toBe(first.total);
    expect(empty.page).toBe(beyond);
  });
});
