// INGLOG-002 verification harness.
//
// Seeds IngestionRun rows with various error blob shapes and asserts that the
// /ingestion page exposes error details for failed (and partial-failure) runs:
//   1. A failed run with a structured pipeline-shape blob renders an
//      ingestion-log-errors-row beneath its main row containing a <details>
//      disclosure with summary, top-level message, and per-error items.
//   2. A failed run with a legacy array-of-strings blob renders one
//      message-kind item per string.
//   3. A run with malformed JSON in errors falls through to the raw-blob
//      pre-formatted block.
//   4. A completed run with no errors does NOT get an errors row.
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const createdRunIds: string[] = [];

async function seedRun(seed: {
  trigger: "manual" | "scheduled";
  status: "completed" | "failed" | "running";
  startedAt: Date;
  itemsProcessed: number;
  itemsFlagged: number;
  itemsSuppressed: number;
  errors: string | null;
}): Promise<string> {
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: seed.trigger,
      status: seed.status,
      startedAt: seed.startedAt,
      completedAt: seed.status === "running" ? null : seed.startedAt,
      itemsProcessed: seed.itemsProcessed,
      itemsFlagged: seed.itemsFlagged,
      itemsSuppressed: seed.itemsSuppressed,
      errors: seed.errors,
    },
  });
  createdRunIds.push(run.id);
  return run.id;
}

async function fetchIngestionHtml(): Promise<string> {
  const res = await fetch("http://localhost:3000/ingestion", {
    cache: "no-store",
  });
  expect(res.status).toBe(200);
  return res.text();
}

