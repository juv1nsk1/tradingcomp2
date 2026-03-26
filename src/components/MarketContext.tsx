import { useCallback, useEffect, useState } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { TOKENS, ERC20_ABI } from '../utils/contracts';
import { formatUnits } from 'viem';
import { PriceChart } from './PriceChart';
import { Wallet, TrendingUp, RefreshCw } from 'lucide-react';
import { isPoolPriceSnapshot, type PoolPriceSnapshot } from '../types/poolPrice';
import { formatCompactBalance } from '../utils/formatCompactNumber';
import { factTradeUrl } from '../utils/factTradeApi';

const POOL_PRICE_URL =
  typeof import.meta.env.VITE_POOL_PRICE_URL === 'string' && import.meta.env.VITE_POOL_PRICE_URL.trim() !== ''
    ? import.meta.env.VITE_POOL_PRICE_URL.trim()
    : factTradeUrl('poolPrice');

export function MarketContext() {
  const { address, isConnected } = useAccount();
  const [poolSnapshots, setPoolSnapshots] = useState<PoolPriceSnapshot[]>([]);
  const [poolPriceLoading, setPoolPriceLoading] = useState(true);
  const [poolPriceError, setPoolPriceError] = useState<string | null>(null);

  const loadPoolPrices = useCallback(async () => {
    setPoolPriceLoading(true);
    setPoolPriceError(null);
    try {
      const res = await fetch(`${POOL_PRICE_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Could not load pool price (${res.status})`);
      }
      const data: unknown = await res.json();
      if (!Array.isArray(data)) {
        throw new Error('Pool price API must return a JSON array');
      }
      const valid = data.filter(isPoolPriceSnapshot);
      setPoolSnapshots(valid);
    } catch (e) {
      setPoolSnapshots([]);
      setPoolPriceError(e instanceof Error ? e.message : 'Failed to load pool prices');
    } finally {
      setPoolPriceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPoolPrices();
  }, [loadPoolPrices]);

  const { data: balances, refetch, isFetching } = useReadContracts({
    contracts: [
      {
        address: TOKENS.fETH.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      },
      {
        address: TOKENS.FT564.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      },
    ],
    query: {
      enabled: !!address,
    },
  });

  const fEthBalance = balances?.[0]?.result
    ? Number(formatUnits(balances[0].result as bigint, TOKENS.fETH.decimals))
    : 0;
  const ft564Balance = balances?.[1]?.result
    ? Number(formatUnits(balances[1].result as bigint, TOKENS.FT564.decimals))
    : 0;

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Balances Panel */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Wallet size={20} className="text-indigo-600" />
            Your Balances
          </h2>
          <button
            onClick={() => refetch()}
            disabled={isFetching || !isConnected}
            className="text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>

        {!isConnected ? (
          <div className="text-center py-6 text-gray-500 text-sm bg-gray-50 rounded-xl border border-dashed border-gray-200">
            Connect your wallet to view balances
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">fETH Balance</p>
              <p className="text-2xl font-bold text-gray-900 font-mono">
                {formatCompactBalance(fEthBalance)}
              </p>
            </div>
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">fs564 Balance</p>
              <p className="text-2xl font-bold text-gray-900 font-mono">
                {formatCompactBalance(ft564Balance)}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp size={20} className="text-indigo-600" />
            Market Context
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
              fETH / fs564
            </span>
            <button
              type="button"
              onClick={() => loadPoolPrices()}
              disabled={poolPriceLoading}
              className="text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-50 p-1"
              title="Reload pool price"
            >
              <RefreshCw size={18} className={poolPriceLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-[300px] p-4">
          <PriceChart
            snapshots={poolSnapshots}
            loading={poolPriceLoading}
            error={poolPriceError}
          />
        </div>
      </div>
    </div>
  );
}
