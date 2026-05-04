import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  let dbStatus: "connected" | "error" = "error";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch {
    dbStatus = "error";
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    db: dbStatus,
  });
}
