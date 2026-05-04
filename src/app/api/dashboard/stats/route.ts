import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    alertsBySeverity: { high: 0, medium: 0, low: 0 },
    alertsByRegulator: { SEC: 0, FINRA: 0, CFPB: 0, OCC: 0 },
    alertsByDomain: {},
    alertsByStatus: {},
    totalOpen: 0,
    recentIngestion: [],
  });
}
