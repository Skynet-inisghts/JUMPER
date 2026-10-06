import { ADDR, CHAIN_ID, publicClient } from "./chain/chain.js";
import { factoryAbi } from "./chain/abi.js";
import { endpoints } from "./chain/rpc.js";

/**
 * `jumper doctor`: every source a crawl reads, checked once, plus the pons
 * addresses baked into chain.ts compared against the live factory. All
 * reads. A red line means some part of a report would be missing; the
 * line says which crawler goes without.
 */

interface Check { name: string; ok: boolean; detail: string; ms: number }

async function timed(name: string, run: () => Promise<{ ok: boolean; detail: string }>): Promise<Check> {
  const started = Date.now();
  try {
    return { name, ...(await run()), ms: Date.now() - started };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message.split("\n")[0].slice(0, 110), ms: Date.now() - started };
  }
}

async function probeEndpoint(url: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "jumper/0.1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await res.json()) as { result?: string };
  const id = data.result ? parseInt(data.result, 16) : 0;
  return { ok: res.ok && id === CHAIN_ID, detail: `eth_chainId ${id || "unreadable"}` };
}

export async function runDoctor(print: (line: string) => void): Promise<boolean> {
  const checks: Check[] = [];
  for (const e of endpoints) checks.push(await timed(`rpc ${e.label}${e.logs ? " (logs)" : ""}`, () => probeEndpoint(e.url)));

  checks.push(await timed("pons factory", async () => {
    const f = { address: ADDR.ponsFactory, abi: factoryAbi } as const;
    const r = await publicClient.multicall({
      allowFailure: false,
      contracts: [{ ...f, functionName: "feeEscrow" }, { ...f, functionName: "memeHook" }, { ...f, functionName: "launchDeployer" }],
    });
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const ok = same(r[0], ADDR.ponsEscrow) && same(r[1], ADDR.ponsHook) && same(r[2], ADDR.ponsDeployer);
    return { ok, detail: ok ? "escrow, hook and deployer match chain.ts" : `chain.ts is stale: escrow ${r[0]} hook ${r[1]} deployer ${r[2]}` };
  }));

  checks.push(await timed("wallet index (SCOUT, LEDGER)", async () => {
    const { indexConfigured } = await import("./chain/history.js");
    if (!indexConfigured()) return { ok: false, detail: "JUMPER_INDEX_URL / JUMPER_INDEX_KEY not set: SCOUT runs offline" };
    const base = process.env.JUMPER_INDEX_URL!.replace(/\/$/, "");
    const res = await fetch(`${base}/health`, { headers: { "x-jumper-key": process.env.JUMPER_INDEX_KEY! }, signal: AbortSignal.timeout(8_000) });
    const data = (await res.json()) as { ok?: boolean; tip?: number };
    const head = Number(await publicClient.getBlockNumber());
    const lagMin = data.tip ? Math.round(((head - data.tip) * 0.1014) / 60) : null;
    return { ok: Boolean(data.ok), detail: data.ok ? `tip ${data.tip}, ${lagMin} min behind the head` : `HTTP ${res.status}` };
  }));

  checks.push(await timed("explorer (KNOT funding)", async () => {
    const { blockscoutFetch, blockscoutKey } = await import("./chain/blockscout.js");
    if (!blockscoutKey()) return { ok: false, detail: "BLOCKSCOUT_API_KEY not set: KNOT reads only the declared bundle" };
    const stats = (await blockscoutFetch("/api/v2/stats")) as { total_blocks?: string };
    return { ok: Boolean(stats.total_blocks), detail: "keyed, answering" };
  }));

  checks.push(await timed("dollar rate (SIEVE, LEDGER)", async () => {
    const { ethUsd } = await import("./chain/prices.js");
    const r = await ethUsd();
    return { ok: Boolean(r), detail: r ? `ETH $${r.usd.toFixed(0)} from ${r.source}` : "no rate: dust falls back to a share of supply" };
  }));

  for (const c of checks) {
    print(`${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(30)} ${String(c.ms).padStart(5)} ms  ${c.detail}`);
  }
  return checks.every((c) => c.ok);
}
