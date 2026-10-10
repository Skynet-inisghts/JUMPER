import { blockscoutFetchLegacy, blockscoutKey, blockscoutResting } from "./blockscout.js";
import { BURN_ADDRESSES, INFRA_ADDRESSES } from "./chain.js";
import { cachedFunding, keepFunding } from "../cache.js";

/**
 * Where a wallet's first ETH came from. KNOT clusters wallets that were
 * funded from one source within minutes of each other; the funding itself
 * is plain value transfer, which leaves no log, so it is read from the
 * explorer: the earliest incoming transaction and the earliest incoming
 * internal transfer, whichever came first.
 */

export interface Funding {
  wallet: string;
  funder: string;
  ts: number;
  block: number;
  valueWei: string;
  via: "tx" | "internal";
}

interface Row { from?: string; to?: string; value?: string; timeStamp?: string; blockNumber?: string; isError?: string }

async function firstIncoming(wallet: string, action: "txlist" | "txlistinternal"): Promise<Row | null> {
  const data = (await blockscoutFetchLegacy(`module=account&action=${action}&address=${wallet}&sort=asc&page=1&offset=6`)) as { result?: Row[] | string };
  if (!Array.isArray(data.result)) return null;
  const w = wallet.toLowerCase();
  for (const row of data.result) {
    if (row.to?.toLowerCase() !== w || row.isError === "1") continue;
    if (!row.value || row.value === "0") continue;
    return row;
  }
  return null;
}

/** Thrown when the explorer did not answer: unlike "no funding", it is not kept. */
class Unanswered extends Error {}

export async function readFunding(wallet: string): Promise<Funding | null> {
  const kept = cachedFunding(wallet);
  if (kept !== undefined) return kept;
  const [tx, internal] = await Promise.all([
    firstIncoming(wallet, "txlist").catch(() => { throw new Unanswered(); }),
    firstIncoming(wallet, "txlistinternal").catch(() => { throw new Unanswered(); }),
  ]);
  const found = pickFunding(wallet, tx, internal);
  keepFunding(wallet, found);
  return found;
}

function pickFunding(wallet: string, tx: Row | null, internal: Row | null): Funding | null {
  const pick = [tx && { row: tx, via: "tx" as const }, internal && { row: internal, via: "internal" as const }]
    .filter((x): x is { row: Row; via: "tx" | "internal" } => Boolean(x))
    .sort((a, b) => Number(a.row.blockNumber) - Number(b.row.blockNumber))[0];
  if (!pick?.row.from) return null;
  const funder = pick.row.from.toLowerCase();
  if (INFRA_ADDRESSES.has(funder) || BURN_ADDRESSES.has(funder)) return null;
  return {
    wallet: wallet.toLowerCase(),
    funder,
    ts: Number(pick.row.timeStamp ?? 0),
    block: Number(pick.row.blockNumber ?? 0),
    valueWei: pick.row.value ?? "0",
    via: pick.via,
  };
}

/** First funding for a list of wallets, inside a time budget; what is not read in time is simply absent. */
export async function readFundingFor(wallets: string[], budgetMs: number): Promise<{ funding: Funding[]; asked: number; read: number }> {
  if (!blockscoutKey()) return { funding: [], asked: wallets.length, read: 0 };
  const deadline = Date.now() + budgetMs;
  const funding: Funding[] = [];
  let read = 0;
  let next = 0;
  // kept answers first: they cost nothing and never wait on the explorer
  const ask: string[] = [];
  for (const w of wallets) {
    const kept = cachedFunding(w);
    if (kept === undefined) { ask.push(w); continue; }
    read++;
    if (kept) funding.push(kept);
  }
  // the explorer gate spaces requests itself; three lanes keep it saturated.
  // The budget is a hard stop: lookups still out when it ends are dropped.
  const lane = async () => {
    while (next < ask.length && Date.now() < deadline && !blockscoutResting()) {
      const w = ask[next++];
      const f = await readFunding(w).catch(() => undefined);
      if (Date.now() > deadline) return;
      if (f === undefined) continue;
      read++;
      if (f) funding.push(f);
    }
  };
  const timer = new Promise<void>((r) => setTimeout(r, Math.max(0, deadline - Date.now())).unref?.());
  await Promise.race([Promise.all([lane(), lane(), lane()]), timer]);
  return { funding, asked: wallets.length, read };
}
