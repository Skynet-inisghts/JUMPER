"use client";
/* eslint-disable @next/next/no-img-element -- the generated card PNG, shown full size */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The share card, full screen. A portal into <body> so no stacking context
 * of the page can paint over it; Esc or a click anywhere closes it.
 */
export default function Lightbox({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const id = requestAnimationFrame(() => setShown(true));
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(id); };
  }, [onClose]);
  return createPortal(
    <div id="share" className={shown ? "on" : ""} style={{ display: "grid" }} role="dialog" aria-modal="true" aria-label="Share card, full screen" onClick={onClose}>
      <img id="shareCard" src={src} alt="JUMPER share card" />
      <div className="sharebar">
        <span>{label}</span>
        <a className="btn ghost" href={src} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Open PNG</a>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
