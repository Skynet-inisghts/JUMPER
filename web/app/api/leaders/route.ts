import { NextResponse } from "next/server";
import { indexConfigured, readLeaders } from "@engine/chain/history.js";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/leaders?by=realized|winrate -> the index's leaderboard, cached at the edge for five minutes. */
export async function GET(request: Request) {
  const by = new URL(request.url).searchParams.get("by") === "winrate" ? "winrate" : "realized";
  if (!indexConfigured()) return NextResponse.json({ error: "the wallet index is offline" }, { status: 503 });
  try {
    return NextResponse.json(await readLeaders(by), { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "the wallet index did not answer" }, { status: 502 });
  }
}
