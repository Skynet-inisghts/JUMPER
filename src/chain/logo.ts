import { parseAbi, type Address } from "viem";
import { publicClient } from "./chain.js";

/**
 * The token's own logo, as pons stores it: `getTokenInfo()` on the token
 * contract returns an ipfs:// reference, served through the gateway the pons
 * site itself uses, then its old one, then a public gateway.
 * Missing, huge or unreachable logos degrade to null and the card draws its
 * grey initial circle instead.
 * Gateway mapping adapted from bodkin (MIT) — https://github.com/Phosphenq/bodkin
 */

const infoAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

const MAX_BYTES = 2 * 1024 * 1024;

export function logoUrls(logo: string): string[] {
  if (!logo) return [];
  if (logo.startsWith("ipfs://")) {
    const cid = logo.slice(7);
    return [
      `https://dbk-vercel.vercel.app/api/ipfs/content/${cid}?variant=card`,
      `https://www.ponsfamily.com/api/ipfs/content/${cid}?variant=card`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
    ];
  }
  if (logo.startsWith("http://") || logo.startsWith("https://")) return [logo];
  return [];
}

export const logoUrl = (logo: string): string => logoUrls(logo)[0] ?? "";

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length === 0 || bytes.length > MAX_BYTES ? null : bytes;
  } catch {
    return null;
  }
}

export async function fetchTokenLogo(token: Address): Promise<Buffer | null> {
  try {
    const info = await publicClient.readContract({ address: token, abi: infoAbi, functionName: "getTokenInfo" });
    for (const url of logoUrls(info[1])) {
      const bytes = await fetchImage(url);
      if (bytes) return bytes;
    }
    return null;
  } catch {
    return null;
  }
}
