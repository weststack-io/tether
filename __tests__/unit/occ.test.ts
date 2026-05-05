import { describe, expect, it } from "@jest/globals";
import { parseOccRss, rssItemToRaw } from "@/lib/ingestion/parsers/occ";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>OCC News Releases</title>
    <link>https://www.occ.gov/news-issuances/news-releases/</link>
    <description>Latest OCC news releases and bulletins</description>
    <item>
      <title><![CDATA[OCC Issues Bulletin on BSA/AML Examination Priorities]]></title>
      <link>https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-3.html</link>
      <description><![CDATA[The OCC <em>reaffirms</em> Bank Secrecy Act and AML supervisory priorities for national banks.]]></description>
      <pubDate>Wed, 12 Feb 2025 14:00:00 GMT</pubDate>
      <guid>https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-3.html</guid>
    </item>
    <item>
      <title>OCC Issues Bulletin on Third-Party Risk Management</title>
      <link>https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-7.html</link>
      <description>Clarifies supervisory expectations for cloud service provider risk management.</description>
      <pubDate>Wed, 19 Mar 2025 14:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("parseOccRss", () => {
  it("extracts every <item> block from RSS XML", () => {
    const items = parseOccRss(SAMPLE_RSS);
    expect(items).toHaveLength(2);
  });

  it("returns CDATA-wrapped fields with surrounding whitespace stripped", () => {
    const [first] = parseOccRss(SAMPLE_RSS);
    expect(first.title).toBe("OCC Issues Bulletin on BSA/AML Examination Priorities");
    expect(first.link).toBe("https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-3.html");
    expect(first.pubDate).toBe("Wed, 12 Feb 2025 14:00:00 GMT");
    expect(first.description).toContain("<em>reaffirms</em>");
  });

  it("decodes XML entities in non-CDATA fields", () => {
    const xml = `<rss><channel><item>
      <title>BSA &amp; AML Reminder</title>
      <link>https://example.com/o</link>
      <description>SAR &amp; CTR filings</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseOccRss(xml);
    expect(item.title).toBe("BSA & AML Reminder");
    expect(item.description).toBe("SAR & CTR filings");
  });

  it("returns an empty array when the document has no <item> elements", () => {
    expect(parseOccRss("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseOccRss("not even xml")).toEqual([]);
  });

  it("matches <item> case-insensitively", () => {
    const xml = `<RSS><channel><ITEM><title>Hi</title><link>https://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></ITEM></channel></RSS>`;
    const items = parseOccRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Hi");
  });
});

describe("rssItemToRaw (OCC)", () => {
  it("maps a well-formed RSS item to a RawRegulatoryItem with regulator='OCC'", () => {
    const raw = rssItemToRaw({
      title: "OCC Issues Bulletin on Third-Party Risk Management",
      link: "https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-7.html",
      description: "<p>The OCC <strong>clarifies</strong> third-party risk expectations.</p>",
      pubDate: "Wed, 19 Mar 2025 14:00:00 GMT",
    });
    expect(raw).not.toBeNull();
    if (raw === null) throw new Error("unreachable");
    expect(raw.regulator).toBe("OCC");
    expect(raw.sourceUrl).toBe("https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-7.html");
    expect(raw.title).toBe("OCC Issues Bulletin on Third-Party Risk Management");
    expect(raw.documentType).toBe("bulletin");
    expect(raw.publicationDate).toBeInstanceOf(Date);
    expect(raw.publicationDate.toISOString()).toBe("2025-03-19T14:00:00.000Z");
    expect(raw.fullText).toBe("The OCC clarifies third-party risk expectations.");
  });

  it("returns null when the link field is missing", () => {
    expect(
      rssItemToRaw({
        title: "x",
        link: "",
        description: "y",
        pubDate: "Wed, 19 Mar 2025 14:00:00 GMT",
      }),
    ).toBeNull();
  });

  it("returns null when the title field is missing", () => {
    expect(
      rssItemToRaw({
        title: "",
        link: "https://x",
        description: "y",
        pubDate: "Wed, 19 Mar 2025 14:00:00 GMT",
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
      title: "Bulletin: <em>OCC</em> Issues Guidance",
      link: "https://x",
      description: "Body",
      pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(raw?.title).toBe("Bulletin: OCC Issues Guidance");
  });
});
