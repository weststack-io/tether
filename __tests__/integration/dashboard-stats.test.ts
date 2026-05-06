// API-002: GET /api/dashboard/stats
//
// Seeds a controlled set of Alert rows (across distinct severities, regulators,
// domains, and statuses) plus a few IngestionRun rows, calls the route handler,
// and asserts the aggregated response shape matches the app_spec contract:
//   alertsBySeverity { high, medium, low }
//   alertsByRegulator { SEC, FINRA, CFPB, OCC }
//   alertsByDomain    Record<string, number>
//   alertsByStatus    Record<string, number>
//   totalOpen         number (open alerts only)
//   recentIngestion   IngestionRun[] (up to 5, newest first)

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { GET } from "@/app/api/dashboard/stats/route";
import { prisma } from "@/lib/db";

const TEST_TAG = "dashboard-stats-test";

type SeededAlert = {
  id: string;
  regulator: string;
  severity: string;
  domain: string;
  status: string;
};

const createdAlertIds: string[] = [];
const createdRegItemIds: string[] = [];
const createdRunIds: string[] = [];
const createdChunkIds: string[] = [];
const createdPolicyIds: string[] = [];

async function seedAlert(spec: {
  regulator: string;
  severity: string;
  domain: string;
  status: string;
  classification?: string;
}): Promise<SeededAlert> {
  // Each alert needs: a parent IngestionRun, a parent RegulatoryItem (for
  // regulator), a parent PolicyChunk -> PolicyDocument (for domain), and the
  // Alert row itself (for severity + status).
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: "manual",
      status: "completed",
      completedAt: new Date(),
    },
  });
  createdRunIds.push(run.id);

  const regItem = await prisma.regulatoryItem.create({
    data: {
      sourceUrl: `https://${TEST_TAG}.example/${Math.random().toString(36).slice(2)}`,
      regulator: spec.regulator,
      publicationDate: new Date("2026-01-15T00:00:00Z"),
      documentType: "notice",
      title: `${TEST_TAG} ${spec.regulator} item`,
      fullText: `${TEST_TAG} regulatory body text`,
      ingestionRunId: run.id,
    },
  });
  createdRegItemIds.push(regItem.id);

  const policy = await prisma.policyDocument.create({
    data: {
      title: `${TEST_TAG} policy ${spec.domain}`,
      domain: spec.domain,
      fullText: `${TEST_TAG} policy text for ${spec.domain}`,
      isSynthetic: true,
    },
  });
  createdPolicyIds.push(policy.id);

  const chunk = await prisma.policyChunk.create({
    data: {
      policyDocumentId: policy.id,
      sectionHeading: "Test Section",
      content: `${TEST_TAG} chunk content`,
      chunkIndex: 0,
    },
  });
  createdChunkIds.push(chunk.id);

  const alert = await prisma.alert.create({
    data: {
      regulatoryItemId: regItem.id,
      policyChunkId: chunk.id,
      classification: spec.classification ?? "drifted",
      confidence: 0.9,
      severity: spec.severity,
      explanation: `${TEST_TAG} explanation`,
      regulatoryQuote: "regulatory quote",
      policyQuote: "policy quote",
      regulatorySourceUrl: regItem.sourceUrl,
      policyReference: `${policy.title} > Test Section`,
      status: spec.status,
    },
  });
  createdAlertIds.push(alert.id);

  return {
    id: alert.id,
    regulator: spec.regulator,
    severity: spec.severity,
    domain: spec.domain,
    status: spec.status,
  };
}

