import { SCORE } from "./config.js";

/**
 * One number from the crawl. Three promises, each pinned by a test:
 *  - monotone in holding: more supply still held never lowers the score;
 *  - sniped supply and exit pressure only ever subtract;
 *  - supply in smart wallets only ever adds.
 * Everything is a percent of supply except the dev state. The score is
 * about people: snipers and wallets that sold out within ten minutes are
 * left out of `gone` and of the first-minute cohort before this runs, and
 * snipers are charged only for what they still hold. The score describes
 * what already happened; it predicts nothing.
 */

export interface ScoreInput {
  /**
   * 0..1, how firmly real holders (no snipers, no ten-minute flips) sit:
   * the share of them still in, averaged with the share of held supply that
   * has been in place a while. Built by ORACLE; see crawlers/oracle.ts.
   */
  holding: number;
  /** Null when the first minute had too few real buyers to say anything. */
  firstMinuteKept: number | null;
  smartSupply: number;
  /** What the snipers still hold, percent of supply. */
  sniperSupply: number;
  exitPressure: number;
  bundleSupply: number;
  devState: "clean" | "sold half" | "dumped";
}

export interface ScoreParts {
  retention: number;
  kept: number;
  smart: number;
  base: number;
  sniper: number;
  exit: number;
  bundle: number;
  dev: number;
  score: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function scoreParts(m: ScoreInput): ScoreParts {
  const w = SCORE.weights;
  const p = SCORE.penalties;
  const retention = clamp(m.holding, 0, 1);
  // no real first-minute crowd: the term takes retention's value instead of zero
  const kept = m.firstMinuteKept === null ? retention : clamp(m.firstMinuteKept / 100, 0, 1);
  const smart = clamp(m.smartSupply / SCORE.smartSupplyFull, 0, 1);
  const base = 100 * (w.retention * retention + w.firstMinuteKept * kept + w.smartSupply * smart);
  const sniper = p.sniperSupplyPerPct * clamp(m.sniperSupply, 0, 100);
  const exit = p.exitPressurePerPct * clamp(m.exitPressure, 0, 100);
  const bundle = p.bundleSupplyPerPct * clamp(m.bundleSupply, 0, 100);
  const dev = m.devState === "dumped" ? p.devDumped : m.devState === "sold half" ? p.devSoldHalf : 0;
  const score = Math.round(clamp(base - sniper - exit - bundle - dev, 0, 100));
  return { retention, kept, smart, base, sniper, exit, bundle, dev, score };
}

export const scoreOf = (m: ScoreInput): number => scoreParts(m).score;
