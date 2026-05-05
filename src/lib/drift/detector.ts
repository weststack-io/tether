// Drift detection pipeline orchestrator.
//
// Wires together every stage of app_spec.txt §5:
//   1. classifyRelevance   (LLM)
//   2. retrieveCandidates  (embedding + cosine)
//   3. classifyDrift       (LLM, per chunk)
//   4. verifyCitations     (substring check)
//   5. deriveSeverity      (pure mapping)
//   6. Alert + AuditEntry creation in a per-alert transaction.
//
// Per-chunk classification failures are caught and the chunk is skipped so
// one bad LLM round-trip does not abort the entire run. Citation failures
// suppress the alert (PIPE-002 will add the itemsSuppressed counter on top
// of this; the suppression decision itself lives here).
//
// Returns a summary object so callers (API routes, tests) can assert what
// happened without re-querying the DB.
//
// CITE-001 wires verifyCitations as a hard gate: a drift result with a
// fabricated quote produces no alert. Aligned / no_material_impact
// classifications also produce no alert (deriveSeverity returns null).

import { classifyDrift, classifyRelevance, type DriftResult } from "@/lib/ai/classifier";
import { prisma } from "@/lib/db";
import { verifyCitations } from "@/lib/drift/citation";
import { retrieveCandidates, type RetrievedChunk } from "@/lib/drift/retriever";
import { deriveSeverity } from "@/lib/drift/scorer";

const RETRIEVAL_TEXT_LIMIT = 4000;

export interface DriftDetectionResult {
  regulatoryItemId: string;
  isRelevant: boolean;
  candidatesEvaluated: number;
  alertsCreated: string[];
  citationFailures: number;
  classificationErrors: number;
}

export async function runDriftDetection(
  regulatoryItemId: string,
): Promise<DriftDetectionResult> {
  if (typeof regulatoryItemId !== "string" || regulatoryItemId.length === 0) {
    throw new Error("runDriftDetection: regulatoryItemId is required");
  }

  const regItem = await prisma.regulatoryItem.findUnique({
    where: { id: regulatoryItemId },
  });
  if (!regItem) {
    throw new Error(
      `runDriftDetection: RegulatoryItem ${regulatoryItemId} not found`,
    );
  }

  const relevance = await classifyRelevance({
    title: regItem.title,
    fullText: regItem.fullText,
  });

  await prisma.regulatoryItem.update({
    where: { id: regItem.id },
    data: { isRelevant: relevance.isRelevant },
  });

  if (!relevance.isRelevant) {
    return {
      regulatoryItemId: regItem.id,
      isRelevant: false,
      candidatesEvaluated: 0,
      alertsCreated: [],
      citationFailures: 0,
      classificationErrors: 0,
    };
  }

  const queryText = `${regItem.title}\n\n${regItem.fullText.slice(0, RETRIEVAL_TEXT_LIMIT)}`;
  const candidates = await retrieveCandidates(queryText);

  const alertsCreated: string[] = [];
  let citationFailures = 0;
  let classificationErrors = 0;

  for (const candidate of candidates) {
    const alertId = await processCandidate(regItem, candidate, {
      onCitationFailure: () => {
        citationFailures++;
      },
      onClassificationError: () => {
        classificationErrors++;
      },
    });
    if (alertId) alertsCreated.push(alertId);
  }

  return {
    regulatoryItemId: regItem.id,
    isRelevant: true,
    candidatesEvaluated: candidates.length,
    alertsCreated,
    citationFailures,
    classificationErrors,
  };
}

interface ProcessHandlers {
  onCitationFailure: () => void;
  onClassificationError: () => void;
}

async function processCandidate(
  regItem: { id: string; fullText: string; sourceUrl: string; ingestionRunId: string },
  candidate: RetrievedChunk,
  handlers: ProcessHandlers,
): Promise<string | null> {
  const { chunk } = candidate;

  const policyDocument = await prisma.policyDocument.findUnique({
    where: { id: chunk.policyDocumentId },
  });
  if (!policyDocument) {
    handlers.onClassificationError();
    return null;
  }

  let drift: DriftResult;
  try {
    drift = await classifyDrift({
      regulatoryText: regItem.fullText,
      policyText: chunk.content,
      policySection: chunk.sectionHeading,
      policyDocument: policyDocument.title,
    });
  } catch {
    handlers.onClassificationError();
    return null;
  }

  const verified = verifyCitations({
    regulatoryText: regItem.fullText,
    regulatoryQuote: drift.regulatoryQuote,
    policyText: chunk.content,
    policyQuote: drift.policyQuote,
  });
  if (!verified) {
    handlers.onCitationFailure();
    return null;
  }

  const severity = deriveSeverity(drift.classification, drift.confidence);
  if (severity === null) return null;

  const policyReference = `${policyDocument.title} > ${chunk.sectionHeading}`;

  const alert = await prisma.$transaction(async (tx) => {
    const created = await tx.alert.create({
      data: {
        regulatoryItemId: regItem.id,
        policyChunkId: chunk.id,
        classification: drift.classification,
        confidence: drift.confidence,
        severity,
        explanation: drift.explanation,
        regulatoryQuote: drift.regulatoryQuote,
        policyQuote: drift.policyQuote,
        regulatorySourceUrl: regItem.sourceUrl,
        policyReference,
      },
    });
    await tx.auditEntry.create({
      data: {
        alertId: created.id,
        actor: "system",
        action: "created",
      },
    });
    await tx.ingestionRun.update({
      where: { id: regItem.ingestionRunId },
      data: { itemsFlagged: { increment: 1 } },
    });
    return created;
  });

  return alert.id;
}
