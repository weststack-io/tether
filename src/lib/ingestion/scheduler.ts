// Ingestion scheduler (stub)
//
// The MVP does NOT implement automatic scheduled ingestion. Ingestion is
// triggered exclusively via the dashboard button or direct API call to
// POST /api/ingestion/trigger.
//
// In production, an external scheduler (e.g., Azure Functions timer trigger,
// OS cron, or similar) would call the trigger endpoint on a 6-hour interval.
// No in-process setInterval or background polling should be implemented.

export function scheduleIngestion(): void {
  // No-op in MVP — see comment above
}
