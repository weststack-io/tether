// SEC RSS and document parser.
//
// Fetches the SEC's public press-releases RSS feed, parses each <item> into a
// RawRegulatoryItem, and returns the list. On any failure (network, HTTP,
// XML, date) we log and fall back to a pre-downloaded local cache at
// data/regulatory/sec/cache.json so the demo pipeline still has data to chew
// on in offline / CI sandboxes (per app_spec §6).
//
// The parser is intentionally regex-based -- the project has no XML library
// dep, and the SEC RSS shape is stable enough that a tag-extractor handles it
// without pulling in jsdom/cheerio for one feed.
//
// HTTP transport (timeout / User-Agent / non-2xx -> failure result) is
// delegated to `@/lib/ingestion/fetcher` (INGEST-005); see that module for
// the rationale on the shared User-Agent + Accept header.

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { fetchUrl } from "@/lib/ingestion/fetcher";
import type { RawRegulatoryItem } from "@/types";

export const SEC_RSS_URL = "https://www.sec.gov/news/pressreleases.rss";
export const SEC_FETCH_TIMEOUT_MS = 10_000;

const CACHE_PATH = resolve(process.cwd(), "data/regulatory/sec/cache.json");

export interface SecRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

const ITEM_BLOCK_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

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

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(block: string, tag: string): string {
  const cdataRe = new RegExp(
    `<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    "i",
  );
  const cdata = block.match(cdataRe);
  if (cdata) return cdata[1].trim();
  const plainRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const plain = block.match(plainRe);
  return plain ? decodeEntities(plain[1].trim()) : "";
}

export function parseSecRss(xml: string): SecRssItem[] {
  const items: SecRssItem[] = [];
  for (const match of xml.matchAll(ITEM_BLOCK_RE)) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      description: extractTag(block, "description"),
      pubDate: extractTag(block, "pubDate"),
    });
  }
  return items;
}

export function rssItemToRaw(item: SecRssItem): RawRegulatoryItem | null {
  if (!item.link || !item.title || !item.pubDate) return null;
  const date = new Date(item.pubDate);
  if (Number.isNaN(date.getTime())) return null;
  const fullText = stripHtml(item.description) || item.title;
  return {
    sourceUrl: item.link,
    regulator: "SEC",
    publicationDate: date,
    documentType: "press_release",
    title: stripHtml(item.title),
    fullText,
  };
}

async function loadCache(): Promise<RawRegulatoryItem[]> {
  const text = await fs.readFile(CACHE_PATH, "utf-8");
  const parsed = JSON.parse(text) as Array<Omit<RawRegulatoryItem, "publicationDate"> & { publicationDate: string }>;
  return parsed.map((it) => ({
    ...it,
    publicationDate: new Date(it.publicationDate),
  }));
}

export async function fetchLatest(): Promise<RawRegulatoryItem[]> {
  const result = await fetchUrl(SEC_RSS_URL, {
    timeoutMs: SEC_FETCH_TIMEOUT_MS,
  });
  if (result.ok) {
    const items = parseSecRss(result.body)
      .map(rssItemToRaw)
      .filter((x): x is RawRegulatoryItem => x !== null);
    if (items.length > 0) return items;
    console.warn(
      `[sec.fetchLatest] live fetch ${SEC_RSS_URL} returned 0 parseable items, falling back to cache`,
    );
  } else {
    console.warn(
      `[sec.fetchLatest] live fetch ${SEC_RSS_URL} failed (${result.error}); falling back to cache`,
    );
  }
  try {
    return await loadCache();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[sec.fetchLatest] cache load ${CACHE_PATH} failed (${message}); returning empty list`,
    );
    return [];
  }
}
