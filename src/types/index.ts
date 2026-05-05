export type Regulator = "SEC" | "FINRA" | "CFPB" | "OCC";

export type DriftClassification =
  | "aligned"
  | "drifted"
  | "contradicted"
  | "ambiguous"
  | "no_material_impact";

export type Severity = "high" | "medium" | "low";

export type AlertStatus =
  | "open"
  | "accepted"
  | "dismissed"
  | "escalated"
  | "snoozed";

export type AlertAction = "accept" | "dismiss" | "escalate" | "snooze";

export type DismissReason =
  | "false_positive"
  | "already_addressed"
  | "not_applicable"
  | "duplicate"
  | "accepted_risk"
  | "other";

export type DocumentType =
  | "final_rule"
  | "proposed_rule"
  | "enforcement"
  | "bulletin"
  | "notice"
  | "guidance"
  | "letter";

export type PolicyDomain =
  | "bsa_aml"
  | "complaint_handling"
  | "fair_lending"
  | "reg_e"
  | "reg_z"
  | "vendor_management"
  | "info_security"
  | "cip"
  | "overdraft"
  | "marketing";

export type IngestionTrigger = "scheduled" | "manual";

export type IngestionStatus = "running" | "completed" | "failed";

export type AuditActor = "system" | "reviewer";

export type AuditAction =
  | "created"
  | "accepted"
  | "dismissed"
  | "escalated"
  | "snoozed"
  | "reopened";

export interface RegulatoryItem {
  id: string;
  sourceUrl: string;
  regulator: Regulator;
  publicationDate: Date;
  documentType: DocumentType;
  title: string;
  fullText: string;
  summary: string | null;
  isRelevant: boolean | null;
  ingestionRunId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyDocument {
  id: string;
  title: string;
  domain: PolicyDomain;
  fullText: string;
  version: string;
  isSynthetic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyChunk {
  id: string;
  policyDocumentId: string;
  sectionHeading: string;
  content: string;
  chunkIndex: number;
  embedding: string | null;
  createdAt: Date;
}

export interface Alert {
  id: string;
  regulatoryItemId: string;
  policyChunkId: string;
  classification: DriftClassification;
  confidence: number;
  severity: Severity;
  explanation: string;
  regulatoryQuote: string;
  policyQuote: string;
  regulatorySourceUrl: string;
  policyReference: string;
  status: AlertStatus;
  dismissReason: DismissReason | null;
  escalationNote: string | null;
  snoozeUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEntry {
  id: string;
  alertId: string | null;
  actor: AuditActor;
  action: AuditAction;
  beforeState: string | null;
  afterState: string | null;
  note: string | null;
  timestamp: Date;
}

export interface IngestionRun {
  id: string;
  trigger: IngestionTrigger;
  status: IngestionStatus;
  startedAt: Date;
  completedAt: Date | null;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
  errors: string | null;
}
