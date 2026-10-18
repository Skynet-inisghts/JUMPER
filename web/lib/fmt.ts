/** Number formats the tool pages share. */
export const usd = (x: number | null | undefined) =>
  x == null ? "n/a" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`;
export const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`);
export const eth = (x: number) => `${x.toFixed(x >= 10 ? 1 : x >= 1 ? 2 : 3)} ETH`;
export const age = (m: number) => (m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`);
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const BAND_CLASS: Record<string, string> = { TORN: "bad", LOOSE: "bad", PATCHED: "mid", HOLDING: "mid", TAUT: "ok", SILK: "ok" };
