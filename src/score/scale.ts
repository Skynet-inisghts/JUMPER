import type { Band } from "../crawlers/types.js";

/**
 * The web scale. Three bands carry the verdict; six labels give the reading
 * inside them. Names and cut points are part of the brand: do not move them.
 */

export const BANDS: { band: Band; min: number; max: number; verdict: string; color: string }[] = [
  { band: "TORN", min: 0, max: 34, verdict: "DO NOT TOUCH", color: "#FF5D7A" },
  { band: "PATCHED", min: 35, max: 69, verdict: "HANDLE WITH CARE", color: "#FFD166" },
  { band: "TAUT", min: 70, max: 100, verdict: "SAFE TO WALK IN", color: "#7DF0C8" },
];

export const LABELS = ["TORN", "LOOSE", "PATCHED", "HOLDING", "TAUT", "SILK"] as const;

export function bandOf(score: number): (typeof BANDS)[number] {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return BANDS.find((b) => s >= b.min && s <= b.max)!;
}

/** Two labels per band: the lower half and the upper half. */
export function labelOf(score: number): (typeof LABELS)[number] {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s <= 17) return "TORN";
  if (s <= 34) return "LOOSE";
  if (s <= 52) return "PATCHED";
  if (s <= 69) return "HOLDING";
  if (s <= 85) return "TAUT";
  return "SILK";
}

export const CRAWLERS = [
  { name: "WEAVER", color: "#B47CFF", role: "maps the holder graph" },
  { name: "TRACKER", color: "#FF5D7A", role: "follows who left" },
  { name: "SNARE", color: "#FFD166", role: "catches snipers" },
  { name: "SCOUT", color: "#6ED0FF", role: "finds smart money" },
  { name: "KNOT", color: "#FFA85A", role: "spots bundles" },
  { name: "LEDGER", color: "#7DF0C8", role: "rebuilds every book" },
  { name: "SIEVE", color: "#968EAA", role: "throws out the noise" },
  { name: "ORACLE", color: "#D6B4FF", role: "writes the card" },
] as const;
