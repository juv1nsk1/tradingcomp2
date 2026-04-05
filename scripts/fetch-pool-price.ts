/**
 * Reads Uniswap V2 pair reserves and appends a spot price snapshot to a JSON file.
 *
 * Price = fETH per 1 FT564 (fs564) — mid price from reserves, no fee adjustment.
 * (Reciprocal of “fs564 per 1 fETH”; e.g. if 1 fETH buys ~48.44 fs564, price ≈ 1/48.44 ≈ 0.0206.)
 *
 * Output: JSON array of `{ timestamp, price, pair }` (appended each run).
 *
 * Usage: npm run fetch-pool-price
 *
 * Env (from .env / .env.local):
 *   VITE_TOKEN_FETH_ADDRESS, VITE_TOKEN_FT564_ADDRESS, VITE_PAIR_V2_ADDRESS (required)
 *   SEPOLIA_RPC_URL — optional, default public Sepolia RPC
 *   POOL_PRICE_JSON — optional output path, default public/pool-price.json (served by Vite at /pool-price.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createPublicClient, formatUnits, http, isAddress, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import type { PoolPriceSnapshot } from '../src/types/poolPrice';

export type { PoolPriceSnapshot };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, '.env.local') });

const PAIR_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]);

const ERC20_DECIMALS_ABI = parseAbi(['function decimals() view returns (uint8)']);

function requireAddr(value: string | undefined, name: string): `0x${string}` {
  if (!value || !isAddress(value)) {
    throw new Error(`Missing or invalid ${name}. Set it in .env (see .env.example).`);
  }
  return value as `0x${string}`;
}

/** fETH human units per 1 FT564 (spot from reserves). */
function fethPerFt564(
  feth: `0x${string}`,
  reserve0: bigint,
  reserve1: bigint,
  token0: `0x${string}`,
  token1: `0x${string}`,
  dec0: number,
  dec1: number,
): number {
  const f = feth.toLowerCase();
  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  const r0 = Number(formatUnits(reserve0, dec0));
  const r1 = Number(formatUnits(reserve1, dec1));
  if (r0 <= 0 || r1 <= 0) throw new Error('Pool reserves are zero or invalid.');

  if (f === t0) {
    return r0 / r1;
  }
  if (f === t1) {
    return r1 / r0;
  }
  throw new Error('fETH address does not match pair token0/token1.');
}

function isPoolPriceSnapshotRow(x: unknown): x is PoolPriceSnapshot {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.timestamp === 'string' &&
    typeof o.price === 'number' &&
    Number.isFinite(o.price) &&
    typeof o.pair === 'string' &&
    isAddress(o.pair)
  );
}

/**
 * Read existing JSON array from disk, append one snapshot, write back.
 * Exported for reuse (e.g. tests or other scripts).
 */
export function appendPoolPriceJson(outPath: string, entry: PoolPriceSnapshot): PoolPriceSnapshot[] {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });

  let list: PoolPriceSnapshot[] = [];
  if (fs.existsSync(outPath)) {
    const raw = fs.readFileSync(outPath, 'utf8').trim();
    if (raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`Invalid JSON in ${outPath}`);
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`${outPath} must contain a JSON array of snapshots`);
      }
      for (const item of parsed) {
        if (!isPoolPriceSnapshotRow(item)) {
          throw new Error(`${outPath} contains an invalid snapshot object`);
        }
        list.push(item);
      }
    }
  }

  list.push(entry);
  fs.writeFileSync(outPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  return list;
}

async function main() {
  const feth = requireAddr(process.env.VITE_TOKEN_FETH_ADDRESS, 'VITE_TOKEN_FETH_ADDRESS');
  const ft564 = requireAddr(process.env.VITE_TOKEN_FT564_ADDRESS, 'VITE_TOKEN_FT564_ADDRESS');
  const pair = requireAddr(process.env.VITE_PAIR_V2_ADDRESS, 'VITE_PAIR_V2_ADDRESS');

  const rpcUrl =
    process.env.SEPOLIA_RPC_URL?.trim() ||
    process.env.VITE_SEPOLIA_RPC_URL?.trim() ||
    'https://ethereum-sepolia-rpc.publicnode.com';

  const outPath =
    process.env.POOL_PRICE_JSON?.trim() || path.join( '/srv/fact/site/data/trade', 'pool-price.json');

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const [token0, token1, reserves] = (await Promise.all([
    publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' } as never),
    publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token1' } as never),
    publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' } as never),
  ])) as [`0x${string}`, `0x${string}`, readonly [bigint, bigint, number]];

  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  const f = feth.toLowerCase();
  const t = ft564.toLowerCase();
  if (!(t0 === f || t1 === f) || !(t0 === t || t1 === t)) {
    throw new Error('VITE_PAIR_V2_ADDRESS is not the fETH/FT564 pair for the configured token addresses.');
  }

  const dec0 = Number(
    await publicClient.readContract({
      address: token0,
      abi: ERC20_DECIMALS_ABI,
      functionName: 'decimals',
    } as never),
  );
  const dec1 = Number(
    await publicClient.readContract({
      address: token1,
      abi: ERC20_DECIMALS_ABI,
      functionName: 'decimals',
    } as never),
  );

  const [reserve0, reserve1] = reserves;
  const price = fethPerFt564(feth, reserve0, reserve1, token0, token1, dec0, dec1);

  const entry: PoolPriceSnapshot = {
    timestamp: new Date().toISOString(),
    price,
    pair,
  };

  const list = appendPoolPriceJson(outPath, entry);

  console.log(`Appended snapshot: ${JSON.stringify(entry)}`);
  console.log(`File: ${outPath} (${list.length} total snapshot(s))`);
  console.log(`(fETH per 1 FT564; pair ${pair})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
