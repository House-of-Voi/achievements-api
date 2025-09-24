import { NextResponse } from "next/server";
import { getCursor } from "@/lib/state/cursor";

export const runtime = "nodejs";

export async function GET() {
  const cur = await getCursor();
  return NextResponse.json({ cursor: cur });
}
