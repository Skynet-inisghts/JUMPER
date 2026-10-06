import { THRESHOLDS } from "../score/config.js";
import { lc } from "./common.js";
import type { KnotOut, SnareOut, Tape, WeaverOut } from "./types.js";

/** Which wallets KNOT looks up: snipers first (bundles live there), then the largest holders. */
export function knotTargets(web: WeaverOut, snared: SnareOut): string[] {
  const out = new Set<string>();
  for (const s of snared.snipers) if (!s.exited) out.add(s.wallet);
  for (const h of web.holders) {
    if (out.size >= THRESHOLDS.knotWallets) break;
    out.add(h.address);
  }
  return [...out].slice(0, THRESHOLDS.knotWallets);
}

/**
 * KNOT: wallets funded from one source within minutes of each other.
 *
 * Funding is the first ETH a wallet ever received. Wallets sharing a funder
 * are knotted when their fundings fall inside a ten-minute window; one
 * funder far apart in time is a habit, not a bundle. The wallets the
 * launcher declared exempt from the opening tax are a cluster by their own
 * admission and are counted whether or not their funding was read.
 */
export function knot(tape: Tape, web: WeaverOut): KnotOut {
  const balanceOf = (w: string) => web.wallets.get(w)?.balance ?? 0n;
  const byFunder = new Map<string, { wallet: string; ts: number }[]>();
  for (const f of tape.funding) {
    const list = byFunder.get(f.funder) ?? [];
    list.push({ wallet: f.wallet, ts: f.ts });
    byFunder.set(f.funder, list);
  }

  const clusters: KnotOut["clusters"] = [];
  for (const [funder, list] of byFunder) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.ts - b.ts);
    let group = [list[0]];
    const flush = () => {
      if (group.length >= 2) {
        const wallets = group.map((g) => g.wallet);
        clusters.push({ funder, wallets, supply: wallets.reduce((s, w) => s + balanceOf(w), 0n), declared: false });
      }
    };
    for (const item of list.slice(1)) {
      if (item.ts - group[group.length - 1].ts <= THRESHOLDS.knotWindowSec) group.push(item);
      else { flush(); group = [item]; }
    }
    flush();
  }

  const declared = tape.launch.exemptions.map(lc).filter((w) => web.wallets.has(w));
  if (declared.length) {
    clusters.push({ funder: lc(tape.launch.deployer), wallets: declared, supply: declared.reduce((s, w) => s + balanceOf(w), 0n), declared: true });
  }

  clusters.sort((a, b) => (b.supply > a.supply ? 1 : b.supply < a.supply ? -1 : 0));
  // a wallet in two clusters (declared and funded) is counted once
  const inCluster = new Set(clusters.flatMap((c) => c.wallets));
  const bundleSupply = [...inCluster].reduce((s, w) => s + balanceOf(w), 0n);
  return { looked: tape.fundingAsked, read: tape.fundingRead ?? tape.funding.length, clusters, bundleSupply };
}
