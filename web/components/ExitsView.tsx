"use client";
import { useEffect, useState } from "react";
import { ToolHero } from "./ToolPage";
import { age, eth, pct, short, usd } from "@/lib/fmt";

/* ---------- exits: the last hour's big sells ----------
 * One sale of half a percent of the supply or more, grouped per token,
 * newest first. The dev's own sells are marked from the launch event.
 * Read again every thirty seconds. */

interface Sell { wallet: string; minAgo: number; share: number; eth: number; bagSold: number | null; left: number | null; dev?: boolean; n?: number }
interface Row { token: string; symbol: string; ageMin: number; mcapUsd: number | null; sold: number; eth: number; usdOut: number | null; sellers: number; lastMinAgo: number; devSold: boolean; sells: Sell[] }
type Filter = "all" | "dev" | "whole";

function Logo({ token, symbol }: { token: string; symbol: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="tlogo">{symbol.slice(0, 1).toUpperCase()}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="tlogo" src={`/api/logo?token=${token}`} alt="" onError={() => setBad(true)} />;
}

/** Out of it: sold nearly all it bought and holds next to nothing. */
const whole = (s: Sell) => (s.bagSold ?? 0) >= 0.95 && (s.left ?? 0) <= 0.0005;
/** One line per wallet: a bot flipping in and out sells many times an hour. */
function byWallet(sells: Sell[]): Sell[] {
  const m = new Map<string, Sell>();
  for (const s of sells) {
    const e = m.get(s.wallet);
    if (!e) { m.set(s.wallet, { ...s, n: 1 }); continue; }
    e.share += s.share; e.eth += s.eth; e.n! += 1;
    // the newest sell carries what is left
    if (s.minAgo < e.minAgo) { e.minAgo = s.minAgo; e.bagSold = s.bagSold; e.left = s.left; }
  }
  return [...m.values()].sort((a, b) => a.minAgo - b.minAgo);
}
const ago = (m: number) => (m < 1 ? "now" : `${m}m ago`);

export default function ExitsView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/exits")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { rows: Row[] }) => { if (alive) { setRows(d.rows); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const all = rows ?? [];
  const shown = all.filter((r) => filter === "all" || (filter === "dev" ? r.devSold : r.sells.some(whole)));
  const devCount = all.filter((r) => r.devSold).length;
  const out = all.reduce((a, r) => a + (r.usdOut ?? 0), 0);

  return (
    <>
      <ToolHero
        live="live · read again every 30 seconds"
        title="Exits"
        lede="Who is getting out of Pons tokens right now."
        fine="The last hour's big sells: one sale of half a percent of the supply or more. Grouped per token, the newest first. The dev's own sells are marked, read from the launch event; how much of a bag was sold counts buys and sells, not transfers. It describes what happened, it does not predict."
        nums={[
          ["tokens with exits", rows ? all.length : "n/a"],
          ["dev sold", rows ? devCount : "n/a", devCount ? "rd" : ""],
          ["out in the hour", rows ? usd(out) : "n/a"],
        ]}
      >
        <div className="tchips" role="group" aria-label="Filter">
          {([["all", "All"], ["dev", "Dev sold"], ["whole", "Whole bag sold"]] as [Filter, string][]).map(([f, t]) => (
            <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{t}</button>
          ))}
        </div>
      </ToolHero>

      {failed && !rows && <p className="tempty">The exits did not answer. They come back on the next read.</p>}
      {rows && !shown.length && <p className="tempty">No exits like that in the last hour.</p>}

      <div className="xfeed">
        {shown.map((r) => (
          <article key={r.token} className={"xcard" + (r.devSold ? " dev" : "")}>
            <header>
              <Logo token={r.token} symbol={r.symbol} />
              <div className="xid">
                <div><b>${r.symbol}</b><span className="tpill">{age(r.ageMin)} old</span>{r.devSold && <span className="tpill rd">dev sold</span>}</div>
                <span>cap now {usd(r.mcapUsd)} · last exit {ago(r.lastMinAgo)}</span>
              </div>
              <div className="xsum">
                <b>{byWallet(r.sells).filter(whole).length} out</b><span>{r.sellers} {r.sellers === 1 ? "wallet" : "wallets"} sold big, whole bags counted</span>
                <i>{eth(r.eth)}{r.usdOut ? ` · ${usd(r.usdOut)}` : ""} taken out in the hour</i>
              </div>
            </header>
            <ul className="xsells">
              {byWallet(r.sells).map((s, i) => (
                <li key={s.wallet + i} className={s.dev ? "dev" : ""}>
                  <span className="t">{ago(s.minAgo)}</span>
                  <a href={`https://robinhoodchain.blockscout.com/address/${s.wallet}`} target="_blank" rel="noreferrer">{short(s.wallet)}</a>
                  <em className={s.dev ? "" : "no"}>dev</em>
                  <span>sold <b>{pct(s.share)}</b> of the supply for {eth(s.eth)}{(s.n ?? 1) > 1 ? ` in ${s.n} sells` : ""}</span>
                  <span className={whole(s) ? "rd" : "d"}>{s.bagSold == null ? "" : whole(s) ? "whole bag" : `${pct(s.bagSold)} of the bag sold`}</span>
                  <span className="d">{s.left != null && s.left > 0.0005 ? `still holds ${pct(s.left)}` : ""}</span>
                </li>
              ))}
            </ul>
            <div className="xacts">
              <a className="btn ghost" href={`/?token=${r.token}`}>Full scan</a>
              <a className="btn ghost" href={`https://axiom.trade/t/${r.token}/@jumperrrr?chain=robinhood`} target="_blank" rel="noopener">Axiom</a>
              <a className="btn ghost" href={`/dev?address=${r.token}`}>Dev check</a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
