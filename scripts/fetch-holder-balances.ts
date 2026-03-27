/**
 * Reads wallet addresses from data/holders.csv and fetches each wallet's FT564 balance
 * via the Etherscan API (Sepolia).
 *
 * Output CSV: position, previous position, wallet, balance (balance in FT564 human units, 18 decimals).
 * "Previous position" comes from the last run’s holder-balances.csv for the same wallet (empty if new).
 *
 * Usage: npm run fetch-holder-balances
 *
 * Env (from .env / .env.local):
 *   VITE_ETHERSCAN_API_KEY — required
 *   VITE_TOKEN_FT564_ADDRESS — required (ERC-20 contract)
 *   HOLDERS_CSV — optional input path, default data/holders.csv
 *   HOLDERS_BALANCE_CSV — optional output path, default data/holder-balances.csv
 *   HOLDERS_EVOLUTION_CSV — optional append-only CSV (data/) for chart: timestamp, wallet, balance (top 5)
 *   HOLDERS_PUBLIC_STANDINGS_JSON — optional, default public/leaderboard-standings.json (Competition Standings)
 *   HOLDERS_PUBLIC_EVOLUTION_JSON — optional, default public/rank-evolution.json (append snapshots for chart)
 *   HOLDERS_ENS_CSV — optional, default data/holder-ens.csv (address, ens); merged into standings & rank-evolution JSON
 *   HOLDERS_ETHERSCAN_DELAY_MS — optional ms to wait between API calls (default 450; Etherscan free tier ≈ 3/sec)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { formatUnits, isAddress } from 'viem';
import type {
  LeaderboardStandingsFile,
  LeaderboardStandingsRow,
  RankEvolutionSnapshot,
} from '../src/types/leaderboard';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, '.env.local') });

/** Sepolia — Etherscan API v2 (chainid) */
const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';
const SEPOLIA_CHAIN_ID = 11155111;
const FT564_DECIMALS = 18;
/** Etherscan free tier: Max 3 calls/sec → need >333ms between request *starts*; 450ms + prior request RTT stays under limit */
const DEFAULT_REQUEST_DELAY_MS = 450;
/** Lines appended per run to evolution CSV (by FT564 balance, descending) */
const EVOLUTION_TOP_N = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(value: string | undefined, name: string): string {
  const v = value?.trim();
  if (!v) throw new Error(`Missing ${name}. Set it in .env (see .env.example).`);
  return v;
}

function requireAddr(value: string | undefined, name: string): `0x${string}` {
  const v = value?.trim();
  if (!v || !isAddress(v)) {
    throw new Error(`Missing or invalid ${name}. Set it in .env (see .env.example).`);
  }
  return v as `0x${string}`;
}

type EtherscanTokenBalanceResponse = {
  status: string;
  message: string;
  result: string;
};

async function fetchTokenBalance(
  apiKey: string,
  contractAddress: `0x${string}`,
  walletAddress: `0x${string}`,
): Promise<bigint> {
  const params = new URLSearchParams({
    chainid: String(SEPOLIA_CHAIN_ID),
    module: 'account',
    action: 'tokenbalance',
    contractaddress: contractAddress,
    address: walletAddress,
    tag: 'latest',
    apikey: apiKey,
  });

  const url = `${ETHERSCAN_V2}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Etherscan HTTP ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as EtherscanTokenBalanceResponse;
  if (data.status !== '1') {
    throw new Error(`Etherscan error: ${data.message} — ${data.result}`);
  }

  try {
    return BigInt(data.result);
  } catch {
    throw new Error(`Etherscan returned non-numeric balance: ${data.result}`);
  }
}

function parseHoldersFile(content: string): `0x${string}`[] {
  const lines = content.split(/\r?\n/);
  const wallets: `0x${string}`[] = [];
  for (const line of lines) {
    const w = line.trim();
    if (!w) continue;
    if (!isAddress(w)) {
      console.warn(`Skipping invalid address line: ${line.slice(0, 80)}`);
      continue;
    }
    wallets.push(w as `0x${string}`);
  }
  return wallets;
}

/**
 * Loads `data/holder-ens.csv` (from `npm run fetch-holder-ens`): address, ens.
 * Keys are lowercase hex addresses; values may be empty when no primary name.
 */
function loadHolderEnsMap(ensPath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(ensPath)) {
    console.warn(
      `ENS map not found (${ensPath}). Run \`npm run fetch-holder-ens\` first; JSON rows will have empty ens.`,
    );
    return map;
  }

  const lines = fs.readFileSync(ensPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const comma = trimmed.indexOf(',');
    if (comma === -1) continue;
    const addr = trimmed.slice(0, comma).trim();
    let ens = trimmed.slice(comma + 1).trim();
    if (addr.toLowerCase() === 'address') continue;
    if (ens.startsWith('"') && ens.endsWith('"')) {
      ens = ens.slice(1, -1).replace(/""/g, '"');
    }
    if (!isAddress(addr)) continue;
    map.set(addr.toLowerCase(), ens);
  }

  if (map.size > 0) {
    console.log(`Loaded ${map.size} ENS row(s) from ${ensPath}`);
  }
  return map;
}

