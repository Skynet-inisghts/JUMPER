"use client";
/* eslint-disable @next/next/no-img-element -- pixel sprite and the generated card PNG */
import { useCallback, useEffect, useRef, useState } from "react";
import Logo from "./Logo";
import Similar from "./Similar";
import SilkWeb from "./SilkWeb";
import WalletCheck, { type WalletHere } from "./WalletCheck";
import type { RecentRow } from "./types";
import { buildChain, graphFromReport, type Bug, type Graph, type NodeState } from "@/lib/chain";
import { createCrawlRoom } from "@/lib/crawlroom";
import { bandInfo, CREW, dprNow, fmt, fontsFor, MARK, reducedMotion, ri, rnd, short, type Report } from "@/lib/util";
import type { CheckpointLabel } from "@engine/crawlers/types.js";

type Step = "input" | "run" | "report";
type Pass = { state: "queued" | "running" | "done"; pct: number };
type Feed = { id: number; c: string; m: string; v: string; cls: string };
type Failure = { message: string; candidates?: { token: string; symbol: string; name: string }[]; retryInSec?: number };

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
  const [wallet, setWallet] = useState<WalletHere | null>(null);
  const closeWallet = useCallback(() => setWallet(null), []);
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
  /* the card is a square as tall as the score block beside it */
  const coreRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<number | null>(null);
  useEffect(() => {
    const el = coreRef.current;
    if (!el || step !== "report") return;
    /* The card is square and the score block grows taller as it narrows, so
     * the side that makes them equal is found by measuring: bisect on the
     * card's side, laying the block out at the width that would leave it. */
    const fit = () => {
      const wrap = el.parentElement;
      if (!wrap || window.innerWidth <= 1000) { setSide(null); return; }
      const cs = getComputedStyle(wrap);
      const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const gap = parseFloat(cs.columnGap) || 24;
      const heightAt = (s: number) => { el.style.width = `${avail - s - gap}px`; return el.offsetHeight; };
      let lo = 320, hi = Math.round(avail * 0.5);
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (heightAt(mid) > mid) lo = mid; else hi = mid;
      }
      el.style.width = "";
      setSide(Math.round(lo));
    };
    /* measured after paint; again once fonts settle; again on every resize */
    let raf = requestAnimationFrame(fit);
    const later = window.setTimeout(fit, 400);
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    window.addEventListener("resize", onResize);
    void document.fonts?.ready.then(() => requestAnimationFrame(fit));
    return () => { cancelAnimationFrame(raf); clearTimeout(later); window.removeEventListener("resize", onResize); };
  }, [step, report]);
  /* what the crawl room reads every frame: kept in refs, not state */
  const passesRef = useRef<Pass[]>(PASSES.map(() => ({ state: "queued", pct: 0 })));
  const saidRef = useRef<(string | undefined)[]>([]);
  const resultsRef = useRef<([string, string] | undefined)[]>([]);
  useEffect(() => { passesRef.current = passes; }, [passes]);

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

  /* a history still being read: count down and crawl again by itself */
  const lastTarget = useRef("");
  const [retryLeft, setRetryLeft] = useState<number | null>(null);
  const startRef = useRef<(raw: string) => void>(() => {});
  useEffect(() => {
    if (retryLeft == null) return;
    if (retryLeft <= 0) { setRetryLeft(null); startRef.current(lastTarget.current); return; }
    const id = setTimeout(() => setRetryLeft((n) => (n == null ? null : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [retryLeft]);

  const toInput = useCallback((f: Failure | null) => {
    abortRef.current?.abort();
    setFailure(f);
    setRetryLeft(f?.retryInSec ? f.retryInSec : null);
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
    lastTarget.current = target;
    setRetryLeft(null);
    setFailure(null);
    setReport(null);
    setCardState("loading");
    setFeed([]);
    setKv({ n: "...", e: "..." });
    setPasses(PASSES.map(() => ({ state: "queued", pct: 0 })));
    saidRef.current = [];
    resultsRef.current = [];
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
          if (i >= 0) saidRef.current[i] = e.detail ?? (e.state === "done" ? "done" : PASSES[i][1]);
        } else if (event === "progress") {
          const e = data as { crawler: string; done: number; total: number; detail?: string };
          const pct = e.total > 0 ? Math.min(99, (e.done / e.total) * 100) : 0;
          setPass(e.crawler, (p) => (p.state === "done" ? p : { state: "running", pct: Math.max(p.pct, pct) }));
          progressFeed(e.crawler, e.detail ? `reading logs · ${e.detail}` : "reading logs", `${Math.round(pct)}%`);
          { const k = PASSES.findIndex((p) => p[0] === e.crawler); if (k >= 0) saidRef.current[k] = e.detail ? `reading ${e.detail}` : "reading logs"; }
        } else if (event === "report") {
          finished = true;
          const r = data as Report;
          setPasses(PASSES.map(() => ({ state: "done", pct: 100 })));
          resultsRef.current = PASSES.map((p) => r.crawlers.find((c) => c.name === p[0])?.stats);
          saidRef.current = PASSES.map((p) => r.crawlers.find((c) => c.name === p[0])?.lines.at(-1)?.text);
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
  useEffect(() => { startRef.current = start; }, [start]);

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
    const room = createCrawlRoom();
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
      room(ctx, CW, CH, t, { passes: passesRef.current, said: saidRef.current, results: resultsRef.current, graph: CG, bugs: bugsRef.current }, DPR, mono, !still);
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
        <div className="ovhome" onClick={close} role="button" aria-label="Back to the site" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") close(); }}>
          <Logo small />
        </div>
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
              {retryLeft != null
                ? <><b className="wait">reading the full history</b> · {failure.message} Crawling again in {retryLeft >= 60 ? `${Math.floor(retryLeft / 60)}m ${String(retryLeft % 60).padStart(2, "0")}s` : `${retryLeft}s`}. <button type="button" className="linkbtn" onClick={() => setRetryLeft(null)}>Cancel</button></>
                : <><b>crawl stopped</b> · {failure.message}</>}
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
            <div className="repcore" ref={coreRef}>
              <MarketStrip r={r} />
              <RugWarning r={r} />
              {r.outcome ? (
                <div className="gradehead">
                  <div className="gradeltr" style={{ color: "var(--dm)" }}>{r.outcome.kind.toUpperCase()}</div>
                  <div>
                    <div className="gradenum"><b style={{ color: "var(--dm)" }}>N/A</b></div>
                    <div className="gradeln">${r.token.symbol} · no score: {r.outcome.why}</div>
                  </div>
                </div>
              ) : (
              <div className="gradehead">
                <div className="gradeltr" style={{ color: b.color }}>{r.label}</div>
                <div>
                  <div className="gradenum"><b>{r.score}</b><span>/100</span></div>
                  <div className="gradeln">${r.token.symbol} · {r.verdict.toLowerCase()}: {r.subline}</div>
                </div>
              </div>
              )}
              {!r.outcome && <div className="gwrap">
                <div className="gradebar">
                  <i style={{ width: "34%", background: "#8C2F3F" }} />
                  <i style={{ width: "35%", background: "#8A7A2A" }} />
                  <i style={{ width: "31%", background: "#2F7D55" }} />
                  <u style={{ left: Math.max(0, Math.min(99.4, r.score)) + "%" }} />
                </div>
                <div className="gradeticks"><span>1</span><span>35</span><span>70</span><span>100</span></div>
                <ScoreBuild r={r} />
                <div className="gradenote">0-34 TORN, do not touch · 35-69 PATCHED, handle with care · 70-100 TAUT, safe to walk in. it measures the past, it does not predict. not financial advice.</div>
              </div>}
              <Quads r={r} />
              <Similar r={r} />
            </div>
            <div className="repside">
              <div className="shareprev" style={side ? { width: side, height: side } : undefined} onClick={() => onCard(cardSrc, cardLabel)}>
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
            </div>
            <div className="repfull">
              <PriceChart r={r} />
              <DevHistory r={r} />
              {r.silk && <SilkWeb nodes={r.silk} symbol={r.token.symbol} onWallet={(n) => setWallet({ wallet: n.wallet, symbol: r.token.symbol, roles: n.roles.map((k) => ROLE[k]?.label ?? k), share: n.gone ? null : n.share })} />}
              <TopHolders r={r} onWallet={setWallet}>
                <button className="btn ghost" onClick={() => onCard(cardSrc, cardLabel)}>Open card</button>
                <button className="btn ghost" onClick={() => { setValue(""); toInput(null); }}>Run another</button>
              </TopHolders>
              <EarlyBuyers r={r} onWallet={setWallet} />
              <div className="repmeta">
                block <b>{fmt(r.provenance.block)}</b> · observed <b>{r.provenance.observedAt.slice(0, 16).replace("T", " ")} UTC</b> · <b>{(r.provenance.ms / 1000).toFixed(1)}s</b> · sources <b>{r.provenance.sources.join(", ")}</b>
                {r.provenance.partial && <> · <b style={{ color: "var(--ye)" }}>partial: some log ranges could not be read</b></>}
                <br />contract <b>{r.token.address}</b>
              </div>
            </div>
          </div>
        </div>
      )}
      {wallet && <WalletCheck here={wallet} onClose={closeWallet} />}
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
    q.snare.sniperWallets === 0
      ? ["SNARE", "snipers", "none", 0, "#7DF0C8", "How much went before a human could read it?",
        null,
        ["nobody bought in the first three blocks: no sniper got in ahead of people",
          q.snare.bundles
            ? `${q.snare.bundles} bundled cluster${q.snare.bundles === 1 ? "" : "s"} funded from one source, ${pct0(q.snare.bundleSupply)} of supply`
            : "no bundle of wallets funded from one source"]]
      : ["SNARE", "snipers", pct0(q.snare.sniperHeld ?? q.snare.sniperSupply), (q.snare.sniperHeld ?? q.snare.sniperSupply) * 2, "#FFD166", "How much went before a human could read it?",
        null,
        [`${q.snare.sniperWallets} wallet${q.snare.sniperWallets === 1 ? "" : "s"} took ${pct0(q.snare.sniperSupply)} of supply in the first three blocks`,
          q.snare.sniperExited === q.snare.sniperWallets
            ? `all of them have sold: ${pct0(q.snare.sniperHeld ?? 0)} still in sniper hands`
            : `${pct0(q.snare.sniperHeld ?? 0)} of supply still in sniper hands, ${q.snare.sniperExited} of ${q.snare.sniperWallets} have sold`,
          `${q.snare.bundles} bundled cluster${q.snare.bundles === 1 ? "" : "s"} funded from one source, ${pct0(q.snare.bundleSupply)} of supply`]],
    exitQuad(q.exit, r.sellingNow),
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

/** EXIT: what the last hour actually did, both sides, and what leavers took in dollars. */
function exitQuad(e: Report["quadrants"]["exit"], who?: Report["sellingNow"]): [string, string, string, number, string, string, null, string[]] {
  const sold = e.soldHour ?? e.exitPressure;
  const bought = e.boughtHour ?? 0;
  const net = bought - sold;
  const p1 = (x: number) => (x > 0 && x < 1 ? x.toFixed(1) : String(Math.round(x))) + "%";
  const head = sold === 0 && bought === 0 ? "quiet" : net >= 0 ? `+${p1(net)}` : `-${p1(-net)}`;
  const col = sold === 0 && bought === 0 ? "#7E7490" : net >= 0 ? "#7DF0C8" : "#FF5D7A";
  const taken = e.takenOutUsd != null
    ? `$${fmt(e.takenOutUsd)} taken out by wallets that already left`
    : `${compact(e.takenOut)} ${e.pairSymbol} taken out by wallets that already left`;
  return ["EXIT", "last hour", head, Math.min(100, Math.abs(net) * 4), col, "Is anyone leaving right now?", null, [
    sold === 0 && bought === 0
      ? "no buys and no sales in the last hour"
      : `last hour: ${p1(bought)} of supply bought, ${p1(sold)} sold, ${net >= 0 ? `net ${p1(net)} came in` : `net ${p1(-net)} went out`}`,
    ...(who?.length ? [`who sold this hour: ${who.filter((x) => x.share >= 1).slice(0, 4).map((x) => `${Math.round(x.share)}% ${x.group} (${x.wallets})`).join(", ")}`] : []),
    `dev wallet: ${e.devState}${e.devSoldPct > 0 ? `, sold ${pct0(e.devSoldPct)} of its peak` : ""}`,
    taken,
  ]];
}

const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(2));

/** The top fifty holders by share of supply, what kind of wallet each is, and what it is doing. */
const ROLE: Record<string, { label: string; cls: string }> = {
  dev: { label: "dev", cls: "r" }, insider: { label: "insider", cls: "r" }, sniper: { label: "sniper", cls: "r" },
  bot: { label: "bot", cls: "y" }, whale: { label: "whale", cls: "c" }, smart: { label: "smart", cls: "c" },
  bundle: { label: "bundle", cls: "y" }, fresh: { label: "fresh wallet", cls: "y" }, trader: { label: "trader", cls: "d" },
  router: { label: "via router", cls: "d" }, transfer: { label: "transfer in", cls: "y" },
};

function TopHolders({ r, children, onWallet }: { r: Report; children?: React.ReactNode; onWallet: (w: WalletHere) => void }) {
  const rows = r.holders;
  const age = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);
  const counts = new Map<string, number>();
  for (const h of rows) for (const k of h.roles ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
  const worst = (h: Report["holders"][number]) => (h.roles ?? []).some((x) => x === "dev" || x === "insider" || x === "sniper") ? " bad" : (h.roles ?? []).includes("smart") ? " smart" : "";
  return (
    <div className="tophold hold8">
      <div className="th">
        <div>
          <b>top {rows.length} holders</b>
          {r.operators && (
            <span className="sum ops" title="wallets tied by a direct transfer, first tokens from one sender, one funder inside KNOT's window, or near-equal buys in one block">
              <span className={"role " + (r.operators.groups.length ? "y" : "d")}>{r.operators.wallets} wallets = {r.operators.hands} hands</span>
              {r.operators.groups.slice(0, 4).map((g) => (
                <span key={g.id} className="role y">op {g.id}: {g.wallets.length} wallets, {g.share < 1 ? g.share.toFixed(2) : g.share.toFixed(1)}% · {g.ties.join(", ")}</span>
              ))}
            </span>
          )}
          <span className="sum">
            {[...counts.entries()].filter(([k]) => k !== "trader" && k !== "router").map(([k, n]) => (
              <span key={k} className={"role " + (ROLE[k]?.cls ?? "d")}>{n} {ROLE[k]?.label ?? k}</span>
            ))}
          </span>
        </div>
        <div className="btns">{children}</div>
      </div>
      <div className="thead"><span>#</span><span>wallet</span><span>who</span><span>share</span><span>held</span><span>status</span><span>value</span><span>pnl</span></div>
      {rows.map((h, i) => (
        <div key={h.wallet} className={"tr" + worst(h)} role="button" tabIndex={0} title="wallet check"
          onClick={() => onWallet({ wallet: h.wallet, symbol: r.token.symbol, roles: (h.roles ?? []).map((k) => ROLE[k]?.label ?? k), who: h.who, share: h.share })}
          onKeyDown={(e) => { if (e.key === "Enter") onWallet({ wallet: h.wallet, symbol: r.token.symbol, roles: (h.roles ?? []).map((k) => ROLE[k]?.label ?? k), who: h.who, share: h.share }); }}>
          <span className="n">{i + 1}</span>
          <span className="w">{short(h.wallet)}</span>
          <span className="who">
            {h.op != null && <span className="role op">op {h.op}</span>}
            {(h.roles ?? []).map((k) => <span key={k} className={"role " + (ROLE[k]?.cls ?? "d")}>{ROLE[k]?.label ?? k}</span>)}
            <i>{h.who ?? h.flags.join(", ")}</i>
          </span>
          <span className="v">{h.share < 1 ? h.share.toFixed(2) : h.share.toFixed(1)}%</span>
          <span className="v d">{h.heldSec != null ? age(h.heldSec) : ""}</span>
          <ExitCell h={h} age={age} />
          <span className="v d">{h.valueUsd != null ? "$" + fmt(h.valueUsd) : ""}</span>
          <span className={"v " + (h.pnlPct == null ? "d" : h.pnlPct >= 0 ? "g" : "rd")}>{h.pnlPct != null ? `${h.pnlPct >= 0 ? "+" : ""}${Math.round(h.pnlPct)}%` : ""}</span>
        </div>
      ))}
    </div>
  );
}

/** The first twenty buyers: how soon they came in, how much they took, what they did since. */
const STATUS: Record<string, string> = { holding: "g", added: "g", "partly sold": "y", sold: "rd", moved: "y" };

function EarlyBuyers({ r, onWallet }: { r: Report; onWallet: (w: WalletHere) => void }) {
  const rows = r.early;
  if (!rows?.length) return null;
  const after = (s: number, b: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`) + ` · ${fmt(b)} blk`;
  const p = (x: number) => (x === 0 ? "0%" : x < 0.01 ? "<0.01%" : x < 1 ? x.toFixed(2) + "%" : x.toFixed(1) + "%");
  const still = rows.filter((e) => e.status === "holding" || e.status === "added").length;
  return (
    <div className="tophold early">
      <div className="th">
        <div>
          <b>first {rows.length} buyers</b>
          <span className="sum"><span className="role d">{still} of {rows.length} still in</span></span>
        </div>
      </div>
      <div className="thead"><span>#</span><span>wallet</span><span>who</span><span>after launch</span><span>at buy</span><span>now</span><span>status</span></div>
      {rows.map((e, i) => (
        <div key={e.wallet} className={"tr" + (e.roles.some((x) => x === "dev" || x === "insider" || x === "sniper") ? " bad" : e.roles.includes("smart") ? " smart" : "")} role="button" tabIndex={0} title="wallet check"
          onClick={() => onWallet({ wallet: e.wallet, symbol: r.token.symbol, roles: e.roles.map((k) => ROLE[k]?.label ?? k) })}
          onKeyDown={(ev) => { if (ev.key === "Enter") onWallet({ wallet: e.wallet, symbol: r.token.symbol, roles: e.roles.map((k) => ROLE[k]?.label ?? k) }); }}>
          <span className="n">{i + 1}</span>
          <span className="w">{short(e.wallet)}</span>
          <span className="who">{e.roles.map((k) => <span key={k} className={"role " + (ROLE[k]?.cls ?? "d")}>{ROLE[k]?.label ?? k}</span>)}</span>
          <span className="v d">{after(e.delaySec, e.delayBlocks)}</span>
          <span className="v">{p(e.atBuy)}</span>
          <span className="v">{p(e.now)}</span>
          <span className={"v " + (STATUS[e.status] ?? "d")}>{e.status === "partly sold" ? `sold ${Math.round(e.soldPct)}%` : e.status === "moved" ? "moved out" : e.status === "added" ? "added more" : e.status === "sold" ? "sold out" : "holding"}</span>
        </div>
      ))}
    </div>
  );
}

/** Price, cap, liquidity, the last day's volume, age, holders, top ten and the deployer, on one line. */
function MarketStrip({ r }: { r: Report }) {
  const m = r.market;
  if (!m) return null;
  const usd = (x: number | null) => {
    if (x == null) return "n/a";
    if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
    if (x >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
    if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
    return "$" + x.toFixed(0);
  };
  const price = (x: number | null) => {
    if (x == null) return "n/a";
    if (x >= 1) return "$" + x.toFixed(2);
    const z = Math.max(0, -Math.floor(Math.log10(x)) - 1);
    return "$" + x.toFixed(Math.min(12, z + 3));
  };
  const age = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);
  const cells: [string, React.ReactNode][] = [
    ["price", price(m.priceUsd)],
    ["mcap", usd(m.mcapUsd)],
    [m.liquidityIn === "curve" ? `liq · curve ${Math.round(r.token.curveProgress * 100)}%` : "liq · pool", usd(m.liquidityUsd)],
    ["vol 24h", <span key="vol">{m.vol24hUsd != null ? usd(m.vol24hUsd) : `${m.vol24hQuote.toFixed(2)} ${r.token.pairSymbol}`}<i> · {fmt(m.trades24h)} tx</i></span>],
    ["age", age(r.token.ageSec)],
    ["holders", fmt(r.metrics.holders)],
    ["top 10", (m.top10 < 10 ? m.top10.toFixed(1) : Math.round(m.top10)) + "%"],
    ...(r.dump ? [[r.dump.who === "operator" ? `if op 1 sells (${r.dump.wallets} wallets)` : "if top wallet sells", <span key="dump" className={r.dump.drop >= 30 ? "bad" : r.dump.drop >= 10 ? "mid" : "ok"} title={`${r.dump.share < 1 ? r.dump.share.toFixed(2) : r.dump.share.toFixed(1)}% of supply sold at once into ${r.dump.basis === "curve" ? "the curve" : "the pool (estimate: read as a full-range pool)"}; fees and other trades left out`}>-{Math.round(r.dump.drop)}% price</span>] as [string, React.ReactNode]] : []),
    ...(r.dump?.overhang ? [["holders up 3x+", <span key="over" className={r.dump.overhang.drop >= 30 ? "bad" : r.dump.overhang.drop >= 10 ? "mid" : "ok"} title={`${r.dump.overhang.wallets} holders up 3x or more on their book hold ${r.dump.overhang.share < 1 ? r.dump.overhang.share.toFixed(2) : r.dump.overhang.share.toFixed(1)}% of supply; all of it sold at once`}>{r.dump.overhang.share < 1 ? r.dump.overhang.share.toFixed(2) : r.dump.overhang.share.toFixed(1)}%<i> · -{Math.round(r.dump.overhang.drop)}% if sold</i></span>] as [string, React.ReactNode]] : []),
    ["deployer", <a key="dep" href={`https://robinhoodchain.blockscout.com/address/${r.token.deployer}`} target="_blank" rel="noreferrer">{short(r.token.deployer)}</a>],
  ];
  return (
    <div className="mstrip">
      {cells.map(([k, v]) => (
        <div key={k}><span>{k}</span><b>{v}</b></div>
      ))}
    </div>
  );
}

/** Price 80% or more below its peak: a rug when the launch side sold it, a collapse when the crowd did. */
function RugWarning({ r }: { r: Report }) {
  const g = r.rug;
  if (!g) return null;
  const ago = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);
  return (
    <div className={"rugwarn" + (g.rugged ? "" : " soft")}>
      <div className="rh"><b>{g.rugged ? "probably rugged" : "price collapsed"}</b><span>price down {Math.round(g.drawdown)}% from its peak {ago(g.peakAgoSec)} ago{g.devState === "dumped" ? ", the dev sold out" : g.devState === "sold half" ? ", the dev sold half" : ""}</span></div>
      {g.sellers.length > 0 && (
        <div className="rs">
          <span className="k">sold since the peak</span>
          {g.sellers.map((s) => (
            <span key={s.group} className={s.group === "later buyers" || s.group === "ten-minute flippers" ? "o" : ""}><b>{Math.round(s.share)}%</b> {s.group} <i>({s.wallets})</i></span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The token's price over its whole life: the report's candles (curve trades,
 * then pool swaps) on a log scale, so a launch spike and the weeks after both
 * read, with the volume under them. Dollars when the crawl read a rate.
 */
function PriceChart({ r }: { r: Report }) {
  const cs = r.chart ?? [];
  if (cs.length < 2 || !cs.some((c) => c.h !== c.l || c.o !== c.c)) return null;
  const led = r.panels?.ledger;
  const k = led?.priceUsd != null && led.priceQuote ? led.priceUsd / led.priceQuote : null;
  const W = 1000, H = 150, V = 34, PAD = 4;
  const lows = cs.map((c) => c.l).filter((x) => x > 0);
  const lo = Math.min(...lows), hi = Math.max(...cs.map((c) => c.h));
  if (!(lo > 0) || !(hi > 0)) return null;
  const L0 = Math.log(lo), L1 = Math.log(hi) === L0 ? L0 + 1 : Math.log(hi);
  const y = (p: number) => PAD + (H - 2 * PAD) * (1 - (Math.log(Math.max(p, lo)) - L0) / (L1 - L0));
  const step = W / cs.length;
  const bw = Math.max(1.5, step * 0.62);
  const vmax = Math.max(...cs.map((c) => c.v)) || 1;
  const money = (p: number) => {
    const x = k != null ? p * k : p;
    const z = x >= 1 ? 2 : Math.min(12, Math.max(0, -Math.floor(Math.log10(x)) - 1) + 3);
    return (k != null ? "$" : "") + x.toFixed(z) + (k != null ? "" : " " + r.token.pairSymbol);
  };
  const day = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
  // holders on their own scale, from zero, drawn over the candles
  const hc = r.holderCurve && r.holderCurve.length === cs.length ? r.holderCurve : null;
  const hmax = hc ? Math.max(1, ...hc) : 1;
  const hpath = hc ? hc.map((n, i) => `${i ? "L" : "M"}${(i * step + step / 2).toFixed(1)},${(PAD + (H - 2 * PAD) * (1 - n / hmax)).toFixed(1)}`).join(" ") : "";
  return (
    <div className="pchart">
      <div className="ph">
        <b>price</b>
        <span>high {money(hi)} · low {money(lo)} · now {money(cs[cs.length - 1].c)}</span>
        {hc && <span className="hl"><i />holders {fmt(hc[hc.length - 1])}{hmax > hc[hc.length - 1] ? `, peak ${fmt(hmax)}` : ""}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H + V}`} preserveAspectRatio="none" role="img" aria-label={`$${r.token.symbol} price over its life`}>
        {cs.map((c, i) => {
          const x = i * step + step / 2;
          const up = c.c >= c.o;
          const col = up ? "var(--ac2)" : "var(--rd)";
          const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={col} />
              {c.v > 0 && <rect x={x - bw / 2} y={H + V - (V - 6) * (c.v / vmax)} width={bw} height={(V - 6) * (c.v / vmax)} fill={col} opacity="0.35" />}
            </g>
          );
        })}
        {hc && <path d={hpath} fill="none" stroke="var(--cy)" strokeWidth="1.5" strokeOpacity="0.8" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="pf">
        <span>{day(cs[0].t)} UTC launch</span>
        <span>log scale · curve trades and pool swaps read from the robinhood rpc</span>
        <span>now</span>
      </div>
    </div>
  );
}

/** What a holder did with its tokens: holding, or how much it sold, moved and burned, and its last sale. */
function ExitCell({ h, age }: { h: Report["holders"][number]; age: (s: number) => string }) {
  const e = h.exit;
  if (!e) return <span className="v d" />;
  const r = (x: number) => Math.round(x);
  const parts: [string, string][] = [];
  if (e.sold >= 1) parts.push([`sold ${r(e.sold)}%`, "rd"]);
  if (e.moved >= 1) parts.push([`moved ${r(e.moved)}%`, "y"]);
  if (e.burned >= 1) parts.push([`burned ${r(e.burned)}%`, "d"]);
  const last = h.lastSellSec != null ? `last sell ${age(h.lastSellSec)} ago` : "";
  return (
    <span className="v xs" title={last}>
      {parts.length ? parts.map(([t, c]) => <i key={t} className={c}>{t}</i>) : <i className="g">holding</i>}
      {last && <u>{last}</u>}
    </span>
  );
}

/** The deployer's other launches: how many, how many died, and JUMPER's verdict where one was crawled. */
function DevHistory({ r }: { r: Report }) {
  const d = r.devHistory;
  if (!d) return null;
  const others = d.total - 1;
  const BANDC: Record<string, string> = { TORN: "rd", PATCHED: "y", TAUT: "g" };
  const ago = (block: number) => {
    const s = Math.max(0, (r.provenance.block - block) * 0.1);
    return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
  };
  return (
    <div className="devhist">
      <div className="dh">
        <b>dev history</b>
        {others <= 0
          ? <span className="g">the first launch from this deployer</span>
          : <span className={d.dead / Math.max(1, d.tokens.length) >= 0.5 ? "rd" : "y"}>
              {others} other launch{others === 1 ? "" : "es"} from this deployer: {d.dead} dead within a day, {d.quiet} never took off
            </span>}
        {!d.complete && <i>part of the factory log could not be read</i>}
      </div>
      {d.tokens.length > 0 && (
        <div className="dl">
          {d.tokens.slice(0, 12).map((t) => (
            <a key={t.token} href={`/?token=${t.token}`} className="dr">
              <b>{t.symbol ? `$${t.symbol}` : short(t.token)}</b>
              <span>{ago(t.block)}</span>
              <span>{fmt(t.wallets)} wallets</span>
              <span className={t.lastBlock > 0 && r.provenance.block - t.lastBlock > 864_000 ? "rd" : "g"}>{t.lastBlock > 0 && r.provenance.block - t.lastBlock > 864_000 ? "dead" : "trading"}</span>
              <span className={t.verdict ? BANDC[t.verdict.band] : ""}>{t.verdict ? `${t.verdict.score} ${t.verdict.band}` : "not crawled"}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
