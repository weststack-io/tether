import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runIngestion } from "@/lib/ingestion/pipeline";

// POST /api/ingestion/trigger (API-011)
//
// Creates an IngestionRun row synchronously (so the response can return its
// runId), then kicks off the orchestrator as a fire-and-forget. The
// orchestrator drives the row through completion (or failure). The HTTP
// caller only needs to know the run started -- the ingestion-log endpoint
// (API-013) and the dashboard exist to surface terminal status.
export async function POST(request: Request) {
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 },
    );
  }
  if (raw.length > 0) {
    try {
      JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }
  }

  const run = await prisma.ingestionRun.create({
    data: { trigger: "manual", status: "running" },
  });

  void runIngestion({ trigger: "manual", runId: run.id }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ingestion/trigger] runIngestion(${run.id}) rejected: ${message}`,
    );
  });

  return NextResponse.json({ runId: run.id, status: "started" });
}
