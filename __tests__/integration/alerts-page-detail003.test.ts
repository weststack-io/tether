// DETAIL-003 verification harness.
//
// Asserts the alert detail page (/alerts/[id]/page.tsx) renders a citation
// chain card with:
//   - The regulatory source URL exposed as a clickable <a href> link.
//   - The policy reference showing both the parent document title and the
//     section heading.
//   - Both citations clearly labeled.
//
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "detail003-verify";

const REG_TITLE = `${TAG} regulatory item title`;
const REG_FULL_TEXT = `${TAG} regulatory full body`;
const REG_QUOTE = `${TAG} regulatory quote`;
const REG_SOURCE_URL = `https://${TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const REG_REGULATOR = "FINRA";
const REG_DOCUMENT_TYPE = "notice";
const REG_PUBLICATION_DATE = new Date("2096-08-15T00:00:00Z");

const POLICY_TITLE = `${TAG} customer onboarding policy`;
const POLICY_DOMAIN = "cip";
const POLICY_FULL_TEXT = `${TAG} policy full text body`;
const CHUNK_HEADING = `${TAG} Section 4.2 — risk-based identification`;
const CHUNK_CONTENT = `${TAG} chunk full content`;
const POLICY_QUOTE = `${TAG} policy quote`;

const POLICY_REFERENCE = `${POLICY_TITLE} > ${CHUNK_HEADING}`;

const EXPLANATION = `${TAG} citation chain verification body.`;

const CLASSIFICATION = "drifted";
const SEVERITY = "medium";
const CONFIDENCE = 0.71;

let createdRunId: string | null = null;
let createdRegItemId: string | null = null;
let createdPolicyId: string | null = null;
let createdChunkId: string | null = null;
let createdAlertId: string | null = null;

async function purgeStaleFixtures(): Promise<void> {
  const stale = await prisma.regulatoryItem.findMany({
    where: { title: { startsWith: `${TAG} ` } },
    select: { id: true, ingestionRunId: true },
  });
  if (stale.length > 0) {
    const itemIds = stale.map((s) => s.id);
    const runIds = [
      ...new Set(stale.map((s) => s.ingestionRunId).filter(Boolean) as string[]),
    ];
    const alerts = await prisma.alert.findMany({
      where: { regulatoryItemId: { in: itemIds } },
      select: { id: true },
    });
    const alertIds = alerts.map((a) => a.id);
    if (alertIds.length > 0) {
      await prisma.auditEntry.deleteMany({
        where: { alertId: { in: alertIds } },
      });
      await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
    }
    await prisma.regulatoryItem.deleteMany({ where: { id: { in: itemIds } } });
    if (runIds.length > 0) {
      await prisma.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
    }
  }
  const stalePolicies = await prisma.policyDocument.findMany({
    where: { title: { startsWith: `${TAG} ` } },
    select: { id: true },
  });
  if (stalePolicies.length > 0) {
    const policyIds = stalePolicies.map((p) => p.id);
    await prisma.policyChunk.deleteMany({
      where: { policyDocumentId: { in: policyIds } },
    });
    await prisma.policyDocument.deleteMany({
      where: { id: { in: policyIds } },
    });
  }
}

async function seedAlert(): Promise<void> {
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: "manual",
      status: "completed",
      completedAt: new Date(),
    },
  });
  createdRunId = run.id;

  const policy = await prisma.policyDocument.create({
    data: {
      title: POLICY_TITLE,
      domain: POLICY_DOMAIN,
      fullText: POLICY_FULL_TEXT,
      isSynthetic: true,
    },
  });
  createdPolicyId = policy.id;

  const chunk = await prisma.policyChunk.create({
    data: {
      policyDocumentId: policy.id,
      sectionHeading: CHUNK_HEADING,
      content: CHUNK_CONTENT,
      chunkIndex: 0,
    },
  });
  createdChunkId = chunk.id;

  const regItem = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: REG_SOURCE_URL,
      regulator: REG_REGULATOR,
      publicationDate: REG_PUBLICATION_DATE,
      documentType: REG_DOCUMENT_TYPE,
      title: REG_TITLE,
      fullText: REG_FULL_TEXT,
      ingestionRunId: run.id,
    },
  });
  createdRegItemId = regItem.id;

  const alert = await prisma.alert.create({
    data: {
      regulatoryItemId: regItem.id,
      policyChunkId: chunk.id,
      classification: CLASSIFICATION,
      confidence: CONFIDENCE,
      severity: SEVERITY,
      explanation: EXPLANATION,
      regulatoryQuote: REG_QUOTE,
      policyQuote: POLICY_QUOTE,
      regulatorySourceUrl: REG_SOURCE_URL,
      policyReference: POLICY_REFERENCE,
      status: "open",
    },
  });
  createdAlertId = alert.id;
}

async function fetchDetailHtml(id: string): Promise<{ status: number; html: string }> {
  const url = `http://localhost:3000/alerts/${id}`;
  const res = await fetch(url, { cache: "no-store" });
  return { status: res.status, html: await res.text() };
}

