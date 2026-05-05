import { afterAll, describe, expect, it } from "@jest/globals";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/db";

describe("GET /api/health (API-001)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 200 with status, timestamp, and db=connected", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      timestamp: string;
      db: string;
    };

    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
