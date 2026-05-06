// Unit tests for the pure logic in @/lib/ingestion/single-url:
//   * detectRegulator: hostname -> Regulator mapping (with SEC fallback)
//   * extractTitleAndText: HTML -> { title, fullText } extraction

import { describe, expect, it, jest } from "@jest/globals";
import {
  detectRegulator,
  extractTitleAndText,
} from "@/lib/ingestion/single-url";

describe("detectRegulator", () => {
  it.each([
    ["https://www.sec.gov/news/press-release/2025-1", "SEC"],
    ["https://sec.gov/foo", "SEC"],
    ["https://www.finra.org/rules-guidance/notices/25-01", "FINRA"],
    ["https://www.consumerfinance.gov/policy-compliance/guidance/", "CFPB"],
    ["https://www.occ.gov/news-issuances/bulletins/2025/", "OCC"],
    ["https://www.occ.treas.gov/news-issuances/", "OCC"],
  ] as const)("maps %s -> %s", (url, expected) => {
    expect(detectRegulator(url)).toBe(expected);
  });

  it("defaults to SEC for unknown hostnames (with a warning)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(detectRegulator("https://example.com/article")).toBe("SEC");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("returns SEC when the URL is unparseable", () => {
    expect(detectRegulator("not a url")).toBe("SEC");
  });
});

describe("extractTitleAndText", () => {
  it("extracts <title> and strips remaining tags from the body", () => {
    const html = `
      <html>
        <head><title>SEC Charges Adviser</title></head>
        <body>
          <h1>SEC Charges Adviser</h1>
          <p>The Securities and Exchange Commission today announced charges.</p>
        </body>
      </html>
    `;
    const { title, fullText } = extractTitleAndText(html);
    expect(title).toBe("SEC Charges Adviser");
    expect(fullText).toContain("SEC Charges Adviser");
    expect(fullText).toContain(
      "The Securities and Exchange Commission today announced charges.",
    );
    expect(fullText).not.toContain("<");
  });

  it("falls back to the first <h1> when no <title> tag exists", () => {
    const html = `<body><h1>Headline Only</h1><p>Body text here.</p></body>`;
    const { title, fullText } = extractTitleAndText(html);
    expect(title).toBe("Headline Only");
    expect(fullText).toContain("Body text here.");
  });

  it("strips <script> and <style> blocks before extracting text", () => {
    const html = `
      <html>
        <head>
          <title>OK</title>
          <style>.x { color: red; }</style>
        </head>
        <body>
          <script>const sneaky = 1;</script>
          <p>Visible body.</p>
        </body>
      </html>
    `;
    const { title, fullText } = extractTitleAndText(html);
    expect(title).toBe("OK");
    expect(fullText).not.toContain("sneaky");
    expect(fullText).not.toContain("color: red");
    expect(fullText).toContain("Visible body.");
  });

  it("decodes HTML entities", () => {
    const html = `<title>A &amp; B</title><body>x &lt; y &amp; z</body>`;
    const { title, fullText } = extractTitleAndText(html);
    expect(title).toBe("A & B");
    expect(fullText).toContain("x < y & z");
  });
});
