// Shared HTTP fetcher used by every regulator parser (SEC / FINRA / CFPB /
// OCC) and any future ingestion source. Replaces four byte-identical
// `fetchRss` helpers that lived inline in each parser.
//
// Design (per app_spec §6 and §12 "Ingestion errors"):
//   * Returns a discriminated result, never throws. The four sources run as a
//     batch; one bad host must not abort the others.
//   * Caller-controllable timeout via AbortController; defaults to 10s
//     (matches the original per-parser constants).
//   * Default User-Agent identifies the demo + carries a contact mailbox per
//     SEC's developer guidelines (https://www.sec.gov/os/accessing-edgar-data).
//     Other regulators don't require it but accept it; using one UA across
//     all four keeps the parser code uniform.
//   * Default Accept header advertises RSS/XML preference but tolerates
//     anything (FINRA serves RSS as application/rss+xml; CFPB as
//     application/xml; OCC as text/xml; some CDNs strip the type entirely).
//   * Logs failures with the URL embedded so the caller doesn't have to
//     reconstruct context from a bare `error` field.

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_USER_AGENT = "Tether Compliance Demo dev@tether.local";
export const DEFAULT_ACCEPT =
  "application/rss+xml, application/xml;q=0.9, */*;q=0.5";

export type FetchSuccess = { ok: true; body: string; status: number };
export type FetchFailure = { ok: false; error: string };
export type FetchResult = FetchSuccess | FetchFailure;

export interface FetchUrlOptions {
  timeoutMs?: number;
  userAgent?: string;
  accept?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function fetchUrl(
  url: string,
  opts: FetchUrlOptions = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // If the caller passed their own signal, abort our controller when theirs
  // fires too (otherwise external cancellation wouldn't propagate).
  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
        Accept: opts.accept ?? DEFAULT_ACCEPT,
        ...(opts.headers ?? {}),
      },
    });
    if (!res.ok) {
      const error = `HTTP ${res.status} ${res.statusText} for ${url}`;
      console.warn(`[fetcher.fetchUrl] ${error}`);
      return { ok: false, error };
    }
    const body = await res.text();
    return { ok: true, body, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name: unknown }).name)
        : "";
    // AbortError can arrive as either an Error subclass (from undici) or a
    // DOMException (which doesn't always pass `instanceof Error`); inspect
    // the name + message either way so callers see a proper timeout message.
    const isTimeout = name === "AbortError" || /aborted/i.test(message);
    const error = isTimeout
      ? `request timed out after ${timeoutMs}ms for ${url}`
      : `fetch failed for ${url}: ${message}`;
    console.warn(`[fetcher.fetchUrl] ${error}`);
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onExternalAbort);
  }
}
