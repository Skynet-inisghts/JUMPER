import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { publicClient } from "@engine/chain/chain.js";
import { readDevLaunches } from "@engine/chain/devhistory.js";
import { indexConfigured, readDevTokens, type DevToken } from "@engine/chain/history.js";
import { readLaunch } from "@engine/chain/launches.js";
import { coalesce, TtlCache } from "@engine/web.js";
import { ethPrice } from "@/lib/eth";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/dev?address=0x..  a dev's dossier: every token the address
 * launched through the Pons factory, what each became, how the dev traded
 * it, and a plain verdict from that record. A token address is taken too:
 * its deployer's dossier comes back.
 */

export interface Dossier {
  dev: string; complete: boolean; ethUsd: number | null;
  rows: DevToken[];
  summary: { launches: number; read: number; dumped: number; dead: number; peaked100k: number; devNetEth: number; verdict: string; tone: "bad" | "mid" | "ok" | "d" };
}

const cache = new TtlCache<Dossier>(300);

/** The record in one line. A launch counts as dumped when the dev sold 90% of their bag or more, dead when its cap is down 90% from the peak. */
function verdict(rows: DevToken[]): Pick<Dossier["summary"], "verdict" | "tone" | "dumped" | "dead"> {
  const traded = rows.filter((r) => r.devSold != null);
  const dumped = traded.filter((r) => (r.devSold ?? 0) >= 0.9).length;
  const dead = rows.filter((r) => r.peakMcapEth && r.nowMcapEth != null && r.nowMcapEth / r.peakMcapEth <= 0.1).length;
  if (rows.length < 2) return { verdict: "one launch, too little to judge", tone: "d", dumped, dead };
  const dumpShare = traded.length ? dumped / traded.length : 0;
  const deadShare = dead / rows.length;
  if (rows.length >= 3 && dumpShare >= 0.7) return { verdict: deadShare >= 0.6 ? "serial dumper: sells out of most launches and they die" : "serial dumper: sells out of most launches", tone: "bad", dumped, dead };
  if (dumpShare >= 0.5 || deadShare >= 0.7) return { verdict: "mixed record: half or more of the launches were dumped or died", tone: "mid", dumped, dead };
  return { verdict: "keeps their launches: most not dumped by the dev", tone: "ok", dumped, dead };
}

async function build(dev: string): Promise<Dossier> {
  const head = Number(await publicClient.getBlockNumber());
  const { launches, complete } = await readDevLaunches(dev as `0x${string}`, head);
  const tokens = launches.slice(0, 80).map((l) => l.token);
  const [{ rows }, usd] = await Promise.all([tokens.length ? readDevTokens(dev, tokens) : Promise.resolve({ dev, rows: [] as DevToken[] }), ethPrice()]);
  const sorted = [...rows].sort((a, b) => a.ageMin - b.ageMin);
  const v = verdict(sorted);
  return {
    dev, complete, ethUsd: usd, rows: sorted,
    summary: {
      launches: launches.length, read: sorted.length, ...v,
      peaked100k: usd ? sorted.filter((r) => (r.peakMcapEth ?? 0) * usd >= 100_000).length : 0,
      devNetEth: sorted.reduce((a, r) => a + r.devSellEth - r.devBuyEth, 0),
    },
  };
}

export async function GET(request: Request) {
  if (!indexConfigured()) return NextResponse.json({ error: "no index configured" }, { status: 503 });
  const raw = new URL(request.url).searchParams.get("address") ?? "";
  if (!isAddress(raw)) return NextResponse.json({ error: "pass ?address=0x.. (a dev wallet or one of their tokens)" }, { status: 400 });
  let dev = raw.toLowerCase();
  // a token address stands for its deployer
  const asToken = await readLaunch(getAddress(raw)).catch(() => null);
  if (asToken?.deployer) dev = asToken.deployer.toLowerCase();
  const hit = cache.get(dev);
  if (hit) return NextResponse.json(hit);
  try {
    const d = await coalesce(`dev:${dev}`, () => build(dev));
    cache.set(dev, d, 600_000);
    return NextResponse.json(d, { headers: { "cache-control": "public, s-maxage=300" } });
  } catch {
    return NextResponse.json({ error: "the chain read failed; try again in a moment" }, { status: 502 });
  }
}
