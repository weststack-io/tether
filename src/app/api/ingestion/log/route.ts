import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    runs: [],
    total: 0,
    page: 1,
    totalPages: 0,
  });
}
