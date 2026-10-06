"use client";
import { fmt } from "@/lib/util";
import type { RecentRow } from "./types";

/** The rail of tokens the swarm already walked; edges masked, loops forever. */
export default function Ticker({ rows }: { rows: RecentRow[] }) {
  if (!rows.length) return <div className="tickerrail"><div className="ticker" /></div>;
  const row: RecentRow[] = [];
  while (row.length < 14) row.push(...rows);
  const item = (r: RecentRow, i: number) => {
    const sc = Math.round(r.score);
    const cls = sc >= 70 ? "ok" : sc >= 35 ? "mid" : "bad";
    const key = r.band || (sc >= 70 ? "TAUT" : sc >= 35 ? "PATCHED" : "TORN");
    return (
      <span className="ti" key={i}>
        <b>${r.symbol}</b>
        <span>{fmt(r.holders)} holders</span>
        <u className={cls}>{sc} {key}</u>
      </span>
    );
  };
  return (
    <div className="tickerrail">
      <div className="ticker">{[...row, ...row].map(item)}</div>
    </div>
  );
}
