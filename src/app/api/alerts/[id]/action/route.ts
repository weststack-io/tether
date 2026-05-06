import { NextResponse } from "next/server";
import prisma from "@/lib/db";

const ACCEPT = "accept";

// API-007: accept path. Other actions (dismiss/escalate/snooze) reject as 400
// until their respective sessions land.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const action = (body as { action?: unknown } | null)?.action;
  if (typeof action !== "string") {
    return NextResponse.json(
      { error: "Missing 'action' in request body" },
      { status: 400 },
    );
  }

  if (action !== ACCEPT) {
    return NextResponse.json(
      { error: `Unsupported action: ${action}` },
      { status: 400 },
    );
  }

  try {
    const existing = await prisma.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Alert not found", id },
        { status: 404 },
      );
    }

    const beforeState = JSON.stringify({ status: existing.status });
    const afterState = JSON.stringify({ status: "accepted" });

    const [updated] = await prisma.$transaction([
      prisma.alert.update({
        where: { id },
        data: { status: "accepted" },
      }),
      prisma.auditEntry.create({
        data: {
          alertId: id,
          actor: "reviewer",
          action: "accepted",
          beforeState,
          afterState,
        },
      }),
    ]);

    const alert = await prisma.alert.findUnique({
      where: { id: updated.id },
      include: {
        regulatoryItem: true,
        policyChunk: { include: { policyDocument: true } },
        auditEntries: { orderBy: { timestamp: "asc" } },
      },
    });

    return NextResponse.json(alert);
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to apply action", details },
      { status: 500 },
    );
  }
}
