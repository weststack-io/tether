"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import {
  DISMISS_REASON_CODES,
  type DismissReasonCode,
} from "./dismiss-reasons";

const DISMISS_REASON_SET: Set<string> = new Set(DISMISS_REASON_CODES);

// DETAIL-004: server action backing the Accept button. Mirrors the
// API-007 (POST /api/alerts/[id]/action with action=accept) accept branch
// inline: status -> "accepted" plus an audit entry, both inside one
// transaction so the page can never observe a status change without its
// audit footprint. revalidatePath() invalidates the RSC cache for this
// detail page so the next render picks up the new status + audit entry.
export async function acceptAlert(alertId: string): Promise<void> {
  const existing = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!existing) {
    throw new Error(`Alert ${alertId} not found`);
  }

  // Idempotent guard: if the alert is already accepted, skip the write so
  // a stale double-submit doesn't pile on duplicate audit entries.
  if (existing.status === "accepted") {
    try {
      revalidatePath(`/alerts/${alertId}`);
    } catch {
      // no-op: outside a request scope (test harness)
    }
    return;
  }

  const beforeState = JSON.stringify({ status: existing.status });
  const afterState = JSON.stringify({ status: "accepted" });

  await prisma.$transaction([
    prisma.alert.update({
      where: { id: alertId },
      data: { status: "accepted" },
    }),
    prisma.auditEntry.create({
      data: {
        alertId,
        actor: "reviewer",
        action: "accepted",
        beforeState,
        afterState,
        note: null,
      },
    }),
  ]);

  // revalidatePath throws "static generation store missing" when invoked
  // outside a Next.js request scope (e.g. from a Jest test that imports
  // this action directly). The page is force-dynamic so the next browser
  // navigation always re-fetches; the revalidate call exists to nudge any
  // in-flight RSC cache for the form-submit flow. Swallowing the error
  // here keeps the action callable from both contexts without behavior
  // changes in the request flow.
  try {
    revalidatePath(`/alerts/${alertId}`);
  } catch {
    // no-op: outside a request scope (test harness)
  }
}

// DETAIL-005: server action backing the Dismiss button. Mirrors the
// API-008 (POST /api/alerts/[id]/action with action=dismiss) dismiss branch
// inline: status -> "dismissed", dismissReason persisted on the Alert row,
// audit entry recorded with the reason as its note. Reason must be one of
// the six DISMISS_REASON_CODES from the spec — anything else throws so the
// route handler / form caller surfaces the bad input.
export async function dismissAlert(
  alertId: string,
  reason: string,
): Promise<void> {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!DISMISS_REASON_SET.has(trimmed)) {
    throw new Error(
      `Invalid dismiss reason: ${JSON.stringify(reason)}. Expected one of ${DISMISS_REASON_CODES.join(", ")}`,
    );
  }
  const reasonCode = trimmed as DismissReasonCode;

  const existing = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!existing) {
    throw new Error(`Alert ${alertId} not found`);
  }

  // Idempotent guard: re-dismissing an already-dismissed alert is a stale
  // double-submit (e.g. user double-clicks Confirm). Don't write a second
  // audit row — the original dismiss entry already records the reason.
  if (existing.status === "dismissed") {
    try {
      revalidatePath(`/alerts/${alertId}`);
    } catch {
      // no-op: outside a request scope (test harness)
    }
    return;
  }

  const beforeState = JSON.stringify({ status: existing.status });
  const afterState = JSON.stringify({
    status: "dismissed",
    dismissReason: reasonCode,
  });

  await prisma.$transaction([
    prisma.alert.update({
      where: { id: alertId },
      data: { status: "dismissed", dismissReason: reasonCode },
    }),
    prisma.auditEntry.create({
      data: {
        alertId,
        actor: "reviewer",
        action: "dismissed",
        beforeState,
        afterState,
        note: reasonCode,
      },
    }),
  ]);

  try {
    revalidatePath(`/alerts/${alertId}`);
  } catch {
    // no-op: outside a request scope (test harness)
  }
}

// Form-action wrapper: <form action={dismissAlertFromForm.bind(null, id)}>
// Accepts FormData (the standard server-action signature when used as a
// `<form action>` target) and pulls "reason" out of it before delegating
// to dismissAlert. Keeping the validation in dismissAlert means both
// callers (form submit + direct test invocation) share the same guard.
export async function dismissAlertFromForm(
  alertId: string,
  formData: FormData,
): Promise<void> {
  const raw = formData.get("reason");
  const reason = typeof raw === "string" ? raw : "";
  await dismissAlert(alertId, reason);
}

