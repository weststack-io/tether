import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_ACCEPT,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
} from "@/lib/ingestion/fetcher";

describe("fetcher constants (INGEST-005)", () => {
  it("ships sane defaults that the parsers can rely on", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(10_000);
    // SEC's developer guidelines require a contact-bearing User-Agent; keep
    // the format identifying the app + a contact mailbox even though only
    // the SEC strictly checks. All four parsers reuse this string verbatim
    // unless they override.
    expect(DEFAULT_USER_AGENT).toMatch(/Tether/);
    expect(DEFAULT_USER_AGENT).toMatch(/@/);
    // Default Accept must advertise RSS preference but not be so strict that
    // CDNs which strip the content-type negotiate their way to a 406.
    expect(DEFAULT_ACCEPT).toMatch(/application\/rss\+xml/);
    expect(DEFAULT_ACCEPT).toMatch(/\*\/\*/);
  });
});
