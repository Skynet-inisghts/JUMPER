import { THRESHOLDS } from "../score/config.js";
import { devSet, hasExited, lc } from "./common.js";
import { CHECKPOINTS, type CheckpointLabel, type SnareOut, type Tape, type WeaverOut } from "./types.js";

/**
 * SNARE: everything taken in the first three blocks, before a human could
 * have read the ticker. A block here is about a tenth of a second.
 *
 * Also owns the first-minute cohort: the wallets that bought in the first
 * sixty seconds, and how many of them still keep 80% of their peak. The
 * same replay gives the WEB quadrant its 5m to 24h curve.
 */
export function snare(tape: Tape, web: WeaverOut): SnareOut {
  const { launch } = tape;
  const dev = devSet(tape);
  const lastSniperBlock = launch.launchBlock + THRESHOLDS.sniperBlocks - 1;
  const declared = new Set(launch.exemptions.map(lc));

  const byWallet = new Map<string, { tokens: bigint; block: number }>();
  const firstMinute: string[] = [];
  const seen = new Set<string>();
  const minuteEnd = launch.launchBlock + Math.round(THRESHOLDS.firstMinuteSec / tape.secPerBlock);

  // Buyers in arrival order out to ten minutes; the first minute is the
  // cohort unless it is thin, in which case it widens to the first twenty.
  const ordered: { wallet: string; block: number }[] = [];
  const windowEnd = launch.launchBlock + Math.round(THRESHOLDS.cohortMaxSec / tape.secPerBlock);
  for (const t of web.trades) {
    if (t.kind !== "buy") continue;
    if (t.block > windowEnd) break;
    const w = t.wallet;
    if (dev.has(w)) continue;
    if (t.block <= lastSniperBlock) {
      const cur = byWallet.get(w);
      if (cur) cur.tokens += t.tokens;
      else byWallet.set(w, { tokens: t.tokens, block: t.block });
    }
    if (!seen.has(w) && !declared.has(w) && web.wallets.has(w)) {
      seen.add(w);
      ordered.push({ wallet: w, block: t.block });
    }
  }
  const snipers = [...byWallet.entries()].map(([wallet, s]) => {
    const w = web.wallets.get(wallet);
    const balance = w?.balance ?? 0n;
    return { wallet, tokens: s.tokens, block: s.block, balance, exited: w ? hasExited(w.balance, w.peak) : true };
  }).sort((a, b) => (b.tokens > a.tokens ? 1 : b.tokens < a.tokens ? -1 : 0));
  const sniperTokens = snipers.reduce((s, x) => s + x.tokens, 0n);
  const sniperHeld = snipers.reduce((s, x) => s + x.balance, 0n);

  // The cohort is the people in the first minute, not the machines: snipers
  // (first three blocks) and wallets that sold out within ten minutes of
  // buying are left out. A thin first minute widens to the first twenty
  // real buyers inside ten minutes; under five, the term has nothing to say.
  const sniperSet = new Set(byWallet.keys());
  const flipBlocks = Math.round(THRESHOLDS.flipSec / tape.secPerBlock);
  let bots = 0;
  const real = ordered.filter((o) => {
    const w = web.wallets.get(o.wallet)!;
    const bot = sniperSet.has(o.wallet) || isFlip(w, flipBlocks);
    if (bot && o.block <= minuteEnd) bots++;
    return !bot;
  });
  const inMinute = real.filter((o) => o.block <= minuteEnd);
  const cohort = inMinute.length >= THRESHOLDS.cohortMin ? inMinute : real.slice(0, Math.max(inMinute.length, THRESHOLDS.cohortMin));
  firstMinute.push(...cohort.map((o) => o.wallet));

  const keep = (balance: bigint, peak: bigint) => peak > 0n && balance * 10n >= peak * BigInt(Math.round(THRESHOLDS.keepRatio * 10));
  const kept = firstMinute.filter((w) => {
    const x = web.wallets.get(w)!;
    return keep(x.balance, x.peak);
  }).length;

  return {
    snipers,
    sniperTokens,
    sniperHeld,
    sniperExited: snipers.filter((s) => s.exited).length,
    firstMinute,
    firstMinuteBots: bots,
    firstMinuteKept: firstMinute.length >= THRESHOLDS.cohortFloor ? kept / firstMinute.length : null,
    retention: retention(tape, firstMinute, keep),
  };
}

/** Share of the cohort keeping 80% of its running peak at each reached checkpoint. */
function retention(tape: Tape, cohort: string[], keep: (b: bigint, p: bigint) => boolean): Partial<Record<CheckpointLabel, number>> {
  const out: Partial<Record<CheckpointLabel, number>> = {};
  if (!cohort.length) return out;
  const set = new Set(cohort);
  const deltas = new Map<string, { block: number; delta: bigint }[]>();
  for (const w of cohort) deltas.set(w, []);
  for (const t of tape.transfers) {
    const from = lc(t.from);
    const to = lc(t.to);
    if (set.has(from)) deltas.get(from)!.push({ block: t.block, delta: -t.value });
    if (set.has(to)) deltas.get(to)!.push({ block: t.block, delta: t.value });
  }
  const age = tape.now - tape.launch.launchedAt;
  for (const c of CHECKPOINTS) {
    if (c.sec > age) break;
    const at = tape.launch.launchBlock + Math.round(c.sec / tape.secPerBlock);
    let holding = 0;
    for (const w of cohort) {
      let balance = 0n;
      let peak = 0n;
      for (const step of deltas.get(w)!) {
        if (step.block > at) break;
        balance += step.delta;
        if (balance > peak) peak = balance;
      }
      if (keep(balance, peak)) holding++;
    }
    out[c.label] = holding / cohort.length;
  }
  return out;
}

/** Sold out within the flip window of its first buy: a wallet that traded the launch. */
export function isFlip(w: { balance: bigint; peak: bigint; firstBlock: number; lastBlock: number }, flipBlocks: number): boolean {
  return hasExited(w.balance, w.peak) && w.lastBlock - w.firstBlock < flipBlocks;
}
