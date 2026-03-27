import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, LineSeries, type Time } from 'lightweight-charts';
import type { PoolPriceSnapshot } from '../types/poolPrice';
import { formatUnixSeconds } from '../utils/chartTimezone';

type Timeframe = '1H' | '24H' | '1W';

function filterSnapshots(snapshots: PoolPriceSnapshot[], tf: Timeframe): PoolPriceSnapshot[] {
  if (snapshots.length === 0) return [];
  const now = Date.now();
  const ms =
    tf === '1H' ? 60 * 60 * 1000 : tf === '24H' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const cut = now - ms;
  return snapshots.filter((s) => {
    const t = new Date(s.timestamp).getTime();
    return Number.isFinite(t) && t >= cut;
  });
}

function toChartPoints(snapshots: PoolPriceSnapshot[]): { time: number; value: number }[] {
  return [...snapshots]
    .filter((s) => Number.isFinite(new Date(s.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((s) => ({
      time: Math.floor(new Date(s.timestamp).getTime() / 1000),
      value: s.price,
    }));
}

type PriceChartProps = {
  snapshots: PoolPriceSnapshot[];
  loading?: boolean;
  error?: string | null;
};

export function PriceChart({ snapshots, loading, error }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('24H');

  const filtered = useMemo(() => filterSnapshots(snapshots, timeframe), [snapshots, timeframe]);
  const lineData = useMemo(() => toChartPoints(filtered), [filtered]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6b7280',
      },
      grid: {
        vertLines: { color: '#f3f4f6' },
        horzLines: { color: '#f3f4f6' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 300,
      localization: {
        timeFormatter: (time: Time) => {
          if (typeof time === 'number') return formatUnixSeconds(time);
          if (time && typeof time === 'object' && 'year' in time) {
            const bd = time as { year: number; month: number; day: number };
            const utc = Date.UTC(bd.year, bd.month - 1, bd.day, 12, 0, 0);
            return formatUnixSeconds(Math.floor(utc / 1000));
          }
          return '';
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#4f46e5',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#ffffff',
      crosshairMarkerBackgroundColor: '#4f46e5',
    });

    lineSeries.setData(lineData as { time: any; value: number }[]);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [timeframe, lineData]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-end gap-2 mb-4">
        {(['1H', '24H', '1W'] as const).map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              timeframe === tf
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
      {loading && (
        <p className="text-sm text-gray-500 mb-2">Loading pool price history…</p>
      )}
      {error && (
        <p className="text-sm text-amber-700 mb-2">{error}</p>
      )}
      {!loading && !error && lineData.length === 0 && (
        <p className="text-sm text-gray-500 mb-2">
          No price data in this range. Data is loaded via <code className="text-xs bg-gray-100 px-1 rounded">/api/fact/trade/poolPrice</code>{' '}
          (proxied to Fact Finance). Try another timeframe or set{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">VITE_POOL_PRICE_URL=/pool-price.json</code> and run{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">npm run fetch-pool-price</code>.
        </p>
      )}
      <div ref={chartContainerRef} className="flex-1 w-full min-h-[300px]" />
    </div>
  );
}
