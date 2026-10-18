import { parseAbi, type Address } from "viem";
import { publicClient } from "./chain.js";

/**
 * The token's own logo, as pons stores it: `getTokenInfo()` on the token
 * contract returns an ipfs:// reference (or a link), read through the
 * gateway the pons site itself uses, then the link, then a public gateway.
 * Missing, huge or unreachable logos degrade to null and the card draws its
 * grey initial circle instead.
 * Gateway mapping adapted from bodkin (MIT) — https://github.com/Phosphenq/bodkin
 */

const infoAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

const MAX_BYTES = 4 * 1024 * 1024;

/** The IPFS content id in an ipfs:// reference or in any gateway link (path or subdomain style). */
export function ipfsCid(logo: string): string | null {
  if (logo.startsWith("ipfs://")) return logo.slice(7).replace(/^ipfs\//, "").split(/[/?#]/)[0] || null;
  const path = logo.match(/^https?:\/\/[^/]+\/ipfs\/([A-Za-z0-9]+)/);
  if (path) return path[1];
  const sub = logo.match(/^https?:\/\/([A-Za-z0-9]+)\.ipfs\./);
  return sub ? sub[1] : null;
}

/**
 * Where to read a logo, best first. An IPFS logo goes through the gateway
 * the pons site uses (twice: it answers in well under a second, and a miss
 * is usually a cold cache), then the token's own link, then a public gateway.
 */
export function logoUrls(logo: string): string[] {
  if (!logo) return [];
  const own = logo.startsWith("http://") || logo.startsWith("https://") ? [logo] : [];
  const cid = ipfsCid(logo);
  if (!cid) return own;
  const pons = `https://dbk-vercel.vercel.app/api/ipfs/content/${cid}?variant=card`;
  return [pons, pons, ...own, `https://gateway.pinata.cloud/ipfs/${cid}`];
}

export const logoUrl = (logo: string): string => logoUrls(logo)[0] ?? "";

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length === 0 || bytes.length > MAX_BYTES ? null : bytes;
  } catch {
    return null;
  }
}

export async function fetchTokenLogo(token: Address): Promise<Buffer | null> {
  try {
    const read = () => publicClient.readContract({ address: token, abi: infoAbi, functionName: "getTokenInfo" });
    // one retry: a busy RPC should not cost the card its logo
    const info = await read().catch(read);
    for (const url of logoUrls(info[1])) {
      const bytes = await fetchImage(url);
      if (bytes) return bytes;
    }
    return null;
  } catch {
    return null;
  }
}
