"use client";
import { useEffect, useMemo, useState } from "react";
import { ToolHero } from "./ToolPage";
import { eth, pct, short } from "@/lib/fmt";

/* ---------- clusters: wallets that move together ----------
 * Two wallets that bought the same token in the same block, on three
 * tokens or more in a day, are tied; tied wallets make a cluster. Most are
 * one team behind many addresses: bundlers, sniper farms, coordinated
 * buyers. Rebuilt every two hours on the index host. */

interface Tok { token: string; symbol: string; together: number; held: number; kept: number }
interface Cluster { id: string; wallets: string[]; size: number; tokenCount: number; spentEth: number; backEth: number; lastMinAgo: number; tokens: Tok[]; holding: Tok[] }
type Sort = "size" | "recent" | "holding";

const ago = (m: number) => (m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`);

/** The cluster as a small web: its wallets on the rim, tied to the tokens they bought together. */
function Web({ c }: { c: Cluster }) {
  const S = 180, C = S / 2, R = 78;
  const ws = c.wallets.slice(0, 48);
  const toks = c.tokens.slice(0, 4);
  const tp = toks.map((t, i) => {
    const a = (i / Math.max(1, toks.length)) * Math.PI * 2 - Math.PI / 2;
    const d = toks.length > 1 ? 26 : 0;
    return { t, x: Math.round((C + Math.cos(a) * d) * 10) / 10, y: Math.round((C + Math.sin(a) * d) * 10) / 10 };
  });
  return (
    <svg className="cweb" viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
      <circle cx={C} cy={C} r={R} className="cring" />
      {ws.map((w, i) => {
        const a = (i / ws.length) * Math.PI * 2;
        const x = Math.round((C + Math.cos(a) * R) * 10) / 10, y = Math.round((C + Math.sin(a) * R) * 10) / 10;
        const to = tp[i % Math.max(1, tp.length)] ?? { x: C, y: C };
        return (
          <g key={w}>
            <line x1={x} y1={y} x2={to.x} y2={to.y} className="cthread" />
            <circle cx={x} cy={y} r={2.4} className="cw" />
          </g>
        );
      })}
      {tp.map(({ t, x, y }) => (
        <g key={t.token}>
          <circle cx={x} cy={y} r={11} className="ct" />
          <text x={x} y={y + 3.5} className="ctt">{t.symbol.slice(0, 1).toUpperCase()}</text>
        </g>
      ))}
    </svg>
  );
}

export default function ClustersView() {
  const [data, setData] = useState<{ at: number; windowH: number; clusters: Cluster[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<Sort>("size");

  useEffect(() => {
    fetch("/api/clusters")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const list = useMemo(() => {
    const cs = [...(data?.clusters ?? [])];
    if (sort === "recent") cs.sort((a, b) => a.lastMinAgo - b.lastMinAgo);
    else if (sort === "holding") cs.sort((a, b) => b.holding.reduce((s, t) => s + t.held, 0) - a.holding.reduce((s, t) => s + t.held, 0));
    return cs;
  }, [data, sort]);
  const wallets = (data?.clusters ?? []).reduce((a, c) => a + c.size, 0);

  return (
    <>
      <ToolHero
        live={data?.at ? `rebuilt every two hours · last ${new Date(data.at * 1000).toISOString().slice(11, 16)} UTC` : "rebuilt every two hours"}
        title="Clusters"
        lede="Wallets across Pons that move as one."
        fine="Two wallets that bought the same token in the same block, on three tokens or more within a day, are tied, and tied wallets make a cluster. Most clusters are one team behind many addresses: bundlers, sniper farms, coordinated buyers. Routers and wallets trading over 150 markets a day are left out. It describes what happened."
        nums={[
          ["clusters", data ? data.clusters.length : "n/a"],
          ["wallets in them", data ? wallets : "n/a"],
          ["window", data ? `${data.windowH} h` : "n/a"],
        ]}
      >
        <div className="tchips" role="group" aria-label="Sort">
          {([["size", "Biggest"], ["recent", "Active now"], ["holding", "Holding the most"]] as [Sort, string][]).map(([s, t]) => (
            <button key={s} type="button" className={sort === s ? "on" : ""} onClick={() => setSort(s)}>{t}</button>
          ))}
        </div>
      </ToolHero>

      {failed && <p className="tempty">The clusters did not answer. Try again in a moment.</p>}
      {data && !list.length && <p className="tempty">No clusters in the last day.</p>}

      <div className="cgrid">
        {list.map((c) => (
          <article key={c.id} className="ccard">
            <div className="ctop">
              <Web c={c} />
              <div className="cmeta">
                <b>Cluster {c.id}</b>
                <span><i>{c.size}</i> wallets</span>
                <span>bought together in <i>{c.tokenCount}</i> tokens</span>
                <span>{eth(c.spentEth)} in · {eth(c.backEth)} out</span>
                <span className={c.lastMinAgo < 60 ? "g" : "d"}>last buy {ago(c.lastMinAgo)}</span>
              </div>
            </div>
            {c.holding.length > 0 && (
              <div className="crow">
                <span className="k">holding now</span>
                {c.holding.slice(0, 8).map((t) => <a key={t.token} href={`/?token=${t.token}`} className="cchip hot">${t.symbol} <i>{pct(t.held)}</i></a>)}
              </div>
            )}
            <div className="crow">
              <span className="k">bought together</span>
              {c.tokens.slice(0, 12).map((t) => <a key={t.token} href={`/?token=${t.token}`} className="cchip">${t.symbol} <i>{t.together} in a block</i></a>)}
              {c.tokenCount > 12 && <span className="d">and {c.tokenCount - 12} more</span>}
            </div>
            <details className="cws">
              <summary>the {c.size} wallets</summary>
              <div>{c.wallets.map((w) => <a key={w} href={`https://robinhoodchain.blockscout.com/address/${w}`} target="_blank" rel="noreferrer">{short(w)}</a>)}</div>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
