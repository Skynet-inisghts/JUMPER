import { NextResponse } from "next/server";
import { indexConfigured, readClusters } from "@engine/chain/history.js";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/clusters: wallets that move together, from the two-hourly job. */
export async function GET() {
  if (!indexConfigured()) return NextResponse.json({ error: "no index configured" }, { status: 503 });
  const data = await readClusters().catch(() => null);
  if (!data) return NextResponse.json({ error: "the clusters did not answer" }, { status: 502 });
  return NextResponse.json(data, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" } });
}
