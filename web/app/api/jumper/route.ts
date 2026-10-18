import { NextResponse } from "next/server";
import { formatUnits, type Address } from "viem";
import { publicClient, BURN_ADDRESSES } from "@engine/chain/chain.js";
import { erc20Abi, SUPPLY } from "@engine/chain/abi.js";
import { blockscoutFetchLegacy } from "@engine/chain/blockscout.js";
import { coalesce, TtlCache } from "@engine/web.js";
import { cachedReport, crawlShared } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/jumper: the site's own token for the $JUMPER block on the home
 * page. Its market and price history (the same crawl a report runs, kept
 * off the scan), what has been burned and the latest burns.
 */

const JUMPER: Address = "0xce4537dc4d7c1e172c437dd92f25e757af927d7a";
const answers = new TtlCache<unknown>(10);

interface Burn { hash: string; from: string; amount: number; at: number }

/** Transfers of $JUMPER into the burn addresses, newest first. */
async function burns(): Promise<Burn[]> {
  const out: Burn[] = [];
  for (const to of BURN_ADDRESSES) {
    const j = (await blockscoutFetchLegacy(`module=account&action=tokentx&contractaddress=${JUMPER}&address=${to}&sort=desc&page=1&offset=50`).catch(() => null)) as
      { result?: { hash: string; from: string; to: string; value: string; timeStamp: string }[] } | null;
    for (const t of Array.isArray(j?.result) ? j.result : []) {
      if (t.to.toLowerCase() !== to || BURN_ADDRESSES.has(t.from.toLowerCase())) continue;
      out.push({ hash: t.hash, from: t.from, amount: Number(formatUnits(BigInt(t.value), 18)), at: Number(t.timeStamp) });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 20);
}

async function build() {
  const [supply, ...held] = await Promise.all([
    publicClient.readContract({ address: JUMPER, abi: erc20Abi, functionName: "totalSupply" }),
    ...[...BURN_ADDRESSES].map((a) => publicClient.readContract({ address: JUMPER, abi: erc20Abi, functionName: "balanceOf", args: [a as Address] })),
  ]);
  // sent to a burn address, plus whatever burn() took out of the supply
  const burnedWei = held.reduce((a, b) => a + b, 0n) + (SUPPLY > supply ? SUPPLY - supply : 0n);
  const report = cachedReport(JUMPER) ?? (await crawlShared(JUMPER).promise.catch(() => null));
  return {
    token: JUMPER,
    symbol: report?.token.symbol ?? "JUMPER",
    burned: Number(formatUnits(burnedWei, 18)),
    burnedPct: Number((burnedWei * 1_000_000n) / SUPPLY) / 10_000,
    burns: await burns().catch(() => []),
    // what the price chart and the market line need, nothing else
    report: report
      ? {
          token: report.token,
          market: report.market,
          chart: report.chart,
          candles: report.candles,
          metrics: { holders: report.metrics.holders },
          panels: { ledger: report.panels?.ledger ? { priceUsd: report.panels.ledger.priceUsd, priceQuote: report.panels.ledger.priceQuote } : undefined },
        }
      : null,
  };
}

export async function GET() {
  const hit = answers.get("jumper");
  const body = hit ?? (await coalesce("jumper", build).catch(() => null));
  if (!body) return NextResponse.json({ error: "the chain read failed; try again in a moment" }, { status: 502 });
  if (!hit) answers.set("jumper", body, 60_000);
  return NextResponse.json(body, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
