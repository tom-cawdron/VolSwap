"use client";

import React, { useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseEther, formatEther } from "viem";
import { MULTIVERSE_MARKET_ABI, MULTIVERSE_MARKET_ADDRESSES } from "../lib/contracts";
import type { AssetKey } from "../lib/types";
import { ASSETS } from "../lib/types";

/**
 * TradePanel — Buy HIGH_VOL or LOW_VOL regime tokens for a specific asset.
 *
 * Displays:
 *  - Asset badge
 *  - Current LMSR prices for each outcome
 *  - Dynamic fee (entropy-adaptive)
 *  - Amount input + cost estimate
 *  - Buy buttons
 */

type Outcome = "HIGH_VOL" | "LOW_VOL";

interface TradePanelProps {
  asset: AssetKey;
}

export default function TradePanel({ asset }: TradePanelProps) {
  const meta = ASSETS[asset];
  const marketAddress = MULTIVERSE_MARKET_ADDRESSES[asset];

  const { address, isConnected } = useAccount();
  const [outcome, setOutcome] = useState<Outcome>("HIGH_VOL");
  const [amount, setAmount] = useState("");

  // Read current prices from contract
  const { data: priceHigh } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "priceHighVol",
  });

  const { data: priceLow } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "priceLowVol",
  });

  const { data: fee } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "dynamicFee",
  });

  const { writeContract, isPending } = useWriteContract();

  const formattedPriceHigh = priceHigh
    ? (Number(priceHigh) / 1e18).toFixed(4)
    : "—";
  const formattedPriceLow = priceLow
    ? (Number(priceLow) / 1e18).toFixed(4)
    : "—";
  const formattedFee = fee
    ? (Number(fee) / 1e16).toFixed(2) + "%"
    : "—";

  // Estimated cost (simplified: price × amount × (1 + fee))
  const estimatedCost =
    amount && fee
      ? (
          parseFloat(amount) *
          (outcome === "HIGH_VOL"
            ? Number(priceHigh ?? 0) / 1e18
            : Number(priceLow ?? 0) / 1e18) *
          (1 + Number(fee) / 1e18)
        ).toFixed(6)
      : "0";

  const handleBuy = () => {
    if (!amount || !isConnected) return;

    writeContract({
      address: marketAddress,
      abi: MULTIVERSE_MARKET_ABI,
      functionName: "buyOutcome",
      args: [outcome === "HIGH_VOL", parseEther(amount)],
      value: parseEther(estimatedCost),
    });
  };

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6">
      <div className="flex items-center gap-3 mb-6">
        <span className={`text-lg font-bold ${meta.color}`}>{meta.shortLabel}</span>
        <h2 className="text-xl font-semibold text-white">Trade Regime Tokens</h2>
      </div>

      {/* Price cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setOutcome("HIGH_VOL")}
          className={`rounded-xl p-4 border transition-colors ${
            outcome === "HIGH_VOL"
              ? "border-red-500 bg-red-500/10"
              : "border-gray-700 bg-gray-800 hover:border-gray-600"
          }`}
        >
          <p className="text-xs text-gray-400 mb-1">HIGH_VOL</p>
          <p className="text-xl font-mono text-red-400">{formattedPriceHigh}</p>
          <p className="text-xs text-gray-500 mt-1">LMSR Price</p>
        </button>

        <button
          onClick={() => setOutcome("LOW_VOL")}
          className={`rounded-xl p-4 border transition-colors ${
            outcome === "LOW_VOL"
              ? "border-blue-500 bg-blue-500/10"
              : "border-gray-700 bg-gray-800 hover:border-gray-600"
          }`}
        >
          <p className="text-xs text-gray-400 mb-1">LOW_VOL</p>
          <p className="text-xl font-mono text-blue-400">{formattedPriceLow}</p>
          <p className="text-xs text-gray-500 mt-1">LMSR Price</p>
        </button>
      </div>

      {/* Dynamic fee display */}
      <div className="flex items-center justify-between text-sm mb-4 px-1">
        <span className="text-gray-400">Dynamic Fee (entropy-adaptive)</span>
        <span className="text-yellow-400 font-mono">{formattedFee}</span>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">Amount (tokens)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          min="0"
          step="0.01"
          className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3
                     text-white font-mono text-lg placeholder-gray-600
                     focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>

      {/* Cost estimate */}
      <div className="flex items-center justify-between text-sm mb-6 px-1">
        <span className="text-gray-400">Estimated Cost</span>
        <span className="text-white font-mono">{estimatedCost} ETH</span>
      </div>

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={!isConnected || !amount || isPending}
        className={`w-full rounded-xl py-3 font-semibold transition-colors ${
          outcome === "HIGH_VOL"
            ? "bg-red-600 hover:bg-red-500 text-white"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isPending
          ? "Confirming …"
          : isConnected
          ? `Buy ${outcome.replace("_", " ")}`
          : "Connect Wallet"}
      </button>
    </div>
  );
}
