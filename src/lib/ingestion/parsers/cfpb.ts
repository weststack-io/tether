// CFPB publications parser.
//
// Fetches the CFPB newsroom RSS feed, parses each <item> into a
// RawRegulatoryItem, and returns the list. On any failure (network, HTTP,
// XML, date) we log and fall back to a pre-downloaded local cache at
// data/regulatory/cfpb/cache.json so the demo pipeline still has data to
// chew on in offline / CI sandboxes (per app_spec §6).
//
// Structurally identical to sec.ts and finra.ts -- when INGEST-005 (shared
// HTTP fetcher utility) lands, the per-parser fetchRss helpers should be
// replaced by a single shared fetcher; this is the third caller and the
// natural promotion trigger per the established threshold rule.

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import type { RawRegulatoryItem } from "@/types";

export const CFPB_RSS_URL = "https://www.consumerfinance.gov/about-us/newsroom/feed/";
export const CFPB_FETCH_TIMEOUT_MS = 10_000;
const CFPB_USER_AGENT = "Tether Compliance Demo dev@tether.local";

const CACHE_PATH = resolve(process.cwd(), "data/regulatory/cfpb/cache.json");

export interface CfpbRssItem {
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

export function parseCfpbRss(xml: string): CfpbRssItem[] {
  const items: CfpbRssItem[] = [];
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

export function rssItemToRaw(item: CfpbRssItem): RawRegulatoryItem | null {
  if (!item.link || !item.title || !item.pubDate) return null;
  const date = new Date(item.pubDate);
  if (Number.isNaN(date.getTime())) return null;
  const fullText = stripHtml(item.description) || item.title;
  return {
    sourceUrl: item.link,
    regulator: "CFPB",
    publicationDate: date,
    documentType: "publication",
    title: stripHtml(item.title),
    fullText,
  };
}

async function fetchRss(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": CFPB_USER_AGENT,
        Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
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
  try {
    const xml = await fetchRss(CFPB_RSS_URL, CFPB_FETCH_TIMEOUT_MS);
    const items = parseCfpbRss(xml)
      .map(rssItemToRaw)
      .filter((x): x is RawRegulatoryItem => x !== null);
    if (items.length > 0) return items;
    console.warn(
      `[cfpb.fetchLatest] live fetch ${CFPB_RSS_URL} returned 0 parseable items, falling back to cache`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[cfpb.fetchLatest] live fetch ${CFPB_RSS_URL} failed (${message}); falling back to cache`,
    );
  }
  try {
    return await loadCache();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[cfpb.fetchLatest] cache load ${CACHE_PATH} failed (${message}); returning empty list`,
    );
    return [];
  }
}
