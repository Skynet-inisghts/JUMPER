import { NextResponse } from "next/server";
import { indexConfigured, readSmartFlow } from "@engine/chain/history.js";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/smartflow -> tokens smart wallets bought in the last hour, cached at the edge for a minute. */
export async function GET() {
  if (!indexConfigured()) return NextResponse.json({ error: "the wallet index is offline" }, { status: 503 });
  try {
    return NextResponse.json(await readSmartFlow(), { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch {
    return NextResponse.json({ error: "the wallet index did not answer" }, { status: 502 });
  }
}
