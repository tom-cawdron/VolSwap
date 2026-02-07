/**
 * Shared types for VolSwap frontend.
 */

// ─── Asset identifiers ──────────────────────────────────────────────

export type AssetKey = "eth" | "btc" | "sol";

export interface AssetMeta {
  key: AssetKey;
  symbol: string;    // "ETH/USDT"
  label: string;     // "Ethereum"
  shortLabel: string; // "ETH"
  color: string;     // Tailwind text-color class
  bgColor: string;   // Tailwind bg-color class for subtle backgrounds
  borderColor: string;
}

export const ASSETS: Record<AssetKey, AssetMeta> = {
  eth: {
    key: "eth",
    symbol: "ETH/USDT",
    label: "Ethereum",
    shortLabel: "ETH",
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500",
  },
  btc: {
    key: "btc",
    symbol: "BTC/USDT",
    label: "Bitcoin",
    shortLabel: "BTC",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500",
  },
  sol: {
    key: "sol",
    symbol: "SOL/USDT",
    label: "Solana",
    shortLabel: "SOL",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500",
  },
};

export const ASSET_KEYS: AssetKey[] = ["eth", "btc", "sol"];

// ─── Regime prediction (matches inference API response) ──────────────

export interface RegimePrediction {
  asset: string;
  p_high_vol: number;
  p_low_vol: number;
  entropy: number;
  regime: "HIGH_VOL" | "LOW_VOL";
  confidence: number;
  realised_vol_24h: number;
  timestamp: number;
  model_hash: string;
}

export interface AllPredictionsResponse {
  predictions: RegimePrediction[];
  timestamp: number;
}

// ─── Market round (matches MultiverseMarket.Round struct) ────────────

export interface MarketRound {
  roundId: number;
  snapshotVol: bigint;
  tradingEnd: bigint;
  resolutionTime: bigint;
  totalCollateral: bigint;
  totalHighTokens: bigint;
  totalLowTokens: bigint;
  resolved: boolean;
  highVolWon: boolean;
}
