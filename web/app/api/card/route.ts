import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { CrawlError } from "@engine/crawl.js";
import { renderCard } from "@engine/card/card.js";
import { fetchTokenLogo } from "@engine/chain/logo.js";
import { clientIp, coalesce, RateLimiter, reportTtlMs, TtlCache } from "@engine/web.js";
import type { Report } from "@engine/crawlers/types.js";
import { blockedMessage } from "@engine/blocked.js";
import { cachedReport, crawlShared } from "@/lib/server";
import sample from "@/sample/sample-report.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/card?token=0x..  the 1080x1080 share card for one token, from the
 *                           cached report or a fresh (shared) crawl
 * GET /api/card?sample=1    the bundled sample report with the SAMPLE stamp
 */

const pngs = new TtlCache<Buffer>(150);
const bare = new Set<string>();
const limiter = new RateLimiter(10, 60_000);

/** A card drawn without its logo is kept a minute: the logo is usually there on the next try. */
const NO_LOGO_MS = 60_000;

const png = (buf: Buffer, short = false) =>
  new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "image/png",
      "cache-control": short ? "public, s-maxage=60" : "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("sample")) {
    const hit = pngs.get("sample");
    if (hit) return png(hit);
    const buf = await coalesce("card:sample", () => renderCard(sample as unknown as Report, { sample: true }));
    pngs.set("sample", buf, 60 * 60_000);
    return png(buf);
  }

  const raw = url.searchParams.get("token") ?? "";
  if (!isAddress(raw)) {
    return NextResponse.json({ error: "pass ?token=0x.. (a pons v2 token contract address)" }, { status: 400 });
  }
  const token = getAddress(raw);
  const key = token.toLowerCase();
  const blocked = blockedMessage(token);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 404 });
  const hit = pngs.get(key);
  if (hit) return png(hit, bare.has(key));

  let report = cachedReport(token);
  if (!report && !limiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "too many cards at once; try again shortly" }, { status: 429 });
  }

  try {
    const buf = await coalesce(`card:${key}`, async () => {
      if (!report) report = await crawlShared(token).promise;
      const logo = await fetchTokenLogo(token).catch(() => null);
      const out = await renderCard(report, { logo: logo ?? undefined });
      if (logo) bare.delete(key);
      else bare.add(key);
      pngs.set(key, out, logo ? reportTtlMs(report.token.ageSec) : NO_LOGO_MS);
      return out;
    });
    return png(buf, bare.has(key));
  } catch (error) {
    if (error instanceof CrawlError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "chain read failed; try again in a moment" }, { status: 502 });
  }
}
