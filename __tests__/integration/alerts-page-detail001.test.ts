// DETAIL-001 verification harness.
//
// Asserts the alert detail page (/alerts/[id]/page.tsx) renders the two-panel
// side-by-side layout described in app_spec.txt:484-489:
//   - Left panel: Regulatory source — title, publication date, regulator,
//     document type, quoted text.
//   - Right panel: Policy passage — document title, section heading,
//     quoted text.
//   - Both quoted texts are visually highlighted (rendered inside a
//     <blockquote> with a yellow highlight class set).
//
// Live-UI test; depends on the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "detail001-verify";

const REG_TITLE = `${TAG} regulatory item title`;
const REG_FULL_TEXT = `${TAG} regulatory full body`;
const REG_QUOTE = `${TAG} regulatory quote highlighted`;
const REG_SOURCE_URL = `https://${TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const REG_REGULATOR = "FINRA";
const REG_DOCUMENT_TYPE = "final_rule";
const REG_PUBLICATION_DATE = new Date("2096-04-15T00:00:00Z");

const POLICY_TITLE = `${TAG} policy document title`;
const POLICY_DOMAIN = "bsa_aml";
const POLICY_FULL_TEXT = `${TAG} policy full text body`;
const CHUNK_HEADING = `${TAG} section 4.2 heading`;
const CHUNK_CONTENT = `${TAG} chunk full content`;
const POLICY_QUOTE = `${TAG} policy quote highlighted`;

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
      classification: "drifted",
      confidence: 0.84,
      severity: "high",
      explanation: `${TAG} explanation`,
      regulatoryQuote: REG_QUOTE,
      policyQuote: POLICY_QUOTE,
      regulatorySourceUrl: REG_SOURCE_URL,
      policyReference: `${POLICY_TITLE} > ${CHUNK_HEADING}`,
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

describe("DETAIL-001 alert detail two-panel layout (live UI)", () => {
  beforeAll(async () => {
    await purgeStaleFixtures();
    await seedAlert();
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

  it("renders both panels with the alert id wired into the container", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    const container = findTagOpening(html, "alert-detail");
    expect(container).not.toBeNull();
    expect(container!).toContain(`data-alert-id="${createdAlertId}"`);

    expect(findTagOpening(html, "alert-detail-regulatory-panel")).not.toBeNull();
    expect(findTagOpening(html, "alert-detail-policy-panel")).not.toBeNull();
    // The two-panel grid container must be present so left + right read as a
    // single layout, not two stacked cards.
    const panelsTag = findTagOpening(html, "alert-detail-panels");
    expect(panelsTag).not.toBeNull();
    expect(panelsTag!).toMatch(/class="[^"]*\bgrid\b[^"]*"/);
    expect(panelsTag!).toMatch(/class="[^"]*\bmd:grid-cols-2\b[^"]*"/);
  });

  it("left panel shows regulatory source: title, regulator, document type, date, and quoted text", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const title = findTag(html, "alert-detail-regulatory-title");
    expect(title).not.toBeNull();
    expect(title!).toContain(REG_TITLE);

    const regulator = findTagOpening(html, "alert-detail-regulatory-regulator");
    expect(regulator).not.toBeNull();
    expect(regulator!).toContain(`data-regulator="${REG_REGULATOR}"`);

    const docType = findTagOpening(
      html,
      "alert-detail-regulatory-document-type",
    );
    expect(docType).not.toBeNull();
    expect(docType!).toContain(`data-document-type="${REG_DOCUMENT_TYPE}"`);

    const date = findTagOpening(html, "alert-detail-regulatory-date");
    expect(date).not.toBeNull();
    expect(date!).toContain(
      `data-publication-date="${REG_PUBLICATION_DATE.toISOString()}"`,
    );

    const quote = findTag(html, "alert-detail-regulatory-quote");
    expect(quote).not.toBeNull();
    expect(quote!).toContain(REG_QUOTE);
  });

  it("right panel shows policy passage: document title, section heading, and quoted text", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const title = findTag(html, "alert-detail-policy-title");
    expect(title).not.toBeNull();
    expect(title!).toContain(POLICY_TITLE);

    const section = findTagOpening(html, "alert-detail-policy-section");
    expect(section).not.toBeNull();
    expect(section!).toContain(`data-section-heading="${CHUNK_HEADING}"`);

    const quote = findTag(html, "alert-detail-policy-quote");
    expect(quote).not.toBeNull();
    expect(quote!).toContain(POLICY_QUOTE);
  });

  it("both quoted texts are wrapped in <blockquote> elements with a yellow highlight class", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    // Each quote must render as a <blockquote> (the highlighted-block
    // semantic) and carry a Tailwind class containing "bg-yellow" so the
    // visual highlight is verifiable from HTML alone.
    const regQuoteTag = findTagOpening(html, "alert-detail-regulatory-quote");
    expect(regQuoteTag).not.toBeNull();
    expect(regQuoteTag!).toMatch(/^<blockquote\b/);
    expect(regQuoteTag!).toMatch(/class="[^"]*\bbg-yellow-100\b[^"]*"/);

    const polQuoteTag = findTagOpening(html, "alert-detail-policy-quote");
    expect(polQuoteTag).not.toBeNull();
    expect(polQuoteTag!).toMatch(/^<blockquote\b/);
    expect(polQuoteTag!).toMatch(/class="[^"]*\bbg-yellow-100\b[^"]*"/);
  });

  it("returns 404 for an unknown alert id", async () => {
    const { status } = await fetchDetailHtml("does-not-exist-id-xyz");
    expect(status).toBe(404);
  });
});
