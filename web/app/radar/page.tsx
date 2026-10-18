import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import Footer from "@/components/Footer";
import RadarView, { type RadarData } from "@/components/RadarView";
import { indexConfigured, readRadar } from "@engine/chain/history.js";
import "@/lib/server";

// the first paint carries the radar; the page reads it again by itself
export const revalidate = 30;

export const metadata: Metadata = {
  title: "JUMPER · launch radar",
  description: "Fresh Pons launches whose buyers are staying: the last three hours, read off the trade index.",
};

export default async function RadarPage() {
  const data = indexConfigured() ? ((await readRadar().catch(() => null)) as RadarData | null) : null;
  return (
    <div className="page radarpage">
      <nav>
        <div className="wrap nav">
          <Logo />
          <div className="tagline">launch radar</div>
          <div className="navlinks"><Link href="/">Back to the terminal</Link></div>
        </div>
      </nav>
      <div className="wrap">
        <RadarView initial={data} />
      </div>
      <Footer />
    </div>
  );
}
