"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";

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
