// Backtest for the /proof page: what JUMPER would have said about a token
// thirty minutes after its launch, next to what its price did afterwards.
//
//   pnpm build:cli && node scripts/proof.mjs tokens.json [out.json]
//
// tokens.json is a list of { token } (or plain addresses), for example the
// busiest launches of the last days. Each token is read in full, then its
// Tape is cut at launch + 30 min: only the chain up to that block is kept.
// The wallet index and its books describe today, so they are dropped:
// SCOUT and LEDGER run as if the index were offline, nothing from after
// the cut leaks into the verdict. The price after the cut decides the
// outcome: fell 90% or more from the cut price by now, or reached 2x of it.
import { readFileSync, writeFileSync } from "node:fs";
import { crawl } from "../.jumper-build/crawl.js";
import { crawlTape } from "../.jumper-build/crawlers/pipeline.js";
import { loadEnv } from "../.jumper-build/env.js";

loadEnv(new URL("../.env", import.meta.url).pathname);
const [, , input, output = "web/sample/proof.json"] = process.argv;
const CUT_SEC = 30 * 60;
const MIN_AGE_SEC = 6 * 3600;
const list = JSON.parse(readFileSync(input, "utf8")).map((x) => (typeof x === "string" ? x : x.token));

/** Whole quote per whole token, in block order: curve trades, then pool swaps. */
function prices(tape) {
  const toWhole = 1e18 / 10 ** tape.launch.pairDecimals;
  const pts = [];
  for (const t of tape.trades) if (t.tokens > 0n) pts.push({ block: t.block, px: (Number(t.quoteWei) / Number(t.tokens)) * toWhole });
  for (const s of tape.swaps ?? []) if (s.price > 0) pts.push({ block: s.block, px: s.price * toWhole });
  return pts.sort((a, b) => a.block - b.block);
}

function cut(tape, block) {
  const keep = (xs) => (xs ?? []).filter((x) => x.block <= block);
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
  };
}

const rows = [];
let skipped = 0;
for (const [i, token] of list.entries()) {
  try {
    // fundings are dropped below, so KNOT is not asked; a token that will not read in two minutes is skipped
    let timer;
    const { tape } = await Promise.race([
      crawl(token, undefined, { knotBudgetMs: 1 }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("no answer in two minutes")), 120_000); }),
    ]).finally(() => clearTimeout(timer));
    const age = tape.now - tape.launch.launchedAt;
    if (age < MIN_AGE_SEC) { skipped++; continue; }
    const cutBlock = tape.launch.launchBlock + Math.round(CUT_SEC / tape.secPerBlock);
    const pts = prices(tape);
    const before = pts.filter((p) => p.block <= cutBlock);
    const after = pts.filter((p) => p.block > cutBlock);
    if (!before.length || !after.length) { skipped++; continue; }
    const r = crawlTape(cut(tape, cutBlock));
    if (r.outcome) { skipped++; continue; }
    const p0 = before[before.length - 1].px;
    const peak = Math.max(...after.map((p) => p.px));
    const now = pts[pts.length - 1].px;
    rows.push({
      token: tape.launch.token,
      symbol: tape.launch.symbol,
      launchedAt: tape.launch.launchedAt,
      score: r.score,
      band: r.band,
      verdict: r.verdict,
      facts: r.facts,
      holdersAtCut: r.metrics.holders,
      priceAtCut: p0,
      peakAfter: peak,
      priceNow: now,
      peakX: Math.round((peak / p0) * 100) / 100,
      changeNow: Math.round((now / p0 - 1) * 1000) / 10,
      checkedAt: tape.now,
    });
    console.log(`${i + 1}/${list.length} $${tape.launch.symbol} ${r.score} ${r.band} · peak ${(peak / p0).toFixed(2)}x · now ${((now / p0 - 1) * 100).toFixed(0)}%`);
  } catch (e) {
    skipped++;
    console.log(`${i + 1}/${list.length} ${token} failed: ${String(e.message ?? e).slice(0, 80)}`);
  }
}
// a crawl left running past its timeout must not hold the process open
setTimeout(() => process.exit(0), 5_000).unref();

const by = (band) => rows.filter((r) => r.band === band);
const stat = (xs) => ({
  n: xs.length,
  fell90: xs.filter((r) => r.changeNow <= -90).length,
  reached2x: xs.filter((r) => r.peakX >= 2).length,
});
writeFileSync(output, JSON.stringify({
  cutMin: CUT_SEC / 60,
  generatedAt: new Date().toISOString(),
  tested: rows.length,
  skipped,
  bands: { TORN: stat(by("TORN")), PATCHED: stat(by("PATCHED")), TAUT: stat(by("TAUT")) },
  rugs: by("TORN").filter((r) => r.changeNow <= -90).sort((a, b) => a.changeNow - b.changeNow),
  gems: rows.filter((r) => r.band !== "TORN" && r.peakX >= 2).sort((a, b) => b.peakX - a.peakX),
  rows,
}, null, 1));
console.log(`tested ${rows.length}, skipped ${skipped} -> ${output}`);
