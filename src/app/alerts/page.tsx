import Link from "next/link";
import prisma from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const SORT_FIELDS = [
  "severity",
  "classification",
  "regulator",
  "domain",
  "date",
  "status",
] as const;
type SortField = (typeof SORT_FIELDS)[number];
type SortOrder = "asc" | "desc";

const DEFAULT_SORT_BY: SortField = "date";
const DEFAULT_SORT_ORDER: SortOrder = "desc";

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const SEVERITY_BADGE_CLASS: Record<string, string> = {
  high: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  medium:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  low: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  open: "bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:ring-slate-700",
  accepted:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  dismissed:
    "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700",
  escalated:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  snoozed:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
};

const DOMAIN_LABELS: Record<string, string> = {
  bsa_aml: "BSA/AML",
  complaint_handling: "Complaint Handling",
  fair_lending: "Fair Lending",
  reg_e: "Regulation E",
  reg_z: "Regulation Z",
  vendor_management: "Vendor Management",
  info_security: "Information Security",
  cip: "Customer Identification Program",
  overdraft: "Overdraft",
  marketing: "Marketing",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  aligned: "Aligned",
  drifted: "Drifted",
  contradicted: "Contradicted",
  ambiguous: "Ambiguous",
  no_material_impact: "No Material Impact",
};

const COLUMNS: Array<{ key: SortField; label: string; align?: "left" | "right" }> = [
  { key: "severity", label: "Severity" },
  { key: "classification", label: "Classification" },
  { key: "regulator", label: "Regulator" },
  { key: "domain", label: "Policy Domain" },
  { key: "date", label: "Date Detected" },
  { key: "status", label: "Status" },
];

function parseSortBy(raw: string | string[] | undefined): SortField {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && (SORT_FIELDS as readonly string[]).includes(v)) {
    return v as SortField;
  }
  return DEFAULT_SORT_BY;
}

function parseSortOrder(raw: string | string[] | undefined): SortOrder {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "asc" ? "asc" : "desc";
}

function buildPrismaOrderBy(
  sortBy: SortField,
  sortOrder: SortOrder,
): Record<string, unknown> | null {
  switch (sortBy) {
    case "date":
      return { createdAt: sortOrder };
    case "status":
      return { status: sortOrder };
    case "classification":
      return { classification: sortOrder };
    case "regulator":
      return { regulatoryItem: { regulator: sortOrder } };
    case "domain":
      return { policyChunk: { policyDocument: { domain: sortOrder } } };
    case "severity":
      return null;
  }
}

const ALERT_INCLUDE = {
  regulatoryItem: { select: { id: true, regulator: true } },
  policyChunk: {
    select: {
      id: true,
      policyDocument: { select: { id: true, domain: true } },
    },
  },
} as const;

type AlertRow = {
  id: string;
  severity: string;
  classification: string;
  status: string;
  createdAt: Date;
  regulatoryItem: { id: string; regulator: string };
  policyChunk: {
    id: string;
    policyDocument: { id: string; domain: string };
  };
};

