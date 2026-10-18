"use client";
import { useEffect, useMemo, useState } from "react";
import { MARK } from "@/lib/util";

/* ---------- the launch radar ----------
 * A web with the newest launches near the centre and the three hour old
 * ones at the rim, a beam sweeping over it, and one card per launch under
 * it. The rows come from the index (bought minus sold per wallet) and are
 * read again every fifteen seconds. */

export interface RadarItem {
  token: string; symbol: string; name?: string; ageMin: number; buyers: number; stayed: number; kept: number;
  top: number; snipe: number; smartIn: number; volEth: number; mcapUsd: number | null; fromPeak: number; rank: number;
  entryAt?: number; entryMcapUsd?: number | null; sinceX?: number | null;
  score?: number; band?: string; label?: string; scoredAt?: number;
}
export interface RadarPast {
  token: string; symbol: string; firstAt: number; firstMcapUsd: number | null; peakX: number | null;
  x6h: number | null; x24h: number | null; xNow: number | null; score: number | null; band: string | null; label: string | null;
}
export interface RadarHistory {
  days: number;
  stats: { spotted: number; settled: number; reached2x: number; fell50at24h: number; medianX24h: number | null } | null;
  rows: RadarPast[];
}
export interface RadarDot { token: string; symbol: string; ageMin: number }
export interface RadarData { at: number; rows: RadarItem[]; checked?: number; others?: RadarDot[]; history?: RadarHistory | null }

const WINDOW_MIN = 180;
const SIZE = 440;
const C = SIZE / 2;
const R = SIZE / 2 - 26;
const SPOKES = 12;
const RINGS = [15, 60, 120, 180];

