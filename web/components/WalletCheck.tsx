"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WalletCheck as Data } from "@engine/chain/history.js";
import { fmt, short } from "@/lib/util";

/** What the report already knows about the wallet in the token being read. */
export interface WalletHere {
  wallet: string;
  symbol: string;
  roles: string[];
  who?: string | null;
  share?: number | null;
}

const BAND: Record<string, string> = { TORN: "bad", PATCHED: "mid", TAUT: "ok" };
const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const eth = (x: number) => (x === 0 ? "0" : x < 0.001 ? "<0.001" : x.toFixed(3));

/**
 * The wallet check: who a wallet is in this token, its record across every
 * Pons market, the crawls that named it and the markets it traded last with
 * JUMPER's verdict where one was crawled. Esc or the backdrop closes it.
 */
export default function WalletCheck({ here, onClose }: { here: WalletHere; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const ac = new AbortController();
    fetch(`/api/wallet?address=${here.wallet}`, { signal: ac.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `the index answered ${r.status}`); setData(j as Data); })
      .catch((e: unknown) => { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "the wallet check failed"); });
    return () => { window.removeEventListener("keydown", onKey); ac.abort(); };
  }, [here.wallet, onClose]);

  const rec = data?.record;
  const others = (data?.seen ?? []).filter((s) => s.symbol !== here.symbol);
  return createPortal(
    <div className="wcheck" role="dialog" aria-modal="true" aria-label={`Wallet ${here.wallet}`} onClick={onClose}>
      <div className="wbox" onClick={(e) => e.stopPropagation()}>
        <div className="wtop">
          <div>
            <b>wallet check</b>
            <span className="addr">{here.wallet}</span>
          </div>
          <div className="wbtns">
            <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(here.wallet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}>{copied ? "Copied" : "Copy"}</button>
            <a className="btn ghost" href={`https://robinhoodchain.blockscout.com/address/${here.wallet}`} target="_blank" rel="noreferrer">Explorer</a>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="wsec">
          <span className="k">in ${here.symbol}</span>
          <div className="wroles">
            {here.roles.length ? here.roles.map((r) => <span key={r} className="role d">{r}</span>) : <span className="role d">holder</span>}
            {here.share != null && <span className="v">{here.share < 1 ? here.share.toFixed(2) : here.share.toFixed(1)}% of supply</span>}
          </div>
          {here.who && <p>{here.who}</p>}
        </div>

        {error && <div className="wsec"><p className="err">{error}</p></div>}
        {!data && !error && <div className="wsec"><p className="dim">reading the index</p></div>}

        {rec && (
          <div className="wsec">
            <span className="k">across pons</span>
            <div className="wstats">
              <div><b>{fmt(rec.markets)}</b><span>tokens traded</span></div>
              <div><b>{fmt(rec.trades)}</b><span>trades</span></div>
              <div><b>{rec.winrate != null ? Math.round(rec.winrate) + "%" : "n/a"}</b><span>winrate, {rec.positions} closed</span></div>
              <div><b className={rec.avgPnlPct == null ? "" : rec.avgPnlPct >= 0 ? "ok" : "bad"}>{rec.avgPnlPct != null ? `${rec.avgPnlPct >= 0 ? "+" : ""}${Math.round(rec.avgPnlPct)}%` : "n/a"}</b><span>avg closed trade</span></div>
              <div><b className={rec.realizedEth >= 0 ? "ok" : "bad"}>{rec.realizedEth >= 0 ? "+" : ""}{rec.realizedEth.toFixed(3)}</b><span>ETH realized</span></div>
            </div>
            {rec.markets === 0 && <p className="dim">no trades in the index: a fresh wallet, or one that buys through a router</p>}
          </div>
        )}

        {data && others.length > 0 && (
          <div className="wsec">
            <span className="k">named in other crawls</span>
            {others.slice(0, 8).map((s) => (
              <div className="wrow" key={s.token}>
                <b>${s.symbol}</b>
                <span className={"band " + (BAND[s.band] ?? "")}>{s.score} {s.band}</span>
                <span className="wr">{s.roles.join(", ") || (s.early ? "early buyer" : "holder")}{s.share != null ? ` · ${s.share < 1 ? s.share.toFixed(2) : s.share.toFixed(1)}%` : ""}</span>
                <i>{ago(s.at)}</i>
              </div>
            ))}
          </div>
        )}

        {data && data.recent.length > 0 && (
          <div className="wsec">
            <span className="k">last tokens it traded</span>
            {data.recent.map((t) => (
              <div className="wrow" key={t.token}>
                <b>{t.symbol ? `$${t.symbol}` : short(t.token)}</b>
                {t.verdict ? <span className={"band " + (BAND[t.verdict.band] ?? "")}>{t.verdict.score} {t.verdict.band}</span> : <span className="band">not crawled</span>}
                <span className="wr">{fmt(t.trades)} trades · in {eth(t.boughtEth)} · out {eth(t.soldEth)} ETH</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
