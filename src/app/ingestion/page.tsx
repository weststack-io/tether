import { Fragment } from "react";
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
  errors: string | null;
};

type ParsedError = {
  kind: "parser" | "drift" | "message";
  message: string;
  context: string | null;
};

type ParsedErrors = {
  topLevel: string | null;
  items: ParsedError[];
  raw: string | null; // present only when JSON parse fails — show verbatim
};

function parseRunErrors(blob: string | null): ParsedErrors {
  if (!blob) return { topLevel: null, items: [], raw: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    return { topLevel: null, items: [], raw: blob };
  }

  // Pipeline failed-path: { topLevel?, parserErrors[], driftErrors[] }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as {
      topLevel?: unknown;
      parserErrors?: unknown;
      driftErrors?: unknown;
    };
    const items: ParsedError[] = [];
    if (Array.isArray(obj.parserErrors)) {
      for (const p of obj.parserErrors) {
        if (p && typeof p === "object") {
          const e = p as { regulator?: unknown; error?: unknown };
          items.push({
            kind: "parser",
            message: typeof e.error === "string" ? e.error : JSON.stringify(e),
            context: typeof e.regulator === "string" ? e.regulator : null,
          });
        }
      }
    }
    if (Array.isArray(obj.driftErrors)) {
      for (const d of obj.driftErrors) {
        if (d && typeof d === "object") {
          const e = d as { regulatoryItemId?: unknown; error?: unknown };
          items.push({
            kind: "drift",
            message: typeof e.error === "string" ? e.error : JSON.stringify(e),
            context:
              typeof e.regulatoryItemId === "string" && e.regulatoryItemId
                ? e.regulatoryItemId
                : null,
          });
        }
      }
    }
    return {
      topLevel: typeof obj.topLevel === "string" ? obj.topLevel : null,
      items,
      raw: null,
    };
  }

  // Legacy / seed shape: array of bare error strings.
  if (Array.isArray(parsed)) {
    return {
      topLevel: null,
      items: parsed
        .filter((m): m is string => typeof m === "string")
        .map((message) => ({ kind: "message", message, context: null })),
      raw: null,
    };
  }

  return { topLevel: null, items: [], raw: blob };
}

function hasErrorContent(p: ParsedErrors): boolean {
  return p.topLevel !== null || p.items.length > 0 || p.raw !== null;
}

const ERROR_KIND_LABEL: Record<ParsedError["kind"], string> = {
  parser: "Parser",
  drift: "Drift detection",
  message: "Error",
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
      errors: true,
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
                  {runs.map((run, index) => {
                    const parsed = parseRunErrors(run.errors);
                    const showErrors = hasErrorContent(parsed);
                    const errorCount =
                      parsed.items.length + (parsed.topLevel ? 1 : 0);
                    return (
                  <Fragment key={run.id}>
                    <tr
                      data-testid="ingestion-log-row"
                      data-run-id={run.id}
                      data-position={index}
                      data-has-errors={showErrors ? "true" : "false"}
                      className={
                        showErrors
                          ? "border-b-0"
                          : "border-b last:border-b-0"
                      }
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
                    {showErrors ? (
                      <tr
                        data-testid="ingestion-log-errors-row"
                        data-run-id={run.id}
                        className="border-b last:border-b-0 bg-red-50/40 dark:bg-red-950/20"
                      >
                        <td colSpan={6} className="px-4 py-3">
                          <details
                            data-testid="ingestion-log-errors-details"
                            data-error-count={errorCount}
                            className="group"
                          >
                            <summary
                              className="cursor-pointer select-none text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-300"
                              data-testid="ingestion-log-errors-summary"
                            >
                              {`View ${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
                            </summary>
                            <div className="mt-3 space-y-2 text-xs">
                              {parsed.topLevel ? (
                                <p
                                  data-testid="ingestion-log-errors-toplevel"
                                  className="rounded border border-red-200 bg-red-100/60 px-2 py-1 font-mono text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100"
                                >
                                  {parsed.topLevel}
                                </p>
                              ) : null}
                              {parsed.items.length > 0 ? (
                                <ul className="space-y-1">
                                  {parsed.items.map((err, i) => (
                                    <li
                                      key={i}
                                      data-testid="ingestion-log-error-item"
                                      data-error-kind={err.kind}
                                      className="flex flex-col gap-1 rounded border border-red-100 bg-white/60 px-2 py-1 dark:border-red-900/60 dark:bg-red-950/40 sm:flex-row sm:items-baseline sm:gap-2"
                                    >
                                      <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-900/60 dark:text-red-200 dark:ring-red-800">
                                        {ERROR_KIND_LABEL[err.kind]}
                                      </span>
                                      {err.context ? (
                                        <code
                                          data-testid="ingestion-log-error-context"
                                          className="shrink-0 font-mono text-[11px] text-red-800 dark:text-red-300"
                                        >
                                          {err.context}
                                        </code>
                                      ) : null}
                                      <span
                                        data-testid="ingestion-log-error-message"
                                        className="break-words font-mono text-red-900 dark:text-red-100"
                                      >
                                        {err.message}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {parsed.raw ? (
                                <pre
                                  data-testid="ingestion-log-errors-raw"
                                  className="overflow-x-auto rounded border border-red-200 bg-red-100/60 px-2 py-1 font-mono text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100"
                                >
                                  {parsed.raw}
                                </pre>
                              ) : null}
                            </div>
                          </details>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
