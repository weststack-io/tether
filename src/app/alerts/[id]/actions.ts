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
