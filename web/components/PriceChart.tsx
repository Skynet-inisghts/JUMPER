"use client";
import { useEffect, useRef, useState } from "react";
import type { Report } from "@/lib/util";

/** The line runs from dark purple at launch to light purple at the newest candle. */
const FROM = [0x3b, 0x16, 0x70];
const TO = [0xe2, 0xcc, 0xff];
const mix = (f: number) => "#" + FROM.map((a, i) => Math.round(a + (TO[i] - a) * f).toString(16).padStart(2, "0")).join("");

type Hover = { t: number; o: number; h: number; l: number; c: number } | null;
type Mode = "line" | "candles";
type Frame = "1m" | "5m" | "all";
const FRAMES: [Frame, string][] = [["1m", "1m"], ["5m", "5m"], ["all", "All"]];

/**
 * The token's price, read as the market cap in dollars on the right axis
 * (the price when no cap was read), on a log scale. A purple line or
 * candles; one-minute, five-minute or whole-life candles (curve trades, then
 * pool swaps). The wheel or a pinch zooms, a drag scrolls, a double click on
 * the time axis fits it all again.
 */
export default function PriceChart({ r }: { r: Report }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [mode, setMode] = useState<Mode>("line");
  const [frame, setFrame] = useState<Frame>("all");

  const led = r.panels?.ledger;
  const k = led?.priceUsd != null && led.priceQuote ? led.priceUsd / led.priceQuote : null;
  const raw = r.chart ?? [];
  const src = frame === "1m" ? r.candles?.m1 ?? [] : frame === "5m" ? r.candles?.m5 ?? [] : raw;
  const usable = raw.length >= 2 && raw.some((c) => c.h !== c.l || c.o !== c.c);

  // market cap in dollars when the crawl read a rate and a cap; the price otherwise
  const m = r.market;
  const supply = m?.mcapUsd && m?.priceUsd ? m.mcapUsd / m.priceUsd : null;
  const cap = k != null && supply != null ? k * supply : null;
  const toShown = (p: number) => (cap != null ? p * cap : k != null ? p * k : p);
  const label = (x: number) => {
    if (!(x > 0)) return cap != null || k != null ? "$0" : "0";
    if (cap != null) {
      if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
      if (x >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
      if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
      return "$" + x.toFixed(0);
    }
    const z = x >= 1 ? 2 : Math.min(12, Math.max(0, -Math.floor(Math.log10(x)) - 1) + 3);
    return (k != null ? "$" : "") + x.toFixed(z) + (k != null ? "" : " " + r.token.pairSymbol);
  };
  const money = (p: number) => label(toShown(p));

  useEffect(() => {
    const el = box.current;
    if (!el || !usable) return;
    let gone = false;
    let teardown = () => {};
    void import("lightweight-charts").then(({ createChart, AreaSeries, CandlestickSeries, LineStyle, PriceScaleMode, CrosshairMode }) => {
      if (gone) return;
      // strictly ascending, unique times; dollars when the crawl read a rate
      const seen = new Set<number>();
      const pts: { t: number; o: number; h: number; l: number; c: number }[] = [];
      src.forEach((c) => {
        if (!(c.c > 0) || !(c.l > 0) || seen.has(c.t)) return;
        seen.add(c.t);
        pts.push({ t: c.t, o: toShown(c.o), h: toShown(c.h), l: toShown(c.l), c: toShown(c.c) });
      });
      pts.sort((a, b) => a.t - b.t);
      if (pts.length < 2) return;

      const css = getComputedStyle(document.documentElement);
      const dim = css.getPropertyValue("--dm").trim() || "#7E7490";
      const line = css.getPropertyValue("--ln").trim() || "#241B33";

      const chart = createChart(el, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: dim, fontFamily: "inherit", fontSize: 11, attributionLogo: false },
        grid: { vertLines: { color: line + "66" }, horzLines: { color: line + "66" } },
        rightPriceScale: { borderColor: line, mode: PriceScaleMode.Logarithmic, scaleMargins: { top: 0.08, bottom: 0.04 } },
        timeScale: { borderColor: line, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
        crosshair: {
          mode: CrosshairMode.Magnet,
          vertLine: { color: "#B47CFF88", labelBackgroundColor: "#3B1670" },
          horzLine: { color: "#B47CFF88", labelBackgroundColor: "#3B1670" },
        },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      });

      const priceFormat = { type: "custom" as const, formatter: label, minMove: cap != null ? 1 : 1e-12 };
      const last = pts.length - 1;
      if (mode === "line") {
        const area = chart.addSeries(AreaSeries, {
          lineWidth: 2,
          lineColor: mix(1),
          topColor: "rgba(180,124,255,0.30)",
          bottomColor: "rgba(59,22,112,0)",
          priceLineColor: "#B47CFF",
          priceLineStyle: LineStyle.Dashed,
          crosshairMarkerBackgroundColor: "#E2CCFF",
          priceFormat,
        });
        area.setData(pts.map((x, i) => ({ time: x.t as never, value: x.c, lineColor: mix(i / last) })));
      } else {
        const up = css.getPropertyValue("--ac2").trim() || "#7DF0C8";
        const down = css.getPropertyValue("--rd").trim() || "#FF5D7A";
        const candles = chart.addSeries(CandlestickSeries, {
          upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false,
          priceLineColor: "#B47CFF",
          priceLineStyle: LineStyle.Dashed,
          priceFormat,
        });
        candles.setData(pts.map((x) => ({ time: x.t as never, open: x.o, high: x.h, low: x.l, close: x.c })));
      }

      // whole life fits; minute candles open on the newest two hours
      const show = frame === "1m" ? 120 : frame === "5m" ? 96 : 0;
      if (show && pts.length > show) chart.timeScale().setVisibleLogicalRange({ from: pts.length - show, to: pts.length - 1 });
      else chart.timeScale().fitContent();

      const byTime = new Map(pts.map((x) => [x.t, x]));
      chart.subscribeCrosshairMove((param) => {
        const t = typeof param.time === "number" ? param.time : null;
        setHover(t != null && byTime.has(t) ? byTime.get(t)! : null);
      });

      teardown = () => chart.remove();
    });
    return () => {
      gone = true;
      teardown();
    };
    // the chart is rebuilt when the report, the mode or the frame changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, mode, frame]);

  if (!usable) return null;
  // the low is the lowest point since the all-time high, not since launch
  const hi = Math.max(...raw.map((c) => c.h));
  const ath = raw.findIndex((c) => c.h === hi);
  const lows = raw.slice(ath).map((c) => c.l).filter((x) => x > 0);
  const lo = lows.length ? Math.min(...lows) : hi;
  const day = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
  return (
    <div className="pchart">
      <div className="ph">
        <b>{cap != null ? "market cap" : "price"}</b>
        {hover ? (
          <span className="phov">{day(hover.t)} UTC · <em>{label(hover.c)}</em>{mode === "candles" && <> · O {label(hover.o)} H {label(hover.h)} L {label(hover.l)}</>}</span>
        ) : (
          <span>ATH {money(hi)} · low since ATH {money(lo)} · now {money(raw[raw.length - 1].c)}</span>
        )}
        <div className="pctl">
          <div className="seg" role="group" aria-label="Chart type">
            <button type="button" className={mode === "line" ? "on" : ""} onClick={() => setMode("line")}>Line</button>
            <button type="button" className={mode === "candles" ? "on" : ""} onClick={() => setMode("candles")}>Candles</button>
          </div>
          <div className="seg" role="group" aria-label="Candle width">
            {FRAMES.filter(([f]) => f === "all" || r.candles).map(([f, t]) => (
              <button type="button" key={f} className={frame === f ? "on" : ""} onClick={() => setFrame(f)}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="pcv" ref={box} role="img" aria-label={`$${r.token.symbol} price over its life`} />
      <div className="pf">
        <span>{frame === "all" ? `${day(raw[0].t)} UTC launch` : `${frame} candles`}</span>
        <span>scroll to zoom · drag to move · double click the time axis to see it all</span>
        <span>log scale</span>
      </div>
    </div>
  );
}
