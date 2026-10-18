import { ethUsd } from "@engine/chain/prices.js";

let rate: { at: number; usd: number | null } = { at: 0, usd: null };

/** ETH in dollars, read at most every five minutes; the last rate stands when a read fails. */
export async function ethPrice(): Promise<number | null> {
  if (Date.now() - rate.at < 300_000 && rate.usd) return rate.usd;
  const r = await ethUsd().catch(() => null);
  if (r?.usd) rate = { at: Date.now(), usd: r.usd };
  return rate.usd;
}