function findTag(html: string, testId: string): string | null {
  const re = new RegExp(
    `<[a-zA-Z]+[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</[a-zA-Z]+>`,
  );
  const m = html.match(re);
  return m ? m[1]! : null;
}

function findTagOpening(html: string, testId: string): string | null {
  const re = new RegExp(`<[a-zA-Z]+[^>]*data-testid="${testId}"[^>]*>`);
  const m = html.match(re);
  return m ? m[0] : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

describe("DETAIL-003 alert detail citation chain (live UI)", () => {
  // The detail route can take >5s to compile on first request after a dev
  // server bounce; bump the default Jest timeout for this suite.
  jest.setTimeout(20000);

  beforeAll(async () => {
    await purgeStaleFixtures();
    await seedAlert();
    // Warm up the route compile so per-test fetches don't hit the cold-start
    // window.
    if (createdAlertId) {
      await fetchDetailHtml(createdAlertId);
    }
  });

  afterAll(async () => {
    if (createdAlertId) {
      await prisma.auditEntry.deleteMany({
        where: { alertId: createdAlertId },
      });
      await prisma.alert.delete({ where: { id: createdAlertId } });
    }
    if (createdRegItemId) {
      await prisma.regulatoryItem.delete({ where: { id: createdRegItemId } });
    }
    if (createdChunkId) {
      await prisma.policyChunk.delete({ where: { id: createdChunkId } });
    }
    if (createdPolicyId) {
      await prisma.policyDocument.delete({ where: { id: createdPolicyId } });
    }
    if (createdRunId) {
      await prisma.ingestionRun.delete({ where: { id: createdRunId } });
    }
    await prisma.$disconnect();
  });

  it("renders a citations card on the detail page", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    const card = findTagOpening(html, "alert-detail-citations");
    expect(card).not.toBeNull();
  });

  it("renders the regulatory source URL as a clickable <a href> link", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const linkOpen = findTagOpening(html, "alert-detail-citation-regulatory-link");
    expect(linkOpen).not.toBeNull();
    // Must be a real anchor tag with href, not a span/div with text.
    expect(linkOpen!.startsWith("<a ")).toBe(true);
    expect(linkOpen!).toContain(`href="${REG_SOURCE_URL}"`);
    expect(linkOpen!).toContain(`data-source-url="${REG_SOURCE_URL}"`);
    // External link safety — opens in new tab without leaking opener / referrer.
    expect(linkOpen!).toContain('target="_blank"');
    expect(linkOpen!).toMatch(/rel="[^"]*noopener[^"]*"/);

    const inner = findTag(html, "alert-detail-citation-regulatory-link");
    expect(inner).not.toBeNull();
    // Visible text equals the URL itself so reviewers see what they're about
    // to open.
    expect(decodeHtml(inner!).trim()).toBe(REG_SOURCE_URL);
  });

  it("renders the policy reference with the policy document title and section heading", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const refOpen = findTagOpening(
      html,
      "alert-detail-citation-policy-reference",
    );
    expect(refOpen).not.toBeNull();
    // React serializes ">" as &gt; inside attribute values; decode before
    // comparing to the original reference string.
    const refOpenDecoded = decodeHtml(refOpen!);
    expect(refOpenDecoded).toContain(
      `data-policy-reference="${POLICY_REFERENCE}"`,
    );

    const docInner = findTag(html, "alert-detail-citation-policy-document");
    expect(docInner).not.toBeNull();
    expect(decodeHtml(docInner!).trim()).toBe(POLICY_TITLE);

    const sectionInner = findTag(html, "alert-detail-citation-policy-section");
    expect(sectionInner).not.toBeNull();
    expect(decodeHtml(sectionInner!).trim()).toBe(CHUNK_HEADING);
  });

  it("clearly labels both citations with human-readable headings", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    // The labels must appear inside the citation row containers, not just
    // somewhere in the page (which would let an unrelated header satisfy
    // the assertion).
    const regulatoryRow = findTag(html, "alert-detail-citation-regulatory");
    expect(regulatoryRow).not.toBeNull();
    expect(regulatoryRow!.toLowerCase()).toContain("regulatory source");

    const policyRow = findTag(html, "alert-detail-citation-policy");
    expect(policyRow).not.toBeNull();
    expect(policyRow!.toLowerCase()).toContain("policy reference");
  });
});
