// Single-URL ingestion fetcher (API-012).
//
// When the trigger route receives `{ url: <regulator publication URL> }`,
// the orchestrator skips the regulator-wide RSS fan-out and instead pulls
// just that one document. This module is the worker that does the fetch +
// HTML-to-RawRegulatoryItem conversion.
//
// Design notes:
//   * Regulator is derived from the URL hostname, mapping the four supported
//     regulators (SEC / FINRA / CFPB / OCC). Unknown hosts default to "SEC"
//     with a warning -- the spec only mandates SEC publication URLs as the
//     verification target, so a permissive default keeps the demo usable
//     without the route having to refuse arbitrary URLs.
//   * HTML is parsed via tag-extracting regexes, the same approach the
//     SEC RSS parser uses (no jsdom/cheerio dependency). We pull
//     <title>, the first <h1> as a fallback, and strip the rest to plain
//     text for the fullText field.
//   * Returns null on fetch failure so the orchestrator can finalize the
//     run as 'failed' without throwing -- mirrors the parser fan-out's
//     graceful-failure contract.

import { fetchUrl } from "@/lib/ingestion/fetcher";
import type { RawRegulatoryItem, Regulator } from "@/types";

export const SINGLE_URL_FETCH_TIMEOUT_MS = 10_000;

const REGULATOR_HOSTS: Array<{ pattern: RegExp; regulator: Regulator }> = [
  { pattern: /(?:^|\.)sec\.gov$/i, regulator: "SEC" },
  { pattern: /(?:^|\.)finra\.org$/i, regulator: "FINRA" },
  { pattern: /(?:^|\.)consumerfinance\.gov$/i, regulator: "CFPB" },
  { pattern: /(?:^|\.)occ\.(?:gov|treas\.gov)$/i, regulator: "OCC" },
];

export function detectRegulator(url: string): Regulator {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "SEC";
  }
  for (const { pattern, regulator } of REGULATOR_HOSTS) {
    if (pattern.test(host)) return regulator;
  }
  console.warn(
    `[single-url.detectRegulator] hostname '${host}' did not match a known regulator; defaulting to SEC`,
  );
  return "SEC";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractFirstTag(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]).trim() : "";
}

// Drop <script> / <style> blocks before stripping tags so their bodies
// don't pollute the extracted fullText.
function stripBoilerplate(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
}

export function extractTitleAndText(html: string): {
  title: string;
  fullText: string;
} {
  const cleaned = stripBoilerplate(html);
  const titleTag = extractFirstTag(cleaned, "title");
  const h1 = extractFirstTag(cleaned, "h1");
  const title = (titleTag || h1 || "").replace(/\s+/g, " ").trim();
  const text = decodeEntities(cleaned.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return { title, fullText: text };
}

export async function fetchSingleRegulatoryItem(
  url: string,
): Promise<RawRegulatoryItem | null> {
  const result = await fetchUrl(url, { timeoutMs: SINGLE_URL_FETCH_TIMEOUT_MS });
  if (!result.ok) {
    console.warn(
      `[single-url.fetchSingleRegulatoryItem] fetch failed for ${url}: ${result.error}`,
    );
    return null;
  }
  const { title, fullText } = extractTitleAndText(result.body);
  if (!title && !fullText) {
    console.warn(
      `[single-url.fetchSingleRegulatoryItem] no parseable content extracted from ${url}`,
    );
    return null;
  }
  return {
    sourceUrl: url,
    regulator: detectRegulator(url),
    publicationDate: new Date(),
    documentType: "publication",
    title: title || url,
    fullText: fullText || title || url,
  };
}
