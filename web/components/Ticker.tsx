"use client";
import { useState } from "react";
import { fmt } from "@/lib/util";
import type { RecentRow } from "./types";

/**
 * The rail of tokens the swarm already walked; edges masked, loops forever.
 * It stops under the pointer, and a click copies the token's address.
 */
export default function Ticker({ rows }: { rows: RecentRow[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!rows.length) return <div className="tickerrail"><div className="ticker" /></div>;
  const copy = (token: string) => {
    navigator.clipboard?.writeText(token).then(() => {
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1400);
    }).catch(() => {});
  };
  const row: RecentRow[] = [];
  while (row.length < 14) row.push(...rows);
  const item = (r: RecentRow, i: number) => {
    const sc = Math.round(r.score);
    const cls = sc >= 70 ? "ok" : sc >= 35 ? "mid" : "bad";
    const key = r.band || (sc >= 70 ? "TAUT" : sc >= 35 ? "PATCHED" : "TORN");
    return (
      <button type="button" className="ti" key={i} onClick={() => copy(r.token)} title={`copy ${r.token}`}>
        <b>${r.symbol}</b>
        <span className="ca">{copied === r.token ? "address copied" : `${r.token.slice(0, 6)}…${r.token.slice(-4)}`}</span>
        <span>{fmt(r.holders)} holders</span>
        <u className={cls}>{sc} {key}</u>
      </button>
    );
  };
  return (
    <div className="tickerrail">
      <div className="ticker">{[...row, ...row].map(item)}</div>
    </div>
  );
}
