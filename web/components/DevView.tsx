"use client";
import { useCallback, useEffect, useState } from "react";
import { ToolHero } from "./ToolPage";
import { age, eth, pct, short, usd } from "@/lib/fmt";

/* ---------- a dev's dossier ----------
 * Every token one address launched through the Pons factory, what each
 * became, and how the dev traded it. A token address stands for its dev. */

interface Tok { token: string; symbol: string; ageMin: number; wallets: number; peakMcapEth: number | null; nowMcapEth: number | null; devBuyEth: number; devSellEth: number; devSold: number | null }
interface Dossier {
  dev: string; complete: boolean; ethUsd: number | null; rows: Tok[];
  summary: { launches: number; read: number; dumped: number; dead: number; peaked100k: number; devNetEth: number; verdict: string; tone: string };
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;

export default function DevView({ initial }: { initial: string | null }) {
  const [input, setInput] = useState(initial ?? "");
  const [data, setData] = useState<Dossier | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const load = useCallback((addr: string) => {
    if (!ADDR.test(addr)) { setError("paste a dev wallet or one of their token addresses"); setState("error"); return; }
    setState("loading");
    setData(null);
    fetch(`/api/dev?address=${addr}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "failed"); return j as Dossier; })
      .then((d) => {
        setData(d);
        setState("idle");
        window.history.replaceState(null, "", `/dev?address=${d.dev}`);
      })
      .catch((e: Error) => { setError(e.message); setState("error"); });
  }, []);

  // a link with ?address= reads at once, after the first paint
  useEffect(() => {
    if (!initial) return;
    const id = setTimeout(() => load(initial), 0);
    return () => clearTimeout(id);
  }, [initial, load]);

  const usdOf = (x: number | null) => (x != null && data?.ethUsd ? x * data.ethUsd : null);
  const s = data?.summary;
  return (
    <>
      <ToolHero
        title="Dev check"
        lede="Everything one dev launched on Pons, and what became of it."
        fine="Paste a dev wallet, or a token address for its dev. Every launch comes from the factory's own events; caps and the dev's trades from the trade index. A launch counts as dumped when the dev sold 90% of their bag or more, as dead when its cap is down 90% from the peak. It describes the past, it does not predict."
      >
        <form className="tsearch" onSubmit={(e) => { e.preventDefault(); load(input.trim()); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x... dev wallet or token" spellCheck={false} aria-label="Dev wallet or token address" />
          <button className="btn" type="submit" disabled={state === "loading"}>{state === "loading" ? "Reading" : "Check"}</button>
        </form>
      </ToolHero>

      {state === "error" && <p className="tempty">{error}</p>}
      {state === "loading" && <p className="tempty">Reading every launch of this dev from the chain.</p>}

      {data && s && (
        <>
          <div className={"dverdict " + s.tone}>
            <span>dev <a href={`https://robinhoodchain.blockscout.com/address/${data.dev}`} target="_blank" rel="noreferrer">{short(data.dev)}</a></span>
            <b>{s.verdict}</b>
          </div>
          <div className="tnums">
            <div><span>launches</span><b>{s.launches}</b></div>
            <div><span>dumped by the dev</span><b className={s.dumped ? "rd" : ""}>{s.dumped} of {s.read}</b></div>
            <div><span>dead now</span><b className={s.dead ? "rd" : ""}>{s.dead} of {s.read}</b></div>
            <div><span>peaked over $100K</span><b className={s.peaked100k ? "g" : ""}>{s.peaked100k}</b></div>
            <div><span>dev took out, net</span><b className={s.devNetEth > 0 ? "rd" : ""}>{eth(s.devNetEth)}</b></div>
          </div>
          {!data.complete && <p className="tfine">Part of the launch history could not be read this time; the list may be short.</p>}
          {s.launches > s.read && <p className="tfine">The newest {s.read} launches are shown.</p>}
          {data.rows.length ? (
            <div className="dtable">
              <div className="dh"><span>token</span><span>launched</span><span>traders</span><span>peak cap</span><span>cap now</span><span>from peak</span><span>dev bought</span><span>dev sold</span><span>of the bag</span></div>
              {data.rows.map((r) => {
                const drop = r.peakMcapEth && r.nowMcapEth != null ? r.nowMcapEth / r.peakMcapEth - 1 : null;
                return (
                  <a key={r.token} className="dr" href={`/?token=${r.token}`}>
                    <b>${r.symbol}</b>
                    <span className="d">{age(r.ageMin)} ago</span>
                    <span>{r.wallets}</span>
                    <span>{usd(usdOf(r.peakMcapEth))}</span>
                    <span>{usd(usdOf(r.nowMcapEth))}</span>
                    <span className={drop != null && drop <= -0.9 ? "rd" : "d"}>{drop == null ? "n/a" : pct(drop)}</span>
                    <span>{r.devBuyEth ? eth(r.devBuyEth) : "none"}</span>
                    <span>{r.devSellEth ? eth(r.devSellEth) : "none"}</span>
                    <span className={(r.devSold ?? 0) >= 0.9 ? "rd" : (r.devSold ?? 0) > 0 ? "mid" : "g"}>{r.devSold == null ? "no trades" : (r.devSold ?? 0) >= 0.9 ? "dumped" : pct(r.devSold)}</span>
                  </a>
                );
              })}
            </div>
          ) : <p className="tempty">This address launched nothing through the Pons factory.</p>}
        </>
      )}
    </>
  );
}
