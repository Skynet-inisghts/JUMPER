"use client";
import { useCallback, useEffect, useState } from "react";
import Nav from "./Nav";
import Hero from "./Hero";
import Ticker from "./Ticker";
import Room from "./Room";
import Crawlers from "./Crawlers";
import Feed from "./Feed";
import Footer from "./Footer";
import CrawlOverlay from "./CrawlOverlay";
import Lightbox from "./Lightbox";
import SpiderLayer from "./SpiderLayer";
import { recentOf, type PulseState, type RecentRow } from "./types";
import { crawledAt, type Report } from "@/lib/util";
import recentFallback from "@/sample/recent.json";

export default function Site({ initialToken, version }: { initialToken: string | null; version: string }) {
  const [pulse, setPulse] = useState<PulseState>(null);
  const [latest, setLatest] = useState<{ report: Report; sample: boolean } | null>(null);
  const [open, setOpen] = useState(Boolean(initialToken));
  const [card, setCard] = useState<{ src: string; label: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const loadPulse = () =>
      fetch("/api/pulse")
        .then((r) => r.json())
        .then((p: PulseState) => { if (alive) setPulse(p); })
        .catch(() => { if (alive) setPulse({ offline: true, recent: recentFallback as RecentRow[] }); });
    void loadPulse();
    fetch("/api/latest")
      .then((r) => r.json())
      .then((l: { report: Report | null; sample: boolean }) => { if (alive && l.report) setLatest({ report: l.report, sample: l.sample }); })
      .catch(() => {});
    const id = setInterval(() => { if (!document.hidden) void loadPulse(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const report = latest?.report ?? null;
  const label = latest
    ? `${latest.sample ? "sample replay" : "replay"} · $${latest.report.token.symbol} · crawled ${crawledAt(latest.report)}`
    : null;
  const recent = recentOf(pulse);
  const rail = recent.length ? recent : (pulse ? (recentFallback as RecentRow[]) : []);

  const run = useCallback(() => setOpen(true), []);
  const closeCard = useCallback(() => setCard(null), []);

  return (
    <>
      <SpiderLayer report={report} />
      <div className="grain" />
      <div className="page">
        <Nav onRun={run} />
        <Hero
          version={version}
          pulse={pulse}
          report={report}
          onRun={run}
          onSample={() => setCard({ src: "/api/card?sample=1", label: "sample card · replay of a past crawl" })}
        />
        <Ticker rows={rail} />
        <Room report={report} />
        <Crawlers report={report} label={label} />
        <Feed report={report} label={label} />
        <Footer />
      </div>
      <CrawlOverlay
        open={open}
        autoTarget={initialToken}
        examples={rail.length ? rail : (recentFallback as RecentRow[])}
        onClose={() => setOpen(false)}
        onCard={(src, l) => setCard({ src, label: l })}
      />
      {card && <Lightbox src={card.src} label={card.label} onClose={closeCard} />}
    </>
  );
}
