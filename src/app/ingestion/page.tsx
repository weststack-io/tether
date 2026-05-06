import prisma from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

type IngestionLogRow = {
  id: string;
  trigger: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  completed:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  running:
    "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  failed:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
};

const TRIGGER_LABEL: Record<string, string> = {
  manual: "Manual",
  scheduled: "Scheduled",
};

function formatTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

async function getAllIngestionRuns(): Promise<IngestionLogRow[]> {
  return prisma.ingestionRun.findMany({
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      trigger: true,
      status: true,
      startedAt: true,
      completedAt: true,
      itemsProcessed: true,
      itemsFlagged: true,
      itemsSuppressed: true,
    },
  });
}

export default async function IngestionLogPage() {
  const runs = await getAllIngestionRuns();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Ingestion Log</h1>
        <p className="text-sm text-muted-foreground">
          Every ingestion run, most recent first
        </p>
      </div>

      <Card data-testid="ingestion-log-card">
        <CardHeader>
          <CardTitle>All runs</CardTitle>
          <CardDescription
            data-testid="ingestion-log-total"
            data-total={runs.length}
          >
            {runs.length === 1
              ? "1 ingestion run"
              : `${runs.length} ingestion runs`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <div
              className="p-6 text-sm text-muted-foreground"
              data-testid="ingestion-log-empty"
            >
              No ingestion runs yet. Trigger one from the dashboard.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="ingestion-log-table"
              >
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Started</th>
                    <th className="px-4 py-2 font-medium">Trigger</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Processed
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Flagged
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Suppressed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run, index) => (
                    <tr
                      key={run.id}
                      data-testid="ingestion-log-row"
                      data-run-id={run.id}
                      data-position={index}
                      className="border-b last:border-b-0"
                    >
                      <td
                        className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums"
                        data-testid="ingestion-log-started"
                      >
                        <time dateTime={run.startedAt.toISOString()}>
                          {formatTimestamp(run.startedAt)}
                        </time>
                      </td>
                      <td
                        className="px-4 py-2"
                        data-testid="ingestion-log-trigger"
                        data-trigger={run.trigger}
                      >
                        {TRIGGER_LABEL[run.trigger] ?? run.trigger}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            STATUS_BADGE_CLASS[run.status] ??
                            "bg-muted text-muted-foreground ring-border"
                          }`}
                          data-testid="ingestion-log-status"
                          data-status={run.status}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td
                        className="px-4 py-2 text-right tabular-nums"
                        data-testid="ingestion-log-processed"
                      >
                        {run.itemsProcessed}
                      </td>
                      <td
                        className="px-4 py-2 text-right tabular-nums"
                        data-testid="ingestion-log-flagged"
                      >
                        {run.itemsFlagged}
                      </td>
                      <td
                        className="px-4 py-2 text-right tabular-nums"
                        data-testid="ingestion-log-suppressed"
                      >
                        {run.itemsSuppressed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