const pct = (x: number) => `${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
const usd = (x: number | null) => (x == null ? "n/a" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`);
const age = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const xs = (x: number | null | undefined) => (x == null ? "n/a" : x >= 10 ? `${x.toFixed(0)}x` : `${x.toFixed(2)}x`);
const BAND: Record<string, string> = { TORN: "bad", PATCHED: "mid", TAUT: "ok" };
const ago = (s: number) => { const d = Math.max(0, Date.now() / 1000 - s); return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m ago` : d < 86400 ? `${Math.round(d / 3600)}h ago` : `${Math.round(d / 86400)}d ago`; };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** The rings run on the square root of age: the busy first hour gets most of the room. */
const radiusOf = (min: number) => 22 + (R - 22) * Math.sqrt(Math.min(1, Math.max(0, min / WINDOW_MIN)));
/** One decimal: the server and the browser must print the same coordinates. */
const f1 = (n: number) => Math.round(n * 10) / 10;

/** A token's place on the web: its age sets the ring, its address the angle; close ones are pushed apart. */
function layout(rows: RadarItem[]) {
  const pts = rows.map((r) => {
    const a = (parseInt(r.token.slice(2, 10), 16) / 0xffffffff) * Math.PI * 2;
    const d = radiusOf(r.ageMin);
    return { r, a, d, x: f1(C + Math.cos(a) * d), y: f1(C + Math.sin(a) * d) };
  });
  for (let pass = 0; pass < 40; pass++) {
    for (const p of pts) for (const q of pts) {
      if (p === q) continue;
      if (Math.hypot(p.x - q.x, p.y - q.y) < 40) p.a += 0.05;
    }
    for (const p of pts) { p.x = f1(C + Math.cos(p.a) * p.d); p.y = f1(C + Math.sin(p.a) * p.d); }
  }
  return pts;
}

/** A ring of the web: straight threads between spokes, sagging a little toward the centre. */
function ringPath(rad: number) {
  let d = "";
  for (let i = 0; i <= SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    const x = C + Math.cos(a) * rad, y = C + Math.sin(a) * rad;
    if (i === 0) { d += `M${x.toFixed(1)},${y.toFixed(1)}`; continue; }
    const m = ((i - 0.5) / SPOKES) * Math.PI * 2;
    const s = rad * 0.93;
    d += ` Q${(C + Math.cos(m) * s).toFixed(1)},${(C + Math.sin(m) * s).toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

function Logo({ token, symbol, size }: { token: string; symbol: string; size: number }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="rlogo" style={{ width: size, height: size, fontSize: size * 0.42 }}>{symbol.slice(0, 1).toUpperCase()}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="rlogo" src={`/api/logo?token=${token}`} alt="" width={size} height={size} onError={() => setBad(true)} />;
}

function Web({ rows, others, hot, onHot }: { rows: RadarItem[]; others: RadarDot[]; hot: string | null; onHot: (t: string | null) => void }) {
  const pts = useMemo(() => layout(rows), [rows]);
  // every launch checked that did not pass: a faint dot where it would sit
  const dots = useMemo(() => others.map((o) => {
    const a = (parseInt(o.token.slice(2, 10), 16) / 0xffffffff) * Math.PI * 2;
    const d = radiusOf(o.ageMin);
    return { o, x: f1(C + Math.cos(a) * d), y: f1(C + Math.sin(a) * d) };
  }), [others]);
  return (
    <div className="rweb">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${rows.length} launches on the radar`}>
        <defs>
          <radialGradient id="rwglow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#3B1670" stopOpacity=".55" />
            <stop offset="1" stopColor="#3B1670" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rwbeam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#B47CFF" stopOpacity="0" />
            <stop offset="1" stopColor="#B47CFF" stopOpacity=".38" />
          </linearGradient>
          {pts.map((p) => (
            <clipPath key={p.r.token} id={`rwc-${p.r.token}`}><circle cx={p.x} cy={p.y} r={13} /></clipPath>
          ))}
        </defs>
        <circle cx={C} cy={C} r={R + 14} fill="url(#rwglow)" />
        {Array.from({ length: SPOKES }, (_, i) => {
          const a = (i / SPOKES) * Math.PI * 2;
          return <line key={i} x1={C} y1={C} x2={f1(C + Math.cos(a) * (R + 8))} y2={f1(C + Math.sin(a) * (R + 8))} className="rwspoke" />;
        })}
        {RINGS.map((m) => <path key={m} d={ringPath(radiusOf(m))} className="rwring" />)}
        {RINGS.slice(1).map((m) => (
          <text key={m} x={C + 4} y={C - radiusOf(m) + 12} className="rwlbl">{m / 60}h</text>
        ))}
        {dots.map(({ o, x, y }) => (
          <circle key={o.token} cx={x} cy={y} r={2.2} className="rwdot"><title>{`$${o.symbol}, ${age(o.ageMin)}: checked, did not pass`}</title></circle>
        ))}
        <g className="rwsweep">
          <path d={`M${C},${C} L${C + R + 8},${C} A${R + 8},${R + 8} 0 0,0 ${f1(C + Math.cos(-0.6) * (R + 8))},${f1(C + Math.sin(-0.6) * (R + 8))} Z`} fill="url(#rwbeam)" />
          <line x1={C} y1={C} x2={C + R + 8} y2={C} className="rwedge" />
        </g>
        {pts.map((p) => (
          <path key={`t-${p.r.token}`} d={`M${C},${C} Q${(C + p.x) / 2 + (p.y - C) * 0.12},${(C + p.y) / 2 - (p.x - C) * 0.12} ${p.x},${p.y}`}
            className={"rwthread" + (hot === p.r.token ? " on" : "")} />
        ))}
        {pts.map((p) => (
          <a key={p.r.token} href={`/?token=${p.r.token}`} onMouseEnter={() => onHot(p.r.token)} onMouseLeave={() => onHot(null)} onFocus={() => onHot(p.r.token)} onBlur={() => onHot(null)}>
            <circle cx={p.x} cy={p.y} r={17} className={"rwhalo" + (hot === p.r.token ? " on" : "")} />
            <circle cx={p.x} cy={p.y} r={13.5} className="rwnode" />
            <text x={p.x} y={p.y + 4.5} className="rwletter">{p.r.symbol.slice(0, 1).toUpperCase()}</text>
            <image href={`/api/logo?token=${p.r.token}`} x={p.x - 13} y={p.y - 13} width={26} height={26} clipPath={`url(#rwc-${p.r.token})`} preserveAspectRatio="xMidYMid slice" />
            {(hot === p.r.token || p.r.rank >= 70) && (
              <g className="rwtag">
                <rect x={p.x + 17} y={p.y - 10} width={p.r.symbol.length * 7 + 18} height={20} rx={4} />
                <text x={p.x + 26} y={p.y + 4}>${p.r.symbol}</text>
              </g>
            )}
          </a>
        ))}
        <circle cx={C} cy={C} r={15} className="rwcore" />
        <image href={MARK} x={C - 12} y={C - 12} width={24} height={24} style={{ imageRendering: "pixelated" }} />
      </svg>
    </div>
  );
}

