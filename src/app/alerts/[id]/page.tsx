import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptAlert, dismissAlertFromForm } from "./actions";
import {
  DISMISS_REASON_CODES,
  DISMISS_REASON_LABELS,
} from "./dismiss-reasons";

export const dynamic = "force-dynamic";

const REGULATOR_BADGE_CLASS: Record<string, string> = {
  SEC: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900",
  FINRA:
    "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  CFPB: "bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:ring-cyan-900",
  OCC: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900",
};

const SEVERITY_BADGE_CLASS: Record<string, string> = {
  high: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  medium:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  low: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
};

// Mirrors the alerts list table palette (src/app/alerts/page.tsx) so the
// list-view → detail-view transition is visually continuous on status.
const STATUS_BADGE_CLASS: Record<string, string> = {
  open: "bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:ring-slate-700",
  accepted:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  dismissed:
    "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700",
  escalated:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  snoozed:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  accepted: "Accepted",
  dismissed: "Dismissed",
  escalated: "Escalated",
  snoozed: "Snoozed",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: "Created",
  accepted: "Accepted",
  dismissed: "Dismissed",
  escalated: "Escalated",
  snoozed: "Snoozed",
  reopened: "Reopened",
};

const CLASSIFICATION_BADGE_CLASS: Record<string, string> = {
  aligned:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  drifted:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  contradicted:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  ambiguous:
    "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-900",
  no_material_impact:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  aligned: "Aligned",
  drifted: "Drifted",
  contradicted: "Contradicted",
  ambiguous: "Ambiguous",
  no_material_impact: "No Material Impact",
};

// Confidence-bar fill color tracks classification — drift/contradiction read
// red even at low confidence, alignment reads green, ambiguous/no-material
// read neutral. This pairs visually with the classification badge so a quick
// glance at the bar communicates both "how confident" and "of what".
const CONFIDENCE_BAR_CLASS: Record<string, string> = {
  aligned: "bg-emerald-500 dark:bg-emerald-400",
  drifted: "bg-amber-500 dark:bg-amber-400",
  contradicted: "bg-red-500 dark:bg-red-400",
  ambiguous: "bg-purple-500 dark:bg-purple-400",
  no_material_impact: "bg-slate-400 dark:bg-slate-500",
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  final_rule: "Final Rule",
  proposed_rule: "Proposed Rule",
  enforcement: "Enforcement",
  bulletin: "Bulletin",
  notice: "Notice",
  guidance: "Guidance",
  letter: "Letter",
};

const DOMAIN_LABELS: Record<string, string> = {
  bsa_aml: "BSA/AML",
  complaint_handling: "Complaint Handling",
  fair_lending: "Fair Lending",
  reg_e: "Regulation E",
  reg_z: "Regulation Z",
  vendor_management: "Vendor Management",
  info_security: "Information Security",
  cip: "Customer Identification Program",
  overdraft: "Overdraft",
  marketing: "Marketing",
};

function formatPublicationDate(d: Date): string {
  // Mirrors the alerts list's date formatting style for consistency: ISO date
  // portion only, since publicationDate semantically represents a calendar day
  // for a regulatory item, not a wall-clock event.
  return d.toISOString().slice(0, 10);
}

async function loadAlert(id: string) {
  return prisma.alert.findUnique({
    where: { id },
    include: {
      regulatoryItem: true,
      policyChunk: {
        include: { policyDocument: true },
      },
      // DETAIL-004 step 5 verifies "a new audit entry appears in the audit
      // history" after Accept. DETAIL-008 will add the polished timeline;
      // for now we render a minimal newest-first list under the action bar.
      auditEntries: { orderBy: { timestamp: "desc" } },
    },
  });
}

