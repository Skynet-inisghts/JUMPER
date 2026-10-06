"use client";
/* eslint-disable @next/next/no-img-element -- pixel sprite and the generated card PNG */
import { useCallback, useEffect, useRef, useState } from "react";
import Logo from "./Logo";
import type { RecentRow } from "./types";
import { buildChain, drawChain, graphFromReport, type Bug, type Graph, type NodeState } from "@/lib/chain";
import { bandInfo, CREW, dprNow, fmt, fontsFor, MARK, reducedMotion, ri, rnd, short, type Report } from "@/lib/util";
import type { CheckpointLabel } from "@engine/crawlers/types.js";

type Step = "input" | "run" | "report";
type Pass = { state: "queued" | "running" | "done"; pct: number };
type Feed = { id: number; c: string; m: string; v: string; cls: string };
type Failure = { message: string; candidates?: { token: string; symbol: string; name: string }[] };

const PASSES: [string, string][] = [
  ["WEAVER", "mapping transfers"], ["TRACKER", "marking exits"], ["SNARE", "scanning first blocks"],
  ["SCOUT", "tracing wallets across pons"], ["KNOT", "clustering funding sources"], ["LEDGER", "rebuilding books"],
  ["SIEVE", "filtering noise"], ["ORACLE", "writing the card"],
];
const BUGTAGS: NodeState[] = ["hold", "smart", "snipe", "gone", "hold", "hold", "smart", "gone", "hold", "snipe"];
const CHECKS: CheckpointLabel[] = ["5m", "15m", "1h", "6h", "24h"];
const pct0 = (n: number) => Math.round(n) + "%";
const firstNum = (s: string | undefined) => (s ?? "").match(/[\d\s]+/)?.[0].trim() ?? "";

/** Read a fetch body as Server-Sent Events. */
async function readSSE(res: Response, onEvent: (event: string, data: unknown) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = "message", data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) {
        try {
          onEvent(event, JSON.parse(data));
        } catch {
          /* a malformed frame is skipped */
        }
      }
    }
  }
}

