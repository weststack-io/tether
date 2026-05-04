import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    alerts: [],
    total: 0,
    page: 1,
    pageSize: 25,
    totalPages: 0,
  });
}
