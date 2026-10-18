"use client";
import { useEffect, useMemo, useState } from "react";
import type { Report } from "@/lib/util";

/* ---------- replay its life ----------
 * The token from launch to now on a slider: the price so far, the web of
 * its biggest wallets at that moment (dev, snipers, smart money, holders,
 * each sized by what it held then), the counts, and the events up to it.
 * Play runs the whole life in about ten seconds. */

type TL = NonNullable<Report["timeline"]>;

const ROLE: Record<string, string> = { dev: "#FF5D7A", sniper: "#FFD166", smart: "#7DF0C8", holder: "#B47CFF" };
const KIND: Record<string, string> = { launch: "#B47CFF", snipe: "#FFD166", "dev-sell": "#FF5D7A", "big-sell": "#FF8FA3", "smart-in": "#7DF0C8", ath: "#E2CCFF" };
const S = 300;
const C = S / 2;
const f1 = (n: number) => Math.round(n * 10) / 10;

const since = (sec: number) => {
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.round((sec % 86400) / 3600)}h`;
};

/** Where a moment sits on the slider: the steps run on a square-root clock. */
const stepOf = (tl: TL, t: number) => {
  const t0 = tl.steps[0].t, t1 = tl.steps[tl.steps.length - 1].t;
  const f = t1 > t0 ? Math.sqrt(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : 0;
  return f * (tl.steps.length - 1);
};

/** The wallets on a sunflower spiral, the biggest at the end holders sit nearest the centre. */
function spots(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const r = 26 + 112 * Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996;
    return { x: f1(C + Math.cos(a) * r), y: f1(C + Math.sin(a) * r) };
  });
}

export default function Timeline({ r }: { r: Report }) {
  const tl = r.timeline!;
  const last = tl.steps.length - 1;
  const [i, setI] = useState(last);
  const [playing, setPlaying] = useState(false);
  const at = tl.steps[i];
  const pos = useMemo(() => spots(tl.wallets.length), [tl.wallets.length]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setI((x) => {
        if (x >= last) { setPlaying(false); return last; }
        return x + 1;
      });
    }, 120);
    return () => clearInterval(id);
  }, [playing, last]);

  const play = () => {
    if (i >= last) setI(0);
    setPlaying((p) => !p);
  };

  // the price so far, as a line over the whole life
  const closes = r.chart.filter((c) => c.c > 0);
  const t0 = tl.steps[0].t, t1 = tl.steps[last].t;
  const lo = Math.log(Math.min(...closes.map((c) => c.l > 0 ? c.l : c.c)));
  const hi = Math.log(Math.max(...closes.map((c) => c.h)));
  const px = (t: number) => f1(((t - t0) / Math.max(1, t1 - t0)) * 600);
  const py = (v: number) => f1(110 - ((Math.log(v) - lo) / Math.max(1e-9, hi - lo)) * 100);
  const path = closes.map((c, k) => `${k ? "L" : "M"}${px(c.t)},${py(c.c)}`).join(" ");
  const cursor = px(at.t);

  const shown = tl.events.filter((e) => e.t <= at.t);
  const prev = i > 0 ? tl.steps[i - 1] : at;
  const delta = (a: number, b: number) => (a === b ? "" : a > b ? ` +${f1(a - b)}` : ` ${f1(a - b)}`);

  return (
    <div className="tline">
      <div className="tlh">
        <b>replay its life</b>
        <span>{i === last ? "now" : `${since(at.t - t0)} after launch`} · {new Date(at.t * 1000).toISOString().slice(5, 16).replace("T", " ")} UTC</span>
        <button type="button" className="btn ghost" onClick={play}>{playing ? "Pause" : i >= last ? "Play from launch" : "Play"}</button>
      </div>

      <div className="tlbody">
        <div className="tlweb">
          <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="The biggest wallets at this moment">
            <circle cx={C} cy={C} r={142} className="tlrim" />
            <circle cx={C} cy={C} r={70} className="tlrim" />
            {tl.wallets.map((w, k) => {
              const v = tl.balances[i][k];
              const p = pos[k];
              return v > 0 ? <line key={"l" + w.wallet} x1={C} y1={C} x2={p.x} y2={p.y} className="tlthread" style={{ stroke: ROLE[w.role] }} /> : null;
            })}
            {tl.wallets.map((w, k) => {
              const v = tl.balances[i][k];
              const p = pos[k];
              const rad = v > 0 ? f1(Math.min(16, 2.5 + Math.sqrt(v) * 4.2)) : 2.5;
              return (
                <circle key={w.wallet} cx={p.x} cy={p.y} r={rad} className={"tlnode" + (v > 0 ? "" : " out")} style={{ fill: v > 0 ? ROLE[w.role] : "transparent", stroke: ROLE[w.role] }}>
                  <title>{`${w.role} ${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)}: ${v > 0 ? `${v}% of the supply` : "holds none"}`}</title>
                </circle>
              );
            })}
            <circle cx={C} cy={C} r={6} className="tlcore" />
          </svg>
          <div className="tllegend">
            {Object.entries(ROLE).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}
            <span><i className="hollow" />sold out</span>
          </div>
        </div>

        <div className="tlright">
          <svg className="tlprice" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
            <path d={path} className="tlpath" />
            <rect x={cursor} y={0} width={Math.max(0, 600 - cursor)} height={120} className="tlfuture" />
            <line x1={cursor} y1={0} x2={cursor} y2={120} className="tlcursor" />
          </svg>
          <div className="tlstats">
            <div><span>holders</span><b>{at.holders}<i>{delta(at.holders, prev.holders)}</i></b></div>
            <div><span>top 10 hold</span><b>{at.top10.toFixed(1)}%</b></div>
            <div><span>snipers hold</span><b className={at.snipers > 5 ? "y" : ""}>{at.snipers.toFixed(1)}%</b></div>
            <div><span>dev holds</span><b className={at.dev < prev.dev ? "rd" : ""}>{at.dev.toFixed(1)}%</b></div>
            <div><span>smart hold</span><b className={at.smart > 0 ? "g" : ""}>{at.smart.toFixed(1)}%</b></div>
          </div>
          <ul className="tlevents">
            {shown.slice(-6).reverse().map((e, k) => (
              <li key={e.t + e.kind + k} className={k === 0 ? "on" : ""} onClick={() => { setPlaying(false); setI(Math.round(stepOf(tl, e.t))); }}>
                <i style={{ background: KIND[e.kind] }} />
                <span className="d">{since(e.t - t0)}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="tlslide">
        <div className="tlticks" aria-hidden="true">
          {tl.events.map((e, k) => (
            <i key={k} title={e.text} style={{ left: `${(stepOf(tl, e.t) / last) * 100}%`, background: KIND[e.kind] }} />
          ))}
        </div>
        <input type="range" min={0} max={last} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label="Moment in the token's life" />
        <div className="tlends"><span>launch</span><span>now</span></div>
      </div>
    </div>
  );
}
