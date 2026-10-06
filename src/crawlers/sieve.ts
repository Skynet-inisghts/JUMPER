import { THRESHOLDS } from "../score/config.js";
import type { LedgerOut, ScoutOut, SieveOut, Tape, WeaverOut } from "./types.js";

/**
 * SIEVE: throws out the noise. Dust under $50, balances that arrived by
 * transfer with no cost basis, and wallets for which this token is the
 * first trade of their life. What is left is the clean set.
 *
 * Without a dollar rate the dust line falls back to a share of supply
 * (one in a hundred thousand): a dollar line that floats with a missing
 * price would sieve the same token differently on every run.
 */
export function sieve(tape: Tape, web: WeaverOut, scouted: ScoutOut, books: LedgerOut): SieveOut {
  const dust: string[] = [];
  const transferOnly: string[] = [];
  const virgins = new Set(scouted.virgins);
  const dustFloor = tape.launch.totalSupply / 100_000n;

  for (const h of web.holders) {
    const usd = books.books.get(h.address)?.valueUsd ?? null;
    const isDust = usd !== null ? usd < THRESHOLDS.dustUsd : h.balance < dustFloor;
    if (isDust) dust.push(h.address);
    else if (h.bought === 0n && h.received > 0n) transferOnly.push(h.address);
  }

  const out = new Set([...dust, ...transferOnly, ...virgins]);
  const clean = web.holders.filter((h) => !out.has(h.address)).map((h) => h.address);
  const cleanSupply = web.holders.filter((h) => !out.has(h.address)).reduce((s, h) => s + h.balance, 0n);
  return { dust, transferOnly, virgins: [...virgins], removed: out.size, clean, cleanSupply };
}
