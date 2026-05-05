import { afterAll, describe, expect, it } from "@jest/globals";
import { prisma } from "@/lib/db";

describe("Prisma client (INFRA-002)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("connects to the SQLite database via the libsql adapter", async () => {
    const result = await prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 as one`;
    expect(result[0].one).toBe(1);
  });

  it("exposes a delegate for every declared model", () => {
    expect(prisma.regulatoryItem).toBeDefined();
    expect(prisma.policyDocument).toBeDefined();
    expect(prisma.policyChunk).toBeDefined();
    expect(prisma.alert).toBeDefined();
    expect(prisma.auditEntry).toBeDefined();
    expect(prisma.ingestionRun).toBeDefined();
    expect(prisma.llmCallLog).toBeDefined();
  });

  it("returns the same singleton instance on repeated import", async () => {
    const again = (await import("@/lib/db")).prisma;
    expect(again).toBe(prisma);
  });
});
