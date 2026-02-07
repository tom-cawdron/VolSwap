/**
 * Contract ABIs and addresses for Finance Multiverse.
 *
 * Replace the placeholder addresses with actual deployed addresses
 * after deploying to testnet (Base Sepolia / Arbitrum Sepolia).
 *
 * Each supported asset (ETH, BTC, SOL) has its own oracle, market, and
 * vault contract instance.
 */

import type { AssetKey } from "./types";

const ZERO: `0x${string}` = "0x0000000000000000000000000000000000000000";

// ─── Per-asset addresses (update after deployment) ───────────────────

function envAddr(key: string): `0x${string}` {
  return (process.env[key] as `0x${string}` | undefined) ?? ZERO;
}

/** Oracle contract address per asset */
export const REGIME_ORACLE_ADDRESSES: Record<AssetKey, `0x${string}`> = {
  eth: envAddr("NEXT_PUBLIC_REGIME_ORACLE_ADDRESS_ETH"),
  btc: envAddr("NEXT_PUBLIC_REGIME_ORACLE_ADDRESS_BTC"),
  sol: envAddr("NEXT_PUBLIC_REGIME_ORACLE_ADDRESS_SOL"),
};

/** Market contract address per asset */
export const MULTIVERSE_MARKET_ADDRESSES: Record<AssetKey, `0x${string}`> = {
  eth: envAddr("NEXT_PUBLIC_MULTIVERSE_MARKET_ADDRESS_ETH"),
  btc: envAddr("NEXT_PUBLIC_MULTIVERSE_MARKET_ADDRESS_BTC"),
  sol: envAddr("NEXT_PUBLIC_MULTIVERSE_MARKET_ADDRESS_SOL"),
};

/** Vault contract address per asset */
export const HEDGE_VAULT_ADDRESSES: Record<AssetKey, `0x${string}`> = {
  eth: envAddr("NEXT_PUBLIC_HEDGE_VAULT_ADDRESS_ETH"),
  btc: envAddr("NEXT_PUBLIC_HEDGE_VAULT_ADDRESS_BTC"),
  sol: envAddr("NEXT_PUBLIC_HEDGE_VAULT_ADDRESS_SOL"),
};

// ─── Backward-compatible single-address exports ──────────────────────

export const REGIME_ORACLE_ADDRESS = REGIME_ORACLE_ADDRESSES.eth;
export const MULTIVERSE_MARKET_ADDRESS = MULTIVERSE_MARKET_ADDRESSES.eth;
export const HEDGE_VAULT_ADDRESS = HEDGE_VAULT_ADDRESSES.eth;

// ─── RegimeOracle ABI ────────────────────────────────────────────────

export const REGIME_ORACLE_ABI = [
  {
    inputs: [{ name: "_modelHash", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "latestUpdate",
    outputs: [
      { name: "pHighVol", type: "uint256" },
      { name: "pLowVol", type: "uint256" },
      { name: "entropy", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "modelHash", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRegimeProbs",
    outputs: [
      { name: "pHigh", type: "uint256" },
      { name: "pLow", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getEntropy",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "maxAge", type: "uint256" }],
    name: "isStale",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "updateCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "updateId", type: "uint256" },
      { indexed: false, name: "pHighVol", type: "uint256" },
      { indexed: false, name: "pLowVol", type: "uint256" },
      { indexed: false, name: "entropy", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
    name: "RegimeUpdated",
    type: "event",
  },
] as const;

// ─── MultiverseMarket ABI ────────────────────────────────────────────

export const MULTIVERSE_MARKET_ABI = [
  {
    inputs: [
      { name: "_oracle", type: "address" },
      { name: "_b", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "priceHighVol",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "priceLowVol",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "dynamicFee",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "isHighVol", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    name: "buyOutcome",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "resolveMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "claimPayout",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "highVolBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "lowVolBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "resolved",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalCollateral",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "buyer", type: "address" },
      { indexed: false, name: "isHighVol", type: "bool" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "cost", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "OutcomeBought",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: "highVolWon", type: "bool" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
    name: "MarketResolved",
    type: "event",
  },
] as const;

// ─── HedgeVault ABI ──────────────────────────────────────────────────

export const HEDGE_VAULT_ABI = [
  {
    inputs: [{ name: "_market", type: "address" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [{ name: "hedgeRatio", type: "uint256" }],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawBase",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "claimHedge",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getPosition",
    outputs: [
      { name: "ethDeposited", type: "uint256" },
      { name: "highVolTokens", type: "uint256" },
      { name: "hedgeRatio", type: "uint256" },
      { name: "depositTimestamp", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalDeposits",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "depositorCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "totalAmount", type: "uint256" },
      { indexed: false, name: "hedgeAmount", type: "uint256" },
      { indexed: false, name: "highVolTokens", type: "uint256" },
      { indexed: false, name: "hedgeRatio", type: "uint256" },
    ],
    name: "Deposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "ethAmount", type: "uint256" },
      { indexed: false, name: "hedgeTokens", type: "uint256" },
    ],
    name: "Withdrawn",
    type: "event",
  },
] as const;
