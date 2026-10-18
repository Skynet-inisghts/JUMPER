import { NextResponse } from "next/server";
import type { Address } from "viem";
import { indexConfigured, readWatchScoreQueue, writeWatchScore } from "@engine/chain/history.js";
import { blockedMessage } from "@engine/blocked.js";
import { crawlShared } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/watch-score, run by the Vercel cron every five minutes: each
 * token someone watches in the bot is crawled again every half hour, and
 * its score goes to the index. When its label changes (PATCHED to TORN,
 * say), jumper-watch tells every chat that watches it.
 *
 * One deployment scores (JUMPER_RADAR_SCORER=1); the others only read.
 */

const BUDGET_MS = 240_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not allowed" }, { status: 401 });
  }
  if (!process.env.JUMPER_RADAR_SCORER) return NextResponse.json({ error: "this deployment does not score" }, { status: 404 });
  if (!indexConfigured()) return NextResponse.json({ error: "no wallet index configured" }, { status: 503 });

  const deadline = Date.now() + BUDGET_MS;
  const queue = await readWatchScoreQueue().catch(() => [] as string[]);
  const done: { token: string; result: string; ms: number }[] = [];
  for (const token of queue) {
    if (deadline - Date.now() < 30_000) break;
    if (blockedMessage(token)) continue;
    const t = Date.now();
    try {
      // a fresh crawl, not the cached report: the point is to see a change
      const report = await crawlShared(token as Address).promise;
      const r = await writeWatchScore(token, report.score, report.band, report.label);
      done.push({ token, result: `${report.score} ${report.label}${r.changed ? " changed" : ""}`, ms: Date.now() - t });
    } catch (e) {
      done.push({ token, result: `failed: ${String((e as Error).message ?? e).slice(0, 60)}`, ms: Date.now() - t });
    }
  }
  console.log(`watch-score ${JSON.stringify(done)}`);
  return NextResponse.json({ queue: queue.length, done });
}
