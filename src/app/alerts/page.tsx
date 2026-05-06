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

const REGULATOR_OPTIONS = ["SEC", "FINRA", "CFPB", "OCC"] as const;
type RegulatorOption = (typeof REGULATOR_OPTIONS)[number];

const SEVERITY_OPTIONS = ["high", "medium", "low"] as const;
type SeverityOption = (typeof SEVERITY_OPTIONS)[number];

const STATUS_OPTIONS = [
  "open",
  "accepted",
  "dismissed",
  "escalated",
  "snoozed",
] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

const DOMAIN_OPTIONS = [
  "bsa_aml",
  "complaint_handling",
  "fair_lending",
  "reg_e",
  "reg_z",
  "vendor_management",
  "info_security",
  "cip",
  "overdraft",
  "marketing",
] as const;
type DomainOption = (typeof DOMAIN_OPTIONS)[number];

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

// Parse `?regulator=SEC,FINRA` into a deduped, validated array of regulators.
// Values not in REGULATOR_OPTIONS are dropped. Returns null when no valid
// regulators are selected so callers can short-circuit the where-clause.
function parseRegulators(
  raw: string | string[] | undefined,
): RegulatorOption[] | null {
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  if (!flat) return null;
  const valid = new Set<string>(REGULATOR_OPTIONS);
  const picked = new Set<RegulatorOption>();
  for (const part of flat.split(",")) {
    const v = part.trim();
    if (valid.has(v)) picked.add(v as RegulatorOption);
  }
  return picked.size > 0 ? [...picked] : null;
}

function parseSeverities(
  raw: string | string[] | undefined,
): SeverityOption[] | null {
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  if (!flat) return null;
  const valid = new Set<string>(SEVERITY_OPTIONS);
  const picked = new Set<SeverityOption>();
  for (const part of flat.split(",")) {
    const v = part.trim();
    if (valid.has(v)) picked.add(v as SeverityOption);
  }
  return picked.size > 0 ? [...picked] : null;
}

function parseStatuses(
  raw: string | string[] | undefined,
): StatusOption[] | null {
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  if (!flat) return null;
  const valid = new Set<string>(STATUS_OPTIONS);
  const picked = new Set<StatusOption>();
  for (const part of flat.split(",")) {
    const v = part.trim();
    if (valid.has(v)) picked.add(v as StatusOption);
  }
  return picked.size > 0 ? [...picked] : null;
}

function parseDomains(
  raw: string | string[] | undefined,
): DomainOption[] | null {
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  if (!flat) return null;
  const valid = new Set<string>(DOMAIN_OPTIONS);
  const picked = new Set<DomainOption>();
  for (const part of flat.split(",")) {
    const v = part.trim();
    if (valid.has(v)) picked.add(v as DomainOption);
  }
  return picked.size > 0 ? [...picked] : null;
}

const PAGE_SIZE = 25;

// Parse `?page=N` into a 1-indexed positive integer. Anything malformed or
// less than 1 collapses to page 1 (the canonical default). The caller is
// responsible for clamping above totalPages — the empty-state copy already
// handles the over-shoot case correctly.
function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return 1;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Parses a YYYY-MM-DD query value into the same string for echoing back into
// the form. Anything that doesn't match the strict date-only shape is dropped
// so the form always receives well-formed values. Full ISO timestamps are NOT
// accepted here -- the input control is `type="date"` so the wire format is
// always YYYY-MM-DD.
function parseDateInput(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return v;
}

