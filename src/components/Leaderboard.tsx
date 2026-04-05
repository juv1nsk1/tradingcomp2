import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';
import { Trophy, TrendingUp, TrendingDown, RefreshCw, Copy } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  isLeaderboardStandingsFile,
  isRankEvolutionSnapshot,
  type LeaderboardStandingsRow,
  type RankEvolutionSnapshot,
} from '../types/leaderboard';
import { formatStandingsPortfolioValue } from '../utils/formatCompactNumber';
import { formatChartAxisDate, formatChartTooltip } from '../utils/chartTimezone';
import { factTradeUrl } from '../utils/factTradeApi';
import { useTheme } from '../hooks/useTheme';
import { getChartColors } from '../utils/chartColors';

const STANDINGS_URL =
  typeof import.meta.env.VITE_LEADERBOARD_STANDINGS_URL === 'string' &&
    import.meta.env.VITE_LEADERBOARD_STANDINGS_URL.trim() !== ''
    ? import.meta.env.VITE_LEADERBOARD_STANDINGS_URL.trim()
    : factTradeUrl('standings');
const EVOLUTION_URL =
  typeof import.meta.env.VITE_LEADERBOARD_RANK_URL === 'string' &&
    import.meta.env.VITE_LEADERBOARD_RANK_URL.trim() !== ''
    ? import.meta.env.VITE_LEADERBOARD_RANK_URL.trim()
    : factTradeUrl('rank');

/** Default starting fs564 in standings (`5,000.000`). Override with `VITE_RANK_EVOLUTION_BASELINE`. */
function rankEvolutionBaselineValue(): number {
  const raw = import.meta.env.VITE_RANK_EVOLUTION_BASELINE;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number.parseFloat(raw.trim());
    if (Number.isFinite(n)) return n;
  }
  return 5000;
}

function isUnchangedStartingBalance(balanceStr: string | undefined, baseline: number): boolean {
  if (balanceStr === undefined) return false;
  const n = Number.parseFloat(balanceStr);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n - baseline) < 1e-7;
}

/** Latest balance string per wallet (lowercase key). Standings win over history in snapshots. */
function buildLatestBalanceByWallet(
  standingsRows: LeaderboardStandingsRow[],
  snapshots: RankEvolutionSnapshot[],
): Map<string, string> {
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const fromSnapshots = new Map<string, string>();
  for (const s of sorted) {
    for (const e of s.top) {
      fromSnapshots.set(e.wallet.toLowerCase(), e.balance);
    }
  }
  const out = new Map(fromSnapshots);
  for (const r of standingsRows) {
    out.set(r.wallet.toLowerCase(), r.portfolioValue);
  }
  return out;
}

const LINE_COLORS_LIGHT = [
  '#4f46e5',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#0ea5e9',
  '#84cc16',
  '#f97316',
  '#8b5cf6',
  '#14b8a6',
  '#e11d48',
  '#64748b',
  '#22c55e',
  '#a855f7',
  '#eab308',
];
const LINE_COLORS_DARK = [
  '#818cf8',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#38bdf8',
  '#a3e635',
  '#fb923c',
  '#c084fc',
  '#2dd4bf',
  '#fb7185',
  '#94a3b8',
  '#4ade80',
  '#d8b4fe',
  '#facc15',
];

