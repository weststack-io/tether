// API-012: POST /api/ingestion/trigger with { url } -- route-layer contract.
//
// Verifies the route validates and propagates `url`:
//   * a parseable URL is forwarded to runIngestion alongside the runId
//   * non-string url -> 400, no row created, orchestrator not invoked
//   * non-URL url    -> 400, no row created, orchestrator not invoked
//   * empty-string url is treated as "no url" (full-crawl path stays usable)
//
// runIngestion is mocked so the route is exercised in isolation. The
// pipeline's single-URL branch is covered separately in
// pipeline-single-url.test.ts.

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

const SEC_URL = "https://www.sec.gov/news/press-release/2026-api012-test";
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
  const req = new Request("http://localhost/api/ingestion/trigger", init);
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

function makeFastCompletionMock() {
  return async (options?: RunIngestionOptions): Promise<IngestionRunResult> => {
    const id = options?.runId;
    if (!id) throw new Error("runId not propagated to runIngestion");
    await prisma.ingestionRun.update({
      where: { id },
      data: { status: "completed", completedAt: new Date(), itemsProcessed: 0 },
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

describe("POST /api/ingestion/trigger with { url } (API-012, route layer)", () => {
  beforeAll(() => {
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

  it("forwards a valid URL to runIngestion alongside the runId", async () => {
    mockRunIngestion.mockImplementation(makeFastCompletionMock());

    const { status, body } = await postTrigger({ url: SEC_URL });

    expect(status).toBe(200);
    expect(body.status).toBe("started");
    expect(typeof body.runId).toBe("string");
    const runId = body.runId as string;
    createdRunIds.push(runId);

    expect(mockRunIngestion).toHaveBeenCalledTimes(1);
    const call = mockRunIngestion.mock.calls[0]?.[0];
    expect(call?.runId).toBe(runId);
    expect(call?.trigger).toBe("manual");
    expect(call?.url).toBe(SEC_URL);

    await waitForTerminalStatus(runId);
  });

  it("returns 400 when url is not a string", async () => {
    const beforeCount = await prisma.ingestionRun.count();
    const { status, body } = await postTrigger({ url: 12345 });

    expect(status).toBe(400);
    expect(body.error?.toLowerCase()).toContain("url");
    expect(mockRunIngestion).not.toHaveBeenCalled();
    expect(await prisma.ingestionRun.count()).toBe(beforeCount);
  });

  it("returns 400 when url is not a valid URL", async () => {
    const beforeCount = await prisma.ingestionRun.count();
    const { status, body } = await postTrigger({ url: "not a url" });

    expect(status).toBe(400);
    expect(body.error?.toLowerCase()).toContain("url");
    expect(mockRunIngestion).not.toHaveBeenCalled();
    expect(await prisma.ingestionRun.count()).toBe(beforeCount);
  });

  it("treats an empty-string url as the no-URL path (full crawl)", async () => {
    mockRunIngestion.mockImplementation(makeFastCompletionMock());

    const { status, body } = await postTrigger({ url: "" });

    expect(status).toBe(200);
    expect(body.status).toBe("started");
    const runId = body.runId as string;
    createdRunIds.push(runId);

    expect(mockRunIngestion).toHaveBeenCalledTimes(1);
    const call = mockRunIngestion.mock.calls[0]?.[0];
    expect(call?.url).toBeUndefined();
    await waitForTerminalStatus(runId);
  });
});
