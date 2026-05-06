// Ingestion pipeline orchestrator (INGEST-006).
//
// Single entry point that drives a full ingestion run end to end:
//   1. Create an IngestionRun row with status='running'.
//   2. Call all four parsers (SEC / FINRA / CFPB / OCC) in parallel via
//      Promise.allSettled so a single parser failure does not bring down the
//      run -- the failed-isolation contract that INGEST-007 separately verifies.
//   3. Deduplicate by sourceUrl, both within the batch and against rows
//      already persisted from prior runs.
//   4. Persist each new RawRegulatoryItem as a RegulatoryItem with the raw
//      vendor-side documentType normalized into the canonical DocumentType
//      union (final_rule | proposed_rule | enforcement | bulletin | notice |
//      guidance | letter).
//   5. For each newly persisted item, run drift detection. The detector
//      itself increments IngestionRun.itemsFlagged / itemsSuppressed, so the
//      orchestrator only reads those counters back at the end.
//   6. Mark the run completed (or failed on a top-level throw) and return a
//      summary the API route / tests can use without re-querying the DB.
//
// Per app_spec §12: parser errors are logged and the run continues; a failed
// run does not block subsequent runs (see INGEST-007).

import { prisma } from "@/lib/db";
import { runDriftDetection } from "@/lib/drift/detector";
import { fetchLatest as fetchCfpb } from "@/lib/ingestion/parsers/cfpb";
import { fetchLatest as fetchFinra } from "@/lib/ingestion/parsers/finra";
import { fetchLatest as fetchOcc } from "@/lib/ingestion/parsers/occ";
import { fetchLatest as fetchSec } from "@/lib/ingestion/parsers/sec";
import type {
  DocumentType,
  IngestionTrigger,
  RawRegulatoryItem,
  Regulator,
} from "@/types";

interface ParserBinding {
  regulator: Regulator;
  fetch: () => Promise<RawRegulatoryItem[]>;
}

const DEFAULT_PARSERS: ParserBinding[] = [
  { regulator: "SEC", fetch: fetchSec },
  { regulator: "FINRA", fetch: fetchFinra },
  { regulator: "CFPB", fetch: fetchCfpb },
  { regulator: "OCC", fetch: fetchOcc },
];

export interface ParserError {
  regulator: Regulator;
  error: string;
}

export interface DriftError {
  regulatoryItemId: string;
  error: string;
}

export interface IngestionRunResult {
  runId: string;
  status: "completed" | "failed";
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
  duplicatesSkipped: number;
  parserErrors: ParserError[];
  driftErrors: DriftError[];
}

export interface RunIngestionOptions {
  trigger?: IngestionTrigger;
  // Test seam: lets integration tests inject mock parsers without having to
  // jest.unstable_mockModule four separate parser modules.
  parsers?: ParserBinding[];
}

