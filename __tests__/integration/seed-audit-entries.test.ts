import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { createClient } from "@libsql/client";
import { prisma } from "@/lib/db";
import { seedDemoAlerts } from "@/lib/seed/demo-alerts";

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const libsql = createClient({ url: databaseUrl });

const REQUIRED_CHUNKS = [
  { domain: "marketing", sectionHeading: "5. Pre-Publication Review Workflow" },
  { domain: "overdraft", sectionHeading: "8. Fee Structure and Limits" },
  { domain: "fair_lending", sectionHeading: "5. Marketing and Outreach" },
] as const;

async function ensurePolicyCorpus(): Promise<void> {
  for (const { domain, sectionHeading } of REQUIRED_CHUNKS) {
    const found = await prisma.policyChunk.findFirst({
      where: {
        sectionHeading,
        policyDocument: { domain },
      },
      select: { id: true },
    });
    if (!found) {
      throw new Error(
        `seed-audit-entries.test: missing PolicyChunk for domain=${domain} section="${sectionHeading}". Run \`npx prisma db seed\` first.`,
      );
    }
  }
}

beforeAll(async () => {
  await ensurePolicyCorpus();
  await seedDemoAlerts(libsql);
}, 30_000);

afterAll(async () => {
  await libsql.close();
  await prisma.$disconnect();
});

describe("SEED-004 seeded reviewer audit entries", () => {
  it("creates reviewer audit entries for multiple demo alerts", async () => {
    const entries = await prisma.auditEntry.findMany({
      where: {
        alertId: { startsWith: "seed-demo-alerts-alt-" },
        actor: "reviewer",
      },
      orderBy: { timestamp: "asc" },
      select: { alertId: true, action: true },
    });

    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(new Set(entries.map((entry) => entry.alertId)).size).toBeGreaterThan(1);

    const actions = new Set(entries.map((entry) => entry.action));
    expect(actions.has("accepted")).toBe(true);
    expect(actions.has("dismissed")).toBe(true);
    expect(actions.has("escalated")).toBe(true);
  });

  it("stores before/after state JSON and notes where applicable", async () => {
    const entries = await prisma.auditEntry.findMany({
      where: {
        alertId: { startsWith: "seed-demo-alerts-alt-" },
        actor: "reviewer",
      },
      orderBy: [{ alertId: "asc" }, { timestamp: "asc" }],
      select: {
        alertId: true,
        action: true,
        beforeState: true,
        afterState: true,
        note: true,
      },
    });

    expect(entries.length).toBeGreaterThanOrEqual(3);

    for (const entry of entries) {
      expect(entry.beforeState).not.toBeNull();
      expect(entry.afterState).not.toBeNull();

      const before = JSON.parse(entry.beforeState as string) as Record<string, unknown>;
      const after = JSON.parse(entry.afterState as string) as Record<string, unknown>;

      expect(before.status).toBe("open");
      expect(before.severity).toEqual(after.severity);
      expect(after.status).toBe(entry.action);

      if (entry.action === "accepted") {
        expect(entry.note).toBeNull();
      }
      if (entry.action === "dismissed") {
        expect(entry.note).toBe("already_addressed");
        expect(after.dismissReason).toBe("already_addressed");
      }
      if (entry.action === "escalated") {
        expect(entry.note).toContain("Fair Lending Committee");
        expect(after.escalationNote).toBe(entry.note);
      }
    }
  });

  it("updates the seeded alert rows to match the last reviewer action", async () => {
    const alerts = await prisma.alert.findMany({
      where: {
        id: {
          in: [
            "seed-demo-alerts-alt-001",
            "seed-demo-alerts-alt-003",
            "seed-demo-alerts-alt-004",
          ],
        },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        dismissReason: true,
        escalationNote: true,
      },
    });

    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toMatchObject({
      id: "seed-demo-alerts-alt-001",
      status: "accepted",
      dismissReason: null,
      escalationNote: null,
    });
    expect(alerts[1]).toMatchObject({
      id: "seed-demo-alerts-alt-003",
      status: "dismissed",
      dismissReason: "already_addressed",
      escalationNote: null,
    });
    expect(alerts[2]?.id).toBe("seed-demo-alerts-alt-004");
    expect(alerts[2]?.status).toBe("escalated");
    expect(alerts[2]?.dismissReason).toBeNull();
    expect(alerts[2]?.escalationNote).toContain("Fair Lending Committee");
  });
});
