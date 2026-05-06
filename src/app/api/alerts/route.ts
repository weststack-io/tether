import { NextResponse } from "next/server";
import prisma from "@/lib/db";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(
      url.searchParams.get("pageSize"),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const [total, rows] = await Promise.all([
      prisma.alert.count(),
      prisma.alert.findMany({
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
