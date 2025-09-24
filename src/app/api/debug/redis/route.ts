import { NextResponse } from "next/server";
import { getCursor, setCursor } from "@/lib/state/cursor";

export const runtime = "nodejs";

export async function GET() {
  const before = await getCursor();
  await setCursor(before.round + 1, before.intra + 1);
  const after = await getCursor();
  return NextResponse.json({ before, after });
}
