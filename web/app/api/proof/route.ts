import { NextResponse } from "next/server";
import { loadProof } from "@/lib/proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/proof: the rolling backtest's rows, for "looked like this" in a report. */
export async function GET() {
  const proof = await loadProof();
  const rows = proof.rows.map(({ token, symbol, score, band, peakX, changeNow, at }) => ({ token, symbol, score, band, peakX, changeNow, at }));
  return NextResponse.json({ rows }, { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" } });
}
