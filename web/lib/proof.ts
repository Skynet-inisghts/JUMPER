import { indexConfigured, readProof } from "@engine/chain/history.js";
import type { Proof } from "@engine/proof.js";
import sample from "@/sample/proof.json";
import "@/lib/server";

/** The rolling backtest from the index; the checked-in run when the index is away. */
export async function loadProof(): Promise<Proof> {
  if (indexConfigured()) {
    const live = await readProof<Proof>().catch(() => null);
    if (live?.rows?.length) return live;
  }
  return sample as unknown as Proof;
}
