import type { Client } from "@libsql/client";

export const DEMO_INGESTION_RUN_PREFIX = "seed-demo-ingestion-run-";

export type SeedIngestionRunsResult = {
  runIds: string[];
};

type DemoRunSeed = {
  id: string;
  trigger: "manual" | "scheduled";
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
  errors: string | null;
};

function buildDemoRuns(now: Date): DemoRunSeed[] {
  const minute = 60_000;
  const start = now.getTime();

  return [
    {
      id: `${DEMO_INGESTION_RUN_PREFIX}001`,
      trigger: "manual",
      status: "completed",
      startedAt: new Date(start - 3 * minute).toISOString(),
      completedAt: new Date(start - 2 * minute).toISOString(),
      itemsProcessed: 12,
      itemsFlagged: 4,
      itemsSuppressed: 1,
      errors: null,
    },
    {
      id: `${DEMO_INGESTION_RUN_PREFIX}002`,
      trigger: "scheduled",
      status: "failed",
      startedAt: new Date(start - 90 * minute).toISOString(),
      completedAt: new Date(start - 88 * minute).toISOString(),
      itemsProcessed: 5,
      itemsFlagged: 1,
      itemsSuppressed: 0,
      errors: JSON.stringify([
        "FINRA parser timeout after 30s for https://www.finra.org/rules-guidance/notices",
      ]),
    },
    {
      id: `${DEMO_INGESTION_RUN_PREFIX}003`,
      trigger: "scheduled",
      status: "completed",
      startedAt: new Date(start - 6 * 60 * minute).toISOString(),
      completedAt: new Date(start - 6 * 60 * minute + 5 * minute).toISOString(),
      itemsProcessed: 21,
      itemsFlagged: 6,
      itemsSuppressed: 2,
      errors: null,
    },
  ];
}

export async function seedDemoIngestionRuns(client: Client): Promise<SeedIngestionRunsResult> {
  await client.execute({
    sql: "DELETE FROM IngestionRun WHERE id LIKE ?",
    args: [`${DEMO_INGESTION_RUN_PREFIX}%`],
  });

  const runs = buildDemoRuns(new Date());

  for (const run of runs) {
    await client.execute({
      sql: `INSERT INTO IngestionRun (id, trigger, status, startedAt, completedAt, itemsProcessed, itemsFlagged, itemsSuppressed, errors)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        run.id,
        run.trigger,
        run.status,
        run.startedAt,
        run.completedAt,
        run.itemsProcessed,
        run.itemsFlagged,
        run.itemsSuppressed,
        run.errors,
      ],
    });
  }

  return { runIds: runs.map((r) => r.id) };
}
