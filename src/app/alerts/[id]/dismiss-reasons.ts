// DETAIL-005 reason codes for the Dismiss action — kept in sync with
// app_spec.txt section 9 and the API-008 dismiss branch in
// src/app/api/alerts/[id]/action/route.ts.
//
// Lives in its own (non-"use server") module because Next.js server-action
// files can only export async functions. Both the page (which renders the
// <select> options) and the actions module (which validates incoming
// reasons) import from here so the option list and the validator can never
// drift apart.

export const DISMISS_REASON_CODES = [
  "false_positive",
  "already_addressed",
  "not_applicable",
  "duplicate",
  "accepted_risk",
  "other",
] as const;

export type DismissReasonCode = (typeof DISMISS_REASON_CODES)[number];

export const DISMISS_REASON_LABELS: Record<DismissReasonCode, string> = {
  false_positive: "False positive",
  already_addressed: "Already addressed",
  not_applicable: "Not applicable",
  duplicate: "Duplicate",
  accepted_risk: "Accepted risk",
  other: "Other",
};
