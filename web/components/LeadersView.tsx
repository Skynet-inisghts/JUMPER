"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Leaders, SmartFlow } from "@engine/chain/history.js";
import Logo from "./Logo";
import Footer from "./Footer";
import WalletCheck, { type WalletHere } from "./WalletCheck";
import { fmt, short } from "@/lib/util";

const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : `${Math.round(s / 3600)} h ago`;
};

/**
 * The leaderboard and the smart money feed. Both come from the wallet
 * index: its leaders job scores every wallet of the busiest Pons markets
 * on its whole record every two hours, bots left out; the feed is the last
 * hour's buys by the wallets it marked smart.
 */
export default function LeadersView() {
  const [by, setBy] = useState<"realized" | "winrate">("realized");
  const [board, setBoard] = useState<Leaders | null>(null);
  const [flow, setFlow] = useState<SmartFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletHere | null>(null);
  const close = useCallback(() => setWallet(null), []);

  const pick = (b: "realized" | "winrate") => { if (b !== by) { setBoard(null); setBy(b); } };
  useEffect(() => {
    fetch(`/api/leaders?by=${by}`).then((r) => r.json()).then((j) => (j.error ? setError(j.error) : setBoard(j))).catch(() => setError("the leaderboard did not load"));
  }, [by]);
  useEffect(() => {
    const load = () => fetch("/api/smartflow").then((r) => r.json()).then((j) => { if (!j.error) setFlow(j); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="page leaderspage">
      <nav>
        <div className="wrap nav">
          <Logo />
          <div className="tagline">leaders · smart money</div>
          <div className="navlinks"><Link href="/">Back to the terminal</Link></div>
        </div>
      </nav>
      <div className="wrap">
        <h2>LEADERS</h2>
        <p className="plede">
          Every wallet in the busiest Pons markets, scored on its whole record across Pons: closed trades only, bots and
          five-thousand-market farms left out. Smart money is a winrate of 55% or more over five closed trades or more.
          Refreshed every two hours{board?.at ? `, last ${ago(board.at)}` : ""}.
        </p>

        <h3>Smart money buying now</h3>
        <p className="psub">Tokens the smart wallets bought in the last hour, the most smart buyers first. Refreshes every minute.</p>
        <div className="ptable flow">
          <div className="ph"><span>token</span><span>smart buyers</span><span>ETH in</span><span /></div>
          {!flow && <div className="pempty pad">reading the index</div>}
          {flow && flow.tokens.length === 0 && <div className="pempty pad">no smart buys in the last hour</div>}
          {flow?.tokens.slice(0, 15).map((t) => (
            <Link key={t.token} className="pr" href={`/?token=${t.token}`}>
              <b>{t.symbol ? `$${t.symbol}` : short(t.token)}</b>
              <span className="ok">{t.smartBuyers}</span>
              <span className="d">{t.eth < 0.01 ? "<0.01" : t.eth.toFixed(2)}</span>
              <span className="d">crawl it</span>
            </Link>
          ))}
        </div>

        <h3>Leaderboard</h3>
        <div className="ltabs">
          <button className={by === "realized" ? "on" : ""} onClick={() => pick("realized")}>by ETH realized</button>
          <button className={by === "winrate" ? "on" : ""} onClick={() => pick("winrate")}>by winrate, 20+ closed</button>
        </div>
        {error && <p className="pempty">{error}</p>}
        <div className="ptable lead">
          <div className="ph"><span>#</span><span>wallet</span><span>ETH realized</span><span>winrate</span><span>closed</span><span>tokens</span><span>avg trade</span></div>
          {!board && !error && <div className="pempty pad">reading the index</div>}
          {board?.rows.map((r, i) => (
            <div key={r.wallet} className="pr" role="button" tabIndex={0}
              onClick={() => setWallet({ wallet: r.wallet, symbol: "", roles: r.smart ? ["smart"] : [] })}
              onKeyDown={(e) => { if (e.key === "Enter") setWallet({ wallet: r.wallet, symbol: "", roles: r.smart ? ["smart"] : [] }); }}>
              <span className="d">{i + 1}</span>
              <b className={r.smart ? "cy" : ""}>{short(r.wallet)}</b>
              <span className={r.realized >= 0 ? "ok" : "bad"}>{r.realized >= 0 ? "+" : ""}{r.realized.toFixed(2)}</span>
              <span>{r.winrate != null ? Math.round(r.winrate) + "%" : "n/a"}</span>
              <span className="d">{fmt(r.positions)}</span>
              <span className="d">{fmt(r.markets)}</span>
              <span className={r.avgPnl >= 0 ? "ok" : "bad"}>{r.avgPnl >= 0 ? "+" : ""}{Math.round(r.avgPnl)}%</span>
            </div>
          ))}
        </div>
      </div>
      <Footer />
      {wallet && <WalletCheck here={wallet} onClose={close} />}
    </div>
  );
}
