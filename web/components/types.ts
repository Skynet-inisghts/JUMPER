import type { Pulse } from "@engine/chain/history.js";

export interface RecentRow { token: string; symbol: string; holders: number; score: number; band: string; at?: number }

/** /api/pulse: the index's counters, or offline with the bundled list of past crawls. */
export type PulseState = Pulse | { offline: true; recent: RecentRow[] } | null;

export const recentOf = (p: PulseState): RecentRow[] => (p ? p.recent ?? [] : []);
