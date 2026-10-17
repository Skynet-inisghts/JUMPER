"use client";
import { useState } from "react";
import type { SilkNode } from "@engine/crawlers/types.js";
import { short } from "@/lib/util";

/**
 * The holders as a spider web. The token sits in the hub; the rings are
 * when a wallet came in (the sniper blocks, the first minute, ten minutes,
 * the first hour, later); each operator gets its own spoke and a yellow
 * silk thread through its wallets. A node is as big as its share; a wallet
 * that left is hollow, and the ring segment it sat on is torn: a web
 * that lost its holders looks it.
 */

const SPOKES = 24;
const RINGS = [0.22, 0.38, 0.54, 0.7, 0.86];
const RING_NAMES = ["sniper blocks", "first minute", "first 10 min", "first hour", "later"];

const colorOf = (n: SilkNode) =>
  n.roles.some((r) => r === "dev" || r === "insider" || r === "sniper") ? "var(--rd)"
  : n.roles.includes("smart") ? "var(--cy)"
  : n.roles.includes("bot") ? "var(--dm)"
  : n.roles.some((r) => r === "bundle" || r === "fresh" || r === "transfer") ? "var(--ye)"
  : "var(--ac)";

export default function SilkWeb({ nodes, symbol, onWallet }: { nodes: SilkNode[]; symbol: string; onWallet?: (n: SilkNode) => void }) {
  const [hover, setHover] = useState<SilkNode | null>(null);
  if (!nodes.length) return null;
  const S = 640, C = S / 2, R = S / 2 - 18;
  const angle = (k: number) => (k / SPOKES) * Math.PI * 2 - Math.PI / 2;
  const at = (k: number, r: number): [number, number] => [C + Math.cos(angle(k)) * r * R, C + Math.sin(angle(k)) * r * R];

  // each operator gets a sector of neighbouring spokes, sized by its wallets;
  // everyone else is dealt round the remaining spokes, biggest first
  const ops = [...new Set(nodes.filter((n) => n.op != null).map((n) => n.op as number))].sort((a, b) => a - b);
  const opSectors = new Map<number, number[]>();
  let next = 2; // the top spoke carries the ring names
  for (const id of ops) {
    const members = nodes.filter((n) => n.op === id).length;
    const span = Math.min(6, Math.max(1, Math.ceil(members / 5)));
    opSectors.set(id, [...Array(span).keys()].map((j) => (next + j) % SPOKES));
    next += span + 1;
  }
  const taken = new Set([...opSectors.values()].flat());
  const free = [...Array(SPOKES).keys()].filter((k) => !taken.has(k));
  const placed: { n: SilkNode; x: number; y: number; k: number; r: number }[] = [];
  const crowd = new Map<string, number>();
  const opSeen = new Map<number, number>();
  let rr = 0;
  const order = [...nodes].sort((a, b) => Math.max(b.share, b.peak) - Math.max(a.share, a.peak));
  for (const n of order) {
    const band = n.ring < 4 ? RINGS[n.ring + 1] - RINGS[n.ring] : 0.12;
    let k: number, r: number, kk: number;
    if (n.op != null) {
      const sector = opSectors.get(n.op)!;
      const i = opSeen.get(n.op) ?? 0;
      opSeen.set(n.op, i + 1);
      k = sector[i % sector.length];
      const depth = Math.floor(i / sector.length);
      r = RINGS[n.ring] + band * Math.min(0.92, 0.12 + depth * 0.2);
      kk = k + (depth % 2 ? 0.35 : 0);
    } else {
      k = free.length ? free[rr++ % free.length] : rr++ % SPOKES;
      const key = `${k}:${n.ring}`;
      const i = crowd.get(key) ?? 0;
      crowd.set(key, i + 1);
      // inside a ring band: step outwards and sideways so neighbours do not sit on each other
      r = RINGS[n.ring] + band * (0.15 + ((i * 0.27) % 0.7));
      kk = k + (i % 2 ? 1 : -1) * Math.min(0.42, 0.14 * Math.ceil(i / 2));
    }
    const [x, y] = at(kk, r);
    placed.push({ n, x, y, k, r });
  }

  const shareOf = (n: SilkNode) => (n.gone ? n.peak : n.share);
  const nodeR = (n: SilkNode) => (n.gone ? Math.min(5, 1.6 + Math.sqrt(n.peak) * 2) : Math.min(13, 2.4 + Math.sqrt(n.share) * 5));

  // rings sag toward the hub between spokes, the way silk hangs
  const sag = (k: number, rad: number) => {
    const [x1, y1] = at(k, rad), [x2, y2] = at(k + 1, rad);
    const [mx, my] = at(k + 0.5, rad * 0.94);
    return { x1, y1, x2, y2, mx, my };
  };
  const torn = new Set(placed.filter((p) => p.n.gone).map((p) => `${p.n.ring}:${p.k}`));

  // each operator: a knot in its sector, a curved thread to every wallet it runs
  const threads = ops.map((id) => {
    const members = placed.filter((p) => p.n.op === id);
    const sector = opSectors.get(id)!;
    const mid = sector[0] + (sector.length - 1) / 2;
    const inner = Math.max(0.12, Math.min(...members.map((m) => m.r)) - 0.1);
    const [kx, ky] = at(mid, inner);
    const paths = members.map((m) => {
      const [c1x, c1y] = at(mid, inner + (m.r - inner) * 0.55);
      return `M${kx.toFixed(1)},${ky.toFixed(1)} Q${c1x.toFixed(1)},${c1y.toFixed(1)} ${m.x.toFixed(1)},${m.y.toFixed(1)}`;
    });
    const share = members.reduce((a, m) => a + m.n.share, 0);
    return { id, kx, ky, paths, share, count: members.length };
  });

  const hex = (x: number, y: number, r: number) =>
    [...Array(6).keys()].map((i) => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; return `${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`; }).join(" ");

  const held = nodes.filter((n) => !n.gone).length;
  const gone = nodes.length - held;
  const counts = {
    risk: nodes.filter((n) => !n.gone && colorOf(n) === "var(--rd)").length,
    smart: nodes.filter((n) => !n.gone && colorOf(n) === "var(--cy)").length,
    fresh: nodes.filter((n) => !n.gone && colorOf(n) === "var(--ye)").length,
  };

  return (
    <div className="silkweb">
      <div className="sh">
        <b>the web</b>
        <span>{held} biggest holders and {gone} biggest wallets that left. Rings are when they came in, a torn thread is where someone left, a knot is one hand behind many wallets.</span>
      </div>
      <div className="sb">
        <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Holder web of $${symbol}`} onMouseLeave={() => setHover(null)}>
          <defs>
            <radialGradient id="sw-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#B47CFF" stopOpacity="0.10" />
              <stop offset="60%" stopColor="#B47CFF" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#B47CFF" stopOpacity="0" />
            </radialGradient>
            <filter id="sw-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="sw-thread" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FFD166" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#FF9F43" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          <circle cx={C} cy={C} r={R} fill="url(#sw-bg)" />

          {[...Array(SPOKES).keys()].map((k) => {
            const [x, y] = at(k, 0.98);
            const [x0, y0] = at(k, 0.12);
            return <line key={k} x1={x0} y1={y0} x2={x} y2={y} className="spoke" />;
          })}

          {RINGS.map((rad, ri) => [...Array(SPOKES).keys()].map((k) => {
            const g = sag(k, rad);
            if (!torn.has(`${ri}:${k}`)) return <path key={`${ri}-${k}`} d={`M${g.x1.toFixed(1)},${g.y1.toFixed(1)} Q${g.mx.toFixed(1)},${g.my.toFixed(1)} ${g.x2.toFixed(1)},${g.y2.toFixed(1)}`} className="silk" />;
            // a torn thread: two frayed ends hanging off the spokes
            const f = (x: number, y: number, tx: number, ty: number) => `M${x.toFixed(1)},${y.toFixed(1)} Q${((x * 2 + tx) / 3).toFixed(1)},${((y * 2 + ty) / 3 + 4).toFixed(1)} ${((x * 3 + tx) / 4).toFixed(1)},${((y * 3 + ty) / 4 + 7).toFixed(1)}`;
            return (
              <g key={`${ri}-${k}`} className="tear">
                <path d={f(g.x1, g.y1, g.mx, g.my)} />
                <path d={f(g.x2, g.y2, g.mx, g.my)} />
              </g>
            );
          }))}

          {RINGS.map((rad, i) => (
            <text key={i} x={C - 7} y={C - rad * R + 13} textAnchor="end" className="rl">{RING_NAMES[i]}</text>
          ))}

          {threads.map((t) => (
            <g key={t.id} className="op">
              {t.paths.map((d, i) => <path key={i} d={d} className="thread" />)}
              {t.paths.map((d, i) => <path key={`f${i}`} d={d} className="flow" style={{ animationDelay: `${(i % 7) * -0.6}s` }} />)}
              <polygon points={hex(t.kx, t.ky, 9)} className="knot" filter="url(#sw-glow)" />
              <text x={t.kx} y={t.ky + 3} textAnchor="middle" className="knotid">{t.id}</text>
            </g>
          ))}

          <g className="hub">
            {[...Array(72).keys()].map((i) => {
              const a = (i / 72) * Math.PI * 2;
              const r1 = R * 0.125, r2 = R * (i % 6 ? 0.133 : 0.145);
              return <line key={i} x1={C + Math.cos(a) * r1} y1={C + Math.sin(a) * r1} x2={C + Math.cos(a) * r2} y2={C + Math.sin(a) * r2} />;
            })}
            <circle cx={C} cy={C} r={R * 0.1} className="core" />
            <text x={C} y={C + 5} textAnchor="middle" className="sym">${symbol.slice(0, 7)}</text>
          </g>

          {[...placed].sort((a, b) => shareOf(a.n) - shareOf(b.n)).map(({ n, x, y }) => {
            const col = colorOf(n);
            const r = nodeR(n);
            const on = hover?.wallet === n.wallet;
            return (
              <g key={n.wallet} className={"nd" + (onWallet ? " click" : "") + (n.gone ? " gone" : "")}
                onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)}
                onClick={onWallet ? () => onWallet(n) : undefined}
                tabIndex={onWallet ? 0 : undefined} role={onWallet ? "button" : undefined}
                onKeyDown={onWallet ? (e) => { if (e.key === "Enter") onWallet(n); } : undefined}>
                {n.gone ? (
                  <circle cx={x} cy={y} r={r} fill="none" stroke={col} strokeOpacity="0.45" strokeWidth="1" />
                ) : (
                  <>
                    <circle cx={x} cy={y} r={r + 4} fill={col} opacity={on ? 0.28 : 0.12} />
                    <circle cx={x} cy={y} r={r} fill="var(--bg2)" stroke={col} strokeWidth={on ? 2 : 1.2} />
                    <circle cx={x} cy={y} r={Math.max(1.4, r * 0.45)} fill={col} filter="url(#sw-glow)" />
                  </>
                )}
              </g>
            );
          })}
        </svg>
        <div className="sl">
          <div className="read">
            {hover ? (
              <>
                <b>{short(hover.wallet)}</b>
                <span>{hover.gone ? `left · peaked at ${hover.peak.toFixed(2)}% of supply` : `${hover.share.toFixed(2)}% of supply`}</span>
                <span>came in: {RING_NAMES[hover.ring]}</span>
                {hover.op != null && <span className="opl">one hand: operator {hover.op}</span>}
                {hover.roles.length > 0 && <span>{hover.roles.join(", ")}</span>}
                {onWallet && <em>click for the wallet check</em>}
              </>
            ) : (
              <em>point at a wallet on the web</em>
            )}
          </div>
          <span><i style={{ background: "var(--rd)" }} />dev, insider, sniper <u>{counts.risk}</u></span>
          <span><i style={{ background: "var(--cy)" }} />smart money <u>{counts.smart}</u></span>
          <span><i style={{ background: "var(--ye)" }} />bundle, fresh, transfer <u>{counts.fresh}</u></span>
          <span><i style={{ background: "var(--ac)" }} />trader, holder</span>
          <span><i className="hollow" />left the token <u>{gone}</u></span>
          {threads.map((t) => (
            <span key={t.id}><i className="knotk" />operator {t.id}: {t.count} wallets, {t.share < 1 ? t.share.toFixed(2) : t.share.toFixed(1)}%</span>
          ))}
        </div>
      </div>
    </div>
  );
}
