/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TOKEN_FETH_ADDRESS: string;
  readonly VITE_TOKEN_FT564_ADDRESS: string;
  readonly VITE_PAIR_V2_ADDRESS: string;
  /** Uniswap V2 Router02 (approve this spender; swap uses one tx). */
  readonly VITE_UNISWAP_V2_ROUTER_ADDRESS: string;
  /** Used by Node scripts (e.g. fetch-holder-balances); not required for the Vite client build. */
  readonly VITE_ETHERSCAN_API_KEY?: string;
  /** Override Fact Finance proxy base (default `/api/fact` → Vite/Vercel proxy). */
  readonly VITE_FACT_TRADE_API_BASE?: string;
  /** Override pool price fetch URL (default `${VITE_FACT_TRADE_API_BASE or /api/fact}/trade/poolPrice`). */
  readonly VITE_POOL_PRICE_URL?: string;
  /** Override leaderboard standings JSON URL. */
  readonly VITE_LEADERBOARD_STANDINGS_URL?: string;
  /** Override rank evolution JSON URL. */
  readonly VITE_LEADERBOARD_RANK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
