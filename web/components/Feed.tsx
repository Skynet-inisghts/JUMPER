"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Words from "./Words";
import { CREW, fmt, ri, short, usd, type Report } from "@/lib/util";
import type { LogLine } from "@engine/crawlers/types.js";

/* ---------- crawlers at work: a replay of the newest crawl ----------
 * Everything here comes from one report: the holder table, the crawlers'
 * own log lines, and the fills of the wallets they tracked. The HUD and the
 * account strip replay those fills in order; nothing is our own trading. */

interface Step { fills: number; buys: number; sells: number; realized: number; wallets: number; last: { usd: number | null; kind: "buy" | "sell" } | null }

function replaySteps(r: Report | null) {
  const fills = r ? [...r.fills].sort((a, b) => a.ts - b.ts || a.block - b.block) : [];
  const book = new Map<string, { tok: number; usd: number }>();
  const seen = new Set<string>();
  const steps: Step[] = [{ fills: 0, buys: 0, sells: 0, realized: 0, wallets: 0, last: null }];
  let buys = 0, sells = 0, realized = 0;
  for (const f of fills) {
    const w = f.wallet.toLowerCase();
    seen.add(w);
    const b = book.get(w) ?? { tok: 0, usd: 0 };
    if (f.kind === "buy") {
      buys += f.usd ?? 0;
      b.tok += f.tokens;
      b.usd += f.usd ?? 0;
    } else {
      sells += f.usd ?? 0;
      if (b.tok > 0 && f.usd != null) {
        const sold = Math.min(f.tokens, b.tok);
        const cost = (b.usd / b.tok) * sold;
        realized += f.usd - cost;
        b.usd -= cost;
        b.tok -= sold;
      }
    }
    book.set(w, b);
    steps.push({ fills: steps.length, buys, sells, realized, wallets: seen.size, last: { usd: f.usd, kind: f.kind } });
  }
  return { fills, steps };
}

const KIND_CLASS: Record<string, string> = { link: "c-link", cluster: "c-cluster", trace: "c-crawler", verdict: "c-verdict" };
/* the log is mostly crawlers walking, with the occasional link, cluster, trace or verdict */
const LOGMIX = ["walk", "walk", "walk", "walk", "walk", "link", "link", "cluster", "trace", "trace", "verdict"] as const;

interface Row { id: number; ts: string; line: LogLine }

function LogText({ line }: { line: LogLine }) {
  const crew = CREW.find((c) => c.n === line.crawler);
  let text = line.text;
  let kindWord: string | null = null;
  if (line.kind !== "walk") {
    const kw = line.kind;
    if (text.toLowerCase().startsWith(kw + " ")) text = text.slice(kw.length + 1);
    kindWord = kw;
  }
  const m = text.match(/^(0x[0-9a-fA-F]{2,8}…[0-9a-fA-F]{2,8})(.*)$/);
  return (
    <>
      <b className="cn" style={{ color: crew ? `rgb(${crew.col})` : undefined }}>{line.crawler}</b>{" "}
      {kindWord && <><b className={kindWord === "flag" ? undefined : KIND_CLASS[kindWord] ?? "c-dim"} style={kindWord === "flag" && crew ? { color: `rgb(${crew.col})`, opacity: 0.8 } : undefined}>{kindWord}</b>{" "}</>}
      {m ? <><b className="c-dim">{m[1]}</b>{m[2]}</> : text}
    </>
  );
}

