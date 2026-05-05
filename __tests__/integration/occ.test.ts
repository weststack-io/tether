import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { fetchLatest, OCC_RSS_URL } from "@/lib/ingestion/parsers/occ";

const REAL_FETCH = global.fetch;

const RSS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>OCC News Releases</title>
    <link>https://www.occ.gov/news-issuances/news-releases/</link>
    <description>Latest OCC news releases and bulletins</description>
    <item>
      <title><![CDATA[Live Item: OCC Issues BSA/AML Bulletin]]></title>
      <link>https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-3.html</link>
      <description><![CDATA[OCC reaffirms BSA and anti-money laundering supervisory priorities.]]></description>
      <pubDate>Wed, 12 Feb 2025 14:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Live Item: OCC Issues Third-Party Risk Bulletin</title>
      <link>https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-7.html</link>
      <description>Cloud service provider risk management expectations are clarified.</description>
      <pubDate>Wed, 19 Mar 2025 14:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

function mockResponse(body: string, init?: { status?: number; ok?: boolean }): Response {
  const status = init?.status ?? 200;
  const ok = init?.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => body,
  } as Response;
}

describe("occ.fetchLatest (INGEST-004)", () => {
  beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = REAL_FETCH;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("hits the OCC RSS URL and returns parsed items when the live fetch succeeds", async () => {
    const fetchSpy = jest.fn(async () => mockResponse(RSS_BODY));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const items = await fetchLatest();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(OCC_RSS_URL);
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Tether/);
    expect(headers["User-Agent"]).toMatch(/@/);

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.regulator).toBe("OCC");
      expect(item.sourceUrl).toMatch(/^https?:\/\//);
      expect(item.publicationDate).toBeInstanceOf(Date);
      expect(Number.isFinite(item.publicationDate.getTime())).toBe(true);
      expect(typeof item.documentType).toBe("string");
      expect(item.documentType.length).toBeGreaterThan(0);
      expect(typeof item.title).toBe("string");
      expect(item.title.length).toBeGreaterThan(0);
      expect(typeof item.fullText).toBe("string");
      expect(item.fullText.length).toBeGreaterThan(0);
    }
    expect(items[0].title).toBe("Live Item: OCC Issues BSA/AML Bulletin");
  });

  it("returns the cached fixture when the live fetch throws (network error)", async () => {
    global.fetch = (jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown) as typeof fetch;

    const items = await fetchLatest();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.regulator).toBe("OCC");
      expect(item.publicationDate).toBeInstanceOf(Date);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.fullText.length).toBeGreaterThan(0);
      expect(item.sourceUrl).toMatch(/^https:\/\/www\.occ\.gov\//);
    }
    const warnSpy = console.warn as unknown as jest.Mock;
    const warnings = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnings.some((w) => w.includes(OCC_RSS_URL))).toBe(true);
    expect(warnings.some((w) => w.includes("ECONNREFUSED"))).toBe(true);
  });

  it("returns the cached fixture when the live fetch returns a non-OK HTTP status", async () => {
    global.fetch = (jest.fn(async () =>
      mockResponse("<html>503 Service Unavailable</html>", { status: 503, ok: false }),
    ) as unknown) as typeof fetch;

    const items = await fetchLatest();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.regulator).toBe("OCC");
    }
  });

  it("returns the cached fixture when the live fetch returns 0 parseable items", async () => {
    global.fetch = (jest.fn(async () => mockResponse("<rss><channel></channel></rss>")) as unknown) as typeof fetch;

    const items = await fetchLatest();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.regulator).toBe("OCC");
    }
  });

  it("aborts a hung fetch and falls back to cache (timeout path)", async () => {
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
    const promise = fetchLatest();
    jest.advanceTimersByTime(11_000);
    jest.useRealTimers();

    const items = await promise;
    expect(items.length).toBeGreaterThan(0);
  });
});
