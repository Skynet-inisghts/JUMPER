"use client";
import Link from "next/link";
import proof from "@/sample/proof.json";
import type { Report } from "@/lib/util";

interface Row {
  token: string; symbol: string; score: number; band: string; peakX: number; changeNow: number;
  at?: { sniperSupply: number; sniperHeld: number; bundleSupply: number; firstMinuteKept: number | null; hold: number; devState: string; exitPressure: number };
}

const dev = (s: string) => (s === "dumped" ? 1 : s === "sold half" ? 0.5 : 0);

/** One token's shape: the score and what the launch looked like, each on a comparable scale. */
function shape(m: { score: number; sniperSupply: number; bundleSupply: number; firstMinuteKept: number | null; hold: number; devState: string }): number[] {
  return [m.score / 100, Math.min(1, m.sniperSupply / 40), Math.min(1, m.bundleSupply / 25), (m.firstMinuteKept ?? 50) / 100, m.hold / 100, dev(m.devState)];
}

/**
 * The ten backtested launches whose shape at two hours sits closest to this
 * token's, and what their price did afterwards. A comparison with the
 * past, not a forecast.
 */
export default function Similar({ r }: { r: Report }) {
  const rows = ((proof as unknown as { rows: Row[] }).rows ?? []).filter((x) => x.at && x.token.toLowerCase() !== r.token.address.toLowerCase());
  // no comparison for a token the score does not judge (too early, an airdrop)
  if (rows.length < 20 || (r as { outcome?: unknown }).outcome) return null;
  const me = shape({ ...r.metrics, score: r.score });
  const near = rows
    .map((x) => {
      const s = shape({ score: x.score, ...x.at! });
      return { x, d: Math.sqrt(s.reduce((a, v, i) => a + (v - me[i]) ** 2, 0)) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 10)
    .map((n) => n.x);
  const fell = near.filter((x) => x.changeNow <= -50).length;
  const x2 = near.filter((x) => x.peakX >= 2).length;
  const med = [...near.map((x) => x.changeNow)].sort((a, b) => a - b)[Math.floor(near.length / 2)];
  return (
    <div className="similar">
      <div className="smh">
        <b>looked like this</b>
        <span>the {near.length} backtested launches closest to this one at two hours old:</span>
        <span className={fell >= 5 ? "rd" : "d"}>{fell} fell 50% or more</span>
        <span className={x2 >= 3 ? "g" : "d"}>{x2} went 2x</span>
        <span className="d">median since {med >= 0 ? "+" : ""}{Math.round(med)}%</span>
        <Link href="/proof" className="more">how this was tested</Link>
      </div>
      <div className="sml">
        {near.map((x) => (
          <Link key={x.token} href={`/?token=${x.token}`} className={x.changeNow <= -50 ? "rd" : x.peakX >= 2 ? "g" : ""}>
            ${x.symbol} <i>{x.changeNow >= 0 ? "+" : ""}{Math.round(x.changeNow)}%</i>
          </Link>
        ))}
      </div>
    </div>
  );
}
