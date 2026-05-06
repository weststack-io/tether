import { NextResponse } from "next/server";
import prisma from "@/lib/db";

const ACCEPT = "accept";
const DISMISS = "dismiss";

// API-007 (accept) + API-008 (dismiss). Other actions (escalate/snooze) reject
// as 400 until their respective sessions land.
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

  const payload = (body ?? {}) as Record<string, unknown>;
  const action = payload.action;
  if (typeof action !== "string") {
    return NextResponse.json(
      { error: "Missing 'action' in request body" },
      { status: 400 },
    );
  }

  if (action !== ACCEPT && action !== DISMISS) {
    return NextResponse.json(
      { error: `Unsupported action: ${action}` },
      { status: 400 },
    );
  }

  let reason: string | null = null;
  if (action === DISMISS) {
    const rawReason = payload.reason;
    if (typeof rawReason !== "string" || rawReason.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing 'reason' for dismiss action" },
        { status: 400 },
      );
    }
    reason = rawReason.trim();
  }

  try {
    const existing = await prisma.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Alert not found", id },
        { status: 404 },
      );
    }

    const nextStatus = action === ACCEPT ? "accepted" : "dismissed";
    const beforeState = JSON.stringify({ status: existing.status });
    const afterState =
      action === DISMISS
        ? JSON.stringify({ status: nextStatus, dismissReason: reason })
        : JSON.stringify({ status: nextStatus });

    const updateData =
      action === DISMISS
        ? { status: nextStatus, dismissReason: reason }
        : { status: nextStatus };

    const [updated] = await prisma.$transaction([
      prisma.alert.update({
        where: { id },
        data: updateData,
      }),
      prisma.auditEntry.create({
        data: {
          alertId: id,
          actor: "reviewer",
          action: nextStatus,
          beforeState,
          afterState,
          note: action === DISMISS ? reason : null,
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
