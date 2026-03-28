/** One pool price snapshot (Fact Finance API or `public/pool-price.json` from `npm run fetch-pool-price`). */
export type PoolPriceSnapshot = {
  timestamp: string;
  /** fETH per 1 FT564 (fs564) */
  price: number;
  pair: `0x${string}`;
};

export function isPoolPriceSnapshot(x: unknown): x is PoolPriceSnapshot {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.timestamp === 'string' &&
    typeof o.price === 'number' &&
    Number.isFinite(o.price) &&
    typeof o.pair === 'string' &&
    /^0x[a-fA-F0-9]{40}$/.test(o.pair)
  );
}