async function loadAlerts(
  sortBy: SortField,
  sortOrder: SortOrder,
): Promise<AlertRow[]> {
  if (sortBy === "severity") {
    // Severity uses a custom rank (high < medium < low) that Prisma's typed
    // orderBy can't express, so fetch then sort in JS. Mirrors the API-005
    // approach in src/app/api/alerts/route.ts.
    const rows = (await prisma.alert.findMany({
      include: ALERT_INCLUDE,
    })) as AlertRow[];
    return [...rows].sort((a, b) => {
      const rankA = SEVERITY_RANK[a.severity] ?? 999;
      const rankB = SEVERITY_RANK[b.severity] ?? 999;
      if (rankA !== rankB) {
        return sortOrder === "desc" ? rankA - rankB : rankB - rankA;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }
  const orderBy = buildPrismaOrderBy(sortBy, sortOrder)!;
  return (await prisma.alert.findMany({
    orderBy,
    include: ALERT_INCLUDE,
  })) as AlertRow[];
}

function formatDateDetected(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function buildSortHref(
  column: SortField,
  currentSortBy: SortField,
  currentSortOrder: SortOrder,
): string {
  // Clicking the active column toggles direction. Clicking a different column
  // selects it with the column's natural default direction (desc for date /
  // severity / status; asc for the alphabetic axes).
  let nextOrder: SortOrder;
  if (column === currentSortBy) {
    nextOrder = currentSortOrder === "desc" ? "asc" : "desc";
  } else {
    nextOrder =
      column === "date" || column === "severity" || column === "status"
        ? "desc"
        : "asc";
  }
  const params = new URLSearchParams();
  params.set("sortBy", column);
  params.set("sortOrder", nextOrder);
  return `/alerts?${params.toString()}`;
}

function sortIndicator(
  column: SortField,
  sortBy: SortField,
  sortOrder: SortOrder,
): string {
  if (column !== sortBy) return "";
  return sortOrder === "desc" ? " ▼" : " ▲";
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const sortBy = parseSortBy(params.sortBy);
  const sortOrder = parseSortOrder(params.sortOrder);
  const alerts = await loadAlerts(sortBy, sortOrder);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Regulatory drift alerts. Click a column header to sort.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div
              className="p-6 text-sm text-muted-foreground"
              data-testid="alerts-empty"
            >
              No alerts to show. Trigger an ingestion run from the dashboard.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="alerts-table"
                data-sort-by={sortBy}
                data-sort-order={sortOrder}
              >
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {COLUMNS.map((col) => {
                      const isActive = col.key === sortBy;
                      return (
                        <th
                          key={col.key}
                          className="px-4 py-2 font-medium"
                          data-testid={`alerts-th-${col.key}`}
                          aria-sort={
                            isActive
                              ? sortOrder === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <Link
                            href={buildSortHref(col.key, sortBy, sortOrder)}
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            data-testid={`alerts-sort-${col.key}`}
                            data-active={isActive ? "true" : "false"}
                          >
                            {col.label}
                            <span className="text-[10px]" aria-hidden="true">
                              {sortIndicator(col.key, sortBy, sortOrder)}
                            </span>
                          </Link>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => {
                    const domain = alert.policyChunk.policyDocument.domain;
                    return (
                      <tr
                        key={alert.id}
                        data-testid="alerts-row"
                        data-alert-id={alert.id}
                        className="border-b last:border-b-0"
                      >
                        <td
                          className="px-4 py-2"
                          data-testid="alerts-cell-severity"
                          data-severity={alert.severity}
                        >
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                              SEVERITY_BADGE_CLASS[alert.severity] ??
                              "bg-muted text-muted-foreground ring-border"
                            }`}
                          >
                            {alert.severity}
                          </span>
                        </td>
                        <td
                          className="px-4 py-2"
                          data-testid="alerts-cell-classification"
                          data-classification={alert.classification}
                        >
                          {CLASSIFICATION_LABELS[alert.classification] ??
                            alert.classification}
                        </td>
                        <td
                          className="px-4 py-2"
                          data-testid="alerts-cell-regulator"
                          data-regulator={alert.regulatoryItem.regulator}
                        >
                          {alert.regulatoryItem.regulator}
                        </td>
                        <td
                          className="px-4 py-2"
                          data-testid="alerts-cell-domain"
                          data-domain={domain}
                        >
                          {DOMAIN_LABELS[domain] ?? domain}
                        </td>
                        <td
                          className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums"
                          data-testid="alerts-cell-date"
                          data-date={alert.createdAt.toISOString()}
                        >
                          {formatDateDetected(alert.createdAt)}
                        </td>
                        <td
                          className="px-4 py-2"
                          data-testid="alerts-cell-status"
                          data-status={alert.status}
                        >
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                              STATUS_BADGE_CLASS[alert.status] ??
                              "bg-muted text-muted-foreground ring-border"
                            }`}
                          >
                            {alert.status}
                          </span>
                        </td>
                      </tr>
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
