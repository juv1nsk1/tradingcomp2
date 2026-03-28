## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. **Token & pair addresses** — the app reads `VITE_TOKEN_FETH_ADDRESS`, `VITE_TOKEN_FT564_ADDRESS`, and `VITE_PAIR_V2_ADDRESS` (see [`.env.example`](.env.example)). **Defaults are in the committed [`.env`](.env)** so `npm run dev` and `npm run build` work without extra setup. To override locally, use **`.env.local`** (gitignored) or edit `.env` if you’re not worried about committing changes.
3. Run the app: `npm run dev`

### Log pool price to CSV

`npm run fetch-pool-price` reads the **Uniswap V2 pair** reserves (`getReserves`) and **appends** to **`public/pool-price.json`**: `{ "timestamp", "price", "pair" }`. **Price** = **fETH per 1 FT564** (spot mid-price from reserves). The helper **`appendPoolPriceJson`** is exported from `scripts/fetch-pool-price.ts` for reuse.

**Market Context** and **Leaderboard** load from the Fact Finance trade API via same-origin **`/api/fact/trade/*`**:

- [`/trade/poolPrice`](https://api.fact.finance/trade/poolPrice) — price history array  
- [`/trade/standings`](https://api.fact.finance/trade/standings) — competition standings  
- [`/trade/rank`](https://api.fact.finance/trade/rank) — rank evolution array  

**Local dev:** [Vite `server.proxy`](vite.config.ts) forwards `/api/fact` → `https://api.fact.finance` (avoids CORS). **Vercel:** [`vercel.json`](vercel.json) rewrites the same path. **`vite preview`** does not run that proxy — use **`npm run dev`** to hit the live API locally, or deploy to Vercel. Override the base with **`VITE_FACT_TRADE_API_BASE`**, or individual URLs with **`VITE_POOL_PRICE_URL`**, **`VITE_LEADERBOARD_STANDINGS_URL`**, **`VITE_LEADERBOARD_RANK_URL`** (e.g. static files under `/public`).

Optional env for the script: `SEPOLIA_RPC_URL` (or `VITE_SEPOLIA_RPC_URL`), `POOL_PRICE_JSON` (custom output path). See [`.env.example`](.env.example).

### Holder balances (Etherscan)

`npm run fetch-holder-balances` reads **`data/holders.csv`** (one wallet address per line), queries **Sepolia Etherscan** for each wallet’s **FT564** (`VITE_TOKEN_FT564_ADDRESS`) balance, and writes **`data/holder-balances.csv`** with header **`position, previous position, wallet, balance`**. **Previous position** is that wallet’s **`position` from the last run** (same output file, read before overwrite); empty if the wallet is new or there was no prior file.

Requires **`VITE_ETHERSCAN_API_KEY`** in `.env` or `.env.local` (same key works with [Etherscan API v2](https://docs.etherscan.io/) and `chainid=11155111`). The script waits **~450ms** between calls (plus a short post-call pause) to stay under Etherscan’s **3 calls/sec** limit; override with **`HOLDERS_ETHERSCAN_DELAY_MS`** if needed. After each run it also writes:

- **`public/leaderboard-standings.json`** — `{ updatedAt, rows[] }` for **Competition Standings** (`rank`, `wallet`, `portfolioValue` FT564, `change24h` vs last run).
- **`public/rank-evolution.json`** — append-only array of `{ timestamp, top: [{ rank, wallet, balance }] }` (top **5**) for the **Rank Evolution** chart.

It still updates **`data/holder-balances.csv`** and **`data/rank-evolution.csv`** as before. Optional env: `HOLDERS_CSV`, `HOLDERS_BALANCE_CSV`, `HOLDERS_EVOLUTION_CSV`, `HOLDERS_PUBLIC_STANDINGS_JSON`, `HOLDERS_PUBLIC_EVOLUTION_JSON`. See [`.env.example`](.env.example).

### Deploy on Vercel

- The repo **`.env`** is included in the build, so production builds get the same Sepolia defaults as local.
- To use **different addresses** per environment, set `VITE_TOKEN_FETH_ADDRESS`, `VITE_TOKEN_FT564_ADDRESS`, and `VITE_PAIR_V2_ADDRESS` in **Vercel → Project → Settings → Environment Variables** for Production (and Preview if needed). **Vercel’s variables override** values from `.env` during `vite build`.
- After changing env vars on Vercel, **redeploy** so the client bundle picks them up.

