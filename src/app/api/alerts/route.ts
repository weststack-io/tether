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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(
      url.searchParams.get("pageSize"),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

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

    const [total, rows] = await Promise.all([
      prisma.alert.count({ where }),
      prisma.alert.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
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
        },
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
