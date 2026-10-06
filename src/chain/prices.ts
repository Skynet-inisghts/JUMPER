import { blockscoutFetch, blockscoutKey } from "./blockscout.js";
import { SOURCES } from "./chain.js";

/**
 * Dollar rates, only where a dollar figure is the honest unit: SIEVE's
 * dust line ($50) and LEDGER's "what it is worth now". Every rate carries
 * its source; a missing rate leaves the dollar fields empty rather than
 * guessed.
 */

export interface UsdRate {
  usd: number;
  source: string;
}

async function getJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "jumper/0.1" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function ethUsd(): Promise<UsdRate | null> {
  if (blockscoutKey()) {
    try {
      const stats = (await blockscoutFetch("/api/v2/stats")) as { coin_price?: string | null };
      const v = Number(stats.coin_price);
      if (v > 0) return { usd: v, source: "blockscout" };
    } catch { /* next source */ }
  }
  try {
    const data = (await getJson("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")) as { ethereum?: { usd?: number } };
    const v = Number(data.ethereum?.usd);
    if (v > 0) return { usd: v, source: "coingecko" };
  } catch { /* none */ }
  return null;
}

/** A pair token's dollar rate (a stock token, a stablecoin): explorer rate first, then the token's best DEX pair. */
export async function tokenUsd(token: string): Promise<UsdRate | null> {
  if (blockscoutKey()) {
    try {
      const info = (await blockscoutFetch(`/api/v2/tokens/${token}`)) as { exchange_rate?: string | null };
      const v = Number(info.exchange_rate);
      if (v > 0) return { usd: v, source: "blockscout" };
    } catch { /* next source */ }
  }
  return dexPriceUsd(token);
}

/** The deepest Robinhood pair's dollar price for a token, from DexScreener. */
export async function dexPriceUsd(token: string): Promise<UsdRate | null> {
  try {
    const data = (await getJson(`${SOURCES.dexscreener}/latest/dex/tokens/${token}`)) as {
      pairs?: { chainId: string; priceUsd?: string; liquidity?: { usd?: number }; baseToken: { address: string } }[];
    };
    const pairs = (data.pairs ?? [])
      .filter((p) => p.chainId === "robinhood" && p.baseToken.address.toLowerCase() === token.toLowerCase() && Number(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    if (!pairs[0]) return null;
    return { usd: Number(pairs[0].priceUsd), source: "dexscreener" };
  } catch {
    return null;
  }
}
