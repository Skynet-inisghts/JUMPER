import { NextResponse } from "next/server";
import { indexConfigured, readLatest } from "@engine/chain/history.js";
import { coalesce, TtlCache } from "@engine/web.js";
import type { Report } from "@engine/crawlers/types.js";
import sample from "@/sample/sample-report.json";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/latest -> { report, sample } with the newest full report the index
 * holds, cached for 60 s. Without one, the bundled report of a real past
 * crawl, flagged sample so the page says it is a replay.
 */

const cache = new TtlCache<Report>(2);

export async function GET() {
  const headers = { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
  const hit = cache.get("latest");
  if (hit) return NextResponse.json({ report: hit, sample: false }, { headers });
  if (indexConfigured()) {
    try {
      const { report } = await coalesce("latest", () => readLatest<Report>());
      // reports recorded before the room had panels and candles cannot fill it
      if (report && report.version === 1 && Array.isArray(report.crawlers) && report.panels && Array.isArray(report.chart)) {
        cache.set("latest", report, 60_000);
        return NextResponse.json({ report, sample: false }, { headers });
      }
    } catch {
      /* falls through to the bundled replay */
    }
  }
  return NextResponse.json({ report: sample, sample: true }, { headers: { "cache-control": "no-store" } });
}
