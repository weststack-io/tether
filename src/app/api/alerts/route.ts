import { NextResponse } from "next/server";
import prisma from "@/lib/db";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function parsePositiveInt(
  raw: string | null,
  fallback: number,
  max?: number,
): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

function parseCsvList(raw: string | null): string[] | null {
  if (raw === null) return null;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}

type DateBound = { mode: "gte" | "lte" | "lt"; value: Date };

// Parses an ISO date or date-only string. For dateTo passed as YYYY-MM-DD we
// advance to next-day midnight + use `lt` so the bound is inclusive of the
// named day (intuitive for ?dateTo=2026-06-01). Full ISO timestamps are taken
// verbatim and use `lte`/`gte`.
function parseDateBound(raw: string | null, isUpper: boolean): DateBound | null {
  if (raw === null) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  if (isUpper && isDateOnly) {
    return { mode: "lt", value: new Date(parsed.getTime() + DAY_MS) };
  }
  return { mode: isUpper ? "lte" : "gte", value: parsed };
}

const SORT_FIELDS = [
  "severity",
  "date",
  "regulator",
  "domain",
  "status",
] as const;
type SortField = (typeof SORT_FIELDS)[number];
type SortOrder = "asc" | "desc";

function parseSortBy(raw: string | null): SortField {
  if (raw && (SORT_FIELDS as readonly string[]).includes(raw)) {
    return raw as SortField;
  }
  return "date";
}

function parseSortOrder(raw: string | null): SortOrder {
  return raw === "asc" ? "asc" : "desc";
}

// Severity ranks by impact, not lexicographic order: high < medium < low.
// `sortOrder=desc` means "highest severity first" -> rank ascending.
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

// Translates sortBy+sortOrder into a Prisma orderBy clause for fields that map
// cleanly to a column or relation chain. Returns null for `severity`, which
// requires a custom rank order that Prisma's typed orderBy cannot express.
function buildPrismaOrderBy(
  sortBy: SortField,
  sortOrder: SortOrder,
): Record<string, unknown> | null {
  switch (sortBy) {
    case "date":
      return { createdAt: sortOrder };
    case "status":
      return { status: sortOrder };
    case "regulator":
      return { regulatoryItem: { regulator: sortOrder } };
    case "domain":
      return { policyChunk: { policyDocument: { domain: sortOrder } } };
    case "severity":
      return null;
  }
}

const ALERT_INCLUDE = {
  regulatoryItem: {
    select: {
      id: true,
      title: true,
      regulator: true,
      sourceUrl: true,
      publicationDate: true,
      documentType: true,
    },
  },
  policyChunk: {
    select: {
      id: true,
      sectionHeading: true,
      content: true,
      chunkIndex: true,
      policyDocument: {
        select: { id: true, title: true, domain: true },
      },
    },
  },
} as const;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(
      url.searchParams.get("pageSize"),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const sortBy = parseSortBy(url.searchParams.get("sortBy"));
    const sortOrder = parseSortOrder(url.searchParams.get("sortOrder"));

    const regulators = parseCsvList(url.searchParams.get("regulator"));
    const severities = parseCsvList(url.searchParams.get("severity"));
    const statuses = parseCsvList(url.searchParams.get("status"));
    const domains = parseCsvList(url.searchParams.get("domain"));
    const fromBound = parseDateBound(url.searchParams.get("dateFrom"), false);
    const toBound = parseDateBound(url.searchParams.get("dateTo"), true);

    const where: Record<string, unknown> = {};
    if (severities) where.severity = { in: severities };
    if (statuses) where.status = { in: statuses };
    if (regulators) {
      where.regulatoryItem = { regulator: { in: regulators } };
    }
    if (domains) {
      where.policyChunk = { policyDocument: { domain: { in: domains } } };
    }
    if (fromBound || toBound) {
      const createdAt: Record<string, Date> = {};
      if (fromBound) createdAt[fromBound.mode] = fromBound.value;
      if (toBound) createdAt[toBound.mode] = toBound.value;
      where.createdAt = createdAt;
    }

    if (sortBy === "severity") {
      // Severity uses a custom rank (high < medium < low), so we cannot push
      // the ordering into Prisma's typed orderBy. Fetch the filtered set,
      // sort + paginate in JS. Demo alert volume is well below where this
      // matters; the natural perf upgrade is a denormalized severity_rank
      // column or a $queryRaw `ORDER BY CASE severity ...`.
      const all = await prisma.alert.findMany({ where, include: ALERT_INCLUDE });
      const sorted = [...all].sort((a, b) => {
        const rankA = SEVERITY_RANK[a.severity] ?? 999;
        const rankB = SEVERITY_RANK[b.severity] ?? 999;
        if (rankA !== rankB) {
          return sortOrder === "desc" ? rankA - rankB : rankB - rankA;
        }
        // Stable secondary sort on createdAt desc (newest tiebreaker first).
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      const total = sorted.length;
      const skip = (page - 1) * pageSize;
      const rows = sorted.slice(skip, skip + pageSize);
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
      return NextResponse.json({
        alerts: rows,
        total,
        page,
        pageSize,
        totalPages,
      });
    }

    const orderBy = buildPrismaOrderBy(sortBy, sortOrder)!;
    const [total, rows] = await Promise.all([
      prisma.alert.count({ where }),
      prisma.alert.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
        include: ALERT_INCLUDE,
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    return NextResponse.json({
      alerts: rows,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to list alerts", details },
      { status: 500 },
    );
  }
}