function extractRow(html: string, runId: string): string | null {
  const re = new RegExp(
    `<tr[^>]*data-testid="ingestion-log-row"[^>]*data-run-id="${runId}"[^>]*>([\\s\\S]*?)</tr>`,
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

function extractErrorsRow(html: string, runId: string): string | null {
  const re = new RegExp(
    `<tr[^>]*data-testid="ingestion-log-errors-row"[^>]*data-run-id="${runId}"[^>]*>([\\s\\S]*?)</tr>`,
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

describe("INGLOG-002 ingestion log error details (live UI)", () => {
  let failedStructuredId = "";
  let failedArrayId = "";
  let failedRawId = "";
  let completedCleanId = "";

  beforeAll(async () => {
    // future-anchor so seeded rows render together at the top of the table
    const base = Date.now() + 365 * 24 * 60 * 60 * 1000;

    failedStructuredId = await seedRun({
      trigger: "scheduled",
      status: "failed",
      startedAt: new Date(base + 1_000),
      itemsProcessed: 0,
      itemsFlagged: 0,
      itemsSuppressed: 0,
      errors: JSON.stringify({
        topLevel: "inglog002 top-level pipeline failure",
        parserErrors: [
          { regulator: "SEC", error: "inglog002 SEC parser timed out" },
          { regulator: "FINRA", error: "inglog002 FINRA RSS 503" },
        ],
        driftErrors: [
          {
            regulatoryItemId: "inglog002-item-1",
            error: "inglog002 drift llm 401",
          },
        ],
      }),
    });

    failedArrayId = await seedRun({
      trigger: "manual",
      status: "failed",
      startedAt: new Date(base + 2_000),
      itemsProcessed: 0,
      itemsFlagged: 0,
      itemsSuppressed: 0,
      errors: JSON.stringify([
        "inglog002 array-shape error one",
        "inglog002 array-shape error two",
      ]),
    });

    failedRawId = await seedRun({
      trigger: "manual",
      status: "failed",
      startedAt: new Date(base + 3_000),
      itemsProcessed: 0,
      itemsFlagged: 0,
      itemsSuppressed: 0,
      errors: "inglog002 not-valid-json verbatim text",
    });

    completedCleanId = await seedRun({
      trigger: "scheduled",
      status: "completed",
      startedAt: new Date(base + 4_000),
      itemsProcessed: 7,
      itemsFlagged: 1,
      itemsSuppressed: 0,
      errors: null,
    });
  });

  afterAll(async () => {
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("renders a 'failed' status badge and an errors row for the structured failed run", async () => {
    const html = await fetchIngestionHtml();
    const row = extractRow(html, failedStructuredId);
    const errorsRow = extractErrorsRow(html, failedStructuredId);
    expect(row).not.toBeNull();
    expect(errorsRow).not.toBeNull();
    expect(row!).toMatch(/data-testid="ingestion-log-status"[^>]*data-status="failed"/);
    expect(row!).toMatch(/data-has-errors="true"/);
    expect(row!).toMatch(/bg-red-50/); // status badge is red

    expect(errorsRow!).toMatch(/data-testid="ingestion-log-errors-details"/);
    expect(errorsRow!).toMatch(/data-error-count="4"/); // topLevel + 2 parser + 1 drift
    expect(errorsRow!).toMatch(/View 4 errors/);
  });

  it("renders the topLevel message and per-error items with kind+context+message for the structured failed run", async () => {
    const html = await fetchIngestionHtml();
    const errorsRow = extractErrorsRow(html, failedStructuredId);
    expect(errorsRow).not.toBeNull();

    expect(errorsRow!).toMatch(
      /data-testid="ingestion-log-errors-toplevel"[^>]*>\s*inglog002 top-level pipeline failure\s*</,
    );

    // Two parser items, each kind=parser, with regulator context + message.
    const parserMatches = [
      ...errorsRow!.matchAll(
        /data-testid="ingestion-log-error-item"[^>]*data-error-kind="parser"[^>]*>([\s\S]*?)<\/li>/g,
      ),
    ];
    expect(parserMatches.length).toBe(2);
    const parserBodies = parserMatches.map((m) => m[1]);
    expect(parserBodies.some((b) => /SEC/.test(b) && /inglog002 SEC parser timed out/.test(b))).toBe(true);
    expect(parserBodies.some((b) => /FINRA/.test(b) && /inglog002 FINRA RSS 503/.test(b))).toBe(true);

    // One drift item with regulatoryItemId context + message.
    const driftMatches = [
      ...errorsRow!.matchAll(
        /data-testid="ingestion-log-error-item"[^>]*data-error-kind="drift"[^>]*>([\s\S]*?)<\/li>/g,
      ),
    ];
    expect(driftMatches.length).toBe(1);
    expect(driftMatches[0][1]).toMatch(/inglog002-item-1/);
    expect(driftMatches[0][1]).toMatch(/inglog002 drift llm 401/);
  });

  it("renders one message-kind item per element for an array-shaped error blob", async () => {
    const html = await fetchIngestionHtml();
    const errorsRow = extractErrorsRow(html, failedArrayId);
    expect(errorsRow).not.toBeNull();
    expect(errorsRow!).toMatch(/data-error-count="2"/);

    const messageMatches = [
      ...errorsRow!.matchAll(
        /data-testid="ingestion-log-error-item"[^>]*data-error-kind="message"[^>]*>([\s\S]*?)<\/li>/g,
      ),
    ];
    expect(messageMatches.length).toBe(2);
    expect(messageMatches[0][1]).toMatch(/inglog002 array-shape error one/);
    expect(messageMatches[1][1]).toMatch(/inglog002 array-shape error two/);

    // No parser/drift kinds and no topLevel block for an array-shaped blob.
    expect(errorsRow!).not.toMatch(/data-error-kind="parser"/);
    expect(errorsRow!).not.toMatch(/data-error-kind="drift"/);
    expect(errorsRow!).not.toMatch(/data-testid="ingestion-log-errors-toplevel"/);
  });

  it("falls through to a verbatim raw-text block when the errors blob is not valid JSON", async () => {
    const html = await fetchIngestionHtml();
    const errorsRow = extractErrorsRow(html, failedRawId);
    expect(errorsRow).not.toBeNull();
    expect(errorsRow!).toMatch(
      /data-testid="ingestion-log-errors-raw"[^>]*>[\s\S]*inglog002 not-valid-json verbatim text/,
    );
    expect(errorsRow!).not.toMatch(/data-testid="ingestion-log-error-item"/);
  });

  it("does NOT render an errors row for a completed run with no errors", async () => {
    const html = await fetchIngestionHtml();
    const row = extractRow(html, completedCleanId);
    expect(row).not.toBeNull();
    expect(row!).toMatch(/data-has-errors="false"/);
    expect(extractErrorsRow(html, completedCleanId)).toBeNull();
  });
});