function shortWallet(w: string) {
  if (w.length <= 14) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

async function copyWalletAddress(wallet: `0x${string}`) {
  try {
    await navigator.clipboard.writeText(wallet);
    toast.success('Address copied', { duration: 2000 });
  } catch {
    toast.error('Could not copy address');
  }
}

/** Pivot evolution snapshots → Recharts rows (rank on Y by wallet key). */
function evolutionToChartData(snapshots: RankEvolutionSnapshot[], walletKeysOrdered: string[]) {
  if (snapshots.length === 0 || walletKeysOrdered.length === 0) {
    return { chartRows: [] as Record<string, unknown>[], walletKeys: [] as string[] };
  }

  const walletKeys = walletKeysOrdered;

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const chartRows = sorted.map((s) => {
    const rankByWallet = new Map(s.top.map((e) => [e.wallet.toLowerCase(), e.rank]));
    const row: Record<string, unknown> = {
      date: formatChartAxisDate(s.timestamp),
      dateFull: s.timestamp,
    };
    for (const w of walletKeys) {
      row[w] = rankByWallet.get(w) ?? null;
    }
    return row;
  });

  return { chartRows, walletKeys };
}

/** Lowercase wallet → ENS from evolution snapshots (newer snapshots win), then standings for gaps. */
function buildWalletEnsMap(
  snapshots: RankEvolutionSnapshot[],
  standingsRows: LeaderboardStandingsRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  for (const s of sorted) {
    for (const e of s.top) {
      const ens = e.ens?.trim();
      if (ens) map.set(e.wallet.toLowerCase(), ens);
    }
  }
  for (const r of standingsRows) {
    const ens = r.ens?.trim();
    if (ens) {
      const k = r.wallet.toLowerCase();
      if (!map.has(k)) map.set(k, ens);
    }
  }
  return map;
}

export function Leaderboard() {
  const { address } = useAccount();
  const { isDark } = useTheme();
  const chartColors = getChartColors();
  const lineColors = isDark ? LINE_COLORS_DARK : LINE_COLORS_LIGHT;
  const [standings, setStandings] = useState<LeaderboardStandingsRow[]>([]);
  const [evolution, setEvolution] = useState<RankEvolutionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJson = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${STANDINGS_URL}?t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`${EVOLUTION_URL}?t=${Date.now()}`, { cache: 'no-store' }),
      ]);
      if (!r1.ok) throw new Error(`Standings ${r1.status}`);
      if (!r2.ok) throw new Error(`Evolution ${r2.status}`);
      const sJson: unknown = await r1.json();
      const eJson: unknown = await r2.json();
      if (!isLeaderboardStandingsFile(sJson)) throw new Error('Invalid standings response');
      if (!Array.isArray(eJson)) throw new Error('Rank API must return a JSON array');
      const evo = eJson.filter(isRankEvolutionSnapshot);
      setStandings(sJson.rows);
      setEvolution(evo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard data');
      setStandings([]);
      setEvolution([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJson();
  }, [loadJson]);

  const evolutionBaseline = useMemo(() => rankEvolutionBaselineValue(), []);

  const latestBalanceByWallet = useMemo(
    () => buildLatestBalanceByWallet(standings, evolution),
    [standings, evolution],
  );

  /** Wallets that appear in rank history but are not still at the starting fs564 allocation. */
  const evolutionChartWallets = useMemo(() => {
    const seen = new Set<string>();
    for (const s of evolution) {
      for (const e of s.top) seen.add(e.wallet.toLowerCase());
    }
    const active = [...seen].filter(
      (w) => !isUnchangedStartingBalance(latestBalanceByWallet.get(w), evolutionBaseline),
    );
    const rankByWallet = new Map<string, number>(
      standings.map((r) => [r.wallet.toLowerCase(), r.rank]),
    );
    active.sort((a, b) => {
      const ra: number = rankByWallet.get(a) ?? 1_000_000;
      const rb: number = rankByWallet.get(b) ?? 1_000_000;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
    return active;
  }, [evolution, standings, latestBalanceByWallet, evolutionBaseline]);

  const { chartRows, walletKeys } = useMemo(
    () => evolutionToChartData(evolution, evolutionChartWallets),
    [evolution, evolutionChartWallets],
  );

  const walletEnsByKey = useMemo(
    () => buildWalletEnsMap(evolution, standings),
    [evolution, standings],
  );

  const maxRank = useMemo(() => {
    let m = 5;
    for (const row of chartRows) {
      for (const w of walletKeys) {
        const v = row[w];
        if (typeof v === 'number' && v > m) m = v;
      }
    }
    return Math.max(m, 5);
  }, [chartRows, walletKeys]);

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4 sm:p-6">
        <div className="flex justify-between items-center mb-6 gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 min-w-0">
            <TrendingUp size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="min-w-0 leading-tight">
              Rank evolution
              {walletKeys.length > 0 ? (
                <span className="block text-sm font-normal text-gray-500 dark:text-gray-400 mt-0.5">
                  {walletKeys.length} holder{walletKeys.length === 1 ? '' : 's'} with fs564 ≠{' '}
                  {formatStandingsPortfolioValue(String(evolutionBaseline))} (starting balance)
                </span>
              ) : null}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => loadJson()}
            disabled={loading}
            className="text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50 p-1 shrink-0"
            title="Reload chart data"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {error && <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">{error}</p>}
        {!loading && evolution.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            No evolution data from the rank API yet. For local static files, set{' '}
            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">VITE_LEADERBOARD_RANK_URL=/rank-evolution.json</code>{' '}
            (and standings URL) or run{' '}
            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">npm run fetch-holder-balances</code>.
          </p>
        )}
        {!loading && evolution.length > 0 && evolutionChartWallets.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            No rank history to plot yet: every wallet in the snapshot is still at the starting balance (
            {formatStandingsPortfolioValue(String(evolutionBaseline))} fs564). Traders who move fs564 will
            appear here automatically.
          </p>
        )}
        <div
          className={`w-full min-w-0 ${walletKeys.length > 10 ? 'h-64 sm:h-72' : 'h-56 sm:h-64'}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.grid} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: chartColors.text, fontSize: 12 }}
                dy={10}
              />
              <YAxis
                reversed
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: chartColors.text, fontSize: 12 }}
                domain={[1, maxRank]}
                dx={-10}
              />
              <Tooltip
                labelFormatter={(_, p) => {
                  const pl = p?.[0]?.payload as { dateFull?: string } | undefined;
                  const iso = pl?.dateFull;
                  return iso ? formatChartTooltip(iso) : '';
                }}
                contentStyle={{
                  borderRadius: '12px',
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  backgroundColor: chartColors.tooltipBg,
                  color: chartColors.tooltipText,
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
                formatter={(value: number | string, name: string) => {
                  const ens = walletEnsByKey.get(name.toLowerCase());
                  const label = ens && ens.length > 0 ? ens : shortWallet(name);
                  return [value, label];
                }}
              />
              {walletKeys.map((w, i) => (
                <Line
                  key={w}
                  type="monotone"
                  dataKey={w}
                  name={w}
                  stroke={lineColors[i % lineColors.length]}
                  strokeWidth={walletKeys.length > 10 ? 1.5 : 2}
                  dot={walletKeys.length > 10 ? false : { r: 3, strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex-1 min-w-0">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 flex justify-between items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 min-w-0">
            <Trophy size={20} className="text-amber-500 shrink-0" />
            Competition Standings
          </h2>
          <button
            type="button"
            onClick={() => loadJson()}
            disabled={loading}
            className="text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="overflow-x-auto min-w-0">
          <table className="w-full table-fixed text-left border-collapse text-sm">
            <colgroup>
              <col className="w-11" />
              <col />
              <col className="w-20 sm:w-24" />
              <col className="w-14 sm:w-16" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-950/30">
                <th className="pl-3 pr-1 py-2.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">#</th>
                <th className="px-1 py-2.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Wallet</th>
                <th
                  className="px-1 py-2.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-right"
                  title="Portfolio value (fs564)"
                >
                  fs564
                </th>
                <th className="pl-1 pr-3 py-2.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-right">
                  Δ last
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading && standings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                    Loading standings…
                  </td>
                </tr>
              ) : standings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                    No standings yet. Run{' '}
                    <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">npm run fetch-holder-balances</code>.
                  </td>
                </tr>
              ) : (
                standings.map((row) => {
                  const isYou =
                    !!address && row.wallet.toLowerCase() === address.toLowerCase();
                  return (
                    <tr
                      key={`${row.rank}-${row.wallet}`}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors ${isYou ? 'bg-indigo-50/50 dark:bg-indigo-950/40 hover:bg-indigo-50 dark:hover:bg-indigo-950/50' : ''}`}
                    >
                      <td className="pl-3 pr-1 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-0.5">
                          <span
                            className={`text-xs font-bold tabular-nums ${row.rank <= 3 ? 'text-amber-500' : 'text-gray-900 dark:text-gray-100'}`}
                          >
                            {row.rank}
                          </span>
                          {row.rank === 1 && <Trophy size={12} className="text-amber-500 shrink-0" />}
                        </div>
                      </td>
                      <td className="px-1 py-2.5 min-w-0 text-xs text-gray-600 dark:text-gray-300">
                        {(() => {
                          const ens = row.ens?.trim();
                          const hasEns = Boolean(ens && ens.length > 0);
                          const display = hasEns
                            ? ens!
                            : isYou && address
                              ? shortWallet(address)
                              : shortWallet(row.wallet);
                          const title = hasEns ? `${ens} · ${row.wallet}` : row.wallet;
                          return (
                            <div className="flex items-center gap-1 min-w-0 max-w-full">
                              <span
                                className={`truncate min-w-0 ${hasEns ? 'font-medium text-gray-800 dark:text-gray-200' : 'font-mono'} ${isYou ? 'font-semibold text-indigo-600 dark:text-indigo-400' : ''}`}
                                title={title}
                              >
                                {display}
                              </span>
                              {isYou && (
                                <span className="bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[9px] px-1 py-0.5 rounded shrink-0">
                                  You
                                </span>
                              )}
                              <button
                                type="button"
                                className="shrink-0 p-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                aria-label="Copy wallet address"
                                title="Copy wallet address"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void copyWalletAddress(row.wallet);
                                }}
                              >
                                <Copy size={14} strokeWidth={2} />
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                      <td
                        className="px-1 py-2.5 whitespace-nowrap text-right text-xs font-medium text-gray-900 dark:text-gray-100 tabular-nums"
                        title={row.portfolioValue}
                      >
                        {formatStandingsPortfolioValue(row.portfolioValue)}
                      </td>
                      <td className="pl-1 pr-3 py-2.5 whitespace-nowrap text-right">
                        <span
                          className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${Number(row.change24h) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                            }`}
                        >
                          {Number(row.change24h) >= 0 ? (
                            <TrendingUp size={12} className="shrink-0" />
                          ) : (
                            <TrendingDown size={12} className="shrink-0" />
                          )}
                          {Number(row.change24h) === 0 ? '-' : Math.abs(Number(row.change24h))}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
