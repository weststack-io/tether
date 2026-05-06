// DETAIL-002 verification harness.
//
// Asserts the alert detail page (/alerts/[id]/page.tsx) renders:
//   - A classification badge with classification-specific color tokens.
//   - A severity badge with severity-specific color tokens.
//   - A confidence value as a percentage AND a visual progress bar whose
//     fill width matches the alert's confidence float.
//   - A plain-language explanation block placed BELOW the two-panel grid.
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

const TAG = "detail002-verify";

const REG_TITLE = `${TAG} regulatory item title`;
const REG_FULL_TEXT = `${TAG} regulatory full body`;
const REG_QUOTE = `${TAG} regulatory quote`;
const REG_SOURCE_URL = `https://${TAG}.example/source-${Math.random().toString(36).slice(2)}`;
const REG_REGULATOR = "SEC";
const REG_DOCUMENT_TYPE = "guidance";
const REG_PUBLICATION_DATE = new Date("2096-09-01T00:00:00Z");

const POLICY_TITLE = `${TAG} policy document title`;
const POLICY_DOMAIN = "fair_lending";
const POLICY_FULL_TEXT = `${TAG} policy full text body`;
const CHUNK_HEADING = `${TAG} section 7.1 heading`;
const CHUNK_CONTENT = `${TAG} chunk full content`;
const POLICY_QUOTE = `${TAG} policy quote`;

// Use a recognizable explanation so the test can assert the literal string
// renders below the panels (not in a hidden attribute or similar).
const EXPLANATION = `${TAG} this rule narrows the safe-harbor exception in ways the policy does not yet reflect, creating drift across paragraph 3.`;

const CLASSIFICATION = "drifted";
const SEVERITY = "high";
const CONFIDENCE = 0.84;
const EXPECTED_CONFIDENCE_PCT = 84;

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

describe("DETAIL-002 alert detail summary (live UI)", () => {
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

  it("renders the classification badge with a classification-specific color class", async () => {
    const { status, html } = await fetchDetailHtml(createdAlertId!);
    expect(status).toBe(200);

    const tag = findTagOpening(html, "alert-detail-classification-badge");
    expect(tag).not.toBeNull();
    expect(tag!).toContain(`data-classification="${CLASSIFICATION}"`);
    // 'drifted' uses the amber palette per CLASSIFICATION_BADGE_CLASS in
    // src/app/alerts/[id]/page.tsx; the assertion locks the visible color
    // signal so a future palette refactor that drops classification-specific
    // hues is caught.
    expect(tag!).toMatch(/class="[^"]*\bbg-amber-50\b[^"]*"/);
    expect(tag!).toMatch(/class="[^"]*\btext-amber-700\b[^"]*"/);

    const inner = findTag(html, "alert-detail-classification-badge");
    expect(inner).not.toBeNull();
    expect(inner!).toContain("Drifted");
  });

  it("renders the severity badge with a severity-specific color class", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const tag = findTagOpening(html, "alert-detail-severity-badge");
    expect(tag).not.toBeNull();
    expect(tag!).toContain(`data-severity="${SEVERITY}"`);
    // 'high' uses the red palette per SEVERITY_BADGE_CLASS.
    expect(tag!).toMatch(/class="[^"]*\bbg-red-50\b[^"]*"/);
    expect(tag!).toMatch(/class="[^"]*\btext-red-700\b[^"]*"/);

    const inner = findTag(html, "alert-detail-severity-badge");
    expect(inner).not.toBeNull();
    // Visible label pairs the severity word with the noun so the badge reads
    // unambiguously next to the classification badge.
    expect(inner!).toContain(SEVERITY);
    expect(inner!).toMatch(/severity/i);
  });

  it("renders the confidence as both a percentage value and a progress bar whose fill width matches", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const valueOpen = findTagOpening(html, "alert-detail-confidence-value");
    expect(valueOpen).not.toBeNull();
    expect(valueOpen!).toContain(`data-confidence="${CONFIDENCE}"`);
    const valueInner = findTag(html, "alert-detail-confidence-value");
    expect(valueInner).not.toBeNull();
    expect(valueInner!).toContain(`${EXPECTED_CONFIDENCE_PCT}%`);

    const barOpen = findTagOpening(html, "alert-detail-confidence-bar");
    expect(barOpen).not.toBeNull();
    expect(barOpen!).toContain(`role="progressbar"`);
    expect(barOpen!).toContain(`aria-valuenow="${EXPECTED_CONFIDENCE_PCT}"`);
    expect(barOpen!).toContain(`data-confidence-pct="${EXPECTED_CONFIDENCE_PCT}"`);

    const fillOpen = findTagOpening(html, "alert-detail-confidence-bar-fill");
    expect(fillOpen).not.toBeNull();
    // Width must reflect the seeded confidence; this is the spec's "visual
    // bar" requirement.
    expect(fillOpen!).toMatch(
      new RegExp(`style="width:\\s*${EXPECTED_CONFIDENCE_PCT}%"`),
    );
  });

  it("renders the plain-language explanation text below the two-panel grid", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const explanationCard = findTagOpening(html, "alert-detail-explanation");
    expect(explanationCard).not.toBeNull();

    const text = findTag(html, "alert-detail-explanation-text");
    expect(text).not.toBeNull();
    expect(text!).toContain(EXPLANATION);

    // DOM order matters: the spec requires the explanation BELOW the panels.
    // Compare the byte offsets of the panels grid open tag and the
    // explanation card open tag — explanation must come strictly later.
    const panelsIdx = html.indexOf('data-testid="alert-detail-panels"');
    const explanationIdx = html.indexOf(
      'data-testid="alert-detail-explanation"',
    );
    expect(panelsIdx).toBeGreaterThan(-1);
    expect(explanationIdx).toBeGreaterThan(-1);
    expect(explanationIdx).toBeGreaterThan(panelsIdx);
  });

  it("exposes the underlying classification/severity/confidence on the summary container for programmatic queries", async () => {
    const { html } = await fetchDetailHtml(createdAlertId!);

    const summary = findTagOpening(html, "alert-detail-summary");
    expect(summary).not.toBeNull();
    expect(summary!).toContain(`data-classification="${CLASSIFICATION}"`);
    expect(summary!).toContain(`data-severity="${SEVERITY}"`);
    expect(summary!).toContain(`data-confidence="${CONFIDENCE}"`);
  });
});
