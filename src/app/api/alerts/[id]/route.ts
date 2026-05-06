import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        regulatoryItem: true,
        policyChunk: {
          include: { policyDocument: true },
        },
        auditEntries: {
          orderBy: { timestamp: "asc" },
        },
      },
    });

    if (!alert) {
      return NextResponse.json(
        { error: "Alert not found", id },
        { status: 404 },
      );
    }

    return NextResponse.json(alert);
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to load alert", details },
      { status: 500 },
    );
  }
}
