import { NextResponse } from "next/server";
import type { Address } from "viem";
import { indexConfigured, readExits } from "@engine/chain/history.js";
import { readLaunch } from "@engine/chain/launches.js";
import { TtlCache } from "@engine/web.js";
import { ethPrice } from "@/lib/eth";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/exits: the last hour's big sells per token, the dev's own sells marked. */

const devs = new TtlCache<string | null>(2000);

async function devOf(token: string): Promise<string | null | undefined> {
  const hit = devs.get(token);
  if (hit !== undefined) return hit;
  const d = (await readLaunch(token as Address).catch(() => null))?.deployer?.toLowerCase() ?? null;
  devs.set(token, d, d ? 7 * 86_400_000 : 300_000);
  return d;
}

/** The page answers in seconds: a dev not read by then is marked on the next poll, from the warm cache. */
const DEV_WAIT_MS = 6_000;

export async function GET() {
  if (!indexConfigured()) return NextResponse.json({ error: "no index configured" }, { status: 503 });
  const [data, usd] = await Promise.all([readExits().catch(() => null), ethPrice()]);
  if (!data) return NextResponse.json({ error: "the exits did not answer" }, { status: 502 });
  const wait = new Promise<undefined>((r) => setTimeout(() => r(undefined), DEV_WAIT_MS));
  const rows = await Promise.all(data.rows.map(async (r) => {
    const dev = await Promise.race([devOf(r.token), wait]);
    const sells = r.sells.map((s) => ({ ...s, dev: dev != null && s.wallet.toLowerCase() === dev }));
    return { ...r, sells, devSold: sells.some((s) => s.dev), mcapUsd: r.mcapEth != null && usd ? r.mcapEth * usd : null, usdOut: usd ? r.eth * usd : null };
  }));
  return NextResponse.json({ at: data.at, rows }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
