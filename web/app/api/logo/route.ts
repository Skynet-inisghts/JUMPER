import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { fetchTokenLogo } from "@engine/chain/logo.js";
import { coalesce, TtlCache } from "@engine/web.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/logo?token=0x..  a token's own logo, for the radar; 404 when it has none. */

const logos = new TtlCache<Buffer | null>(400);

/** What the bytes are: the logo comes from IPFS without a trustworthy type. */
function typeOf(b: Buffer): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (b.subarray(0, 3).toString() === "GIF") return "image/gif";
  return null;
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("token") ?? "";
  if (!isAddress(raw)) return NextResponse.json({ error: "pass ?token=0x.." }, { status: 400 });
  const key = raw.toLowerCase();
  let buf = logos.get(key);
  if (buf === undefined) {
    buf = await coalesce(`logo:${key}`, () => fetchTokenLogo(getAddress(raw)).catch(() => null));
    // a miss is asked again in a few minutes, a hit is kept for the day
    logos.set(key, buf, buf ? 86_400_000 : 300_000);
  }
  const type = buf ? typeOf(buf) : null;
  if (!buf || !type) return NextResponse.json({ error: "no logo" }, { status: 404, headers: { "cache-control": "public, s-maxage=300" } });
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": type, "cache-control": "public, max-age=86400, s-maxage=86400" } });
}