export async function runIngestion(
  options: RunIngestionOptions = {},
): Promise<IngestionRunResult> {
  const trigger: IngestionTrigger = options.trigger ?? "manual";
  const parsers = options.parsers ?? DEFAULT_PARSERS;

  const run = await prisma.ingestionRun.create({
    data: { trigger, status: "running" },
  });

  const parserErrors: ParserError[] = [];
  const driftErrors: DriftError[] = [];

  try {
    const settled = await Promise.allSettled(parsers.map((p) => p.fetch()));

    const collected: RawRegulatoryItem[] = [];
    settled.forEach((res, i) => {
      const regulator = parsers[i].regulator;
      if (res.status === "fulfilled") {
        collected.push(...res.value);
      } else {
        const message =
          res.reason instanceof Error ? res.reason.message : String(res.reason);
        parserErrors.push({ regulator, error: message });
        console.warn(`[runIngestion] parser ${regulator} failed: ${message}`);
      }
    });

    const seenInBatch = new Set<string>();
    const uniqueRaw: RawRegulatoryItem[] = [];
    for (const raw of collected) {
      if (seenInBatch.has(raw.sourceUrl)) continue;
      seenInBatch.add(raw.sourceUrl);
      uniqueRaw.push(raw);
    }
    const inBatchDuplicates = collected.length - uniqueRaw.length;

    let crossRunDuplicates = 0;
    let newItems: RawRegulatoryItem[] = uniqueRaw;
    if (uniqueRaw.length > 0) {
      const existing = await prisma.regulatoryItem.findMany({
        where: { sourceUrl: { in: uniqueRaw.map((r) => r.sourceUrl) } },
        select: { sourceUrl: true },
      });
      const existingSet = new Set(existing.map((e) => e.sourceUrl));
      newItems = uniqueRaw.filter((r) => !existingSet.has(r.sourceUrl));
      crossRunDuplicates = uniqueRaw.length - newItems.length;
    }

    const persistedIds: string[] = [];
    for (const raw of newItems) {
      try {
        const created = await prisma.regulatoryItem.create({
          data: {
            sourceUrl: raw.sourceUrl,
            regulator: raw.regulator,
            publicationDate: raw.publicationDate,
            documentType: normalizeDocumentType(raw),
            title: raw.title,
            fullText: raw.fullText,
            ingestionRunId: run.id,
          },
        });
        persistedIds.push(created.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        parserErrors.push({
          regulator: raw.regulator,
          error: `persist ${raw.sourceUrl}: ${message}`,
        });
        console.warn(
          `[runIngestion] persist failed for ${raw.sourceUrl}: ${message}`,
        );
      }
    }

    for (const itemId of persistedIds) {
      try {
        await runDriftDetection(itemId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        driftErrors.push({ regulatoryItemId: itemId, error: message });
        console.warn(
          `[runIngestion] drift detection failed for ${itemId}: ${message}`,
        );
      }
    }

    const errorsBlob =
      parserErrors.length === 0 && driftErrors.length === 0
        ? null
        : JSON.stringify({ parserErrors, driftErrors });

    const finalRun = await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        itemsProcessed: persistedIds.length,
        errors: errorsBlob,
      },
    });

    return {
      runId: run.id,
      status: "completed",
      itemsProcessed: persistedIds.length,
      itemsFlagged: finalRun.itemsFlagged,
      itemsSuppressed: finalRun.itemsSuppressed,
      duplicatesSkipped: inBatchDuplicates + crossRunDuplicates,
      parserErrors,
      driftErrors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errors: JSON.stringify({
          topLevel: message,
          parserErrors,
          driftErrors,
        }),
      },
    });
    return {
      runId: run.id,
      status: "failed",
      itemsProcessed: 0,
      itemsFlagged: 0,
      itemsSuppressed: 0,
      duplicatesSkipped: 0,
      parserErrors,
      driftErrors: [...driftErrors, { regulatoryItemId: "", error: message }],
    };
  }
}

// Normalize the raw vendor-side documentType into the canonical DocumentType
// union. The raw labels come from the per-regulator parsers
// ("press_release" | "regulatory_notice" | "publication" | "bulletin") and
// don't directly map onto the policy-side type taxonomy. Title/keyword
// classification is the most reliable signal -- the patterns below are
// ordered most-specific to least-specific so e.g. "Final Rule on X" wins
// over a stray "rule" mention later in the text.
export function normalizeDocumentType(raw: RawRegulatoryItem): DocumentType {
  const haystack = `${raw.title} ${raw.fullText.slice(0, 500)}`.toLowerCase();

  if (/\bfinal(?:iz(?:e|es|ed|ing))?\s+rule\b/.test(haystack)) return "final_rule";
  if (/\bproposed rule\b|\brule proposal\b|\bproposing release\b/.test(haystack)) {
    return "proposed_rule";
  }
  if (
    /\benforcement\b|\bcharges?\s|\bsanction|\bsettle(?:s|d|ment|ments)?\b|\bcease[\s-]and[\s-]desist\b|\bdisciplinary\b|\bpenalt/.test(
      haystack,
    )
  ) {
    return "enforcement";
  }
  if (/\bguidance\b|\bcircular\b|\bfaq\b|\bfrequently asked\b/.test(haystack)) {
    return "guidance";
  }
  if (/\bbulletin\b/.test(haystack) || raw.documentType === "bulletin") return "bulletin";
  if (/\bno[\s-]action\b|\binterpretive letter\b/.test(haystack)) return "letter";
  if (/\bnotice\b/.test(haystack) || raw.documentType === "regulatory_notice") {
    return "notice";
  }

  switch (raw.regulator) {
    case "SEC":
      return "enforcement";
    case "FINRA":
      return "notice";
    case "CFPB":
      return "guidance";
    case "OCC":
      return "bulletin";
  }
}
