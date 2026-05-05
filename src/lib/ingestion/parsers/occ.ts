// OCC bulletins / news-release parser.
//
// Fetches the OCC's news-release RSS feed, parses each <item> into a
// RawRegulatoryItem, and returns the list. On any failure (network, HTTP,
// XML, date) we log and fall back to a pre-downloaded local cache at
// data/regulatory/occ/cache.json so the demo pipeline still has data to
// chew on in offline / CI sandboxes (per app_spec §6).
//
// Structurally identical to sec.ts, finra.ts, and cfpb.ts; HTTP transport
// is delegated to `@/lib/ingestion/fetcher` (INGEST-005).

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { fetchUrl } from "@/lib/ingestion/fetcher";
import type { RawRegulatoryItem } from "@/types";

export const OCC_RSS_URL = "https://www.occ.gov/rss/occ_news_releases.xml";
export const OCC_FETCH_TIMEOUT_MS = 10_000;

const CACHE_PATH = resolve(process.cwd(), "data/regulatory/occ/cache.json");

export interface OccRssItem {
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

export function parseOccRss(xml: string): OccRssItem[] {
  const items: OccRssItem[] = [];
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

export function rssItemToRaw(item: OccRssItem): RawRegulatoryItem | null {
  if (!item.link || !item.title || !item.pubDate) return null;
  const date = new Date(item.pubDate);
  if (Number.isNaN(date.getTime())) return null;
  const fullText = stripHtml(item.description) || item.title;
  return {
    sourceUrl: item.link,
    regulator: "OCC",
    publicationDate: date,
    documentType: "bulletin",
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
  const result = await fetchUrl(OCC_RSS_URL, {
    timeoutMs: OCC_FETCH_TIMEOUT_MS,
  });
  if (result.ok) {
    const items = parseOccRss(result.body)
      .map(rssItemToRaw)
      .filter((x): x is RawRegulatoryItem => x !== null);
    if (items.length > 0) return items;
    console.warn(
      `[occ.fetchLatest] live fetch ${OCC_RSS_URL} returned 0 parseable items, falling back to cache`,
    );
  } else {
    console.warn(
      `[occ.fetchLatest] live fetch ${OCC_RSS_URL} failed (${result.error}); falling back to cache`,
    );
  }
  try {
    return await loadCache();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[occ.fetchLatest] cache load ${CACHE_PATH} failed (${message}); returning empty list`,
    );
    return [];
  }
}