export default function Feed({ report, label }: { report: Report | null; label: string | null }) {
  const { fills, steps } = useMemo(() => replaySteps(report), [report]);
  const holders = useMemo(() => (report?.holders ?? []).slice(0, 10), [report]);

  /* ---------- the execution HUD: replays the tracked wallets' fills ---------- */
  const [idx, setIdx] = useState(0);
  const [hist, setHist] = useState<number[]>(() => new Array(60).fill(0));
  useEffect(() => {
    const n = steps.length - 1;
    let i = Math.min(n, Math.max(0, Math.round(n * 0.5)));
    const sync = () => {
      setIdx(i);
      const h = new Array(60).fill(0);
      for (let k = 0; k < 60; k++) {
        const s = i - 59 + k;
        h[k] = s >= 0 ? steps[s].realized : 0;
      }
      setHist(h);
    };
    const first = setTimeout(sync, 0);
    const id = setInterval(() => {
      if (document.hidden) return;
      if (Math.random() < 0.42) {
        i = i >= n ? 0 : i + 1;
        sync();
      }
    }, 900);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [steps]);
  const cur = steps[Math.min(idx, steps.length - 1)];
  const next = fills[idx];

  const sparkRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = sparkRef.current;
    if (!c) return;
    const w = Math.round(c.clientWidth * 2), h = 60;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const d = c.getContext("2d");
    if (!d) return;
    d.clearRect(0, 0, w, h);
    const mx = Math.max(1, ...hist.map(Math.abs));
    d.strokeStyle = "rgba(125,240,200,.85)";
    d.lineWidth = 2;
    d.beginPath();
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * w, y = h / 2 - (v / mx) * (h / 2 - 4);
      if (i) d.lineTo(x, y);
      else d.moveTo(x, y);
    });
    d.stroke();
    d.strokeStyle = "rgba(255,255,255,.08)";
    d.lineWidth = 1;
    d.beginPath();
    d.moveTo(0, h / 2);
    d.lineTo(w, h / 2);
    d.stroke();
  }, [hist]);

  /* ---------- the account strip: capital the tracked wallets put in ---------- */
  const acRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const draw = () => {
      const c = acRef.current;
      if (!c) return;
      const w = Math.round(c.clientWidth * 2), h = 380;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const d = c.getContext("2d");
      if (!d) return;
      d.clearRect(0, 0, w, h);
      const upto = Math.max(2, idx + 1);
      const BAL = steps.slice(0, upto).map((s) => s.buys);
      if (BAL.length < 2) return;
      const BARS = fills.slice(0, upto - 1).map((f) => (f.kind === "buy" ? 1 : -1) * (f.usd ?? 0));
      const bmax = Math.max(1, ...BARS.map(Math.abs));
      const lo = Math.min(...BAL), hi = Math.max(...BAL);
      const span = hi - lo || 1;
      const X = (i: number) => 26 + (i / (BAL.length - 1)) * (w - 52);
      const Y = (v: number) => h * 0.7 - ((v - lo) / span) * (h * 0.56);
      /* the fill under the curve */
      const g = d.createLinearGradient(0, 0, 0, h * 0.72);
      g.addColorStop(0, "rgba(125,240,200,.22)");
      g.addColorStop(1, "rgba(125,240,200,0)");
      d.beginPath();
      d.moveTo(X(0), h * 0.72);
      BAL.forEach((v, i) => d.lineTo(X(i), Y(v)));
      d.lineTo(X(BAL.length - 1), h * 0.72);
      d.closePath();
      d.fillStyle = g;
      d.fill();
      d.beginPath();
      BAL.forEach((v, i) => (i ? d.lineTo(X(i), Y(v)) : d.moveTo(X(i), Y(v))));
      d.strokeStyle = "#7DF0C8";
      d.lineWidth = 3;
      d.stroke();
      d.fillStyle = "#fff";
      d.beginPath();
      d.arc(X(BAL.length - 1), Y(BAL[BAL.length - 1]), 6, 0, 6.283);
      d.fill();
      /* the trade bars beneath */
      const bw = (w - 52) / Math.max(1, BARS.length);
      BARS.forEach((v0, i) => {
        const v = v0 / bmax;
        const bh = Math.abs(v) * h * 0.16;
        d.fillStyle = v > 0 ? "rgba(125,240,200,.6)" : "rgba(255,93,122,.55)";
        d.fillRect(26 + i * bw, h * 0.8 - (v > 0 ? bh : 0), bw * 0.62, bh);
      });
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [idx, steps, fills]);

  const third = (k: number) => steps[Math.max(0, Math.round((idx * k) / 3))]?.buys ?? 0;

  /* ---------- crawlers at work: the log that reads the table ---------- */
  const pools = useMemo(() => {
    const all = report ? report.crawlers.flatMap((c) => c.lines) : [];
    const by = (k: string) => all.filter((l) => l.kind === k);
    const inTable = new Set(holders.map((h) => h.wallet.toLowerCase()));
    return {
      walk: by("walk"),
      walkTable: by("walk").filter((l) => l.wallet && inTable.has(l.wallet.toLowerCase())),
      link: [...by("link"), ...by("flag")],
      cluster: by("cluster"),
      trace: [...by("trace"), ...by("flag")],
      verdict: by("verdict"),
      all,
    };
  }, [report, holders]);

  const [rows, setRows] = useState<Row[]>([]);
  const [now, setNow] = useState<{ wallet: string; col: string } | null>(null);
  useEffect(() => {
    if (!pools.all.length) return;
    let clock = Math.floor(Date.now() / 1000);
    let id = 0;
    const pick = (): LogLine => {
      const kind = LOGMIX[ri(0, LOGMIX.length - 1)];
      let pool: LogLine[] = pools[kind];
      if (kind === "walk" && pools.walkTable.length && Math.random() < 0.6) pool = pools.walkTable;
      if (!pool.length) pool = pools.walk.length ? pools.walk : pools.all;
      return pool[ri(0, pool.length - 1)];
    };
    const tick = (): Row => {
      const line = pick();
      clock += ri(1, 3);
      const d = new Date(clock * 1000);
      const ts = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + ":" + String(d.getUTCSeconds()).padStart(2, "0");
      return { id: id++, ts, line };
    };
    const push = (batch: Row[]) => {
      setRows((prev) => [...prev, ...batch].slice(-11));
      const last = [...batch].reverse().find((r) => r.line.wallet);
      if (last?.line.wallet) {
        const crew = CREW.find((c) => c.n === last.line.crawler);
        setNow({ wallet: last.line.wallet.toLowerCase(), col: crew ? `rgb(${crew.col})` : "rgb(180,124,255)" });
      }
    };
    const first = setTimeout(() => {
      setRows([]);
      push(Array.from({ length: 7 }, tick));
    }, 0);
    const iv = setInterval(() => { if (!document.hidden) push([tick()]); }, 1250);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [pools]);

  const pnl = cur.realized;
  return (
    <section id="feed">
      <div className="wrap">
        <div className="sechdr"><h2>crawlers at work</h2><span className="secnum">01</span></div>
        <p className="sechead">
          <Words text="A replay of the newest crawl. The left panel is the holder table the swarm walked. The right one is its log, unfiltered. The numbers above replay the fills of the wallets it tracked." />
          {label && <span className="replay">{label}</span>}
        </p>

        <div className="hudrow">
          <div className="hud">
            <div className="hh"><span>FILLS</span><u>replay</u></div>
            <div className="hv">{fmt(cur.fills)}</div>
            <div className="hs">{cur.last ? `last fill ${cur.last.usd != null ? usd(cur.last.usd) : "n/a"} · ${cur.last.kind}` : "last fill —"}</div>
          </div>
          <div className="hud">
            <div className="hh"><span>SIZE IN</span><u>bought</u></div>
            <div className="hv money">{usd(cur.buys)}</div>
            <div className="hs">across {fmt(Math.max(cur.wallets, 0))} wallets</div>
          </div>
          <div className="hud">
            <div className="hh"><span>P&amp;L</span><u>realised</u></div>
            <div className={"hv " + (pnl >= 0 ? "up" : "down")}>{(pnl >= 0 ? "+" : "−") + usd(pnl)}</div>
            <div className="spark"><canvas ref={sparkRef} /></div>
          </div>
          <div className="hud">
            <div className="hh"><span>WAITING ON</span><u>next fill</u></div>
            <div className="hv small">{next ? short(next.wallet) : "—"}</div>
            <div className="hs">{fmt(Math.max(0, fills.length - idx))} fills left in the replay</div>
          </div>
        </div>

        <div className="acct">
          <div className="ah"><span>TRACKED WALLETS / THIS REPLAY</span>
            <u>{usd(third(1))} → {usd(third(2))} → {usd(cur.buys)}</u></div>
          <div className="abody">
            <canvas ref={acRef} />
            <div className="abig">
              <div className="ab">{usd(cur.buys)}</div>
              <div className="al">usd bought</div>
              <div className="ad">{(cur.buys - cur.sells >= 0 ? "+" : "−") + usd(cur.buys - cur.sells)} net in</div>
            </div>
          </div>
        </div>

        <div className="workrow">
          <div className="panel">
            <div className="whead"><span>wallet</span><span>share</span><span>flags</span></div>
            <div>
              {holders.map((w) => {
                const fl = w.flags;
                const bad = fl.some((f) => f === "deployer" || f === "sniper");
                const warn = !bad && fl.some((f) => f === "virgin" || f === "transfer" || f === "short history" || f === "bundle");
                const ok = fl.includes("clean") || fl.includes("smart");
                const isNow = now?.wallet === w.wallet.toLowerCase();
                return (
                  <div
                    key={w.wallet}
                    className={"wrw " + (bad ? "bad" : warn ? "warn" : ok ? "ok" : "") + (isNow ? " now" : "")}
                    style={isNow ? { ["--litcol" as string]: now?.col } : undefined}
                  >
                    <span className="ad">{short(w.wallet)}</span>
                    <span className="sh">{w.share.toFixed(1)}%</span>
                    <span className="fl">{fl.map((f) => <span key={f} className={"tag " + f.split(" ")[0]}>{f}</span>)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="lhead"><span>&gt; tail -f crawler.log</span><u><i />live</u></div>
            <div>
              {rows.map((r) => (
                <div className="lrw" key={r.id}>
                  <span className="ts">{r.ts} →</span>
                  <span className="ms"><LogText line={r.line} /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
