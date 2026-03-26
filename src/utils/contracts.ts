import { parseAbi } from 'viem';
import { isAddress } from 'viem';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function envAddress(value: string | undefined, name: string): `0x${string}` {
  if (!value || !ADDR_RE.test(value) || !isAddress(value)) {
    throw new Error(
      `${name} is missing or not a valid address. Set it in .env, .env.local, or your host (e.g. Vercel) — see .env.example.`,
    );
  }
  return value as `0x${string}`;
}

export const TOKENS = {
  fETH: {
    address: envAddress(import.meta.env.VITE_TOKEN_FETH_ADDRESS, 'VITE_TOKEN_FETH_ADDRESS'),
    symbol: 'fETH',
    decimals: 18,
  },
  FT564: {
    address: envAddress(import.meta.env.VITE_TOKEN_FT564_ADDRESS, 'VITE_TOKEN_FT564_ADDRESS'),
    symbol: 'fs564',
    decimals: 18,
  },
};

export const CONTRACTS = {
  /** Uniswap V2 pair for fETH / FT564 */
  PAIR_V2: envAddress(import.meta.env.VITE_PAIR_V2_ADDRESS, 'VITE_PAIR_V2_ADDRESS'),
};

export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

/** Minimal Uniswap V2 pair ABI for quoting + swaps. */
export const PAIR_V2_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function swap(uint amount0Out, uint amount1Out, address to, bytes data)',
]);