function Card({ r, hot, onHot }: { r: RadarItem; hot: boolean; onHot: (t: string | null) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(r.token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1300); });
  return (
    <article className={"rcard" + (hot ? " on" : "")} onMouseEnter={() => onHot(r.token)} onMouseLeave={() => onHot(null)}>
      <header>
        <Logo token={r.token} symbol={r.symbol} size={44} />
        <div className="rcid">
          <div><b>${r.symbol}</b><span className="rage">{age(r.ageMin)}</span></div>
          <span className="rname">{r.name || r.symbol}</span>
        </div>
        <div className="rpills"><span className="rchain">Robinhood</span><span>Pons</span></div>
      </header>
      <div className="rbox">
        <div><span>cap now</span><b>{usd(r.mcapUsd)}</b></div>
        {r.score != null ? (
          <div className={"rscore " + (BAND[r.band ?? ""] ?? "")} title="the full JUMPER crawl of this token"><b>{r.score}</b><i>/100</i><em>{r.label}</em></div>
        ) : (
          <div className="rscore wait" title="the full crawl runs within a few minutes of a token reaching the radar"><i>crawling</i></div>
        )}
      </div>
      <div className="rentry">
        <span>spotted {r.entryAt ? ago(r.entryAt) : "now"} at <b>{usd(r.entryMcapUsd ?? r.mcapUsd)}</b></span>
        <span className={r.sinceX == null ? "" : r.sinceX >= 1 ? "g" : "rd"}>{r.sinceX == null ? "" : `${xs(r.sinceX)} since`}</span>
        <span className="d">radar {r.rank}/100 · {pct(r.kept)} staying</span>
      </div>
      <dl className="rstats">
        <div><dt>buyers</dt><dd>{r.buyers}</dd></div>
        <div><dt>top wallet</dt><dd>{pct(r.top)}</dd></div>
        <div><dt>sniped</dt><dd>{pct(r.snipe)}</dd></div>
        <div><dt>smart in</dt><dd className={r.smartIn ? "g" : ""}>{r.smartIn}</dd></div>
        <div><dt>from peak</dt><dd className={r.fromPeak < -0.3 ? "rd" : ""}>{pct(r.fromPeak)}</dd></div>
      </dl>
      <button type="button" className="rca" onClick={copy} title="Copy the contract address"><span>{short(r.token)}</span><i>{copied ? "copied" : "copy"}</i></button>
      <div className="racts">
        <a className="btn" href={`https://axiom.trade/t/${r.token}/@jumperrrr?chain=robinhood`} target="_blank" rel="noopener">Trade on Axiom</a>
        <a className="btn ghost" href={`https://gmgn.ai/robinhood/token/jumper_${r.token}`} target="_blank" rel="noopener">GMGN</a>
        <a className="btn ghost" href={`/?token=${r.token}`}>Full scan</a>
      </div>
    </article>
  );
}

