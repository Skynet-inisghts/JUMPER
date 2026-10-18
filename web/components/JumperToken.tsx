"use client";
import { useEffect, useState } from "react";
import PriceChart from "./PriceChart";
import Words from "./Words";
import { fmt, short, type Report } from "@/lib/util";

/* ---------- $JUMPER: the site's own token ----------
 * Its contract, where to trade it, its price over its life and what has
 * been burned. The site does not scan its own token; this block reads the
 * chain for it instead (/api/jumper). */

const CA = "0xce4537dc4d7c1e172c437dd92f25e757af927d7a";
const SCAN = "https://robinhoodchain.blockscout.com";

interface Burn { hash: string; from: string; amount: number; at: number }
interface Data { burned: number; burnedPct: number; burns: Burn[]; report: Report | null }

const LINKS: [string, string][] = [
  ["Buy on Pons", `https://ponsfamily.com/launchpad/${CA}`],
  ["Trade on Axiom", `https://axiom.trade/t/${CA}/@jumperrrr?chain=robinhood`],
  ["Trade on GMGN", `https://gmgn.ai/robinhood/token/jumper_${CA}`],
  ["Blockscout", `${SCAN}/token/${CA}`],
];

const money = (x: number | null | undefined) => {
  if (x == null) return "n/a";
  if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
  if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
  return "$" + x.toFixed(0);
};
const price = (x: number | null | undefined) => {
  if (x == null) return "n/a";
  if (x >= 1) return "$" + x.toFixed(2);
  const z = Math.max(0, -Math.floor(Math.log10(x)) - 1);
  return "$" + x.toFixed(Math.min(12, z + 3));
};
const ago = (s: number) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m ago` : d < 86400 ? `${Math.round(d / 3600)}h ago` : `${Math.round(d / 86400)}d ago`;
};

export default function JumperToken() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/jumper")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: Data) => { if (alive) { setData(d); setFailed(false); } })
        .catch(() => { if (alive) setFailed(true); });
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const copy = () => {
    void navigator.clipboard?.writeText(CA).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  const r = data?.report ?? null;
  const m = r?.market;
  const cells: [string, string][] = [
    ["price", price(m?.priceUsd)],
    ["market cap", money(m?.mcapUsd)],
    ["liquidity", money(m?.liquidityUsd)],
    ["volume 24h", money(m?.vol24hUsd)],
    ["holders", r ? fmt(r.metrics.holders) : "n/a"],
    ["burned", data ? `${fmt(data.burned)} · ${data.burnedPct.toFixed(2)}%` : "n/a"],
  ];

  return (
    <section id="jumper">
      <div className="wrap">
        <div className="sechdr"><h2>$JUMPER</h2></div>
        <p className="sechead">
          <Words text="The token of the terminal, on Pons. Its contract, where to trade it, its price since launch and every burn, read from the chain." />
        </p>

        <div className="jtok">
          <button type="button" className="jca" onClick={copy} title="Copy the contract address">
            <span>contract</span>
            <b>{CA}</b>
            <i>{copied ? "copied" : "copy"}</i>
          </button>
          <div className="jlinks">
            {LINKS.map(([t, href]) => (
              <a key={t} className={"btn" + (t === "Buy on Pons" ? "" : " ghost")} href={href} target="_blank" rel="noopener">{t}</a>
            ))}
          </div>
        </div>

        <div className="mstrip">
          {cells.map(([k, v]) => (
            <div key={k}><span>{k}</span><b>{v}</b></div>
          ))}
        </div>

        {r ? <PriceChart r={r} /> : <div className="jwait">{failed ? "the chain did not answer; the chart comes back on the next read" : "reading the chain"}</div>}

        <div className="jburn">
          <div className="jbh">
            <b>burns</b>
            <span>{data ? `${fmt(data.burned)} $JUMPER burned, ${data.burnedPct.toFixed(2)}% of the supply` : "reading"}</span>
          </div>
          {data && !data.burns.length && <p className="jnone">No burns yet. Every transfer to a burn address shows up here.</p>}
          {data?.burns.map((b) => (
            <a key={b.hash} className="jbr" href={`${SCAN}/tx/${b.hash}`} target="_blank" rel="noreferrer">
              <span>{ago(b.at)}</span>
              <span>{short(b.from)}</span>
              <b>{fmt(b.amount)} $JUMPER</b>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
