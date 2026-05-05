import { describe, expect, it } from "@jest/globals";
import { parseFinraRss, rssItemToRaw } from "@/lib/ingestion/parsers/finra";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>FINRA Regulatory Notices</title>
    <link>https://www.finra.org/rules-guidance/notices</link>
    <description>Latest regulatory notices from FINRA</description>
    <item>
      <title><![CDATA[Regulatory Notice 25-04: Generative AI Guidance]]></title>
      <link>https://www.finra.org/rules-guidance/notices/25-04</link>
      <description><![CDATA[FINRA <em>provides guidance</em> on use of generative artificial intelligence in member firm operations.]]></description>
      <pubDate>Mon, 10 Feb 2025 13:30:00 GMT</pubDate>
      <guid>https://www.finra.org/rules-guidance/notices/25-04</guid>
    </item>
    <item>
      <title>Regulatory Notice 25-01: Customer Complaint Reporting</title>
      <link>https://www.finra.org/rules-guidance/notices/25-01</link>
      <description>FINRA reminds member firms of their obligations regarding complaint reporting under Rule 4530.</description>
      <pubDate>Wed, 15 Jan 2025 14:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("parseFinraRss", () => {
  it("extracts every <item> block from RSS XML", () => {
    const items = parseFinraRss(SAMPLE_RSS);
    expect(items).toHaveLength(2);
  });

  it("returns CDATA-wrapped fields with surrounding whitespace stripped", () => {
    const [first] = parseFinraRss(SAMPLE_RSS);
    expect(first.title).toBe("Regulatory Notice 25-04: Generative AI Guidance");
    expect(first.link).toBe("https://www.finra.org/rules-guidance/notices/25-04");
    expect(first.pubDate).toBe("Mon, 10 Feb 2025 13:30:00 GMT");
    expect(first.description).toContain("<em>provides guidance</em>");
  });

  it("decodes XML entities in non-CDATA fields", () => {
    const xml = `<rss><channel><item>
      <title>Rule 4530 &amp; Rule 4511</title>
      <link>https://example.com/r</link>
      <description>Reporting &amp; recordkeeping</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseFinraRss(xml);
    expect(item.title).toBe("Rule 4530 & Rule 4511");
    expect(item.description).toBe("Reporting & recordkeeping");
  });

  it("returns an empty array when the document has no <item> elements", () => {
    expect(parseFinraRss("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseFinraRss("not even xml")).toEqual([]);
  });

  it("matches <item> case-insensitively", () => {
    const xml = `<RSS><channel><ITEM><title>Hi</title><link>https://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></ITEM></channel></RSS>`;
    const items = parseFinraRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Hi");
  });
});

describe("rssItemToRaw (FINRA)", () => {
  it("maps a well-formed RSS item to a RawRegulatoryItem with regulator='FINRA'", () => {
    const raw = rssItemToRaw({
      title: "Regulatory Notice 25-04",
      link: "https://www.finra.org/rules-guidance/notices/25-04",
      description: "<p>FINRA <strong>provides</strong> guidance on AI.</p>",
      pubDate: "Mon, 10 Feb 2025 13:30:00 GMT",
    });
    expect(raw).not.toBeNull();
    if (raw === null) throw new Error("unreachable");
    expect(raw.regulator).toBe("FINRA");
    expect(raw.sourceUrl).toBe("https://www.finra.org/rules-guidance/notices/25-04");
    expect(raw.title).toBe("Regulatory Notice 25-04");
    expect(raw.documentType).toBe("regulatory_notice");
    expect(raw.publicationDate).toBeInstanceOf(Date);
    expect(raw.publicationDate.toISOString()).toBe("2025-02-10T13:30:00.000Z");
    expect(raw.fullText).toBe("FINRA provides guidance on AI.");
  });

  it("returns null when the link field is missing", () => {
    expect(
      rssItemToRaw({
        title: "x",
        link: "",
        description: "y",
        pubDate: "Mon, 10 Feb 2025 13:30:00 GMT",
      }),
    ).toBeNull();
  });

  it("returns null when the title field is missing", () => {
    expect(
      rssItemToRaw({
        title: "",
        link: "https://x",
        description: "y",
        pubDate: "Mon, 10 Feb 2025 13:30:00 GMT",
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
      title: "Notice: <em>FINRA</em> Acts",
      link: "https://x",
      description: "Body",
      pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(raw?.title).toBe("Notice: FINRA Acts");
  });
});
