// DASH-002 verification harness.
//
// Verifies the dashboard renders the "Trigger Ingestion" button and that the
// API surfaces the button depends on (POST /api/ingestion/trigger -> 200 with
// runId/status, then GET /api/ingestion/log surfacing that runId for the
// polling-for-completion flow) behave correctly end-to-end. The actual
// click->loading->toast UI flow is verified via Playwright in this session
// and screenshot-captured for the spec; this test locks in the static markup
// and the API contract the client component relies on.

import {
  afterAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "dash002-verify";
const createdRunIds: string[] = [];

async function fetchDashboardHtml(): Promise<string> {
  const res = await fetch("http://localhost:3000/", { cache: "no-store" });
  expect(res.status).toBe(200);
  return res.text();
}

describe("DASH-002 dashboard 'Trigger Ingestion' button (live UI)", () => {
  afterAll(async () => {
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("renders a Trigger Ingestion button on the dashboard", async () => {
    const html = await fetchDashboardHtml();
    expect(html).toMatch(/data-testid="trigger-ingestion-button"/);
    expect(html).toMatch(/Trigger Ingestion/);
    // The button starts in the non-pending state on first render.
    expect(html).toMatch(
      /data-testid="trigger-ingestion-button"[^>]*data-pending="false"/,
    );
  });

  it("mounts the Sonner Toaster region so toast notifications can appear", async () => {
    const html = await fetchDashboardHtml();
    // sonner renders an element with class "toaster" / a section[aria-label=Notifications]
    // depending on version. We look for either the className or the aria-label.
    const hasToaster =
      /class="[^"]*toaster[^"]*"/.test(html) ||
      /aria-label="Notifications/i.test(html);
    expect(hasToaster).toBe(true);
  });

  it("trigger endpoint returns runId/status and the run appears in the ingestion log", async () => {
    // This is the contract the button relies on at runtime: POST returns
    // { runId, status: "started" }, then the client polls GET /api/ingestion/log
    // until the run is no longer in 'running' state.
    const triggerRes = await fetch("http://localhost:3000/api/ingestion/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(triggerRes.status).toBe(200);
    const triggerBody = (await triggerRes.json()) as {
      runId?: string;
      status?: string;
    };
    expect(typeof triggerBody.runId).toBe("string");
    expect(triggerBody.status).toBe("started");
    const runId = triggerBody.runId!;
    createdRunIds.push(runId);

    // The run should be visible in /api/ingestion/log immediately (it was
    // created synchronously before the orchestrator was kicked off).
    const logRes = await fetch(
      "http://localhost:3000/api/ingestion/log?pageSize=50",
      { cache: "no-store" },
    );
    expect(logRes.status).toBe(200);
    const logBody = (await logRes.json()) as {
      runs: Array<{ id: string; status: string }>;
    };
    const found = logBody.runs.find((r) => r.id === runId);
    expect(found).toBeDefined();
    expect(["running", "completed", "failed"]).toContain(found!.status);

    // Mark TAG so cleanup logs are explicit (no hard side effects beyond
    // the IngestionRun row, which afterAll deletes).
    expect(TAG).toBe("dash002-verify");
  });
});
