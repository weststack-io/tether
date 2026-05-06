// API-011: POST /api/ingestion/trigger
//
// Verifies the route's contract end-to-end:
//   1. responds 200 with { runId: <string>, status: "started" } synchronously
//   2. creates an IngestionRun row with trigger='manual', status='running'
//      *before* it returns (so the runId in the response is queryable)
//   3. delegates the rest of the pipeline to runIngestion as a
//      fire-and-forget (passing the route-created runId), so the orchestrator
//      can drive the row to completion/failure without blocking the response
//   4. the run eventually reaches a terminal state (completed | failed),
//      not stuck in 'running'
//
// runIngestion is mocked so the route is exercised in isolation -- the real
// orchestrator (parsers + drift detector + LLM) is covered by pipeline.test.ts
// and pipeline-isolation.test.ts. Mocking here keeps the suite hermetic and
// fast, and lets us pin the orchestrator's behaviour to the cases the route
// itself must survive (slow run, fast completion, top-level throw).

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type {
  IngestionRunResult,
  RunIngestionOptions,
} from "@/lib/ingestion/pipeline";

const mockRunIngestion = jest.fn<
  (options?: RunIngestionOptions) => Promise<IngestionRunResult>
>();

jest.unstable_mockModule("@/lib/ingestion/pipeline", () => ({
  runIngestion: mockRunIngestion,
}));

const { POST } = await import("@/app/api/ingestion/trigger/route");
const { prisma } = await import("@/lib/db");

const createdRunIds: string[] = [];

async function postTrigger(body?: unknown): Promise<{
  status: number;
  body: { runId?: string; status?: string; error?: string };
}> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const req = new Request(
    "http://localhost/api/ingestion/trigger",
    init,
  );
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

async function waitForTerminalStatus(
  runId: string,
  timeoutMs = 2000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await prisma.ingestionRun.findUnique({ where: { id: runId } });
    if (r && (r.status === "completed" || r.status === "failed")) {
      return r.status;
    }
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(
    `IngestionRun ${runId} did not reach terminal state within ${timeoutMs}ms`,
  );
}

function makeFastCompletionMock() {
  return async (options?: RunIngestionOptions): Promise<IngestionRunResult> => {
    const id = options?.runId;
    if (!id) throw new Error("runId not propagated to runIngestion");
    await prisma.ingestionRun.update({
      where: { id },
      data: {
        status: "completed",
        completedAt: new Date(),
        itemsProcessed: 0,
      },
    });
    return {
      runId: id,
      status: "completed",
      itemsProcessed: 0,
      itemsFlagged: 0,
      itemsSuppressed: 0,
      duplicatesSkipped: 0,
      parserErrors: [],
      driftErrors: [],
    };
  };
}

