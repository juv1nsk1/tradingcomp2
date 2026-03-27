/** One row in `public/leaderboard-standings.json` — Competition Standings table. */
export type LeaderboardStandingsRow = {
  rank: number;
  wallet: `0x${string}`;
  /** FT564 balance (human-readable string) */
  portfolioValue: string;
  /** % change vs last script run (same wallet); "0" if unknown */
  change24h: string;
  /** Primary ENS on Sepolia from `data/holder-ens.csv` when present; omitted or empty if unknown. */
  ens?: string;
};

export type LeaderboardStandingsFile = {
  updatedAt: string;
  rows: LeaderboardStandingsRow[];
};

/** One holder in a rank-evolution snapshot (top by balance). */
export type RankEvolutionEntry = {
  rank: number;
  wallet: `0x${string}`;
  balance: string;
  /** Primary ENS on Sepolia from `data/holder-ens.csv` when present; omitted or empty if unknown. */
  ens?: string;
};

/** One time point for the evolution chart (top N holders). */
export type RankEvolutionSnapshot = {
  timestamp: string;
  top: RankEvolutionEntry[];
};

export function isLeaderboardStandingsFile(x: unknown): x is LeaderboardStandingsFile {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.updatedAt !== 'string' || !Array.isArray(o.rows)) return false;
  return o.rows.every((r) => {
    if (r === null || typeof r !== 'object') return false;
    const row = r as LeaderboardStandingsRow & { ens?: unknown };
    return (
      typeof row.rank === 'number' &&
      typeof row.wallet === 'string' &&
      typeof row.portfolioValue === 'string' &&
      typeof row.change24h === 'string' &&
      (row.ens === undefined || typeof row.ens === 'string')
    );
  });
}

export function isRankEvolutionSnapshot(x: unknown): x is RankEvolutionSnapshot {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.timestamp !== 'string' || !Array.isArray(o.top)) return false;
  return o.top.every((e) => {
    if (e === null || typeof e !== 'object') return false;
    const entry = e as RankEvolutionEntry & { ens?: unknown };
    return (
      typeof entry.rank === 'number' &&
      typeof entry.wallet === 'string' &&
      typeof entry.balance === 'string' &&
      (entry.ens === undefined || typeof entry.ens === 'string')
    );
  });
}
