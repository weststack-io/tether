import { describe, expect, it } from "@jest/globals";
import { parseCfpbRss, rssItemToRaw } from "@/lib/ingestion/parsers/cfpb";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CFPB Newsroom</title>
    <link>https://www.consumerfinance.gov/about-us/newsroom/</link>
    <description>Latest CFPB publications and announcements</description>
    <item>
      <title><![CDATA[CFPB Finalizes Overdraft Rule for Large Banks]]></title>
      <link>https://www.consumerfinance.gov/about-us/newsroom/cfpb-finalizes-overdraft/</link>
      <description><![CDATA[The Bureau <em>finalized</em> a rule limiting overdraft fees charged by large banks under TILA and Regulation Z.]]></description>
      <pubDate>Wed, 05 Mar 2025 13:30:00 GMT</pubDate>
      <guid>https://www.consumerfinance.gov/about-us/newsroom/cfpb-finalizes-overdraft/</guid>
    </item>
    <item>
      <title>CFPB Issues Circular on Fair Lending Marketing</title>
      <link>https://www.consumerfinance.gov/about-us/newsroom/cfpb-circular-fair-lending/</link>
      <description>The Bureau reaffirms ECOA and Regulation B compliance for digital advertising audiences.</description>
      <pubDate>Tue, 18 Feb 2025 15:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("parseCfpbRss", () => {
  it("extracts every <item> block from RSS XML", () => {
    const items = parseCfpbRss(SAMPLE_RSS);
    expect(items).toHaveLength(2);
  });

  it("returns CDATA-wrapped fields with surrounding whitespace stripped", () => {
    const [first] = parseCfpbRss(SAMPLE_RSS);
    expect(first.title).toBe("CFPB Finalizes Overdraft Rule for Large Banks");
    expect(first.link).toBe("https://www.consumerfinance.gov/about-us/newsroom/cfpb-finalizes-overdraft/");
    expect(first.pubDate).toBe("Wed, 05 Mar 2025 13:30:00 GMT");
    expect(first.description).toContain("<em>finalized</em>");
  });

  it("decodes XML entities in non-CDATA fields", () => {
    const xml = `<rss><channel><item>
      <title>Reg B &amp; Reg Z</title>
      <link>https://example.com/c</link>
      <description>ECOA &amp; TILA reminders</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseCfpbRss(xml);
    expect(item.title).toBe("Reg B & Reg Z");
    expect(item.description).toBe("ECOA & TILA reminders");
  });

  it("returns an empty array when the document has no <item> elements", () => {
    expect(parseCfpbRss("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseCfpbRss("not even xml")).toEqual([]);
  });

  it("matches <item> case-insensitively", () => {
    const xml = `<RSS><channel><ITEM><title>Hi</title><link>https://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></ITEM></channel></RSS>`;
    const items = parseCfpbRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Hi");
  });
});

describe("rssItemToRaw (CFPB)", () => {
  it("maps a well-formed RSS item to a RawRegulatoryItem with regulator='CFPB'", () => {
    const raw = rssItemToRaw({
      title: "CFPB Issues Circular on Fair Lending",
      link: "https://www.consumerfinance.gov/about-us/newsroom/cfpb-circular/",
      description: "<p>The Bureau <strong>reaffirms</strong> ECOA compliance.</p>",
      pubDate: "Tue, 18 Feb 2025 15:00:00 GMT",
    });
    expect(raw).not.toBeNull();
    if (raw === null) throw new Error("unreachable");
    expect(raw.regulator).toBe("CFPB");
    expect(raw.sourceUrl).toBe("https://www.consumerfinance.gov/about-us/newsroom/cfpb-circular/");
    expect(raw.title).toBe("CFPB Issues Circular on Fair Lending");
    expect(raw.documentType).toBe("publication");
    expect(raw.publicationDate).toBeInstanceOf(Date);
    expect(raw.publicationDate.toISOString()).toBe("2025-02-18T15:00:00.000Z");
    expect(raw.fullText).toBe("The Bureau reaffirms ECOA compliance.");
  });

  it("returns null when the link field is missing", () => {
    expect(
      rssItemToRaw({
        title: "x",
        link: "",
        description: "y",
        pubDate: "Tue, 18 Feb 2025 15:00:00 GMT",
      }),
    ).toBeNull();
  });

  it("returns null when the title field is missing", () => {
    expect(
      rssItemToRaw({
        title: "",
        link: "https://x",
        description: "y",
        pubDate: "Tue, 18 Feb 2025 15:00:00 GMT",
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
      title: "Notice: <em>CFPB</em> Acts",
      link: "https://x",
      description: "Body",
      pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(raw?.title).toBe("Notice: CFPB Acts");
  });
});