// DETAIL-006: server action backing the Escalate button. Mirrors the
// API-009 (POST /api/alerts/[id]/action with action=escalate) escalate
// branch inline: status -> "escalated", optional escalationNote persisted
// on the Alert row, audit entry recorded with the note as its note column.
// The escalation note is optional per app_spec — an empty/whitespace input
// is normalized to null so the DB doesn't carry empty strings as "notes".
export async function escalateAlert(
  alertId: string,
  note: string | null | undefined,
): Promise<void> {
  const trimmed =
    typeof note === "string" && note.trim().length > 0 ? note.trim() : null;

  const existing = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!existing) {
    throw new Error(`Alert ${alertId} not found`);
  }

  // Idempotent guard: re-escalating an already-escalated alert is a stale
  // double-submit. Don't write a second audit row — the original escalate
  // entry already records the note.
  if (existing.status === "escalated") {
    try {
      revalidatePath(`/alerts/${alertId}`);
    } catch {
      // no-op: outside a request scope (test harness)
    }
    return;
  }

  const beforeState = JSON.stringify({ status: existing.status });
  const afterState = JSON.stringify({
    status: "escalated",
    escalationNote: trimmed,
  });

  await prisma.$transaction([
    prisma.alert.update({
      where: { id: alertId },
      data: { status: "escalated", escalationNote: trimmed },
    }),
    prisma.auditEntry.create({
      data: {
        alertId,
        actor: "reviewer",
        action: "escalated",
        beforeState,
        afterState,
        note: trimmed,
      },
    }),
  ]);

  try {
    revalidatePath(`/alerts/${alertId}`);
  } catch {
    // no-op: outside a request scope (test harness)
  }
}

// Form-action wrapper: <form action={escalateAlertFromForm.bind(null, id)}>
// Pulls "note" out of FormData before delegating to escalateAlert. Empty
// input is allowed (note is optional) — escalateAlert normalizes it to null.
export async function escalateAlertFromForm(
  alertId: string,
  formData: FormData,
): Promise<void> {
  const raw = formData.get("note");
  const note = typeof raw === "string" ? raw : null;
  await escalateAlert(alertId, note);
}

// DETAIL-007: server action backing the Snooze button. Mirrors the API-010
// (POST /api/alerts/[id]/action with action=snooze) snooze branch inline:
// status -> "snoozed", snoozeUntil DateTime persisted on the Alert row,
// audit entry recorded with the snoozeUntil ISO string as its note column
// so the audit list shows what the alert was snoozed until. Validates the
// input is a parseable date string in the future — anything else throws so
// the form caller surfaces the bad input.
export async function snoozeAlert(
  alertId: string,
  snoozeUntil: string | null | undefined,
): Promise<void> {
  if (typeof snoozeUntil !== "string" || snoozeUntil.trim().length === 0) {
    throw new Error("Missing snoozeUntil for snooze action");
  }
  const parsed = new Date(snoozeUntil.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid snoozeUntil: ${JSON.stringify(snoozeUntil)}. Expected an ISO date string.`,
    );
  }
  if (parsed.getTime() <= Date.now()) {
    throw new Error("snoozeUntil must be in the future");
  }

  const existing = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!existing) {
    throw new Error(`Alert ${alertId} not found`);
  }

  // Idempotent guard: re-snoozing an already-snoozed alert is a stale
  // double-submit. Don't write a second audit row — the original snooze
  // entry already records the until-date.
  if (existing.status === "snoozed") {
    try {
      revalidatePath(`/alerts/${alertId}`);
    } catch {
      // no-op: outside a request scope (test harness)
    }
    return;
  }

  const untilIso = parsed.toISOString();
  const beforeState = JSON.stringify({ status: existing.status });
  const afterState = JSON.stringify({
    status: "snoozed",
    snoozeUntil: untilIso,
  });

  await prisma.$transaction([
    prisma.alert.update({
      where: { id: alertId },
      data: { status: "snoozed", snoozeUntil: parsed },
    }),
    prisma.auditEntry.create({
      data: {
        alertId,
        actor: "reviewer",
        action: "snoozed",
        beforeState,
        afterState,
        note: untilIso,
      },
    }),
  ]);

  try {
    revalidatePath(`/alerts/${alertId}`);
  } catch {
    // no-op: outside a request scope (test harness)
  }
}

// Form-action wrapper: <form action={snoozeAlertFromForm.bind(null, id)}>
// Pulls "snoozeUntil" out of FormData before delegating to snoozeAlert.
// The native <input type="date"> serializes its value as a YYYY-MM-DD string
// which `new Date(...)` parses as midnight UTC of that day — fine for the
// ">= today" granularity the verification step exercises.
export async function snoozeAlertFromForm(
  alertId: string,
  formData: FormData,
): Promise<void> {
  const raw = formData.get("snoozeUntil");
  const value = typeof raw === "string" ? raw : null;
  await snoozeAlert(alertId, value);
}
