"use client";
/* eslint-disable @next/next/no-img-element -- pixel sprites, rendered with image-rendering: pixelated */
import { useEffect, useMemo, useRef, useState } from "react";
import Words from "./Words";
import { fmt, MARK, reducedMotion, type Report } from "@/lib/util";
import type { PulseState } from "./types";

const firstNum = (s: string | undefined) => {
  const m = (s ?? "").match(/[\d\s]+/);
  return m ? m[0].trim() : "";
};

/** Eight findings from the latest report, one per crawler, in the prototype's colours. */
function chipsFrom(r: Report | null): [string, string][] {
  if (!r) return [];
  const m = r.metrics;
  const st = (i: number) => r.crawlers[i]?.stats ?? ["", ""];
  const gone = firstNum(st(1)[0]);
  const removed = firstNum(st(6)[0]);
  const books = firstNum(st(5)[0]);
  return [
    ["holder graph built", "180,124,255"],
    [gone ? `${gone} wallets left` : "exits traced", "255,93,122"],
    [`${fmt(m.sniperWallets)} snipers flagged`, "255,209,102"],
    [`${fmt(m.smart)} smart wallets`, "110,208,255"],
    [`${fmt(m.bundles)} bundles tied`, "255,209,102"],
    [books ? `${books} books rebuilt` : "books rebuilt", "125,240,200"],
    [removed ? `${removed} noise dropped` : "noise dropped", "150,142,170"],
    [`score written ${r.score}`, "125,240,200"],
  ];
}

interface Live { launches: number; wallets: number; rateL: number; rateW: number; at: number }

export default function Hero({ version, pulse, report, onRun, onSample }: {
  version: string;
  pulse: PulseState;
  report: Report | null;
  onRun: () => void;
  onSample: () => void;
}) {
  /* ---- the hero counters: anchored on the index pulse, extrapolated between reads ---- */
  const live = useRef<Live | null>(null);
  const [stats, setStats] = useState({ a: "...", c: "...", d: "..." });
  useEffect(() => {
    const show = () => {
      const L = live.current;
      if (!pulse || "offline" in pulse || !L) {
        const d = report && report.provenance.ms > 0 ? Math.round(report.provenance.ms / 1000) + "s" : "n/a";
        setStats({ a: "n/a", c: "n/a", d });
        return;
      }
      const dt = (Date.now() - L.at) / 1000;
      const w = L.wallets + dt * L.rateW;
      setStats({
        a: fmt(L.launches + dt * L.rateL),
        c: w >= 1e6 ? (w / 1e6).toFixed(2) + "M" : fmt(w),
        d: pulse.avgCrawlMs > 0 ? Math.round(pulse.avgCrawlMs / 1000) + "s" : "n/a",
      });
    };
    if (pulse && !("offline" in pulse)) {
      const now = Date.now();
      const prev = live.current;
      const shownL = prev ? prev.launches + ((now - prev.at) / 1000) * prev.rateL : 0;
      const shownW = prev ? prev.wallets + ((now - prev.at) / 1000) * prev.rateW : 0;
      const rateL = pulse.launchesToday / 86_400;
      // wallets: the growth observed between two reads, else a slow default
      let rateW = prev?.rateW ?? rateL;
      if (prev && pulse.walletsIndexed > prev.wallets) rateW = (pulse.walletsIndexed - prev.wallets) / Math.max(1, (now - prev.at) / 1000);
      live.current = {
        // never step a counter backwards on screen
        launches: Math.max(pulse.launchesToday, shownL),
        wallets: Math.max(pulse.walletsIndexed, shownW),
        rateL,
        rateW,
        at: now,
      };
    }
    const first = setTimeout(show, 0);
    const id = setInterval(show, 1300);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [pulse, report]);

  /* ---- chips that orbit the mark, naming what the swarm found ---- */
  const OCH = useMemo(() => chipsFrom(report), [report]);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let ocT = 0;
    const place = () => {
      OCH.forEach((_, i) => {
        const el = chipRefs.current[i];
        if (!el) return;
        const a = ocT + (i / OCH.length) * 6.283;
        const rx = 40, ry = 30;
        el.style.left = 50 + Math.cos(a) * rx + "%";
        el.style.top = 46 + Math.sin(a) * ry + "%";
        /* only the ones in front are visible */
        el.classList.toggle("on", Math.sin(a) > -0.35);
      });
    };
    place();
    if (reducedMotion()) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      ocT += 0.012;
      place();
    }, 40);
    return () => clearInterval(id);
  }, [OCH]);

  return (
    <div className="wrap hero">
      <div>
        <div className="vtag">v{version} · live on robinhood chain 4663</div>
        <h1>JUM<span>PER</span></h1>
        <div className="sub"><Words text="It can jump over any token." /></div>
        <p className="lede">
          <Words text="25,000 tokens launch on Pons every day. JUMPER drops a swarm on one of them: the spiders walk the contract, every transaction, every holder and every wallet those holders ever touched. What comes back is" />{" "}
          <b><Words text="who stayed, who left, who sniped it and who actually knows what they are doing." /></b>
        </p>
        <div className="cta">
          <button className="btn" onClick={onRun}>Run a crawl</button>
          <button className="btn ghost" onClick={onSample}>See a sample card</button>
        </div>
        <div className="notes"><span><i>■</i> no keys</span><span><i>■</i> no signatures</span><span><i>■</i> reads the chain, never writes</span></div>

        <div className="herostats">
          <div><b>{stats.a}</b><span>launches today</span></div>
          <div><b>8</b><span>crawlers live</span></div>
          <div><b>{stats.c}</b><span>wallets indexed</span></div>
          <div><b>{stats.d}</b><span>per crawl</span></div>
        </div>
      </div>

      <div className="heroart">
        <div id="heroSilk" />
        <img id="heroMark" src={MARK} alt="JUMPER mascot hanging on a silk thread" />
        <div className="orbit">
          {OCH.map(([txt, col], i) => (
            <div key={i} className="ochip" ref={(el) => { chipRefs.current[i] = el; }} style={{ ["--oc" as string]: `rgb(${col})` }}>{txt}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
