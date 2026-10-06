import { BURN_ADDRESSES, INFRA_ADDRESSES } from "../chain/chain.js";
import type { Tape } from "./types.js";

/** Lowercase once; every map in a crawl is keyed by lowercase addresses. */
export const lc = (a: string): string => a.toLowerCase();

/**
 * Where tokens are bought from and sold into: the token's curve and the
 * shared infrastructure behind the pool (v4 PoolManager, hook, locker).
 * A transfer out of a venue to a wallet is a buy; into a venue, a sale.
 */
export function venues(tape: Tape): Set<string> {
  return new Set([lc(tape.launch.curve), ...INFRA_ADDRESSES]);
}

/** Never a holder: venues, burn addresses and the token contract itself. */
export function isNonWallet(address: string, venueSet: Set<string>, token: string): boolean {
  const a = lc(address);
  return venueSet.has(a) || BURN_ADDRESSES.has(a) || a === lc(token);
}

export const devSet = (tape: Tape): Set<string> =>
  new Set([lc(tape.launch.deployer), lc(tape.launch.creatorFeeRecipient)]);

/** Percent of supply, to two decimals' worth of precision. */
export function pctOf(amount: bigint, supply: bigint): number {
  if (supply <= 0n) return 0;
  return Number((amount * 1_000_000n) / supply) / 10_000;
}

/** Exited: at or under a thousandth of its peak. Dust left behind by rounding is not a position. */
export const hasExited = (balance: bigint, peak: bigint): boolean => peak > 0n && balance * 1000n <= peak;

export const blockTs = (tape: Tape, block: number): number => tape.now - (tape.headBlock - block) * tape.secPerBlock;

export const short = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** 3177 -> "3 177": the brand groups thousands with a space. */
export const grouped = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function pctText(x: number): string {
  if (x === 0) return "0%";
  if (x < 0.95) return `${x.toFixed(1)}%`;
  return `${Math.round(x)}%`;
}

export const wholeTokens = (base: bigint): number => Number(base) / 1e18;
