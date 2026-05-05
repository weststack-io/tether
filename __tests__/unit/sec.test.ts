import { describe, expect, it } from "@jest/globals";
import { parseSecRss, rssItemToRaw } from "@/lib/ingestion/parsers/sec";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SEC Press Releases</title>
    <link>https://www.sec.gov/news/pressreleases</link>
    <description>Latest press releases from the SEC</description>
    <item>
      <title><![CDATA[SEC Charges Adviser With AI Disclosure Failures]]></title>
      <link>https://www.sec.gov/news/press-release/2025-014</link>
      <description><![CDATA[The SEC charged a registered investment adviser with <em>failing to implement</em> reasonably designed compliance policies concerning AI disclosures.]]></description>
      <pubDate>Wed, 22 Jan 2025 14:30:00 GMT</pubDate>
      <guid>https://www.sec.gov/news/press-release/2025-014</guid>
    </item>
    <item>
      <title>SEC Adopts Amendments to Reg S-P</title>
      <link>https://www.sec.gov/news/press-release/2024-075</link>
      <description>Amendments require covered institutions to notify individuals of data breaches.</description>
      <pubDate>Thu, 16 May 2024 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("parseSecRss", () => {
  it("extracts every <item> block from RSS XML", () => {
    const items = parseSecRss(SAMPLE_RSS);
    expect(items).toHaveLength(2);
  });

  it("returns CDATA-wrapped fields with surrounding whitespace stripped", () => {
    const [first] = parseSecRss(SAMPLE_RSS);
    expect(first.title).toBe("SEC Charges Adviser With AI Disclosure Failures");
    expect(first.link).toBe("https://www.sec.gov/news/press-release/2025-014");
    expect(first.pubDate).toBe("Wed, 22 Jan 2025 14:30:00 GMT");
    // CDATA description preserves inline HTML for downstream stripping
    expect(first.description).toContain("<em>failing to implement</em>");
  });

  it("decodes XML entities in non-CDATA fields", () => {
    const xml = `<rss><channel><item>
      <title>Reg S-P &amp; Reg S-ID</title>
      <link>https://example.com/r</link>
      <description>Privacy &amp; safeguards</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseSecRss(xml);
    expect(item.title).toBe("Reg S-P & Reg S-ID");
    expect(item.description).toBe("Privacy & safeguards");
  });

  it("returns an empty array when the document has no <item> elements", () => {
    expect(parseSecRss("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseSecRss("not even xml")).toEqual([]);
  });

  it("matches <item> case-insensitively", () => {
    const xml = `<RSS><channel><ITEM><title>Hi</title><link>https://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></ITEM></channel></RSS>`;
    const items = parseSecRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Hi");
  });
});

describe("rssItemToRaw", () => {
  it("maps a well-formed RSS item to a RawRegulatoryItem with regulator='SEC'", () => {
    const raw = rssItemToRaw({
      title: "Test Release",
      link: "https://www.sec.gov/news/press-release/test",
      description: "<p>Some <strong>regulated</strong> content.</p>",
      pubDate: "Wed, 22 Jan 2025 14:30:00 GMT",
    });
    expect(raw).not.toBeNull();
    if (raw === null) throw new Error("unreachable");
    expect(raw.regulator).toBe("SEC");
    expect(raw.sourceUrl).toBe("https://www.sec.gov/news/press-release/test");
    expect(raw.title).toBe("Test Release");
    expect(raw.documentType).toBe("press_release");
    expect(raw.publicationDate).toBeInstanceOf(Date);
    expect(raw.publicationDate.toISOString()).toBe("2025-01-22T14:30:00.000Z");
    // HTML stripped from description for the fullText field
    expect(raw.fullText).toBe("Some regulated content.");
  });

  it("returns null when the link field is missing", () => {
    expect(
      rssItemToRaw({
        title: "x",
        link: "",
        description: "y",
        pubDate: "Wed, 22 Jan 2025 14:30:00 GMT",
      }),
    ).toBeNull();
  });

  it("returns null when the title field is missing", () => {
    expect(
      rssItemToRaw({
        title: "",
        link: "https://x",
        description: "y",
        pubDate: "Wed, 22 Jan 2025 14:30:00 GMT",
      }),
    ).toBeNull();
  });

  it("returns null when pubDate is missing or unparseable", () => {
    expect(
      rssItemToRaw({
        title: "x",
        link: "https://x",
        description: "y",
        pubDate: "",
      }),
    ).toBeNull();
    expect(
      rssItemToRaw({
        title: "x",
        link: "https://x",
        description: "y",
        pubDate: "not-a-date",
      }),
    ).toBeNull();
  });

  it("falls back to title for fullText when description is empty", () => {
    const raw = rssItemToRaw({
      title: "Headline only",
      link: "https://x",
      description: "",
      pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(raw?.fullText).toBe("Headline only");
  });

  it("strips HTML from titles wrapped in inline tags", () => {
    const raw = rssItemToRaw({
      title: "Press Release: <em>SEC</em> Acts",
      link: "https://x",
      description: "Body",
      pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(raw?.title).toBe("Press Release: SEC Acts");
  });
});
