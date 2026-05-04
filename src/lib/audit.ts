// Audit log helper
// Creates AuditEntry records for all state changes on alerts.

export async function createAuditEntry(_params: {
  alertId: string;
  actor: "system" | "reviewer";
  action: string;
  beforeState?: string;
  afterState?: string;
  note?: string;
}): Promise<void> {
  throw new Error("Not implemented");
}