export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const alert = await loadAlert(id);
  if (!alert) {
    notFound();
  }

  const regItem = alert.regulatoryItem;
  const chunk = alert.policyChunk;
  const policy = chunk.policyDocument;

  const regulatorClass =
    REGULATOR_BADGE_CLASS[regItem.regulator] ??
    "bg-muted text-muted-foreground ring-border";
  const documentTypeLabel =
    DOCUMENT_TYPE_LABELS[regItem.documentType] ?? regItem.documentType;
  const domainLabel = DOMAIN_LABELS[policy.domain] ?? policy.domain;
  const classificationClass =
    CLASSIFICATION_BADGE_CLASS[alert.classification] ??
    "bg-muted text-muted-foreground ring-border";
  const classificationLabel =
    CLASSIFICATION_LABELS[alert.classification] ?? alert.classification;
  const severityClass =
    SEVERITY_BADGE_CLASS[alert.severity] ??
    "bg-muted text-muted-foreground ring-border";
  const statusClass =
    STATUS_BADGE_CLASS[alert.status] ??
    "bg-muted text-muted-foreground ring-border";
  const statusLabel = STATUS_LABELS[alert.status] ?? alert.status;
  const isOpen = alert.status === "open";
  const confidenceBarClass =
    CONFIDENCE_BAR_CLASS[alert.classification] ?? "bg-primary";
  // Clamp into [0, 1] in case a malformed seed/classifier output ever sneaks
  // through; the bar should never render past 100% or as a negative width.
  const confidenceFraction = Math.max(0, Math.min(1, alert.confidence));
  const confidencePct = Math.round(confidenceFraction * 100);

  return (
    <div className="space-y-6" data-testid="alert-detail" data-alert-id={alert.id}>
      <div>
        <h1 className="font-heading text-2xl font-semibold">Alert Detail</h1>
        <p className="text-sm text-muted-foreground">
          Side-by-side comparison of the regulatory source and the policy
          passage that triggered this alert.
        </p>
      </div>

      <div
        className="space-y-3 rounded-lg border bg-card p-4 shadow-sm"
        data-testid="alert-detail-summary"
        data-classification={alert.classification}
        data-severity={alert.severity}
        data-status={alert.status}
        data-confidence={confidenceFraction}
        data-dismiss-reason={alert.dismissReason ?? ""}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="alert-detail-classification-badge"
            data-classification={alert.classification}
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${classificationClass}`}
          >
            {classificationLabel}
          </span>
          <span
            data-testid="alert-detail-severity-badge"
            data-severity={alert.severity}
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${severityClass}`}
          >
            {alert.severity} severity
          </span>
          <span
            data-testid="alert-detail-status-badge"
            data-status={alert.status}
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Confidence</span>
            <span
              data-testid="alert-detail-confidence-value"
              data-confidence={confidenceFraction}
              className="font-mono tabular-nums text-foreground"
            >
              {`${confidencePct}%`}
            </span>
          </div>
          <div
            data-testid="alert-detail-confidence-bar"
            data-confidence={confidenceFraction}
            data-confidence-pct={confidencePct}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={confidencePct}
            aria-label={`Classification confidence ${confidencePct}%`}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              data-testid="alert-detail-confidence-bar-fill"
              className={`h-full rounded-full transition-all ${confidenceBarClass}`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
        </div>
      </div>

      <div
        className="grid gap-4 md:grid-cols-2"
        data-testid="alert-detail-panels"
      >
        <Card data-testid="alert-detail-regulatory-panel">
          <CardHeader>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Regulatory Source
            </div>
            <CardTitle data-testid="alert-detail-regulatory-title">
              {regItem.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                data-testid="alert-detail-regulatory-regulator"
                data-regulator={regItem.regulator}
                className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${regulatorClass}`}
              >
                {regItem.regulator}
              </span>
              <span
                data-testid="alert-detail-regulatory-document-type"
                data-document-type={regItem.documentType}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground ring-1 ring-inset ring-border"
              >
                {documentTypeLabel}
              </span>
              <span
                data-testid="alert-detail-regulatory-date"
                data-publication-date={regItem.publicationDate.toISOString()}
                className="font-mono tabular-nums text-muted-foreground"
              >
                {formatPublicationDate(regItem.publicationDate)}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Quoted text
              </div>
              <blockquote
                data-testid="alert-detail-regulatory-quote"
                className="rounded-md border-l-4 border-yellow-400 bg-yellow-100 px-3 py-2 text-sm italic text-yellow-950 ring-1 ring-inset ring-yellow-200 dark:border-yellow-500 dark:bg-yellow-950/40 dark:text-yellow-100 dark:ring-yellow-900"
              >
                <mark className="bg-transparent text-inherit">
                  {alert.regulatoryQuote}
                </mark>
              </blockquote>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="alert-detail-policy-panel">
          <CardHeader>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Policy Passage
            </div>
            <CardTitle data-testid="alert-detail-policy-title">
              {policy.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                data-testid="alert-detail-policy-section"
                data-section-heading={chunk.sectionHeading}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground ring-1 ring-inset ring-border"
              >
                {chunk.sectionHeading}
              </span>
              <span
                data-testid="alert-detail-policy-domain"
                data-domain={policy.domain}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground ring-1 ring-inset ring-border"
              >
                {domainLabel}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Quoted text
              </div>
              <blockquote
                data-testid="alert-detail-policy-quote"
                className="rounded-md border-l-4 border-yellow-400 bg-yellow-100 px-3 py-2 text-sm italic text-yellow-950 ring-1 ring-inset ring-yellow-200 dark:border-yellow-500 dark:bg-yellow-950/40 dark:text-yellow-100 dark:ring-yellow-900"
              >
                <mark className="bg-transparent text-inherit">
                  {alert.policyQuote}
                </mark>
              </blockquote>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="alert-detail-explanation">
        <CardHeader>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Why this was flagged
          </div>
          <CardTitle>Plain-language explanation</CardTitle>
        </CardHeader>
        <CardContent>
          <p
            data-testid="alert-detail-explanation-text"
            className="whitespace-pre-line text-sm leading-relaxed text-foreground"
          >
            {alert.explanation}
          </p>
        </CardContent>
      </Card>

      <Card data-testid="alert-detail-citations">
        <CardHeader>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Citations
          </div>
          <CardTitle>Citation chain</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div
              className="space-y-1"
              data-testid="alert-detail-citation-regulatory"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Regulatory source
              </dt>
              <dd>
                <a
                  data-testid="alert-detail-citation-regulatory-link"
                  data-source-url={alert.regulatorySourceUrl}
                  href={alert.regulatorySourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all font-mono text-sm text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {alert.regulatorySourceUrl}
                </a>
              </dd>
            </div>

            <div
              className="space-y-1"
              data-testid="alert-detail-citation-policy"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Policy reference
              </dt>
              <dd
                data-testid="alert-detail-citation-policy-reference"
                data-policy-reference={alert.policyReference}
                className="space-x-1 text-sm text-foreground"
              >
                <span
                  data-testid="alert-detail-citation-policy-document"
                  className="font-medium"
                >
                  {policy.title}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
                <span
                  data-testid="alert-detail-citation-policy-section"
                  className="text-muted-foreground"
                >
                  {chunk.sectionHeading}
                </span>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card data-testid="alert-detail-actions">
        <CardHeader>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Reviewer actions
          </div>
          <CardTitle>Action bar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <form
              action={acceptAlert.bind(null, alert.id)}
              data-testid="alert-detail-accept-form"
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="submit"
                data-testid="alert-detail-accept-button"
                data-action="accept"
                disabled={!isOpen}
                aria-disabled={!isOpen}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-600/40 disabled:text-white/70"
              >
                Accept
              </button>
              {!isOpen ? (
                <span
                  data-testid="alert-detail-accept-locked-hint"
                  className="text-xs text-muted-foreground"
                >
                  Already {statusLabel.toLowerCase()}; reopen to accept again.
                </span>
              ) : null}
            </form>

            {isOpen ? (
              // DETAIL-005: Dismiss button uses a native <details> disclosure
              // so the reason-code selector is server-rendered (no client JS
              // needed). Clicking the Dismiss <summary> toggles the panel
              // open; submitting the inner form invokes the dismissAlert
              // server action with the chosen reason. The <select> is in the
              // DOM regardless of the open state, which makes the integration
              // test markup-driven (no need to drive a real browser to expand
              // the disclosure).
              <details
                data-testid="alert-detail-dismiss-control"
                className="group inline-block"
              >
                <summary
                  data-testid="alert-detail-dismiss-button"
                  data-action="dismiss"
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-zinc-700 px-3 text-sm font-medium text-white shadow-sm transition-colors marker:hidden hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
                >
                  Dismiss
                </summary>
                <form
                  action={dismissAlertFromForm.bind(null, alert.id)}
                  data-testid="alert-detail-dismiss-form"
                  className="mt-3 flex flex-col gap-2 rounded-md border border-border/60 bg-card/60 p-3 shadow-sm sm:min-w-[18rem]"
                >
                  <label
                    htmlFor="alert-detail-dismiss-reason"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Reason
                  </label>
                  <select
                    id="alert-detail-dismiss-reason"
                    name="reason"
                    required
                    defaultValue=""
                    data-testid="alert-detail-dismiss-reason-select"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="" disabled>
                      Select a reason…
                    </option>
                    {DISMISS_REASON_CODES.map((code) => (
                      <option
                        key={code}
                        value={code}
                        data-testid="alert-detail-dismiss-reason-option"
                        data-reason-code={code}
                      >
                        {DISMISS_REASON_LABELS[code] ?? code}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    data-testid="alert-detail-dismiss-confirm-button"
                    data-action="dismiss-confirm"
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-700 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
                  >
                    Confirm dismiss
                  </button>
                </form>
              </details>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="alert-detail-dismiss-button"
                  data-action="dismiss"
                  disabled
                  aria-disabled="true"
                  className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-lg bg-zinc-700/40 px-3 text-sm font-medium text-white/70 shadow-sm"
                >
                  Dismiss
                </button>
                <span
                  data-testid="alert-detail-dismiss-locked-hint"
                  className="text-xs text-muted-foreground"
                >
                  Already {statusLabel.toLowerCase()}
                  {alert.status === "dismissed" && alert.dismissReason
                    ? ` (${
                        (DISMISS_REASON_LABELS as Record<string, string>)[
                          alert.dismissReason
                        ] ?? alert.dismissReason
                      })`
                    : ""}
                  ; reopen to dismiss again.
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="alert-detail-audit">
        <CardHeader>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            History
          </div>
          <CardTitle>Audit history</CardTitle>
        </CardHeader>
        <CardContent>
          {alert.auditEntries.length === 0 ? (
            <p
              data-testid="alert-detail-audit-empty"
              className="text-sm text-muted-foreground"
            >
              No actions recorded yet.
            </p>
          ) : (
            <ol
              data-testid="alert-detail-audit-list"
              data-audit-count={alert.auditEntries.length}
              className="space-y-3 text-sm"
            >
              {alert.auditEntries.map((entry) => {
                const actionLabel =
                  AUDIT_ACTION_LABELS[entry.action] ?? entry.action;
                const timestamp = entry.timestamp.toISOString();
                return (
                  <li
                    key={entry.id}
                    data-testid="alert-detail-audit-entry"
                    data-action={entry.action}
                    data-actor={entry.actor}
                    className="rounded-md border border-border/60 bg-card/50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {actionLabel}
                      </span>
                      <time
                        dateTime={timestamp}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {timestamp}
                      </time>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      by <span className="capitalize">{entry.actor}</span>
                      {entry.note ? <> — {entry.note}</> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