function ensForWallet(ensByWallet: Map<string, string>, wallet: `0x${string}`): string {
  return ensByWallet.get(wallet.toLowerCase()) ?? '';
}

/**
 * Reads an existing holder-balances.csv and maps wallet (lowercase) → position from that file.
 * Supports both `position, wallet, balance` and `position, previous position, wallet, balance`.
 */
function loadPreviousPositionsFromOutput(csvPath: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!fs.existsSync(csvPath)) return map;

  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 3) continue;

    const first = parts[0].toLowerCase();
    if (first === 'position') continue;

    let positionStr: string;
    let walletStr: string;

    if (parts.length >= 4) {
      positionStr = parts[0];
      walletStr = parts[2];
    } else {
      positionStr = parts[0];
      walletStr = parts[1];
    }

    if (!/^\d+$/.test(positionStr)) continue;
    if (!isAddress(walletStr)) continue;

    const pos = Number.parseInt(positionStr, 10);
    if (!Number.isFinite(pos)) continue;
    map.set(walletStr.toLowerCase(), pos);
  }

  return map;
}

type HolderSnapshot = {
  wallet: `0x${string}`;
  balanceWei: bigint;
  balanceHuman: string;
};

/**
 * Appends one row per top holder: timestamp, wallet, balance (same timestamp for all rows in this snapshot).
 * Creates file with header if missing.
 */
function appendEvolutionTopCsv(
  evolutionPath: string,
  timestampIso: string,
  top: HolderSnapshot[],
): void {
  fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
  const header = 'timestamp, wallet, balance';
  const fileExists = fs.existsSync(evolutionPath);
  if (!fileExists) {
    fs.writeFileSync(evolutionPath, `${header}\n`, 'utf8');
  }
  const lines = top.map(
    (h) => `${timestampIso}, ${h.wallet}, ${h.balanceHuman}`,
  );
  fs.appendFileSync(evolutionPath, `${lines.join('\n')}\n`, 'utf8');
}

