/**
 * Reads wallet addresses from data/holders.csv and resolves each address’s primary ENS name
 * on Sepolia via the Etherscan API v2 (`proxy` → `eth_call` to the ENS Universal Resolver).
 *
 * Output CSV columns: address, ens (empty if no primary name or on recoverable errors).
 *
 * Usage: npm run fetch-holder-ens
 *
 * Env (from .env / .env.local):
 *   VITE_ETHERSCAN_API_KEY — required
 *   HOLDERS_CSV — optional input path, default data/holders.csv
 *   HOLDERS_ENS_CSV — optional output path, default data/holder-ens.csv
 *   HOLDERS_ETHERSCAN_DELAY_MS — optional ms after each Etherscan eth_call (default 400; free tier ≈ 3/sec)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  createPublicClient,
  custom,
  type Client,
  type EIP1193RequestFn,
  type Transport,
} from 'viem';
import { sepolia } from 'viem/chains';
import { getEnsName } from 'viem/ens';
import { isAddress } from 'viem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, '.env.local') });

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';
const SEPOLIA_CHAIN_ID = 11155111;
/** Applied after every Etherscan `eth_call` (viem may issue several per ENS lookup). */
const DEFAULT_ETH_CALL_DELAY_MS = 400;
const MAX_ETH_CALL_RETRIES = 4;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(value: string | undefined, name: string): string {
  const v = value?.trim();
  if (!v) throw new Error(`Missing ${name}. Set it in .env (see .env.example).`);
  return v;
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

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function isValidEthCallResult(value: string): boolean {
  return /^0x([0-9a-fA-F]{2})*$/.test(value);
}

function createEtherscanSepoliaTransport(
  apiKey: string,
  ethCallDelayMs: number,
) {
  const request = (async ({ method, params }) => {
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_call') {
      const [tx, blockTag] = params as [{ to?: string; data?: string }, string];
      const searchBase: Record<string, string> = {
        chainid: String(SEPOLIA_CHAIN_ID),
        module: 'proxy',
        action: 'eth_call',
        to: tx.to!,
        data: tx.data!,
        tag:
          typeof blockTag === 'string' && blockTag.startsWith('0x')
            ? blockTag
            : 'latest',
        apikey: apiKey,
      };

      let attempt = 0;
      for (;;) {
        if (attempt > 0) {
          const backoff = Math.min(8000, 350 * 2 ** (attempt - 1));
          await sleep(backoff);
        }
        attempt++;

        const url = `${ETHERSCAN_V2}?${new URLSearchParams(searchBase).toString()}`;
        const res = await fetch(url);
        const json = (await res.json()) as {
          result?: string;
          error?: { message?: string };
          message?: string;
          status?: string;
        };

        if (!res.ok) {
          throw new Error(`Etherscan HTTP ${res.status} ${res.statusText}`);
        }
        if (json.error?.message) {
          throw new Error(`Etherscan: ${json.error.message}`);
        }
        const raw = json.result;
        if (typeof raw !== 'string') {
          throw new Error(
            `Etherscan: unexpected response ${JSON.stringify(json).slice(0, 200)}`,
          );
        }

        if (isValidEthCallResult(raw)) {
          if (ethCallDelayMs > 0) await sleep(ethCallDelayMs);
          return raw;
        }

        const msg = raw || json.message || 'unknown';
        const rateLimited =
          /rate limit|max rate|calls per sec|too many requests/i.test(msg);
        if (rateLimited && attempt < MAX_ETH_CALL_RETRIES) continue;
        throw new Error(
          rateLimited
            ? `Etherscan rate limit after ${MAX_ETH_CALL_RETRIES} retries: ${msg}`
            : `Etherscan: expected hex result, got: ${msg.slice(0, 120)}`,
        );
      }
    }
    throw new Error(`Unsupported RPC for Etherscan transport: ${method}`);
  }) as EIP1193RequestFn;

  return custom({ request });
}

async function main() {
  const apiKey = requireEnv(process.env.VITE_ETHERSCAN_API_KEY, 'VITE_ETHERSCAN_API_KEY');
  const inputPath = path.join(
    ROOT,
    process.env.HOLDERS_CSV?.trim() || 'data/holders.csv',
  );
  const outputPath = path.join(
    ROOT,
    process.env.HOLDERS_ENS_CSV?.trim() || 'data/holder-ens.csv',
  );
  const delayMs = Number(process.env.HOLDERS_ETHERSCAN_DELAY_MS?.trim() || '');
  const ethCallDelay =
    Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : DEFAULT_ETH_CALL_DELAY_MS;

  const raw = fs.readFileSync(inputPath, 'utf8');
  const addresses = parseHoldersFile(raw);
  if (addresses.length === 0) {
    console.warn(`No valid addresses in ${inputPath}`);
  }

  const transport = createEtherscanSepoliaTransport(apiKey, ethCallDelay);
  const client = createPublicClient({
    chain: sepolia,
    transport,
    batch: { multicall: false },
  }) as Client<Transport, typeof sepolia>;

  const rows: string[] = ['address,ens'];
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i]!;
    let ens = '';
    try {
      const name = await getEnsName(client, { address });
      ens = name ?? '';
    } catch (e) {
      console.warn(`${address}: ${e instanceof Error ? e.message : String(e)}`);
    }
    rows.push(`${address},${csvEscape(ens)}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rows.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${addresses.length} rows to ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
