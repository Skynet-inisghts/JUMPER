import { NextResponse } from "next/server";
import { indexConfigured, readPulse, type Pulse } from "@engine/chain/history.js";
import { coalesce, TtlCache } from "@engine/web.js";
import recent from "@/sample/recent.json";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pulse -> the index's counters and recently crawled tokens, cached
 * for 20 s. Without an index (or when it fails) the answer says offline and
 * carries the bundled list of real past crawls instead.
 */

const cache = new TtlCache<Pulse>(2);

export async function GET() {
  const headers = { "cache-control": "public, s-maxage=20, stale-while-revalidate=60" };
  const hit = cache.get("pulse");
  if (hit) return NextResponse.json(hit, { headers });
  if (indexConfigured()) {
    try {
      const pulse = await coalesce("pulse", () => readPulse());
      cache.set("pulse", pulse, 20_000);
      return NextResponse.json(pulse, { headers });
    } catch {
      /* falls through to the offline answer */
    }
  }
  return NextResponse.json({ offline: true, recent }, { headers: { "cache-control": "no-store" } });
}
