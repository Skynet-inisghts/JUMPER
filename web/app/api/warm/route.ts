import { NextResponse } from "next/server";
import type { Address } from "viem";
import { warmLogs } from "@engine/crawl.js";
import { indexConfigured, readActive } from "@engine/chain/history.js";
import { inBackground } from "@engine/chain/rpc.js";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/warm, run by the Vercel cron every minute: the five tokens
 * busiest on Pons in the last hour get their logs read into the cache, so the first
 * crawl anyone runs on them reads only the newest blocks. Each token picks
 * up where its cache stopped; a cold one is read from launch.
 */

/** Stops short of the function's limit; a token not reached waits for the next run. */
const WARM_BUDGET_MS = 55_000;
const WARM_TOKENS = 5;
/** A long history takes its turn and resumes on the next run: the others are not kept waiting. */
const PER_TOKEN_MS = 30_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not allowed" }, { status: 401 });
  }
  if (!indexConfigured()) return NextResponse.json({ error: "no wallet index configured" }, { status: 503 });

  const deadline = Date.now() + WARM_BUDGET_MS;
  const tokens = (await readActive().catch(() => [] as string[])).slice(0, WARM_TOKENS);
  const warmed: { token: string; transfers: number; ms: number }[] = [];
  for (const token of tokens) {
    const left = deadline - Date.now();
    if (left < 5_000) break;
    const t = Date.now();
    // live crawls on this instance go first
    const transfers = await inBackground(() => warmLogs(token as Address, undefined, Math.min(left, PER_TOKEN_MS))).catch(() => -1);
    warmed.push({ token, transfers, ms: Date.now() - t });
  }
  return NextResponse.json({ active: tokens.length, warmed });
}
