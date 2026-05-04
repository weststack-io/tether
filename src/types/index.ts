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

export type IngestionTrigger = "scheduled" | "manual";
