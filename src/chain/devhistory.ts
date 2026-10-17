import type { Address } from "viem";
import { factoryAbi } from "./abi.js";
import { ADDR, publicClient } from "./chain.js";

/** The first Pons launch; nothing before it can be a launch. */
const FIRST_LAUNCH_BLOCK = 27_000_000;
/** A narrow filter (one indexed deployer) reads ten million blocks per call. */
const WINDOW = 10_000_000;

const launchedEvent = factoryAbi.find((e) => e.type === "event" && e.name === "TokenLaunched")!;

/**
 * Every token a deployer launched through the Pons factory: TokenLaunched
 * indexes the deployer, so the whole history is a handful of windows read
 * side by side. A window that fails leaves its part out and says so.
 */
export async function readDevLaunches(deployer: Address, toBlock: number): Promise<{ launches: { token: string; block: number }[]; complete: boolean }> {
  const windows: [number, number][] = [];
  for (let a = FIRST_LAUNCH_BLOCK; a <= toBlock; a += WINDOW) windows.push([a, Math.min(toBlock, a + WINDOW - 1)]);
  const parts = await Promise.all(windows.map(async ([a, b]) => {
    try {
      const logs = await publicClient.getLogs({
        address: ADDR.ponsFactory, event: launchedEvent as never, args: { deployer } as never,
        fromBlock: BigInt(a), toBlock: BigInt(b),
      } as never) as unknown as { args: { token: string }; blockNumber: bigint }[];
      return { ok: true, rows: logs.map((l) => ({ token: l.args.token.toLowerCase(), block: Number(l.blockNumber) })) };
    } catch {
      return { ok: false, rows: [] };
    }
  }));
  return {
    launches: parts.flatMap((p) => p.rows).sort((x, y) => y.block - x.block),
    complete: parts.every((p) => p.ok),
  };
}
