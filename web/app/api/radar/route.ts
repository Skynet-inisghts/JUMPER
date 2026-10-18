import { NextResponse } from "next/server";
import type { Address } from "viem";
import { publicClient } from "@engine/chain/chain.js";
import { erc20Abi } from "@engine/chain/abi.js";
import { indexConfigured, readRadar } from "@engine/chain/history.js";
import { TtlCache } from "@engine/web.js";
import "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/radar: the radar rows from the index, each with the token's own name. */

const names = new TtlCache<string>(500);

async function nameOf(token: string): Promise<string> {
  const hit = names.get(token);
  if (hit !== undefined) return hit;
  const name = await publicClient.readContract({ address: token as Address, abi: erc20Abi, functionName: "name" }).catch(() => "");
  names.set(token, name, name ? 86_400_000 : 120_000);
  return name;
}

export async function GET() {
  if (!indexConfigured()) return NextResponse.json({ error: "no index configured" }, { status: 503 });
  const data = await readRadar().catch(() => null);
  if (!data) return NextResponse.json({ error: "the radar did not answer" }, { status: 502 });
  const rows = await Promise.all(data.rows.map(async (r) => ({ ...r, name: await nameOf(r.token) })));
  return NextResponse.json({ ...data, rows }, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" } });
}
