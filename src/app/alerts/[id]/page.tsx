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
    </div>
  );
}
