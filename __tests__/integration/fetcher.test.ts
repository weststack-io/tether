import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  fetchUrl,
} from "@/lib/ingestion/fetcher";

const REAL_FETCH = global.fetch;

function mockResponse(
  body: string,
  init?: { status?: number; ok?: boolean; statusText?: string },
): Response {
  const status = init?.status ?? 200;
  const ok = init?.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    statusText: init?.statusText ?? (ok ? "OK" : "Error"),
    text: async () => body,
  } as Response;
}

describe("fetchUrl (INGEST-005)", () => {
  beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = REAL_FETCH;
    (console.warn as unknown as jest.Mock).mockClear();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("returns ok=true with the body when the underlying fetch succeeds", async () => {
    const fetchSpy = jest.fn(async () => mockResponse("hello world"));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchUrl("https://example.test/feed.xml");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe("hello world");
      expect(result.status).toBe(200);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends the default User-Agent and Accept headers", async () => {
    const fetchSpy = jest.fn(async () => mockResponse(""));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fetchUrl("https://example.test/");

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(DEFAULT_USER_AGENT);
    expect(headers.Accept).toMatch(/application\/rss\+xml/);
  });

  it("lets callers override the User-Agent and merge extra headers", async () => {
    const fetchSpy = jest.fn(async () => mockResponse(""));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fetchUrl("https://example.test/", {
      userAgent: "Override/1.0 contact@x.test",
      headers: { "X-Trace-Id": "abc123" },
    });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Override/1.0 contact@x.test");
    expect(headers["X-Trace-Id"]).toBe("abc123");
  });

  it("returns ok=false (does not throw) when the underlying fetch throws", async () => {
    global.fetch = (jest.fn(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:80");
    }) as unknown) as typeof fetch;

    const result = await fetchUrl("https://bad.example.test/feed.xml");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/bad\.example\.test/);
      expect(result.error).toMatch(/ECONNREFUSED/);
    }

    // Verify the warning carries the URL for context (per INGEST-005 step 4)
    const warnSpy = console.warn as unknown as jest.Mock;
    const warnings = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnings.some((w) => w.includes("bad.example.test"))).toBe(true);
  });

  it("returns ok=false on non-2xx HTTP responses with status info in the error", async () => {
    global.fetch = (jest.fn(async () =>
      mockResponse("<html>503</html>", {
        status: 503,
        ok: false,
        statusText: "Service Unavailable",
      }),
    ) as unknown) as typeof fetch;

    const result = await fetchUrl("https://example.test/feed.xml");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/503/);
      expect(result.error).toMatch(/Service Unavailable/);
      expect(result.error).toMatch(/example\.test/);
    }
  });

  it("returns ok=false on 404 with the URL embedded in the error message", async () => {
    global.fetch = (jest.fn(async () =>
      mockResponse("not found", {
        status: 404,
        ok: false,
        statusText: "Not Found",
      }),
    ) as unknown) as typeof fetch;

    const result = await fetchUrl("https://example.test/missing.xml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/404/);
      expect(result.error).toMatch(/missing\.xml/);
    }
  });

  it("aborts a hung request and returns a timeout error", async () => {
    global.fetch = (jest.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }
      });
    }) as unknown) as typeof fetch;

    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    const promise = fetchUrl("https://slow.example.test/", {
      timeoutMs: 50,
    });
    jest.advanceTimersByTime(60);
    jest.useRealTimers();

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timed out/i);
      expect(result.error).toMatch(/slow\.example\.test/);
      expect(result.error).toMatch(/50ms/);
    }
  });

  it("uses the default timeout when none is provided", async () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(10_000);

    global.fetch = (jest.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }
      });
    }) as unknown) as typeof fetch;

    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    const promise = fetchUrl("https://hung.example.test/");
    jest.advanceTimersByTime(DEFAULT_FETCH_TIMEOUT_MS + 1_000);
    jest.useRealTimers();

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/10000ms/);
    }
  });

  it("respects an externally supplied AbortSignal", async () => {
    global.fetch = (jest.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }
      });
    }) as unknown) as typeof fetch;

    const ctrl = new AbortController();
    const promise = fetchUrl("https://example.test/", { signal: ctrl.signal });
    ctrl.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
  });
});
