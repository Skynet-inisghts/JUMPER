import { NextResponse } from "next/server";
import type { Address } from "viem";
import { indexConfigured, readProof, readProofCandidates, writeProof } from "@engine/chain/history.js";
import { proveToken, summarize, type Proof, type ProofRow } from "@engine/proof.js";
import { inBackground } from "@engine/chain/rpc.js";
import sample from "@/sample/proof.json";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/proof-tick, run by the Vercel cron every ten minutes: the /proof
 * backtest rolls on by itself. Launches that just became old enough are
 * tested first, then the oldest rows get their prices read again. The run
 * is saved to the index after each token, so a cut-off run loses nothing.
 *
 * One deployment writes (JUMPER_PROOF_WRITER=1); the others only read.
 */

const BUDGET_MS = 270_000;
const PER_TOKEN_MS = 90_000;
/** a row's prices are read again once they are this old */
const REFRESH_SEC = 6 * 3600;
/** launches older than this leave the page */
const KEEP_SEC = 7 * 86400;
const MAX_ROWS = 400;
/** a token that gave no row is not tried again for a day */
const SKIP_RETRY_SEC = 86400;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not allowed" }, { status: 401 });
  }
  if (!process.env.JUMPER_PROOF_WRITER) return NextResponse.json({ error: "this deployment does not write the backtest" }, { status: 404 });
  if (!indexConfigured()) return NextResponse.json({ error: "no wallet index configured" }, { status: 503 });

  const deadline = Date.now() + BUDGET_MS;
  const now = Math.floor(Date.now() / 1000);
  const stored = (await readProof<Proof>()) ?? (sample as unknown as Proof);
  const rows = new Map<string, ProofRow>(stored.rows.map((r) => [r.token.toLowerCase(), r]));
  const skippedAt: Record<string, number> = {};
  for (const [t, at] of Object.entries(stored.skippedAt ?? {})) if (now - at < SKIP_RETRY_SEC) skippedAt[t] = at;

  const candidates = await readProofCandidates().catch(() => [] as string[]);
  const fresh = candidates.filter((t) => !rows.has(t) && !(t in skippedAt));
  const stale = [...rows.values()]
    .filter((r) => now - r.checkedAt > REFRESH_SEC && now - r.launchedAt < KEEP_SEC)
    .sort((a, b) => a.checkedAt - b.checkedAt)
    .map((r) => r.token);
  const queue = [...fresh, ...stale];

  const save = async () => {
    const kept = [...rows.values()]
      .filter((r) => now - r.launchedAt < KEEP_SEC)
      .sort((a, b) => b.launchedAt - a.launchedAt)
      .slice(0, MAX_ROWS);
    await writeProof(summarize(kept, Object.keys(skippedAt).length, skippedAt));
  };

  const done: { token: string; result: string; ms: number }[] = [];
  for (const token of queue) {
    const left = deadline - Date.now();
    if (left < 20_000) break;
    const t = Date.now();
    let result: string;
    try {
      // live crawls on this instance go first
      const row = await inBackground(() => proveToken(token as Address, Math.min(left - 5_000, PER_TOKEN_MS)));
      if (typeof row === "string") {
        skippedAt[token] = now;
        rows.delete(token);
        result = row;
      } else {
        rows.set(token, row);
        result = `${row.score} ${row.band}`;
      }
    } catch (e) {
      // a read that failed is tried again on a later run, the row it had stays
      if (!rows.has(token)) skippedAt[token] = now;
      result = `failed: ${String((e as Error).message ?? e).slice(0, 60)}`;
    }
    done.push({ token, result, ms: Date.now() - t });
    await save().catch(() => {});
  }
  if (!done.length) await save().catch(() => {});
  // one line per run in the function logs
  console.log(`proof ${JSON.stringify({ fresh: fresh.length, stale: stale.length, done })}`);
  return NextResponse.json({ fresh: fresh.length, stale: stale.length, done, rows: rows.size });
}
