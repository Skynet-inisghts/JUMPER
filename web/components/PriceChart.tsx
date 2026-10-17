"use client";
import { useEffect, useRef, useState } from "react";
import { fmt, type Report } from "@/lib/util";

/** The line runs from dark purple at launch to light purple at the newest candle. */
const FROM = [0x3b, 0x16, 0x70];
const TO = [0xe2, 0xcc, 0xff];
const mix = (f: number) => "#" + FROM.map((a, i) => Math.round(a + (TO[i] - a) * f).toString(16).padStart(2, "0")).join("");

type Hover = { t: number; p: number; h: number | null } | null;

/**
 * The token's price over its whole life: the close of each of the report's
 * candles (curve trades, then pool swaps) as one purple line on a log scale,
 * read as the market cap in dollars on the right axis (the price when no cap
 * was read). The wheel or a pinch zooms, a drag
 * scrolls, a double click on the time axis fits the whole life again.
 * Dollars when the crawl read a rate.
 */
export default function PriceChart({ r }: { r: Report }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);

  const led = r.panels?.ledger;
  const k = led?.priceUsd != null && led.priceQuote ? led.priceUsd / led.priceQuote : null;
  const raw = r.chart ?? [];
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
    void import("lightweight-charts").then(({ createChart, AreaSeries, LineSeries, LineStyle, PriceScaleMode, CrosshairMode }) => {
      if (gone) return;
      // strictly ascending, unique times; dollars when the crawl read a rate
      const seen = new Set<number>();
      const pts: { t: number; p: number; h: number | null }[] = [];
      const hc = r.holderCurve && r.holderCurve.length === raw.length ? r.holderCurve : null;
      raw.forEach((c, i) => {
        if (!(c.c > 0) || seen.has(c.t)) return;
        seen.add(c.t);
        pts.push({ t: c.t, p: toShown(c.c), h: hc ? hc[i] : null });
      });
      pts.sort((a, b) => a.t - b.t);
      if (pts.length < 2) return;

      const css = getComputedStyle(document.documentElement);
      const dim = css.getPropertyValue("--dm").trim() || "#7E7490";
      const line = css.getPropertyValue("--ln").trim() || "#241B33";
      const cyan = css.getPropertyValue("--cy").trim() || "#6ED0FF";

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

      const area = chart.addSeries(AreaSeries, {
        lineWidth: 2,
        lineColor: mix(1),
        topColor: "rgba(180,124,255,0.30)",
        bottomColor: "rgba(59,22,112,0)",
        priceLineColor: "#B47CFF",
        priceLineStyle: LineStyle.Dashed,
        crosshairMarkerBackgroundColor: "#E2CCFF",
        priceFormat: { type: "custom", formatter: label, minMove: cap != null ? 1 : 1e-12 },
      });
      const last = pts.length - 1;
      area.setData(pts.map((x, i) => ({ time: x.t as never, value: x.p, lineColor: mix(i / last) })));

      const holders = hc
        ? chart.addSeries(LineSeries, {
            priceScaleId: "holders",
            color: cyan,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
        : null;
      if (holders) {
        chart.priceScale("holders").applyOptions({ visible: false, scaleMargins: { top: 0.08, bottom: 0.04 } });
        holders.setData(pts.filter((x) => x.h != null).map((x) => ({ time: x.t as never, value: x.h as number })));
      }
      chart.timeScale().fitContent();

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
    // the chart is built once per report
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r]);

  if (!usable) return null;
  const lows = raw.map((c) => c.l).filter((x) => x > 0);
  const lo = Math.min(...lows), hi = Math.max(...raw.map((c) => c.h));
  const hc = r.holderCurve && r.holderCurve.length === raw.length ? r.holderCurve : null;
  const hmax = hc ? Math.max(1, ...hc) : 1;
  const day = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
  return (
    <div className="pchart">
      <div className="ph">
        <b>{cap != null ? "market cap" : "price"}</b>
        {hover ? (
          <span className="phov">{day(hover.t)} UTC · <em>{label(hover.p)}</em>{hover.h != null ? <> · {fmt(hover.h)} holders</> : null}</span>
        ) : (
          <span>high {money(hi)} · low {money(lo)} · now {money(raw[raw.length - 1].c)}</span>
        )}
        {hc && <span className="hl"><i />holders {fmt(hc[hc.length - 1])}{hmax > hc[hc.length - 1] ? `, peak ${fmt(hmax)}` : ""}</span>}
      </div>
      <div className="pcv" ref={box} role="img" aria-label={`$${r.token.symbol} price over its life`} />
      <div className="pf">
        <span>{day(raw[0].t)} UTC launch</span>
        <span>scroll to zoom · drag to move · double click the time axis to see it all</span>
        <span>log scale</span>
      </div>
    </div>
  );
}
