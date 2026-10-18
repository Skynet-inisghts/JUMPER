import type { Address } from "viem";
import { crawl } from "./crawl.js";
import { crawlTape } from "./crawlers/pipeline.js";
import type { Tape } from "./crawlers/types.js";

/**
 * The backtest behind the /proof page: what JUMPER would have said about a
 * token two hours after its launch, next to what its price did afterwards.
 *
 * Each token is read in full, then its Tape is cut at launch + the cut:
 * only the chain up to that block is kept. Thirty minutes is too soon:
 * holding is measured against an hour, and at thirty minutes nobody has
 * held one, so every token reads TORN. The wallet index and its books
 * describe today, so they are dropped: SCOUT and LEDGER run as if the index
 * were offline, nothing from after the cut leaks into the verdict. The price
 * after the cut decides the outcome: fell 90% or more from the cut price by
 * now, or reached 2x of it.
 */

export const CUT_SEC = 120 * 60;
/** The outcome needs time to show: six hours after the cut at least. */
export const MIN_AGE_SEC = CUT_SEC + 6 * 3600;

export interface ProofRow {
  token: string;
  symbol: string;
  launchedAt: number;
  score: number;
  band: string;
  verdict: string;
  facts: string[];
  holdersAtCut: number;
  at: {
    sniperSupply: number; sniperHeld: number; bundleSupply: number;
    firstMinuteKept: number | null; hold: number; devState: string; exitPressure: number;
  };
  priceAtCut: number;
  peakAfter: number;
  priceNow: number;
  peakX: number;
  changeNow: number;
  checkedAt: number;
}

export interface Proof {
  cutMin: number;
  generatedAt: string;
  tested: number;
  skipped: number;
  bands: Record<"TORN" | "PATCHED" | "TAUT", { n: number; fell90: number; reached2x: number }>;
  rugs: ProofRow[];
  gems: ProofRow[];
  rows: ProofRow[];
  /** tokens that gave no row, with when they were tried: not tried again for a day */
  skippedAt?: Record<string, number>;
}

/** Whole quote per whole token, in block order: curve trades, then pool swaps. */
function prices(tape: Tape): { block: number; px: number }[] {
  const toWhole = 1e18 / 10 ** tape.launch.pairDecimals;
  const pts: { block: number; px: number }[] = [];
  for (const t of tape.trades) if (t.tokens > 0n) pts.push({ block: t.block, px: (Number(t.quoteWei) / Number(t.tokens)) * toWhole });
  for (const s of tape.swaps ?? []) if (s.price > 0) pts.push({ block: s.block, px: s.price * toWhole });
  return pts.sort((a, b) => a.block - b.block);
}

function cut(tape: Tape, block: number): Tape {
  const keep = <T extends { block: number }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.block <= block);
  return {
    ...tape,
    launch: { ...tape.launch, graduated: false, virtualReserves: null },
    headBlock: block,
    now: tape.launch.launchedAt + CUT_SEC,
    transfers: keep(tape.transfers),
    trades: keep(tape.trades),
    swaps: keep(tape.swaps),
    history: null,
    historyTip: 0,
    books: null,
    funding: [],
    fundingAsked: 0,
    fundingRead: 0,
    tokenUsd: null,
    liquidityUsd: null,
  } as Tape;
}

/** One token's row, or why it gave none. */
export function proofRow(tape: Tape): ProofRow | string {
  const age = tape.now - tape.launch.launchedAt;
  if (age < MIN_AGE_SEC) return "too young";
  const cutBlock = tape.launch.launchBlock + Math.round(CUT_SEC / tape.secPerBlock);
  const pts = prices(tape);
  const before = pts.filter((p) => p.block <= cutBlock);
  const after = pts.filter((p) => p.block > cutBlock);
  if (!before.length || !after.length) return "no trades on one side of the cut";
  const r = crawlTape(cut(tape, cutBlock));
  if ((r as { outcome?: unknown }).outcome) return "no verdict at the cut";
  const p0 = before[before.length - 1].px;
  const peak = Math.max(...after.map((p) => p.px));
  const now = pts[pts.length - 1].px;
  return {
    token: tape.launch.token.toLowerCase(),
    symbol: tape.launch.symbol,
    launchedAt: tape.launch.launchedAt,
    score: r.score,
    band: r.band,
    verdict: r.verdict,
    facts: r.facts,
    holdersAtCut: r.metrics.holders,
    // what the token looked like at the cut, for "similar past tokens"
    at: {
      sniperSupply: r.metrics.sniperSupply, sniperHeld: r.metrics.sniperHeld, bundleSupply: r.metrics.bundleSupply,
      firstMinuteKept: r.metrics.firstMinuteKept, hold: r.metrics.hold, devState: r.metrics.devState, exitPressure: r.metrics.exitPressure,
    },
    priceAtCut: p0,
    peakAfter: peak,
    priceNow: now,
    peakX: Math.round((peak / p0) * 100) / 100,
    changeNow: Math.round((now / p0 - 1) * 1000) / 10,
    checkedAt: tape.now,
  };
}

/** Reads a token in full (no explorer: fundings are dropped at the cut) and backtests it. */
export async function proveToken(token: Address, timeoutMs: number): Promise<ProofRow | string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { tape } = await Promise.race([
    crawl(token, undefined, { knotBudgetMs: 1 }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${Math.round(timeoutMs / 1000)}s`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
  return proofRow(tape);
}

/** The page's numbers from the rows: per band, how many fell 90% and how many reached 2x. */
export function summarize(rows: ProofRow[], skipped: number, skippedAt?: Record<string, number>): Proof {
  const by = (band: string) => rows.filter((r) => r.band === band);
  const stat = (xs: ProofRow[]) => ({
    n: xs.length,
    fell90: xs.filter((r) => r.changeNow <= -90).length,
    reached2x: xs.filter((r) => r.peakX >= 2).length,
  });
  return {
    cutMin: CUT_SEC / 60,
    generatedAt: new Date().toISOString(),
    tested: rows.length,
    skipped,
    bands: { TORN: stat(by("TORN")), PATCHED: stat(by("PATCHED")), TAUT: stat(by("TAUT")) },
    rugs: by("TORN").filter((r) => r.changeNow <= -90).sort((a, b) => a.changeNow - b.changeNow),
    gems: rows.filter((r) => r.band !== "TORN" && r.peakX >= 2).sort((a, b) => b.peakX - a.peakX),
    rows,
    ...(skippedAt ? { skippedAt } : {}),
  };
}