/** What became of every token the radar showed: the record the radar is judged by. */
function Track({ h }: { h: RadarHistory }) {
  const st = h.stats;
  const share = (a: number, n: number) => (n ? `${Math.round((a / n) * 100)}%` : "n/a");
  return (
    <section className="rtrack">
      <h2>Radar track record</h2>
      <p className="rfine">Every token the radar showed in the last {h.days} days, from the moment it was spotted: the highest price after, the price six and twenty-four hours later, and the price now, as multiples of the price when it was spotted. The misses stay in.</p>
      {st && (
        <div className="rnums">
          <div><span>spotted</span><b>{st.spotted}</b></div>
          <div><span>24 h old</span><b>{st.settled}</b></div>
          <div><span>went 2x after</span><b className="g">{share(st.reached2x, st.settled)}</b></div>
          <div><span>down 50% at 24 h</span><b className="rd">{share(st.fell50at24h, st.settled)}</b></div>
          <div><span>median at 24 h</span><b>{xs(st.medianX24h)}</b></div>
        </div>
      )}
      {h.rows.length ? (
        <div className="rhist">
          <div className="rhh"><span>token</span><span>spotted</span><span>cap then</span><span>score</span><span>peak after</span><span>at 6 h</span><span>at 24 h</span><span>now</span></div>
          {h.rows.map((r) => (
            <a key={r.token} className="rhr" href={`/?token=${r.token}`}>
              <b>${r.symbol}</b>
              <span className="d">{ago(r.firstAt)}</span>
              <span>{usd(r.firstMcapUsd)}</span>
              <span className={BAND[r.band ?? ""] ?? "d"}>{r.score != null ? `${r.score} ${r.label}` : "n/a"}</span>
              <span className={r.peakX != null && r.peakX >= 2 ? "g" : ""}>{xs(r.peakX)}</span>
              <span className={r.x6h == null ? "d" : r.x6h >= 1 ? "g" : "rd"}>{r.x6h == null ? "waiting" : xs(r.x6h)}</span>
              <span className={r.x24h == null ? "d" : r.x24h >= 1 ? "g" : "rd"}>{r.x24h == null ? "waiting" : xs(r.x24h)}</span>
              <span className={r.xNow == null ? "d" : r.xNow >= 1 ? "g" : "rd"}>{xs(r.xNow)}</span>
            </a>
          ))}
        </div>
      ) : <p className="rempty">The record starts with the first token the radar shows.</p>}
    </section>
  );
}

export default function RadarView({ initial }: { initial: RadarData | null }) {
  const [data, setData] = useState<RadarData | null>(initial);
  const [hot, setHot] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/radar").then((r) => (r.ok ? r.json() : null)).then((d: RadarData | null) => { if (alive && d) setData(d); }).catch(() => {});
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const rows = data?.rows ?? [];
  const when = data?.at ? new Date(data.at * 1000).toISOString().slice(11, 16) : null;
  return (
    <>
      <div className="rhero">
        <div className="rintro">
          <span className="rlive"><i />live · read again every 15 seconds{when ? ` · radar of ${when} UTC` : ""}</span>
          <h1>Launch radar</h1>
          <p className="rlede">Fresh Pons launches whose buyers are staying.</p>
          <p className="rfine">Each dot on the web is a launch of the last three hours, the newest at the centre. Thirty buyers or more, most still in, little taken in the first three blocks, no wallet over a tenth of the supply, the price within half of its peak. It describes what happened, it does not predict. Not financial advice.</p>
          <div className="rnums">
            <div><span>on the radar</span><b className="g">{rows.length}</b></div>
            <div><span>launches checked</span><b>{data?.checked ?? "n/a"}</b></div>
            <div><span>window</span><b>3 h</b></div>
            <div><span>chain</span><b>Robinhood</b></div>
          </div>
          <a className="rtg" href="https://t.me/jumper_terminal_bot" target="_blank" rel="noopener">Alerts in Telegram: send /radar on to @jumper_terminal_bot</a>
        </div>
        <Web rows={rows} others={data?.others ?? []} hot={hot} onHot={setHot} />
      </div>
      {!data && <p className="rempty">The radar did not answer. It comes back on the next read.</p>}
      {data && !rows.length && <p className="rempty">Nothing passes right now. Fresh launches are checked every two minutes.</p>}
      <div className="rgrid">
        {rows.map((r) => <Card key={r.token} r={r} hot={hot === r.token} onHot={setHot} />)}
      </div>
      {data?.history && <Track h={data.history} />}
    </>
  );
}
