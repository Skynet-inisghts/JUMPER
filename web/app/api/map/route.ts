import { NextResponse } from "next/server";
import { indexConfigured, readMap } from "@engine/chain/history.js";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/map: every busy Pons launch of the last day, for the launchpad map. */
export async function GET() {
  if (!indexConfigured()) return NextResponse.json({ error: "no index configured" }, { status: 503 });
  const data = await readMap().catch(() => null);
  if (!data) return NextResponse.json({ error: "the map did not answer" }, { status: 502 });
  return NextResponse.json(data, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