function loadPreviousPortfolioByWallet(standingsPath: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!fs.existsSync(standingsPath)) return map;
  try {
    const raw = fs.readFileSync(standingsPath, 'utf8').trim();
    if (!raw) return map;
    const j = JSON.parse(raw) as { rows?: { wallet?: string; portfolioValue?: string }[] };
    if (!Array.isArray(j.rows)) return map;
    for (const r of j.rows) {
      if (r?.wallet && typeof r.portfolioValue === 'string') {
        const n = Number.parseFloat(r.portfolioValue);
        if (Number.isFinite(n)) map.set(r.wallet.toLowerCase(), n);
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

/** % change vs last standings snapshot (rounded integer); "0" if no baseline. */
function changeVsPrevious(prevBal: number | undefined, balanceHuman: string): string {
  const curr = Number.parseFloat(balanceHuman);
  if (!Number.isFinite(curr)) return '0';
  if (prevBal === undefined || !Number.isFinite(prevBal) || prevBal === 0) return '0';
  const pct = ((curr - prevBal) / prevBal) * 100;
  if (!Number.isFinite(pct)) return '0';
  return String(Math.round(pct));
}

function loadRankEvolutionJson(evolutionJsonPath: string): RankEvolutionSnapshot[] {
  if (!fs.existsSync(evolutionJsonPath)) return [];
  const raw = fs.readFileSync(evolutionJsonPath, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: RankEvolutionSnapshot[] = [];
  for (const item of parsed) {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as RankEvolutionSnapshot).timestamp === 'string' &&
      Array.isArray((item as RankEvolutionSnapshot).top)
    ) {
      out.push(item as RankEvolutionSnapshot);
    }
  }
  return out;
}

function appendRankEvolutionJson(
  evolutionJsonPath: string,
  snapshot: RankEvolutionSnapshot,
): void {
  fs.mkdirSync(path.dirname(evolutionJsonPath), { recursive: true });
  const list = loadRankEvolutionJson(evolutionJsonPath);
  list.push(snapshot);
  fs.writeFileSync(evolutionJsonPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
}

function writeLeaderboardStandingsJson(
  standingsPath: string,
  payload: LeaderboardStandingsFile,
): void {
  fs.mkdirSync(path.dirname(standingsPath), { recursive: true });
  fs.writeFileSync(standingsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const apiKey = requireEnv(process.env.VITE_ETHERSCAN_API_KEY, 'VITE_ETHERSCAN_API_KEY');
  const token = requireAddr(process.env.VITE_TOKEN_FT564_ADDRESS, 'VITE_TOKEN_FT564_ADDRESS');

  const inPath =
    process.env.HOLDERS_CSV?.trim() || path.join(ROOT, 'data', 'holders.csv');
  const outPath =
    process.env.HOLDERS_BALANCE_CSV?.trim() || path.join(ROOT, 'data', 'holder-balances.csv');
  const evolutionPath =
    process.env.HOLDERS_EVOLUTION_CSV?.trim() || path.join(ROOT, 'data', 'rank-evolution.csv');
  const publicStandingsPath =
    process.env.HOLDERS_PUBLIC_STANDINGS_JSON?.trim() ||
    path.join('/srv/fact/site/data/trade', 'leaderboard-standings.json');
  const publicEvolutionPath =
    process.env.HOLDERS_PUBLIC_EVOLUTION_JSON?.trim() ||
    path.join('/srv/fact/site/data/trade', 'rank-evolution.json');
  const ensPath =
    process.env.HOLDERS_ENS_CSV?.trim() || path.join(ROOT, 'data', 'holder-ens.csv');

  if (!fs.existsSync(inPath)) {
    throw new Error(`Input file not found: ${inPath}`);
  }

  const raw = fs.readFileSync(inPath, 'utf8');
  const wallets = parseHoldersFile(raw);

  if (wallets.length === 0) {
    throw new Error(`No valid wallet addresses found in ${inPath}`);
  }

  const parsedDelay = Number.parseInt(process.env.HOLDERS_ETHERSCAN_DELAY_MS ?? '', 10);
  const delayMs = Number.isFinite(parsedDelay) && parsedDelay >= 0
    ? Math.max(350, parsedDelay)
    : DEFAULT_REQUEST_DELAY_MS;

  const previousByWallet = loadPreviousPositionsFromOutput(outPath);
  if (previousByWallet.size > 0) {
    console.log(`Loaded ${previousByWallet.size} prior position(s) from ${outPath}`);
  }

  const previousPortfolioByWallet = loadPreviousPortfolioByWallet(publicStandingsPath);
  const ensByWallet = loadHolderEnsMap(ensPath);

  const rows: string[] = ['position, previous position, wallet, balance'];
  const snapshots: HolderSnapshot[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const position = i + 1;
    const wallet = wallets[i];
    if (i > 0) await sleep(delayMs);

    const rawBalance = await fetchTokenBalance(apiKey, token, wallet);
    const balance = formatUnits(rawBalance, FT564_DECIMALS);
    snapshots.push({ wallet, balanceWei: rawBalance, balanceHuman: balance });
    const prev = previousByWallet.get(wallet.toLowerCase());
    const prevCol = prev !== undefined ? String(prev) : '';
    rows.push(`${position}, ${prevCol}, ${wallet}, ${balance}`);
    console.log(
      `#${position} (was: ${prevCol || '—'}) ${wallet} → ${balance} FT564`,
    );

    // Extra spacing so the next loop’s request doesn’t start too soon after a fast response
    await sleep(120);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rows.join('\n') + '\n', 'utf8');

  const sorted = [...snapshots].sort((a, b) =>
    a.balanceWei === b.balanceWei ? 0 : a.balanceWei < b.balanceWei ? 1 : -1,
  );
  const top = sorted.slice(0, Math.min(EVOLUTION_TOP_N, sorted.length));
  const timestampIso = new Date().toISOString();
  appendEvolutionTopCsv(evolutionPath, timestampIso, top);
  console.log(
    `\nAppended top ${top.length} balance row(s) for evolution chart → ${evolutionPath}`,
  );

  const standingsRows: LeaderboardStandingsRow[] = sorted.map((h, idx) => {
    const rank = idx + 1;
    const prevBal = previousPortfolioByWallet.get(h.wallet.toLowerCase());
    const ens = ensForWallet(ensByWallet, h.wallet);
    return {
      rank,
      wallet: h.wallet,
      portfolioValue: h.balanceHuman,
      change24h: changeVsPrevious(prevBal, h.balanceHuman),
      ens,
    };
  });

  const standingsPayload: LeaderboardStandingsFile = {
    updatedAt: timestampIso,
    rows: standingsRows,
  };
  writeLeaderboardStandingsJson(publicStandingsPath, standingsPayload);
  console.log(`Wrote Competition Standings JSON → ${publicStandingsPath} (${standingsRows.length} rows)`);

  const evolutionSnapshot: RankEvolutionSnapshot = {
    timestamp: timestampIso,
    top: top.map((h, i) => ({
      rank: i + 1,
      wallet: h.wallet,
      balance: h.balanceHuman,
      ens: ensForWallet(ensByWallet, h.wallet),
    })),
  };
  appendRankEvolutionJson(publicEvolutionPath, evolutionSnapshot);
  console.log(`Appended rank evolution snapshot → ${publicEvolutionPath}`);

  console.log(`\nWrote ${wallets.length} row(s) to ${outPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
