// DASH-004 verification harness.
//
// Seeds open alerts whose policy chunks live in PolicyDocuments with various
// `domain` values, fetches the rendered dashboard HTML from the live dev
// server, parses each domain card's count, and asserts the deltas vs.
// baseline match the seeded counts. Asymmetric per-domain counts catch
// accidental hard-coding or domain-key mis-mapping. Live-UI test; depends on
// the dev server being up on :3000.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { prisma } from "@/lib/db";

const TAG = "dash004-verify";

const DOMAINS = [
  "bsa_aml",
  "complaint_handling",
  "fair_lending",
  "reg_e",
  "reg_z",
  "vendor_management",
  "info_security",
  "cip",
  "overdraft",
  "marketing",
] as const;
type Domain = (typeof DOMAINS)[number];

const HUMAN_LABELS: Record<Domain, string> = {
  bsa_aml: "BSA/AML",
  complaint_handling: "Complaint Handling",
  fair_lending: "Fair Lending",
  reg_e: "Regulation E",
  reg_z: "Regulation Z",
  vendor_management: "Vendor Management",
  info_security: "Information Security",
  cip: "Customer Identification Program",
  overdraft: "Overdraft",
  marketing: "Marketing",
};

const createdAlertIds: string[] = [];
const createdItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

async function seedOpenAlertForDomain(domain: Domain) {
  const run = await prisma.ingestionRun.create({
    data: { trigger: "manual", status: "completed", completedAt: new Date() },
  });
  createdRunIds.push(run.id);

  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TAG} ${domain}`,
      domain,
      fullText: `${TAG} policy text`,
      isSynthetic: true,
    },
  });
  createdPolicyIds.push(policy.id);

  const chunk = await prisma.policyChunk.create({
    data: {
      policyDocumentId: policy.id,
      sectionHeading: "X",
      content: "c",
      chunkIndex: 0,
    },
  });
  createdChunkIds.push(chunk.id);

  const item = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: `https://${TAG}.example/${domain}/${Math.random().toString(36).slice(2)}`,
      regulator: "SEC",
      publicationDate: new Date(),
      documentType: "notice",
      title: `${TAG} ${domain} item`,
      fullText: "x",
      ingestionRunId: run.id,
    },
  });
  createdItemIds.push(item.id);

  const alert = await prisma.alert.create({
    data: {
      regulatoryItemId: item.id,
      policyChunkId: chunk.id,
      classification: "drifted",
      confidence: 0.9,
      severity: "medium",
      explanation: "x",
      regulatoryQuote: "q",
      policyQuote: "q",
      regulatorySourceUrl: item.sourceUrl,
      policyReference: "ref",
      status: "open",
    },
  });
  createdAlertIds.push(alert.id);
}

async function fetchDomainCounts(): Promise<Record<Domain, number>> {
  const res = await fetch("http://localhost:3000/", { cache: "no-store" });
  expect(res.status).toBe(200);
  const html = await res.text();
  const counts: Record<Domain, number> = {} as Record<Domain, number>;
  for (const dom of DOMAINS) {
    const re = new RegExp(
      `data-testid="domain-count-${dom}"[^>]*>\\s*(\\d+)\\s*<`,
    );
    const m = html.match(re);
    expect(m).not.toBeNull();
    counts[dom] = Number(m![1]);
  }
  return counts;
}

describe("DASH-004 dashboard alerts-by-policy-domain cards (live UI)", () => {
  let baseline: Record<Domain, number>;

  beforeAll(async () => {
    baseline = await fetchDomainCounts();
  });

  afterAll(async () => {
    if (createdAlertIds.length > 0) {
      await prisma.alert.deleteMany({ where: { id: { in: createdAlertIds } } });
    }
    if (createdItemIds.length > 0) {
      await prisma.regulatoryItem.deleteMany({
        where: { id: { in: createdItemIds } },
      });
    }
    if (createdChunkIds.length > 0) {
      await prisma.policyChunk.deleteMany({
        where: { id: { in: createdChunkIds } },
      });
    }
    if (createdPolicyIds.length > 0) {
      await prisma.policyDocument.deleteMany({
        where: { id: { in: createdPolicyIds } },
      });
    }
    if (createdRunIds.length > 0) {
      await prisma.ingestionRun.deleteMany({
        where: { id: { in: createdRunIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("renders ten labeled cards for every policy domain with counts that reflect the database", async () => {
    // Asymmetric per-domain seeding: catches accidental hard-coding or a
    // domain-key mis-mapping that uniform counts (e.g., +1 each) would miss.
    const SEEDED: Record<Domain, number> = {
      bsa_aml: 3,
      complaint_handling: 1,
      fair_lending: 2,
      reg_e: 0,
      reg_z: 1,
      vendor_management: 4,
      info_security: 0,
      cip: 2,
      overdraft: 1,
      marketing: 0,
    };
    for (const dom of DOMAINS) {
      for (let i = 0; i < SEEDED[dom]; i += 1) {
        await seedOpenAlertForDomain(dom);
      }
    }

    const after = await fetchDomainCounts();
    for (const dom of DOMAINS) {
      expect(after[dom]).toBe(baseline[dom] + SEEDED[dom]);
    }

    // Lock in the visible markup contract: each domain card has the
    // human-readable label, a data-domain attribute, and the section heading
    // is present.
    const html = await (
      await fetch("http://localhost:3000/", { cache: "no-store" })
    ).text();
    for (const dom of DOMAINS) {
      expect(html).toMatch(new RegExp(`data-domain="${dom}"`));
      expect(html).toContain(HUMAN_LABELS[dom]);
    }
    expect(html).toMatch(/>By policy domain</);
  });
});
