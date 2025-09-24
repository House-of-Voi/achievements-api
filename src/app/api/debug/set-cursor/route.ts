import { NextRequest, NextResponse } from "next/server";
import { setCursor } from "@/lib/state/cursor";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const round = Number(body.round ?? 0);
  const intra = Number(body.intra ?? 0);
  await setCursor(round, intra);
  return NextResponse.json({ ok: true, round, intra });
}
