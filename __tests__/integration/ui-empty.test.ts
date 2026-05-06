// UI-002 verification harness (filter-driven half).
//
// The alerts list distinguishes between "no alerts at all" and "no alerts
// match the active filter". The active-filter branch is reachable purely from
// the URL — passing a date range that excludes every seeded alert — so we
// verify it against the live dev server without touching the dev DB.
//
// The "no runs in the database" branch for the ingestion log is covered by a
// separate unit test (see __tests__/unit/ingestion-empty.test.tsx) because it
// requires zero IngestionRun rows; verifying it against the live shared dev
// server would require destroying seeded data.

import { describe, expect, it } from "@jest/globals";

async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`http://localhost:3000${path}`, {
    cache: "no-store",
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe("UI-002 alerts list empty state (zero-match filter)", () => {
  it("renders the active-filter empty-state copy when no alerts match", async () => {
    const html = await fetchHtml(
      "/alerts?dateFrom=1900-01-01&dateTo=1900-01-02",
    );
    expect(html).toContain('data-testid="alerts-empty"');
    expect(html).toContain("No alerts match the current filter.");
    expect(html).not.toContain('data-testid="alerts-table"');
  });
});