export default function CrawlOverlay({ open, autoTarget, examples, onClose, onCard }: {
  open: boolean;
  autoTarget: string | null;
  examples: RecentRow[];
  onClose: () => void;
  onCard: (src: string, label: string) => void;
}) {
  const [step, setStep] = useState<Step>("input");
  const [value, setValue] = useState("");
  const [cmd, setCmd] = useState<React.ReactNode>(<>&gt; waiting for a contract</>);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [passes, setPasses] = useState<Pass[]>(() => PASSES.map(() => ({ state: "queued", pct: 0 })));
  const [feed, setFeed] = useState<Feed[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [kv, setKv] = useState({ n: "0", e: "0" });
  const [cardState, setCardState] = useState<"loading" | "ok" | "error">("loading");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const bugsRef = useRef<Bug[]>([]);
  const t0Ref = useRef(0);
  const elapsedRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const feedId = useRef(0);
  const autoDone = useRef<string | null>(null);

  const pushFeed = useCallback((c: string, m: string, v: string, cls: string) => {
    setFeed((f) => [{ id: feedId.current++, c, m, v, cls }, ...f].slice(0, 4));
  }, []);
  /* progress rewrites the crawler's live row instead of stacking new ones */
  const progressFeed = useCallback((c: string, m: string, v: string) => {
    setFeed((f) => {
      const top = f[0];
      if (top && top.c === c && top.cls === "y") return [{ ...top, m, v }, ...f.slice(1)];
      return [{ id: feedId.current++, c, m, v, cls: "y" }, ...f].slice(0, 4);
    });
  }, []);

  const toInput = useCallback((f: Failure | null) => {
    abortRef.current?.abort();
    setFailure(f);
    setStep("input");
    setCmd(<>&gt; waiting for a contract</>);
  }, []);

  const start = useCallback(async (raw: string) => {
    const target = raw.trim();
    if (!target) {
      inputRef.current?.focus();
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setFailure(null);
    setReport(null);
    setCardState("loading");
    setFeed([]);
    setKv({ n: "...", e: "..." });
    setPasses(PASSES.map(() => ({ state: "queued", pct: 0 })));
    const shown = target.startsWith("0x") && target.length > 22 ? target.slice(0, 10) + "…" + target.slice(-8) : target;
    setCmd(<>&gt; walk <b>{shown}</b> --depth full<span className="car" /></>);
    graphRef.current = buildChain(11, [4, 7]);
    bugsRef.current = BUGTAGS.map((tag) => ({ li: ri(0, graphRef.current!.links.length - 1), t: Math.random(), v: rnd(0.01, 0.022), tag, leg: rnd(0, 6.28) }));
    t0Ref.current = performance.now();
    setStep("run");

    let res: Response;
    try {
      res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
        signal: ac.signal,
      });
    } catch {
      if (!ac.signal.aborted) toInput({ message: "could not reach the crawler; check the connection and try again" });
      return;
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toInput({ message: body.error ?? `the crawler answered ${res.status}` });
      return;
    }

    const setPass = (name: string, fn: (p: Pass) => Pass) =>
      setPasses((ps) => ps.map((p, i) => (PASSES[i][0] === name ? fn(p) : p)));
    let finished = false;
    try {
      await readSSE(res, (event, data) => {
        if (ac.signal.aborted) return;
        if (event === "resolved") {
          const token = (data as { token: string }).token;
          setCmd(<>&gt; walk <b>{token.slice(0, 10) + "…" + token.slice(-8)}</b> --depth full<span className="car" /></>);
          try {
            window.history.replaceState(null, "", `/?token=${token}`);
          } catch { /* history is a convenience */ }
        } else if (event === "stage") {
          const e = data as { crawler: string; state: "running" | "done"; detail?: string };
          const i = PASSES.findIndex((p) => p[0] === e.crawler);
          setPass(e.crawler, (p) => ({ state: e.state === "done" ? "done" : p.state === "done" ? "done" : "running", pct: e.state === "done" ? 100 : Math.max(p.pct, 4) }));
          pushFeed(e.crawler, e.detail ?? (i >= 0 ? PASSES[i][1] : ""), e.state, e.state === "done" ? "g" : "c");
        } else if (event === "progress") {
          const e = data as { crawler: string; done: number; total: number; detail?: string };
          const pct = e.total > 0 ? Math.min(99, (e.done / e.total) * 100) : 0;
          setPass(e.crawler, (p) => (p.state === "done" ? p : { state: "running", pct: Math.max(p.pct, pct) }));
          progressFeed(e.crawler, e.detail ? `reading logs · ${e.detail}` : "reading logs", `${Math.round(pct)}%`);
        } else if (event === "report") {
          finished = true;
          const r = data as Report;
          setPasses(PASSES.map(() => ({ state: "done", pct: 100 })));
          const real = graphFromReport(r.graph);
          if (real) graphRef.current = real;
          const w = r.crawlers.find((c) => c.name === "WEAVER")?.stats;
          setKv({ n: firstNum(w?.[0]) || String(r.graph.nodes.length), e: firstNum(w?.[1]) || String(r.graph.links.length) });
          pushFeed("ORACLE", "score written", `${r.score} / 100`, "g");
          setReport(r);
          setCmd(<>&gt; walk <b>{r.token.address.slice(0, 10) + "…" + r.token.address.slice(-8)}</b> --depth full · done</>);
          window.setTimeout(() => { if (!ac.signal.aborted) setStep("report"); }, 1300);
        } else if (event === "error") {
          finished = true;
          const e = data as Failure;
          toInput(e);
        }
      });
    } catch {
      if (!ac.signal.aborted && !finished) toInput({ message: "the stream broke before the crawl finished; try again" });
      return;
    }
    if (!finished && !ac.signal.aborted) toInput({ message: "the crawl ended without a report; try again in a moment" });
  }, [pushFeed, progressFeed, toInput]);

  /* running bars creep toward done while the engine works without a count */
  useEffect(() => {
    if (step !== "run") return;
    const id = setInterval(() => {
      setPasses((ps) => ps.map((p, i) => (p.state === "running" && PASSES[i][0] !== "WEAVER" ? { ...p, pct: p.pct + (90 - p.pct) * 0.04 } : p)));
    }, 120);
    return () => clearInterval(id);
  }, [step]);

  /* deep link: /?token=0x.. opens straight into a crawl */
  useEffect(() => {
    if (!open || !autoTarget || autoDone.current === autoTarget) return;
    /* the flag is set when the crawl actually starts: a strict-mode double
     * run clears the first timer, and the second must still fire */
    const id = setTimeout(() => {
      autoDone.current = autoTarget;
      setValue(autoTarget);
      void start(autoTarget);
    }, 0);
    return () => clearTimeout(id);
  }, [open, autoTarget, start]);

  useEffect(() => {
    if (open && step === "input") {
      const id = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(id);
    }
  }, [open, step]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---- the graph canvas, alive only while step 2 is on screen ---- */
  useEffect(() => {
    if (!open || step !== "run") return;
    const cv = cvRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const DPR = dprNow();
    let CW = 0, CH = 0;
    const csz = () => {
      const r = cv.getBoundingClientRect();
      cv.width = r.width * DPR;
      cv.height = r.height * DPR;
      CW = cv.width;
      CH = cv.height;
    };
    csz();
    const { mono } = fontsFor();
    const still = reducedMotion();
    let raf = 0, last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (still && t - last < 600) return;
      last = t;
      const CG = graphRef.current;
      if (!CG || !CW) return;
      if (!still) {
        for (const b of bugsRef.current) {
          b.t += b.v;
          if (b.t >= 1) {
            const n = CG.nodes[CG.links[b.li]?.[1]];
            if (n && n.st === "raw" && n.k !== "contract") n.st = b.tag;
            b.li = ri(0, CG.links.length - 1);
            b.t = 0;
          }
        }
      }
      drawChain(ctx, CG, CW, CH, t, bugsRef.current, true, DPR, mono);
      if (elapsedRef.current) elapsedRef.current.textContent = ((performance.now() - t0Ref.current) / 1000).toFixed(1) + "s";
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", csz);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", csz);
    };
  }, [open, step]);

  /* once the report is in, the swarm stops colouring: the graph shows what the crawl found */
  useEffect(() => {
    if (report) bugsRef.current = bugsRef.current.map((b) => ({ ...b, tag: "raw" as NodeState }));
  }, [report]);

  const close = () => {
    abortRef.current?.abort();
    setStep("input");
    setFailure(null);
    setCmd(<>&gt; waiting for a contract</>);
    try {
      window.history.replaceState(null, "", "/");
    } catch { /* history is a convenience */ }
    onClose();
  };

  if (!open) return null;

  const r = report;
  const b = r ? bandInfo(r.score) : null;
  const cardSrc = r ? `/api/card?token=${r.token.address}` : "";
  const cardLabel = r && b ? `web score ${r.score} · ${r.label.toLowerCase()}` : "";

  return (
    <div id="ov" className="on" role="dialog" aria-modal="true" aria-label="Run a crawl">
      <div className="ovtop">
        <Logo small />
        <div className="cmd">{cmd}{step === "input" && <span className="car" />}</div>
        <div className="ovkv"><div className="k">nodes</div><div className="v">{step === "input" ? "0" : kv.n}</div></div>
        <div className="ovkv"><div className="k">edges</div><div className="v">{step === "input" ? "0" : kv.e}</div></div>
        <div className="ovkv"><div className="k">elapsed</div><div className="v" ref={elapsedRef}>0.0s</div></div>
        <div className="closeb" onClick={close} role="button" aria-label="Close" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") close(); }}>✕</div>
      </div>

      <div className={"step" + (step === "input" ? " on" : "")} id="stepInput">
        <div className="inputwrap">
          <img className="bigmark" src={MARK} alt="" />
          <form className="inputrow" onSubmit={(e) => { e.preventDefault(); void start(value); }}>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0x contract address or ticker"
              spellCheck={false}
              autoComplete="off"
              aria-label="Token contract address or ticker"
            />
            <button className="btn" type="submit">Run a crawl</button>
          </form>
          {failure && (
            <div className="inerr" role="alert">
              <b>crawl stopped</b> · {failure.message}
              {failure.candidates && failure.candidates.length > 0 && (
                <div className="cands">
                  {failure.candidates.map((c) => (
                    <span key={c.token} onClick={() => setValue(c.token)}>${c.symbol} · {short(c.token)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="inputnote">A crawl takes 5 to 90 seconds: a few on a fresh token, longer on a week-old one, because the swarm walks every transfer since launch. JUMPER crawls pons v2 launches only and reads public state, nothing else.</div>
          {examples.length > 0 && (
            <div className="inputchips">
              {examples.slice(0, 4).map((x) => (
                <span key={x.token} onClick={() => setValue(x.token)} title={x.token}>${x.symbol} · {short(x.token)}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={"step" + (step === "run" ? " on" : "")} id="stepRun">
        <div className="ovmain"><canvas id="crawl" ref={cvRef} /></div>
        <div className="ovlog">
          <div className="logrows">
            {feed.map((f) => (
              <div className="lrow" key={f.id}>
                <span className="c" style={{ color: CREW.find((c) => c.n === f.c)?.hex }}>{f.c}</span>
                <span className="m">{f.m}</span>
                <span className={"v " + f.cls}>{f.v}</span>
              </div>
            ))}
          </div>
          <div className="ovprog">
            {PASSES.map((p, i) => (
              <div className={"pg" + (passes[i].state === "done" ? " done" : "")} key={p[0]}>
                <div className="n"><span>{p[0]}</span><b>{passes[i].state}</b></div>
                <div className="t"><i style={{ width: Math.round(passes[i].pct) + "%" }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {r && b && (
        <div className={"step" + (step === "report" ? " on" : "")} id="stepReport">
          <div className="repwrap">
            <div>
              <div className="gradehead">
                <div className="gradeltr" style={{ color: b.color }}>{r.label}</div>
                <div>
                  <div className="gradenum"><b>{r.score}</b><span>/100</span></div>
                  <div className="gradeln">${r.token.symbol} · {r.verdict.toLowerCase()}: {r.subline}</div>
                </div>
              </div>
              <div className="gwrap">
                <div className="gradebar">
                  <i style={{ width: "34%", background: "#8C2F3F" }} />
                  <i style={{ width: "35%", background: "#8A7A2A" }} />
                  <i style={{ width: "31%", background: "#2F7D55" }} />
                  <u style={{ left: Math.max(0, Math.min(99.4, r.score)) + "%" }} />
                </div>
                <div className="gradeticks"><span>1</span><span>35</span><span>70</span><span>100</span></div>
                <ScoreBuild r={r} />
                <div className="gradenote">0-34 TORN, do not touch · 35-69 PATCHED, handle with care · 70-100 TAUT, safe to walk in. it measures the past, it does not predict. not financial advice.</div>
              </div>
              <Quads r={r} />
              <div className="repmeta">
                block <b>{fmt(r.provenance.block)}</b> · observed <b>{r.provenance.observedAt.slice(0, 16).replace("T", " ")} UTC</b> · <b>{(r.provenance.ms / 1000).toFixed(1)}s</b> · sources <b>{r.provenance.sources.join(", ")}</b>
                {r.provenance.partial && <> · <b style={{ color: "var(--ye)" }}>partial: some log ranges could not be read</b></>}
                <br />contract <b>{r.token.address}</b>
              </div>
            </div>
            <div className="repside">
              <div className="shareprev" onClick={() => onCard(cardSrc, cardLabel)}>
                {cardState === "error" && <div className="pending">card failed to render</div>}
                <img
                  src={cardSrc}
                  alt={`Share card for $${r.token.symbol}`}
                  onLoad={() => setCardState("ok")}
                  onError={() => setCardState("error")}
                  style={cardState === "error" ? { display: "none" } : undefined}
                />
                <div className="shareprevhint">{cardState === "loading" ? "rendering the card" : "click to open full size"}</div>
              </div>
              <div className="sharebtns">
                <button className="btn ghost" onClick={() => onCard(cardSrc, cardLabel)}>Open card</button>
                <button className="btn ghost" onClick={() => { setValue(""); toInput(null); }}>Run another</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Quads({ r }: { r: Report }) {
  const b = bandInfo(r.score);
  const q = r.quadrants;
  const ret = q.web.retention;
  const quads: [string, string, string, number, string, string, [string, string][] | null, string[]][] = [
    ["WEB", "real holders", pct0(q.web.realRetention ?? q.web.hold), q.web.realRetention ?? q.web.hold, b.color, "Do the people who bought still hold?",
      CHECKS.map((k) => [k, ret[k] != null ? pct0((ret[k] as number) * 100) : "n/a"]),
      [q.web.firstMinuteKept == null ? "too few real buyers in the first minute to judge them" : `${pct0(q.web.firstMinuteKept)} of the first minute's real buyers are still in`,
        `${fmt(q.web.flips ?? 0)} bots and ten-minute flips left out of the score`,
        `${fmt(r.metrics.holders)} holders right now, ${fmt(r.metrics.transfers)} transfers walked`]],
    ["SILK", "smart money", String(q.silk.smart), Math.min(100, q.silk.smartSupply * 2), "#6ED0FF", "Does anyone here know what they are doing?",
      null,
      q.silk.online
        ? [`${q.silk.smart} wallet${q.silk.smart === 1 ? "" : "s"} above the winrate gate, ${fmt(q.silk.scanned)} scanned`,
          `they hold ${pct0(q.silk.smartSupply)} of supply${q.silk.winrate != null ? `, avg winrate ${pct0(q.silk.winrate)}` : ""}`]
        : ["the wallet index was offline: smart money was not read", "the score leaves this lane out"]],
    ["SNARE", "snipers", pct0(q.snare.sniperSupply), q.snare.sniperSupply * 2, "#FFD166", "How much went before a human could read it?",
      null,
      [`${q.snare.sniperWallets} wallet${q.snare.sniperWallets === 1 ? "" : "s"} bought in the first three blocks, ${pct0(q.snare.sniperHeld ?? 0)} of supply still in their hands`,
        `${q.snare.sniperWallets === 1 ? (q.snare.sniperExited ? "it has already sold" : "it still holds") : `${q.snare.sniperExited} of them have already sold`}`,
        `${q.snare.bundles} bundled cluster${q.snare.bundles === 1 ? "" : "s"} funded from one source, ${pct0(q.snare.bundleSupply)} of supply`]],
    ["EXIT", "pressure", pct0(q.exit.exitPressure), q.exit.exitPressure, "#FF5D7A", "Is anyone leaving right now?",
      null,
      [`${pct0(q.exit.exitPressure)} of supply moved toward an exit in the last hour`,
        `dev wallet: ${q.exit.devState}${q.exit.devSoldPct > 0 ? `, sold ${pct0(q.exit.devSoldPct)}` : ""}`,
        `${q.exit.takenOut.toFixed(2)} ${q.exit.pairSymbol} taken out by wallets that left`]],
  ];
  return (
    <div className="quads">
      {quads.map(([n, s2, v, pct, col, qq, pills, lis]) => (
        <div className="quad" key={n}>
          <div className="qh"><span className="qn" style={{ color: col }}>{n}</span><span className="qs">· {s2}</span><span className="qv">{v}</span></div>
          <div className="qbar"><i style={{ width: Math.max(0, Math.min(100, pct)) + "%", background: col }} /></div>
          <div className="qq">{qq}</div>
          {pills && <div className="pills">{pills.map((p) => <span key={p[0]}>{p[0]} <b>{p[1]}</b></span>)}</div>}
          {lis.map((l) => <li key={l}>{l}</li>)}
        </div>
      ))}
    </div>
  );
}

/**
 * Where the number came from: the three things that add to it, the four that
 * take away, in points. The engine sends the points with the report, so the
 * page never recomputes the score itself.
 */
function ScoreBuild({ r }: { r: Report }) {
  const o = r.panels?.oracle;
  if (!o) return null;
  if (!o.points) return null;
  const pos: [string, number, string][] = [
    ["real holders still in", o.points.holding, "var(--ac2)"],
    ["first minute kept", o.points.kept, "var(--ac2)"],
    ["smart money", o.points.smart, "var(--cy)"],
  ];
  const neg: [string, number, string][] = [
    ["still held by snipers", o.sniper, "var(--ye)"],
    ["exit pressure", o.exit, "var(--rd)"],
    ["bundles", o.bundle, "var(--rd)"],
    ["dev sold", o.dev, "var(--rd)"],
  ];
  const f = (x: number) => (x < 10 && x > 0 && Math.round(x) !== x ? x.toFixed(1) : String(Math.round(x)));
  return (
    <div className="scorebuild">
      {pos.map(([k, v, c]) => (
        <span key={k}><b style={{ color: c }}>+{f(v)}</b> {k}</span>
      ))}
      {neg.filter(([, v]) => v > 0.05).map(([k, v, c]) => (
        <span key={k}><b style={{ color: c }}>-{f(v)}</b> {k}</span>
      ))}
      <span className="eq">= <b>{r.score}</b></span>
    </div>
  );
}
