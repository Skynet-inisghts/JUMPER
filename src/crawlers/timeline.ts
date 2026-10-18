import { blockTs, devSet, isNonWallet, lc, venues } from "./common.js";
import type { Crawled } from "./oracle.js";
import type { Tape, Timeline, TimelineEvent } from "./types.js";

/** Snapshots over a token's life, closer together near the launch where most happens. */
const STEPS = 80;
/** Wallets drawn on the replay's web: the final top holders, the dev, the snipers, the smart ones. */
const TRACKED = 50;
/** A single sale of this share of the supply or more is an event. */
const BIG_SELL = 0.01;

const pct = (x: bigint, supply: bigint) => (supply > 0n ? Number((x * 100_000n) / supply) / 1000 : 0);

/**
 * The token's life as a replay: the transfer log walked in order and
 * sampled at 80 moments, from launch to now. At each moment: how many
 * wallets held it, what the top ten, the snipers, the dev and the smart
 * wallets held, and the balance of each tracked wallet. Next to it the
 * moments that changed the story: the snipe, the dev's sells, the big
 * sales, smart money arriving, the all-time high.
 */
export function timeline(tape: Tape, c: Crawled, supply: bigint, topHolders: string[]): Timeline {
  const token = lc(tape.launch.token);
  const venueSet = new Set([...venues(tape), ...c.web.routers]);
  const isWallet = (a: string) => !isNonWallet(a, venueSet, token);
  const devs = devSet(tape);
  const snipers = new Set(c.snared.snipers.map((s) => lc(s.wallet)));
  const smart = new Set(c.scouted.smart.map((s) => lc(s.wallet)));

  // who is drawn: the final top holders first, then the dev, snipers and smart wallets
  const tracked: { wallet: string; role: string }[] = [];
  const seen = new Set<string>();
  const add = (w: string, role: string) => {
    const a = lc(w);
    if (seen.has(a) || tracked.length >= TRACKED || !isWallet(a)) return;
    seen.add(a);
    tracked.push({ wallet: a, role });
  };
  const roleOf = (a: string) => (devs.has(a) ? "dev" : snipers.has(a) ? "sniper" : smart.has(a) ? "smart" : "holder");
  for (const d of devs) add(d, "dev");
  for (const w of topHolders.slice(0, 30)) add(w, roleOf(lc(w)));
  for (const s of [...c.snared.snipers].sort((a, b) => (b.tokens > a.tokens ? 1 : -1)).slice(0, 12)) add(s.wallet, "sniper");
  for (const s of c.scouted.smart.slice(0, 8)) add(s.wallet, "smart");

  // the moments to sample, on a square-root clock
  const age = Math.max(1, tape.now - tape.launch.launchedAt);
  const times = Array.from({ length: STEPS }, (_, i) => tape.launch.launchedAt + Math.round(age * (i / (STEPS - 1)) ** 2));
  const blockAt = (t: number) => tape.launch.launchBlock + Math.round((t - tape.launch.launchedAt) / tape.secPerBlock);

  const bal = new Map<string, bigint>();
  let holders = 0;
  const move = (a: string, d: bigint) => {
    if (!isWallet(a)) return;
    const was = bal.get(a) ?? 0n;
    const now = was + d;
    if (was <= 0n && now > 0n) holders++;
    else if (was > 0n && now <= 0n) holders--;
    bal.set(a, now);
  };
  const transfers = [...tape.transfers].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const steps: Timeline["steps"] = [];
  const balances: number[][] = [];
  let ti = 0;
  for (const t of times) {
    const upTo = blockAt(t);
    for (; ti < transfers.length && transfers[ti].block <= upTo; ti++) {
      const x = transfers[ti];
      move(lc(x.from), -x.value);
      move(lc(x.to), x.value);
    }
    const all = [...bal.values()].filter((v) => v > 0n).sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
    const sum = (set: Set<string>) => { let s = 0n; for (const w of set) { const v = bal.get(w) ?? 0n; if (v > 0n) s += v; } return s; };
    steps.push({
      t,
      holders,
      top10: pct(all.slice(0, 10).reduce((a, v) => a + v, 0n), supply),
      snipers: pct(sum(snipers), supply),
      dev: pct(sum(devs), supply),
      smart: pct(sum(smart), supply),
    });
    balances.push(tracked.map((w) => { const v = bal.get(w.wallet) ?? 0n; return v > 0n ? Math.round(pct(v, supply) * 100) / 100 : 0; }));
  }

  // the moments that changed the story
  const events: TimelineEvent[] = [{ t: tape.launch.launchedAt, kind: "launch", text: `$${tape.launch.symbol} launched` }];
  if (c.snared.snipers.length) {
    const took = c.snared.snipers.reduce((a, s) => a + s.tokens, 0n);
    const first = Math.min(...c.snared.snipers.map((s) => s.block));
    events.push({ t: Math.round(blockTs(tape, first)), kind: "snipe", pct: pct(took, supply), text: `${c.snared.snipers.length} snipers took ${pct(took, supply).toFixed(1)}% in the first blocks` });
  }
  for (const s of c.web.sells) {
    const a = lc(s.wallet);
    const share = pct(s.tokens, supply);
    if (devs.has(a) && share >= 0.05) events.push({ t: Math.round(blockTs(tape, s.block)), kind: "dev-sell", wallet: a, pct: share, text: `the dev sold ${share.toFixed(1)}% of the supply` });
    else if (share >= BIG_SELL * 100) events.push({ t: Math.round(blockTs(tape, s.block)), kind: "big-sell", wallet: a, pct: share, text: `${a.slice(0, 6)}…${a.slice(-4)}${snipers.has(a) ? " (sniper)" : smart.has(a) ? " (smart)" : ""} sold ${share.toFixed(1)}%` });
  }
  const smartFirst = new Map<string, number>();
  for (const b of c.web.buys) { const a = lc(b.wallet); if (smart.has(a) && !smartFirst.has(a)) smartFirst.set(a, b.block); }
  for (const [a, block] of smartFirst) events.push({ t: Math.round(blockTs(tape, block)), kind: "smart-in", wallet: a, text: `smart wallet ${a.slice(0, 6)}…${a.slice(-4)} bought in` });
  // the biggest sells only: a busy token would bury the story
  const bigSells = events.filter((e) => e.kind === "big-sell").sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 14);
  const kept = events.filter((e) => e.kind !== "big-sell").concat(bigSells).sort((a, b) => a.t - b.t);

  return { steps, wallets: tracked, balances, events: kept.slice(0, 60) };
}
