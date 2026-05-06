import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runIngestion } from "@/lib/ingestion/pipeline";

// POST /api/ingestion/trigger (API-011, API-012)
//
// Creates an IngestionRun row synchronously (so the response can return its
// runId), then kicks off the orchestrator as a fire-and-forget. The
// orchestrator drives the row through completion (or failure). The HTTP
// caller only needs to know the run started -- the ingestion-log endpoint
// (API-013) and the dashboard exist to surface terminal status.
//
// Body shape:
//   {} or no body                 -> full regulator-wide crawl (API-011)
//   { url: "https://sec.gov/..." } -> single-URL ingestion (API-012)
//
// `url`, when present, must be a string parseable by `new URL()`. The
// orchestrator skips the regulator-wide RSS fan-out and instead fetches
// just that document, persisting at most one RegulatoryItem.
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

  let url: string | undefined;
  if (raw.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }
    if (parsed !== null && typeof parsed === "object") {
      const candidate = (parsed as { url?: unknown }).url;
      if (candidate !== undefined && candidate !== null && candidate !== "") {
        if (typeof candidate !== "string") {
          return NextResponse.json(
            { error: "'url' must be a string" },
            { status: 400 },
          );
        }
        try {
          new URL(candidate);
        } catch {
          return NextResponse.json(
            { error: "'url' must be a valid URL" },
            { status: 400 },
          );
        }
        url = candidate;
      }
    }
  }

  const run = await prisma.ingestionRun.create({
    data: { trigger: "manual", status: "running" },
  });

  void runIngestion({ trigger: "manual", runId: run.id, url }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ingestion/trigger] runIngestion(${run.id}) rejected: ${message}`,
    );
  });

  return NextResponse.json({ runId: run.id, status: "started" });
}
