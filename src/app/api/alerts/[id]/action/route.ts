import { NextResponse } from "next/server";
import prisma from "@/lib/db";

const ACCEPT = "accept";
const DISMISS = "dismiss";
const ESCALATE = "escalate";

// API-007 (accept) + API-008 (dismiss) + API-009 (escalate). The snooze action
// rejects as 400 until API-010 lands.
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

  if (action !== ACCEPT && action !== DISMISS && action !== ESCALATE) {
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

  let escalationNote: string | null = null;
  if (action === ESCALATE && payload.note !== undefined && payload.note !== null) {
    const rawNote = payload.note;
    if (typeof rawNote !== "string" || rawNote.trim().length === 0) {
      return NextResponse.json(
        { error: "'note' must be a non-empty string when provided" },
        { status: 400 },
      );
    }
    escalationNote = rawNote.trim();
  }

  try {
    const existing = await prisma.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Alert not found", id },
        { status: 404 },
      );
    }

    const nextStatus =
      action === ACCEPT
        ? "accepted"
        : action === DISMISS
          ? "dismissed"
          : "escalated";
    const beforeState = JSON.stringify({ status: existing.status });
    const afterState =
      action === DISMISS
        ? JSON.stringify({ status: nextStatus, dismissReason: reason })
        : action === ESCALATE
          ? JSON.stringify({ status: nextStatus, escalationNote })
          : JSON.stringify({ status: nextStatus });

    const updateData =
      action === DISMISS
        ? { status: nextStatus, dismissReason: reason }
        : action === ESCALATE
          ? { status: nextStatus, escalationNote }
          : { status: nextStatus };

    const auditNote =
      action === DISMISS ? reason : action === ESCALATE ? escalationNote : null;

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
          note: auditNote,
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
