// UI-002 verification harness — ingestion log half.
//
// The ingestion log page exposes a distinct empty-state branch when there are
// zero IngestionRun rows in the database. Verifying that branch against the
// shared dev DB would mean destroying seeded data, so instead we mock the
// prisma module to return an empty result set and render the server component
// in isolation. Mirrors the existing `unstable_mockModule` pattern used in the
// classifier integration tests.

import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.unstable_mockModule("@/lib/db", () => {
  const findMany = jest.fn(async () => [] as unknown[]);
  const stub = {
    ingestionRun: { findMany },
  };
  return {
    __esModule: true,
    default: stub,
    prisma: stub,
  };
});

const { default: IngestionLogPage } = await import("@/app/ingestion/page");

describe("UI-002 ingestion log empty state", () => {
  it("renders the empty-state copy when no ingestion runs exist", async () => {
    const tree = await IngestionLogPage();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-testid="ingestion-log-empty"');
    expect(html).toContain("No ingestion runs yet.");
    expect(html).not.toContain('data-testid="ingestion-log-table"');
  });
});
