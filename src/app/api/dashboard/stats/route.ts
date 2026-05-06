import { NextResponse } from "next/server";
import prisma from "@/lib/db";

const KNOWN_SEVERITIES = ["high", "medium", "low"] as const;
const KNOWN_REGULATORS = ["SEC", "FINRA", "CFPB", "OCC"] as const;

export async function GET() {
  try {
    const [
      severityRows,
      regulatorRows,
      domainRows,
      statusRows,
      totalOpen,
      recentIngestion,
    ] = await Promise.all([
      prisma.alert.groupBy({
        by: ["severity"],
        _count: { _all: true },
      }),
      prisma.alert.findMany({
        select: { regulatoryItem: { select: { regulator: true } } },
      }),
      prisma.alert.findMany({
        select: {
          policyChunk: {
            select: { policyDocument: { select: { domain: true } } },
          },
        },
      }),
      prisma.alert.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.alert.count({ where: { status: "open" } }),
      prisma.ingestionRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 5,
      }),
    ]);

    const alertsBySeverity: Record<string, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const row of severityRows) {
      if ((KNOWN_SEVERITIES as readonly string[]).includes(row.severity)) {
        alertsBySeverity[row.severity] = row._count._all;
      }
    }

    const alertsByRegulator: Record<string, number> = {
      SEC: 0,
      FINRA: 0,
      CFPB: 0,
      OCC: 0,
    };
    for (const row of regulatorRows) {
      const reg = row.regulatoryItem.regulator;
      if ((KNOWN_REGULATORS as readonly string[]).includes(reg)) {
        alertsByRegulator[reg] = (alertsByRegulator[reg] ?? 0) + 1;
      }
    }

    const alertsByDomain: Record<string, number> = {};
    for (const row of domainRows) {
      const domain = row.policyChunk.policyDocument.domain;
      alertsByDomain[domain] = (alertsByDomain[domain] ?? 0) + 1;
    }

    const alertsByStatus: Record<string, number> = {};
    for (const row of statusRows) {
      alertsByStatus[row.status] = row._count._all;
    }

    return NextResponse.json({
      alertsBySeverity,
      alertsByRegulator,
      alertsByDomain,
      alertsByStatus,
      totalOpen,
      recentIngestion,
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute dashboard stats", details },
      { status: 500 },
    );
  }
}
