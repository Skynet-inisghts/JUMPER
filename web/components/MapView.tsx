"use client";
import { useEffect, useMemo, useState } from "react";
import { hierarchy, pack } from "d3-hierarchy";
import { ToolHero } from "./ToolPage";
import { age, pct, usd } from "@/lib/fmt";

/* ---------- the launchpad map ----------
 * Every busy Pons launch of the last day as a bubble: the size is its cap
 * now, the colour what JUMPER scored it (or, unscored, how far it is from
 * its peak). New launches appear, dead ones fade. Read again every minute. */

interface Node { token: string; symbol: string; ageMin: number; wallets: number; mcapUsd: number | null; peakUsd: number | null; fromPeak: number; score: number | null; label: string | null; radar: boolean }
type Win = 60 | 360 | 1440;

const W = 1180;
const H = 640;

/** The colour of a bubble: the score's band when crawled, otherwise how much of its peak it kept. */
function tone(n: Node): string {
  if (n.label) return n.score! >= 70 ? "ok" : n.score! >= 35 ? "mid" : "bad";
  if (n.fromPeak <= -0.8) return "dead";
  if (n.fromPeak <= -0.4) return "cool";
  return "hot";
}

function Bubble({ n, x, y, r, onHover }: { n: Node; x: number; y: number; r: number; onHover: (n: Node | null, x?: number, y?: number) => void }) {
  const t = tone(n);
  const showLogo = r >= 22;
  const showText = r >= 16;
  return (
    <a href={`/?token=${n.token}`} onMouseEnter={() => onHover(n, x, y)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(n, x, y)} onBlur={() => onHover(null)}>
      <g className={"mb " + t + (n.radar ? " radar" : "")} style={{ transform: `translate(${x}px, ${y}px)` }}>
        <circle r={r} className="mbc" />
        {n.radar && <circle r={r + 3.5} className="mbr" />}
        {showLogo && (
          <>
            <clipPath id={`mc-${n.token}`}><circle r={Math.min(r * 0.42, 22)} cy={-r * 0.22} /></clipPath>
            <image href={`/api/logo?token=${n.token}`} x={-Math.min(r * 0.42, 22)} y={-r * 0.22 - Math.min(r * 0.42, 22)} width={Math.min(r * 0.84, 44)} height={Math.min(r * 0.84, 44)} clipPath={`url(#mc-${n.token})`} preserveAspectRatio="xMidYMid slice" />
          </>
        )}
        {showText && (
          <>
            <text y={showLogo ? r * 0.38 : 3} className="mbt" style={{ fontSize: Math.max(9, Math.min(15, r / 3.4)) }}>${n.symbol.slice(0, 10)}</text>
            {r >= 30 && <text y={showLogo ? r * 0.38 + Math.min(15, r / 3.4) + 2 : 16} className="mbs">{usd(n.mcapUsd)}</text>}
          </>
        )}
      </g>
    </a>
  );
}

export default function MapView() {
  const [data, setData] = useState<{ at: number; nodes: Node[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [win, setWin] = useState<Win>(1440);
  const [hover, setHover] = useState<{ n: Node; x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/map")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { at: number; nodes: Node[] }) => { if (alive) { setData(d); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const nodes = useMemo(() => (data?.nodes ?? []).filter((n) => n.ageMin <= win && (n.mcapUsd ?? 0) > 0), [data, win]);
  const laid = useMemo(() => {
    if (!nodes.length) return [];
    const root = hierarchy<{ children?: Node[] } & Partial<Node>>({ children: nodes })
      // the area follows the cap, with a floor so the smallest still reads
      .sum((d) => (d.mcapUsd ? Math.max(Math.sqrt(d.mcapUsd), 40) : 0));
    return pack<{ children?: Node[] } & Partial<Node>>().size([W, H]).padding(3)(root).leaves()
      .map((l) => ({ n: l.data as Node, x: Math.round(l.x * 10) / 10, y: Math.round(l.y * 10) / 10, r: Math.round(l.r * 10) / 10 }));
  }, [nodes]);

  const alive = nodes.filter((n) => n.fromPeak > -0.8).length;
  const scored = nodes.filter((n) => n.label).length;
  const big = nodes.reduce((a, n) => (a && (a.mcapUsd ?? 0) >= (n.mcapUsd ?? 0) ? a : n), null as Node | null);

  return (
    <>
      <ToolHero
        live={`live · redrawn every five minutes${data?.at ? ` · ${new Date(data.at * 1000).toISOString().slice(11, 16)} UTC` : ""}`}
        title="Launchpad map"
        lede="Every busy Pons launch of the last day, at a glance."
        fine="One bubble per launch that drew fifteen wallets or more. The size is its cap now. The colour is its JUMPER score when anyone has crawled it, otherwise how much of its peak it kept. A ring marks the ones on the radar. Click a bubble for the full crawl."
        nums={[
          ["on the map", data ? nodes.length : "n/a"],
          ["within 80% of the peak", data ? alive : "n/a", "g"],
          ["dead, down 80%+", data ? nodes.length - alive : "n/a"],
          ["scored by JUMPER", data ? scored : "n/a"],
          ["biggest", big ? `$${big.symbol} ${usd(big.mcapUsd)}` : "n/a"],
        ]}
      >
        <div className="tchips" role="group" aria-label="Window">
          {([[60, "Last hour"], [360, "6 hours"], [1440, "24 hours"]] as [Win, string][]).map(([w, t]) => (
            <button key={w} type="button" className={win === w ? "on" : ""} onClick={() => setWin(w)}>{t}</button>
          ))}
        </div>
      </ToolHero>

      <div className="mlegend">
        <span><i className="ok" />TAUT 70+</span><span><i className="mid" />PATCHED</span><span><i className="bad" />TORN</span>
        <span><i className="hot" />unscored, near its peak</span><span><i className="cool" />unscored, down 40%+</span><span><i className="dead" />down 80%+</span>
        <span><i className="ring" />on the radar</span>
      </div>

      {failed && !data && <p className="tempty">The map did not answer. It comes back on the next read.</p>}
      {data && !nodes.length && <p className="tempty">No busy launches in this window yet.</p>}

      {laid.length > 0 && (
        <div className="mapbox">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${laid.length} Pons launches`}>
            {laid.map(({ n, x, y, r }) => (
              <Bubble key={n.token} n={n} x={x} y={y} r={r} onHover={(h, hx, hy) => setHover(h ? { n: h, x: hx!, y: hy! } : null)} />
            ))}
          </svg>
          {hover && (
            <div className="mtip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
              <b>${hover.n.symbol}</b>
              <span>cap {usd(hover.n.mcapUsd)} · peak {usd(hover.n.peakUsd)} · {pct(hover.n.fromPeak)} from it</span>
              <span>{age(hover.n.ageMin)} old · {hover.n.wallets} wallets traded</span>
              <span>{hover.n.label ? `JUMPER ${hover.n.score}/100 ${hover.n.label}` : "not crawled yet"}{hover.n.radar ? " · on the radar" : ""}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
