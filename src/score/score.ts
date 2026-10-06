import { SCORE } from "./config.js";

/**
 * One number from the crawl. Three promises, each pinned by a test:
 *  - monotone in holding: more supply still held never lowers the score;
 *  - sniped supply and exit pressure only ever subtract;
 *  - supply in smart wallets only ever adds.
 * Everything is a percent of supply except the dev state. The score
 * describes what already happened; it predicts nothing.
 */

export interface ScoreInput {
  hold: number;
  gone: number;
  firstMinuteKept: number;
  smartSupply: number;
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
  const everHeld = m.hold + m.gone;
  const retention = everHeld > 0 ? clamp(m.hold / everHeld, 0, 1) : 0;
  const kept = clamp(m.firstMinuteKept / 100, 0, 1);
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
