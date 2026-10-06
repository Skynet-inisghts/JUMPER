import type { Band, Report } from "@engine/crawlers/types.js";
import { BANDS, CRAWLERS } from "@engine/score/scale.js";

export type { Report, Band };

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const ri = (a: number, b: number) => Math.floor(rnd(a, b + 1));
/** 25 412: thin-space style grouping as the prototype prints numbers */
export const fmt = (n: number) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
export const hex4 = () => Array.from({ length: 4 }, () => "0123456789abcdef"[ri(0, 15)]).join("");
export const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const dprNow = () => (typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 1.3));

export const usd = (n: number) => {
  const a = Math.abs(n);
  if (a > 0 && a < 10) return `$${a.toFixed(2)}`;
  return `$${fmt(a)}`;
};

const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

/** The eight crawlers: name, role and colour from the engine, sprites from the prototype. */
export const CREW = CRAWLERS.map((c, i) => ({
  n: c.name as string,
  r: c.role as string,
  hex: c.color as string,
  col: rgbOf(c.color),
  spr: `/sprites/crew-${i + 1}.png`,
}));

export const MARK = "/sprites/mark.png";

export const COH: Record<string, string> = {
  hold: "125,240,200",
  smart: "110,208,255",
  snipe: "255,209,102",
  gone: "255,93,122",
  raw: "126,116,144",
};

export const bandInfo = (score: number) => {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const b = BANDS.find((x) => s >= x.min && s <= x.max) ?? BANDS[0];
  return { ...b, rgb: rgbOf(b.color) };
};

/** The CSS font families next/font registered, for canvas text. */
let families: { mono: string; tiny: string } | null = null;
export function fontsFor(): { mono: string; tiny: string } {
  if (families) return families;
  if (typeof document === "undefined") return { mono: "monospace", tiny: "monospace" };
  const cs = getComputedStyle(document.documentElement);
  const mono = cs.getPropertyValue("--f-mono").trim();
  const tiny = cs.getPropertyValue("--f-tiny").trim();
  families = { mono: mono || "monospace", tiny: tiny || "monospace" };
  return families;
}

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const crawledAt = (r: Report) => {
  const d = new Date(r.provenance.observedAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
};
