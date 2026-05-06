import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
        data-confidence={confidenceFraction}
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
    </div>
  );
}
