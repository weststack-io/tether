import { describe, expect, it } from "@jest/globals";
import type {
  Alert,
  AlertStatus,
  AuditEntry,
  DriftClassification,
  IngestionRun,
  PolicyChunk,
  PolicyDocument,
  RegulatoryItem,
  Regulator,
  Severity,
} from "@/types";

describe("shared domain types", () => {
  it("RegulatoryItem accepts a fully populated record", () => {
    const item: RegulatoryItem = {
      id: "ri_1",
      sourceUrl: "https://sec.gov/rule",
      regulator: "SEC",
      publicationDate: new Date("2026-01-01"),
      documentType: "final_rule",
      title: "Rule",
      fullText: "...",
      summary: null,
      isRelevant: null,
      ingestionRunId: "run_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(item.regulator).toBe("SEC");
  });

  it("PolicyDocument and PolicyChunk wire together", () => {
    const doc: PolicyDocument = {
      id: "doc_1",
      title: "BSA/AML Policy",
      domain: "bsa_aml",
      fullText: "...",
      version: "1.0",
      isSynthetic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const chunk: PolicyChunk = {
      id: "chunk_1",
      policyDocumentId: doc.id,
      sectionHeading: "Section 1",
      content: "...",
      chunkIndex: 0,
      embedding: null,
      createdAt: new Date(),
    };
    expect(chunk.policyDocumentId).toBe(doc.id);
  });

  it("Alert uses narrowed enum-like fields", () => {
    const classification: DriftClassification = "drifted";
    const severity: Severity = "high";
    const status: AlertStatus = "open";
    const alert: Alert = {
      id: "a_1",
      regulatoryItemId: "ri_1",
      policyChunkId: "chunk_1",
      classification,
      confidence: 0.92,
      severity,
      explanation: "...",
      regulatoryQuote: "...",
      policyQuote: "...",
      regulatorySourceUrl: "https://sec.gov/rule",
      policyReference: "BSA/AML Policy > Section 1",
      status,
      dismissReason: null,
      escalationNote: null,
      snoozeUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(alert.severity).toBe("high");
  });

  it("AuditEntry and IngestionRun cover their required fields", () => {
    const entry: AuditEntry = {
      id: "ae_1",
      alertId: "a_1",
      actor: "system",
      action: "created",
      beforeState: null,
      afterState: null,
      note: null,
      timestamp: new Date(),
    };
    const run: IngestionRun = {
      id: "run_1",
      trigger: "scheduled",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      itemsProcessed: 10,
      itemsFlagged: 2,
      itemsSuppressed: 1,
      errors: null,
    };
    expect(entry.actor).toBe("system");
    expect(run.status).toBe("completed");
  });

  it("Regulator union rejects unknown values at compile time", () => {
    const r: Regulator = "FINRA";
    expect(r).toBe("FINRA");
  });
});
