import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { Trophy, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  isLeaderboardStandingsFile,
  isRankEvolutionSnapshot,
  type LeaderboardStandingsRow,
  type RankEvolutionSnapshot,
} from '../types/leaderboard';
import { formatCompactFromDecimalString } from '../utils/formatCompactNumber';
import { formatChartAxisDateNY, formatChartTooltipNY } from '../utils/chartTimezone';
import { factTradeUrl } from '../utils/factTradeApi';

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

const LINE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#6366f1'];

function shortWallet(w: string) {
  if (w.length <= 14) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

/** Pivot evolution snapshots → Recharts rows (rank on Y by wallet key). */
function evolutionToChartData(snapshots: RankEvolutionSnapshot[]) {
  if (snapshots.length === 0) return { chartRows: [] as Record<string, unknown>[], walletKeys: [] as string[] };

  const walletSet = new Set<string>();
  for (const s of snapshots) {
    for (const e of s.top) {
      walletSet.add(e.wallet.toLowerCase());
    }
  }
  const walletKeys = [...walletSet];

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const chartRows = sorted.map((s) => {
    const rankByWallet = new Map(s.top.map((e) => [e.wallet.toLowerCase(), e.rank]));
    const row: Record<string, unknown> = {
      date: formatChartAxisDateNY(s.timestamp),
      dateFull: s.timestamp,
    };
    for (const w of walletKeys) {
      row[w] = rankByWallet.get(w) ?? null;
    }
    return row;
  });

  return { chartRows, walletKeys };
}

export function Leaderboard() {
  const { address } = useAccount();
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

  const { chartRows, walletKeys } = useMemo(() => evolutionToChartData(evolution), [evolution]);

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
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp size={20} className="text-indigo-600" />
            Rank Evolution (Top {Math.min(5, walletKeys.length) || 5})
            <span className="text-xs font-normal text-gray-400 ml-1">(New York)</span>
          </h2>
          <button
            type="button"
            onClick={() => loadJson()}
            disabled={loading}
            className="text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-50 p-1"
            title="Reload chart data"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {error && <p className="text-sm text-amber-700 mb-2">{error}</p>}
        {!loading && chartRows.length === 0 && (
          <p className="text-sm text-gray-500 mb-4">
            No evolution data from the rank API yet. For local static files, set{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">VITE_LEADERBOARD_RANK_URL=/rank-evolution.json</code>{' '}
            (and standings URL) or run{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">npm run fetch-holder-balances</code>.
          </p>
        )}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6b7280', fontSize: 12 }}
                dy={10}
              />
              <YAxis
                reversed
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6b7280', fontSize: 12 }}
                domain={[1, maxRank]}
                dx={-10}
              />
              <Tooltip
                labelFormatter={(_, p) => {
                  const pl = p?.[0]?.payload as { dateFull?: string } | undefined;
                  const iso = pl?.dateFull;
                  return iso ? formatChartTooltipNY(iso) : '';
                }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                formatter={(value: number | string, name: string) => [value, shortWallet(name)]}
              />
              {walletKeys.map((w, i) => (
                <Line
                  key={w}
                  type="monotone"
                  dataKey={w}
                  name={w}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex-1">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Trophy size={20} className="text-amber-500" />
            Competition Standings
          </h2>
          <button
            type="button"
            onClick={() => loadJson()}
            disabled={loading}
            className="text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
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
              <tr className="border-b border-gray-100 bg-gray-50/30">
                <th className="pl-3 pr-1 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">#</th>
                <th className="px-1 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Wallet</th>
                <th
                  className="px-1 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide text-right"
                  title="Portfolio value (fs564)"
                >
                  fs564
                </th>
                <th className="pl-1 pr-3 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide text-right">
                  Δ last
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && standings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 text-sm">
                    Loading standings…
                  </td>
                </tr>
              ) : standings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 text-sm">
                    No standings yet. Run{' '}
                    <code className="text-xs bg-gray-100 px-1 rounded">npm run fetch-holder-balances</code>.
                  </td>
                </tr>
              ) : (
                standings.map((row) => {
                  const isYou =
                    !!address && row.wallet.toLowerCase() === address.toLowerCase();
                  return (
                    <tr
                      key={`${row.rank}-${row.wallet}`}
                      className={`hover:bg-gray-50 transition-colors ${isYou ? 'bg-indigo-50/50 hover:bg-indigo-50' : ''}`}
                    >
                      <td className="pl-3 pr-1 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-0.5">
                          <span
                            className={`text-xs font-bold tabular-nums ${row.rank <= 3 ? 'text-amber-500' : 'text-gray-900'}`}
                          >
                            {row.rank}
                          </span>
                          {row.rank === 1 && <Trophy size={12} className="text-amber-500 shrink-0" />}
                        </div>
                      </td>
                      <td className="px-1 py-2.5 min-w-0 font-mono text-xs text-gray-600">
                        {isYou ? (
                          <span className="font-semibold text-indigo-600 inline-flex items-center gap-1 min-w-0 max-w-full">
                            <span className="truncate">
                              {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : row.wallet}
                            </span>
                            <span className="bg-indigo-100 text-indigo-700 text-[9px] px-1 py-0.5 rounded shrink-0">
                              You
                            </span>
                          </span>
                        ) : (
                          <span className="block truncate" title={row.wallet}>
                            {shortWallet(row.wallet)}
                          </span>
                        )}
                      </td>
                      <td
                        className="px-1 py-2.5 whitespace-nowrap text-right text-xs font-medium text-gray-900 tabular-nums"
                        title={row.portfolioValue}
                      >
                        {formatCompactFromDecimalString(row.portfolioValue)}
                      </td>
                      <td className="pl-1 pr-3 py-2.5 whitespace-nowrap text-right">
                        <span
                          className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${Number(row.change24h) >= 0 ? 'text-emerald-600' : 'text-red-600'
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