describe("POST /api/ingestion/trigger (API-011)", () => {
  beforeAll(() => {
    // The fire-and-forget catch logs to console.error on orchestrator throw;
    // silence it so a deliberately-throwing mock doesn't pollute test output.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  beforeEach(() => {
    mockRunIngestion.mockReset();
  });

  afterAll(async () => {
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  it("returns runId + status='started' and creates an IngestionRun with trigger='manual', status='running'", async () => {
    // Defer the orchestrator's terminal-state work so we can observe the
    // 'running' state in the DB before the mock resolves.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockRunIngestion.mockImplementation(
      async (options?: RunIngestionOptions) => {
        const id = options?.runId;
        if (!id) throw new Error("runId not propagated to runIngestion");
        await gate;
        await prisma.ingestionRun.update({
          where: { id },
          data: {
            status: "completed",
            completedAt: new Date(),
            itemsProcessed: 0,
          },
        });
        return {
          runId: id,
          status: "completed",
          itemsProcessed: 0,
          itemsFlagged: 0,
          itemsSuppressed: 0,
          duplicatesSkipped: 0,
          parserErrors: [],
          driftErrors: [],
        };
      },
    );

    const { status, body } = await postTrigger();

    expect(status).toBe(200);
    expect(typeof body.runId).toBe("string");
    expect(body.runId).not.toBe("");
    expect(body.status).toBe("started");

    const runId = body.runId as string;
    createdRunIds.push(runId);

    // Row exists, mid-run, with the documented seed values.
    const beforeFinish = await prisma.ingestionRun.findUnique({
      where: { id: runId },
    });
    expect(beforeFinish).not.toBeNull();
    expect(beforeFinish?.trigger).toBe("manual");
    expect(beforeFinish?.status).toBe("running");
    expect(beforeFinish?.completedAt).toBeNull();

    // The route called runIngestion with that exact runId.
    expect(mockRunIngestion).toHaveBeenCalledTimes(1);
    const call = mockRunIngestion.mock.calls[0]?.[0];
    expect(call?.runId).toBe(runId);
    expect(call?.trigger).toBe("manual");

    // Release the orchestrator and confirm it transitions the run.
    release();
    const final = await waitForTerminalStatus(runId);
    expect(final).toBe("completed");
  });

  it("kicks off ingestion that eventually reaches a terminal 'completed' state (not stuck)", async () => {
    mockRunIngestion.mockImplementation(makeFastCompletionMock());

    const { status, body } = await postTrigger();
    expect(status).toBe(200);
    expect(body.status).toBe("started");

    const runId = body.runId as string;
    createdRunIds.push(runId);

    const final = await waitForTerminalStatus(runId);
    expect(final).toBe("completed");

    const finalRow = await prisma.ingestionRun.findUnique({
      where: { id: runId },
    });
    expect(finalRow?.status).toBe("completed");
    expect(finalRow?.completedAt).not.toBeNull();
  });

  it("transitions to 'failed' when the orchestrator throws (route's fire-and-forget catch swallows the rejection)", async () => {
    mockRunIngestion.mockImplementation(
      async (options?: RunIngestionOptions) => {
        const id = options?.runId;
        if (!id) throw new Error("runId not propagated");
        await prisma.ingestionRun.update({
          where: { id },
          data: {
            status: "failed",
            completedAt: new Date(),
            errors: JSON.stringify({ topLevel: "boom" }),
          },
        });
        throw new Error("boom");
      },
    );

    const { status, body } = await postTrigger();
    // The HTTP response is still 200 / "started" -- the route doesn't await
    // the orchestrator, so an orchestrator throw cannot reach the caller.
    expect(status).toBe(200);
    expect(body.status).toBe("started");

    const runId = body.runId as string;
    createdRunIds.push(runId);

    const final = await waitForTerminalStatus(runId);
    expect(final).toBe("failed");
  });

  it("accepts an empty body (no JSON) and treats it as the no-URL case", async () => {
    mockRunIngestion.mockImplementation(makeFastCompletionMock());

    // Note: postTrigger() with body=undefined sends a POST with no
    // Content-Type and no body, exercising the route's empty-body branch.
    const { status, body } = await postTrigger();

    expect(status).toBe(200);
    expect(body.status).toBe("started");
    const runId = body.runId as string;
    createdRunIds.push(runId);
    expect(mockRunIngestion).toHaveBeenCalledTimes(1);
    await waitForTerminalStatus(runId);
  });

  it("accepts a JSON body without a url field (the API-011 happy path)", async () => {
    mockRunIngestion.mockImplementation(makeFastCompletionMock());

    const { status, body } = await postTrigger({});

    expect(status).toBe(200);
    expect(body.status).toBe("started");
    const runId = body.runId as string;
    createdRunIds.push(runId);
    await waitForTerminalStatus(runId);
  });

  it("returns 400 on invalid JSON body and does not create an IngestionRun", async () => {
    mockRunIngestion.mockImplementation(makeFastCompletionMock());

    const beforeCount = await prisma.ingestionRun.count();

    const { status, body } = await postTrigger("{not valid json");

    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(body.error?.toLowerCase()).toContain("json");

    // No row was created and the orchestrator was not invoked.
    expect(mockRunIngestion).not.toHaveBeenCalled();
    const afterCount = await prisma.ingestionRun.count();
    expect(afterCount).toBe(beforeCount);
  });
});