describe("GET /api/dashboard/stats (API-002)", () => {
  let baseline: {
    alertsBySeverity: Record<string, number>;
    alertsByRegulator: Record<string, number>;
    alertsByDomain: Record<string, number>;
    alertsByStatus: Record<string, number>;
    totalOpen: number;
  };

  beforeAll(async () => {
    // Capture pre-seed baseline counts so assertions are robust to whatever
    // the dev SQLite already contains (seeded policies, real alerts, etc.).
    const baselineRes = await GET();
    baseline = (await baselineRes.json()) as typeof baseline;
  });

  afterAll(async () => {
    if (createdAlertIds.length > 0) {
      await prisma.auditEntry.deleteMany({
        where: { alertId: { in: createdAlertIds } },
      });
      await prisma.alert.deleteMany({
        where: { id: { in: createdAlertIds } },
      });
    }
    if (createdRegItemIds.length > 0) {
      await prisma.regulatoryItem.deleteMany({
        where: { id: { in: createdRegItemIds } },
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

  it("aggregates seeded alerts across severity, regulator, domain, and status", async () => {
    // Six seeded alerts spanning each axis at least once:
    //   high+SEC+bsa_aml+open
    //   high+FINRA+complaint_handling+open
    //   medium+CFPB+fair_lending+open
    //   medium+OCC+reg_e+accepted
    //   low+SEC+reg_z+dismissed
    //   low+FINRA+vendor_management+escalated
    await seedAlert({
      regulator: "SEC",
      severity: "high",
      domain: "bsa_aml",
      status: "open",
    });
    await seedAlert({
      regulator: "FINRA",
      severity: "high",
      domain: "complaint_handling",
      status: "open",
    });
    await seedAlert({
      regulator: "CFPB",
      severity: "medium",
      domain: "fair_lending",
      status: "open",
    });
    await seedAlert({
      regulator: "OCC",
      severity: "medium",
      domain: "reg_e",
      status: "accepted",
    });
    await seedAlert({
      regulator: "SEC",
      severity: "low",
      domain: "reg_z",
      status: "dismissed",
    });
    await seedAlert({
      regulator: "FINRA",
      severity: "low",
      domain: "vendor_management",
      status: "escalated",
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      alertsBySeverity: { high: number; medium: number; low: number };
      alertsByRegulator: {
        SEC: number;
        FINRA: number;
        CFPB: number;
        OCC: number;
      };
      alertsByDomain: Record<string, number>;
      alertsByStatus: Record<string, number>;
      totalOpen: number;
      recentIngestion: Array<{
        id: string;
        status: string;
        trigger: string;
        startedAt: string;
        completedAt: string | null;
        itemsProcessed: number;
        itemsFlagged: number;
        itemsSuppressed: number;
      }>;
    };

    // Severity: +2 high, +2 medium, +2 low.
    expect(body.alertsBySeverity.high).toBe(baseline.alertsBySeverity.high + 2);
    expect(body.alertsBySeverity.medium).toBe(
      baseline.alertsBySeverity.medium + 2,
    );
    expect(body.alertsBySeverity.low).toBe(baseline.alertsBySeverity.low + 2);

    // Regulator: +2 SEC, +2 FINRA, +1 CFPB, +1 OCC.
    expect(body.alertsByRegulator.SEC).toBe(
      baseline.alertsByRegulator.SEC + 2,
    );
    expect(body.alertsByRegulator.FINRA).toBe(
      baseline.alertsByRegulator.FINRA + 2,
    );
    expect(body.alertsByRegulator.CFPB).toBe(
      baseline.alertsByRegulator.CFPB + 1,
    );
    expect(body.alertsByRegulator.OCC).toBe(
      baseline.alertsByRegulator.OCC + 1,
    );

    // Domain: each appears exactly once.
    expect(body.alertsByDomain.bsa_aml).toBe(
      (baseline.alertsByDomain.bsa_aml ?? 0) + 1,
    );
    expect(body.alertsByDomain.complaint_handling).toBe(
      (baseline.alertsByDomain.complaint_handling ?? 0) + 1,
    );
    expect(body.alertsByDomain.fair_lending).toBe(
      (baseline.alertsByDomain.fair_lending ?? 0) + 1,
    );
    expect(body.alertsByDomain.reg_e).toBe(
      (baseline.alertsByDomain.reg_e ?? 0) + 1,
    );
    expect(body.alertsByDomain.reg_z).toBe(
      (baseline.alertsByDomain.reg_z ?? 0) + 1,
    );
    expect(body.alertsByDomain.vendor_management).toBe(
      (baseline.alertsByDomain.vendor_management ?? 0) + 1,
    );

    // Status: +3 open (3 seeded as open), +1 each of accepted/dismissed/escalated.
    expect(body.alertsByStatus.open).toBe(
      (baseline.alertsByStatus.open ?? 0) + 3,
    );
    expect(body.alertsByStatus.accepted).toBe(
      (baseline.alertsByStatus.accepted ?? 0) + 1,
    );
    expect(body.alertsByStatus.dismissed).toBe(
      (baseline.alertsByStatus.dismissed ?? 0) + 1,
    );
    expect(body.alertsByStatus.escalated).toBe(
      (baseline.alertsByStatus.escalated ?? 0) + 1,
    );

    // totalOpen matches the explicit open-count delta.
    expect(body.totalOpen).toBe(baseline.totalOpen + 3);

    // recentIngestion: array, capped at 5, sorted desc by startedAt.
    expect(Array.isArray(body.recentIngestion)).toBe(true);
    expect(body.recentIngestion.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < body.recentIngestion.length; i++) {
      const prev = new Date(body.recentIngestion[i - 1].startedAt).getTime();
      const cur = new Date(body.recentIngestion[i].startedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
    // Each entry must surface the IngestionRun fields the dashboard renders.
    if (body.recentIngestion.length > 0) {
      const first = body.recentIngestion[0];
      expect(typeof first.id).toBe("string");
      expect(typeof first.status).toBe("string");
      expect(typeof first.trigger).toBe("string");
      expect(typeof first.itemsProcessed).toBe("number");
    }
  });

  it("returns the canonical severity and regulator keys even when the DB is empty for those buckets", async () => {
    // The route guarantees the canonical keys always appear (dashboard cards
    // depend on this), even when no alerts of that severity/regulator exist.
    // We verify on the live response (post-seed): the four regulator and
    // three severity keys all exist as numbers.
    const response = await GET();
    const body = (await response.json()) as {
      alertsBySeverity: Record<string, number>;
      alertsByRegulator: Record<string, number>;
    };
    for (const key of ["high", "medium", "low"]) {
      expect(typeof body.alertsBySeverity[key]).toBe("number");
    }
    for (const key of ["SEC", "FINRA", "CFPB", "OCC"]) {
      expect(typeof body.alertsByRegulator[key]).toBe("number");
    }
  });
});