// Builds the createdAt where-fragment from a parsed range. Mirrors the API
// route's parseDateBound semantics: dateFrom is `gte` at midnight UTC of the
// named day; dateTo is `lt` at midnight UTC of the day AFTER the named day,
// so the bound is inclusive of dateTo's named day.
function buildDateRangeWhere(
  dateFrom: string | null,
  dateTo: string | null,
): Record<string, Date> | null {
  if (!dateFrom && !dateTo) return null;
  const createdAt: Record<string, Date> = {};
  if (dateFrom) {
    createdAt.gte = new Date(dateFrom);
  }
  if (dateTo) {
    createdAt.lt = new Date(new Date(dateTo).getTime() + DAY_MS);
  }
  return createdAt;
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

function buildWhere(
  regulators: RegulatorOption[] | null,
  severities: SeverityOption[] | null,
  statuses: StatusOption[] | null,
  domains: DomainOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (regulators) {
    where.regulatoryItem = { regulator: { in: regulators } };
  }
  if (severities) {
    where.severity = { in: severities };
  }
  if (statuses) {
    where.status = { in: statuses };
  }
  if (domains) {
    where.policyChunk = { policyDocument: { domain: { in: domains } } };
  }
  const range = buildDateRangeWhere(dateFrom, dateTo);
  if (range) {
    where.createdAt = range;
  }
  return where;
}

async function loadAlerts(
  sortBy: SortField,
  sortOrder: SortOrder,
  regulators: RegulatorOption[] | null,
  severities: SeverityOption[] | null,
  statuses: StatusOption[] | null,
  domains: DomainOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
  page: number,
  pageSize: number,
): Promise<{ alerts: AlertRow[]; total: number }> {
  const where = buildWhere(
    regulators,
    severities,
    statuses,
    domains,
    dateFrom,
    dateTo,
  );
  const skip = (page - 1) * pageSize;
  if (sortBy === "severity") {
    // Severity uses a custom rank (high < medium < low) that Prisma's typed
    // orderBy can't express, so fetch then sort in JS. Mirrors the API-005
    // approach in src/app/api/alerts/route.ts.
    const rows = (await prisma.alert.findMany({
      where,
      include: ALERT_INCLUDE,
    })) as AlertRow[];
    const sorted = [...rows].sort((a, b) => {
      const rankA = SEVERITY_RANK[a.severity] ?? 999;
      const rankB = SEVERITY_RANK[b.severity] ?? 999;
      if (rankA !== rankB) {
        return sortOrder === "desc" ? rankA - rankB : rankB - rankA;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return {
      alerts: sorted.slice(skip, skip + pageSize),
      total: sorted.length,
    };
  }
  const orderBy = buildPrismaOrderBy(sortBy, sortOrder)!;
  const [total, alerts] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.findMany({
      where,
      orderBy,
      include: ALERT_INCLUDE,
      skip,
      take: pageSize,
    }) as Promise<AlertRow[]>,
  ]);
  return { alerts, total };
}

function formatDateDetected(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function buildAlertsHref(
  sortBy: SortField,
  sortOrder: SortOrder,
  regulators: RegulatorOption[] | null,
  severities: SeverityOption[] | null,
  statuses: StatusOption[] | null,
  domains: DomainOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
  page: number = 1,
): string {
  const params = new URLSearchParams();
  params.set("sortBy", sortBy);
  params.set("sortOrder", sortOrder);
  if (regulators && regulators.length > 0) {
    params.set("regulator", regulators.join(","));
  }
  if (severities && severities.length > 0) {
    params.set("severity", severities.join(","));
  }
  if (statuses && statuses.length > 0) {
    params.set("status", statuses.join(","));
  }
  if (domains && domains.length > 0) {
    params.set("domain", domains.join(","));
  }
  if (dateFrom) {
    params.set("dateFrom", dateFrom);
  }
  if (dateTo) {
    params.set("dateTo", dateTo);
  }
  // page=1 is the canonical default and omitted for cleaner URLs. The
  // chip-toggle and column-sort hrefs intentionally never thread page through
  // -- changing a filter or sort resets to page 1, since otherwise the user
  // could land on page 5 of a 2-page result set.
  if (page > 1) {
    params.set("page", String(page));
  }
  return `/alerts?${params.toString()}`;
}

function buildSortHref(
  column: SortField,
  currentSortBy: SortField,
  currentSortOrder: SortOrder,
  regulators: RegulatorOption[] | null,
  severities: SeverityOption[] | null,
  statuses: StatusOption[] | null,
  domains: DomainOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  // Clicking the active column toggles direction. Clicking a different column
  // selects it with the column's natural default direction (desc for date /
  // severity / status; asc for the alphabetic axes). The active filters, if
  // any, are preserved across sort changes.
  let nextOrder: SortOrder;
  if (column === currentSortBy) {
    nextOrder = currentSortOrder === "desc" ? "asc" : "desc";
  } else {
    nextOrder =
      column === "date" || column === "severity" || column === "status"
        ? "desc"
        : "asc";
  }
  return buildAlertsHref(
    column,
    nextOrder,
    regulators,
    severities,
    statuses,
    domains,
    dateFrom,
    dateTo,
  );
}

function buildRegulatorToggleHref(
  reg: RegulatorOption,
  active: RegulatorOption[] | null,
  sortBy: SortField,
  sortOrder: SortOrder,
  severities: SeverityOption[] | null,
  statuses: StatusOption[] | null,
  domains: DomainOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  // Toggle membership of `reg` in the active filter set, preserving sort and
  // the other filters. Order within the resulting CSV mirrors
  // REGULATOR_OPTIONS order so the URL is deterministic regardless of click
  // sequence.
  const set = new Set<RegulatorOption>(active ?? []);
  if (set.has(reg)) set.delete(reg);
  else set.add(reg);
  const next = REGULATOR_OPTIONS.filter((r) => set.has(r));
  return buildAlertsHref(
    sortBy,
    sortOrder,
    next.length > 0 ? next : null,
    severities,
    statuses,
    domains,
    dateFrom,
    dateTo,
  );
}

function buildSeverityToggleHref(
  sev: SeverityOption,
  active: SeverityOption[] | null,
  sortBy: SortField,
  sortOrder: SortOrder,
  regulators: RegulatorOption[] | null,
  statuses: StatusOption[] | null,
  domains: DomainOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  // Toggle membership of `sev` in the active severity filter set, preserving
  // sort and the other filters. CSV order mirrors SEVERITY_OPTIONS so the URL
  // is deterministic regardless of click sequence.
  const set = new Set<SeverityOption>(active ?? []);
  if (set.has(sev)) set.delete(sev);
  else set.add(sev);
  const next = SEVERITY_OPTIONS.filter((s) => set.has(s));
  return buildAlertsHref(
    sortBy,
    sortOrder,
    regulators,
    next.length > 0 ? next : null,
    statuses,
    domains,
    dateFrom,
    dateTo,
  );
}

function buildStatusToggleHref(
  st: StatusOption,
  active: StatusOption[] | null,
  sortBy: SortField,
  sortOrder: SortOrder,
  regulators: RegulatorOption[] | null,
  severities: SeverityOption[] | null,
  domains: DomainOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  // Toggle membership of `st` in the active status filter set, preserving
  // sort and the other filters. CSV order mirrors STATUS_OPTIONS so the URL
  // is deterministic regardless of click sequence.
  const set = new Set<StatusOption>(active ?? []);
  if (set.has(st)) set.delete(st);
  else set.add(st);
  const next = STATUS_OPTIONS.filter((s) => set.has(s));
  return buildAlertsHref(
    sortBy,
    sortOrder,
    regulators,
    severities,
    next.length > 0 ? next : null,
    domains,
    dateFrom,
    dateTo,
  );
}

function buildDomainToggleHref(
  dom: DomainOption,
  active: DomainOption[] | null,
  sortBy: SortField,
  sortOrder: SortOrder,
  regulators: RegulatorOption[] | null,
  severities: SeverityOption[] | null,
  statuses: StatusOption[] | null,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  // Toggle membership of `dom` in the active domain filter set, preserving
  // sort and the other filters. CSV order mirrors DOMAIN_OPTIONS so the URL
  // is deterministic regardless of click sequence.
  const set = new Set<DomainOption>(active ?? []);
  if (set.has(dom)) set.delete(dom);
  else set.add(dom);
  const next = DOMAIN_OPTIONS.filter((d) => set.has(d));
  return buildAlertsHref(
    sortBy,
    sortOrder,
    regulators,
    severities,
    statuses,
    next.length > 0 ? next : null,
    dateFrom,
    dateTo,
  );
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
  const regulators = parseRegulators(params.regulator);
  const severities = parseSeverities(params.severity);
  const statuses = parseStatuses(params.status);
  const domains = parseDomains(params.domain);
  const dateFrom = parseDateInput(params.dateFrom);
  const dateTo = parseDateInput(params.dateTo);
  const requestedPage = parsePage(params.page);
  const { alerts, total } = await loadAlerts(
    sortBy,
    sortOrder,
    regulators,
    severities,
    statuses,
    domains,
    dateFrom,
    dateTo,
    requestedPage,
    PAGE_SIZE,
  );
  const totalPages = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE);
  // The empty-state copy already covers over-shoot, so we still render the
  // requested page even if it's past totalPages -- the only downstream effect
  // is that the pagination controls clamp the highlighted page to a sensible
  // value.
  const currentPage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const hasRegulatorFilter = regulators !== null && regulators.length > 0;
  const hasSeverityFilter = severities !== null && severities.length > 0;
  const hasStatusFilter = statuses !== null && statuses.length > 0;
  const hasDomainFilter = domains !== null && domains.length > 0;
  const hasDateRangeFilter = dateFrom !== null || dateTo !== null;
  const hasActiveFilter =
    hasRegulatorFilter ||
    hasSeverityFilter ||
    hasStatusFilter ||
    hasDomainFilter ||
    hasDateRangeFilter;
  const buildPageHref = (page: number): string =>
    buildAlertsHref(
      sortBy,
      sortOrder,
      regulators,
      severities,
      statuses,
      domains,
      dateFrom,
      dateTo,
      page,
    );
  const firstRowIndex = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastRowIndex = Math.min(currentPage * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Regulatory drift alerts. Click a column header to sort.
        </p>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="alerts-filter-bar"
        data-filter-regulator={regulators ? regulators.join(",") : ""}
        data-filter-severity={severities ? severities.join(",") : ""}
        data-filter-status={statuses ? statuses.join(",") : ""}
        data-filter-domain={domains ? domains.join(",") : ""}
        data-filter-date-from={dateFrom ?? ""}
        data-filter-date-to={dateTo ?? ""}
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Regulator
        </span>
        {REGULATOR_OPTIONS.map((reg) => {
          const isActive = regulators?.includes(reg) ?? false;
          return (
            <Link
              key={reg}
              href={buildRegulatorToggleHref(
                reg,
                regulators,
                sortBy,
                sortOrder,
                severities,
                statuses,
                domains,
                dateFrom,
                dateTo,
              )}
              data-testid={`alerts-filter-regulator-${reg}`}
              data-active={isActive ? "true" : "false"}
              aria-pressed={isActive}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-muted text-muted-foreground ring-border hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {reg}
            </Link>
          );
        })}
        <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">
          Severity
        </span>
        {SEVERITY_OPTIONS.map((sev) => {
          const isActive = severities?.includes(sev) ?? false;
          return (
            <Link
              key={sev}
              href={buildSeverityToggleHref(
                sev,
                severities,
                sortBy,
                sortOrder,
                regulators,
                statuses,
                domains,
                dateFrom,
                dateTo,
              )}
              data-testid={`alerts-filter-severity-${sev}`}
              data-active={isActive ? "true" : "false"}
              aria-pressed={isActive}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ring-1 ring-inset transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-muted text-muted-foreground ring-border hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {sev}
            </Link>
          );
        })}
        <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">
          Status
        </span>
        {STATUS_OPTIONS.map((st) => {
          const isActive = statuses?.includes(st) ?? false;
          return (
            <Link
              key={st}
              href={buildStatusToggleHref(
                st,
                statuses,
                sortBy,
                sortOrder,
                regulators,
                severities,
                domains,
                dateFrom,
                dateTo,
              )}
              data-testid={`alerts-filter-status-${st}`}
              data-active={isActive ? "true" : "false"}
              aria-pressed={isActive}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ring-1 ring-inset transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-muted text-muted-foreground ring-border hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {st}
            </Link>
          );
        })}
        <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">
          Domain
        </span>
        {DOMAIN_OPTIONS.map((dom) => {
          const isActive = domains?.includes(dom) ?? false;
          return (
            <Link
              key={dom}
              href={buildDomainToggleHref(
                dom,
                domains,
                sortBy,
                sortOrder,
                regulators,
                severities,
                statuses,
                dateFrom,
                dateTo,
              )}
              data-testid={`alerts-filter-domain-${dom}`}
              data-active={isActive ? "true" : "false"}
              aria-pressed={isActive}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-muted text-muted-foreground ring-border hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {DOMAIN_LABELS[dom] ?? dom}
            </Link>
          );
        })}
        {hasActiveFilter && (
          <Link
            href={buildAlertsHref(
              sortBy,
              sortOrder,
              null,
              null,
              null,
              null,
              null,
              null,
            )}
            data-testid="alerts-filter-clear"
            className="ml-1 inline-flex items-center rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear
          </Link>
        )}
      </div>

      <form
        method="get"
        action="/alerts"
        className="flex flex-wrap items-center gap-2"
        data-testid="alerts-filter-date-range"
        data-date-from={dateFrom ?? ""}
        data-date-to={dateTo ?? ""}
      >
        <input type="hidden" name="sortBy" value={sortBy} />
        <input type="hidden" name="sortOrder" value={sortOrder} />
        {regulators && regulators.length > 0 && (
          <input type="hidden" name="regulator" value={regulators.join(",")} />
        )}
        {severities && severities.length > 0 && (
          <input type="hidden" name="severity" value={severities.join(",")} />
        )}
        {statuses && statuses.length > 0 && (
          <input type="hidden" name="status" value={statuses.join(",")} />
        )}
        {domains && domains.length > 0 && (
          <input type="hidden" name="domain" value={domains.join(",")} />
        )}
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Date Range
        </span>
        <label
          className="flex items-center gap-1 text-xs text-muted-foreground"
          htmlFor="alerts-filter-date-from"
        >
          From
          <input
            id="alerts-filter-date-from"
            type="date"
            name="dateFrom"
            defaultValue={dateFrom ?? ""}
            data-testid="alerts-filter-date-from"
            className="rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label
          className="flex items-center gap-1 text-xs text-muted-foreground"
          htmlFor="alerts-filter-date-to"
        >
          To
          <input
            id="alerts-filter-date-to"
            type="date"
            name="dateTo"
            defaultValue={dateTo ?? ""}
            data-testid="alerts-filter-date-to"
            className="rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="submit"
          data-testid="alerts-filter-date-apply"
          className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground ring-1 ring-inset ring-primary hover:bg-primary/90"
        >
          Apply
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div
              className="p-6 text-sm text-muted-foreground"
              data-testid="alerts-empty"
            >
              {hasActiveFilter
                ? "No alerts match the current filter."
                : "No alerts to show. Trigger an ingestion run from the dashboard."}
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
                            href={buildSortHref(
                              col.key,
                              sortBy,
                              sortOrder,
                              regulators,
                              severities,
                              statuses,
                              domains,
                              dateFrom,
                              dateTo,
                            )}
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

      {total > 0 && (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-sm"
          aria-label="Alerts pagination"
          data-testid="alerts-pagination"
          data-page={currentPage}
          data-total-pages={totalPages}
          data-total={total}
          data-page-size={PAGE_SIZE}
        >
          <div
            className="text-xs text-muted-foreground"
            data-testid="alerts-pagination-summary"
          >
            Showing{" "}
            <span className="font-medium text-foreground">{firstRowIndex}</span>
            {"–"}
            <span className="font-medium text-foreground">{lastRowIndex}</span>{" "}
            of{" "}
            <span className="font-medium text-foreground">{total}</span> alert
            {total === 1 ? "" : "s"} · Page{" "}
            <span className="font-medium text-foreground">{currentPage}</span>{" "}
            of{" "}
            <span className="font-medium text-foreground">{totalPages}</span>
          </div>
          <div className="flex items-center gap-1">
            {currentPage > 1 ? (
              <Link
                href={buildPageHref(currentPage - 1)}
                data-testid="alerts-pagination-prev"
                className="inline-flex items-center rounded-md px-3 py-1 text-xs font-medium ring-1 ring-inset ring-border hover:bg-accent hover:text-accent-foreground"
                rel="prev"
              >
                ← Prev
              </Link>
            ) : (
              <span
                data-testid="alerts-pagination-prev"
                aria-disabled="true"
                className="inline-flex items-center rounded-md px-3 py-1 text-xs font-medium text-muted-foreground/60 ring-1 ring-inset ring-border"
              >
                ← Prev
              </span>
            )}
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
              const isActive = p === currentPage;
              return (
                <Link
                  key={p}
                  href={buildPageHref(p)}
                  data-testid={`alerts-pagination-page-${p}`}
                  data-active={isActive ? "true" : "false"}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                    isActive
                      ? "bg-primary text-primary-foreground ring-primary"
                      : "text-muted-foreground ring-border hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {p}
                </Link>
              );
            })}
            {currentPage < totalPages ? (
              <Link
                href={buildPageHref(currentPage + 1)}
                data-testid="alerts-pagination-next"
                className="inline-flex items-center rounded-md px-3 py-1 text-xs font-medium ring-1 ring-inset ring-border hover:bg-accent hover:text-accent-foreground"
                rel="next"
              >
                Next →
              </Link>
            ) : (
              <span
                data-testid="alerts-pagination-next"
                aria-disabled="true"
                className="inline-flex items-center rounded-md px-3 py-1 text-xs font-medium text-muted-foreground/60 ring-1 ring-inset ring-border"
              >
                Next →
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
