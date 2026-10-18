import { NextResponse } from "next/server";
import type { Address } from "viem";
import { indexConfigured, readRadarScoreQueue, writeRadarScore } from "@engine/chain/history.js";
import { blockedMessage } from "@engine/blocked.js";
import { cachedReport, crawlShared } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/radar-score, run by the Vercel cron every two minutes: every
 * token on the radar gets the full crawl, and its score goes back to the
 * index for the radar's cards. A score is refreshed after half an hour.
 *
 * One deployment scores (JUMPER_RADAR_SCORER=1); the others only read.
 */

const BUDGET_MS = 240_000;
const FRESH_SEC = 30 * 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not allowed" }, { status: 401 });
  }
  if (!process.env.JUMPER_RADAR_SCORER) return NextResponse.json({ error: "this deployment does not score the radar" }, { status: 404 });
  if (!indexConfigured()) return NextResponse.json({ error: "no wallet index configured" }, { status: 503 });

  const deadline = Date.now() + BUDGET_MS;
  const now = Math.floor(Date.now() / 1000);
  const queue = (await readRadarScoreQueue().catch(() => [])).filter((q) => !q.scoredAt || now - q.scoredAt > FRESH_SEC);
  const done: { token: string; result: string; ms: number }[] = [];
  for (const q of queue) {
    if (deadline - Date.now() < 30_000) break;
    if (blockedMessage(q.token)) continue;
    const t = Date.now();
    try {
      const report = cachedReport(q.token) ?? (await crawlShared(q.token as Address).promise);
      await writeRadarScore(q.token, report.score, report.band, report.label);
      done.push({ token: q.token, result: `${report.score} ${report.label}`, ms: Date.now() - t });
    } catch (e) {
      done.push({ token: q.token, result: `failed: ${String((e as Error).message ?? e).slice(0, 60)}`, ms: Date.now() - t });
    }
  }
  console.log(`radar-score ${JSON.stringify(done)}`);
  return NextResponse.json({ queue: queue.length, done });
}
