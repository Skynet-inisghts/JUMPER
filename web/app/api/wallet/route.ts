import { NextResponse } from "next/server";
import { indexConfigured, readWallet, type WalletCheck } from "@engine/chain/history.js";
import { clientIp, coalesce, RateLimiter, TtlCache } from "@engine/web.js";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet?address=0x.. -> one wallet for the wallet check: its record
 * across Pons, the markets it traded last with JUMPER's verdict where one
 * was crawled, and the crawls whose report names it. Cached a minute.
 */

const limiter = new RateLimiter(30, 60_000);
const cache = new TtlCache<WalletCheck>(500);

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "pass a wallet address" }, { status: 400 });
  if (!indexConfigured()) return NextResponse.json({ error: "the wallet index is offline" }, { status: 503 });
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit) return NextResponse.json(hit);
  if (!limiter.allow(clientIp(request))) return NextResponse.json({ error: "thirty wallet checks a minute is the ceiling" }, { status: 429 });
  try {
    const w = await coalesce(`wallet:${key}`, () => readWallet(key));
    cache.set(key, w, 60_000);
    return NextResponse.json(w);
  } catch {
    return NextResponse.json({ error: "the wallet index did not answer; try again in a moment" }, { status: 502 });
  }
}
