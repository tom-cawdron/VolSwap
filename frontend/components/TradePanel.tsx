"use client";

import React, { useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseEther, formatEther } from "viem";
import { MULTIVERSE_MARKET_ABI, MULTIVERSE_MARKET_ADDRESSES } from "../lib/contracts";
import type { AssetKey } from "../lib/types";
import { ASSETS } from "../lib/types";

/**
 * TradePanel — Buy HIGH_VOL or LOW_VOL regime tokens for a specific asset.
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
    <div className="glass-card rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-3 h-3 rounded-full ${meta.color.replace("text-", "bg-")}`} />
        <span className={`text-lg font-bold ${meta.color}`}>{meta.shortLabel}</span>
        <h2 className="text-lg font-semibold text-white">Trade Regime Tokens</h2>
      </div>

      {/* Price cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setOutcome("HIGH_VOL")}
          className={`rounded-xl p-4 border transition-all ${
            outcome === "HIGH_VOL"
              ? "border-red-500/50 bg-red-500/10 glow-red"
              : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
          }`}
        >
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">High Vol</p>
          <p className="text-xl font-mono font-semibold text-red-400">{formattedPriceHigh}</p>
          <p className="text-[10px] text-gray-600 mt-1">LMSR Price</p>
        </button>

        <button
          onClick={() => setOutcome("LOW_VOL")}
          className={`rounded-xl p-4 border transition-all ${
            outcome === "LOW_VOL"
              ? "border-blue-500/50 bg-blue-500/10 glow-indigo"
              : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
          }`}
        >
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Low Vol</p>
          <p className="text-xl font-mono font-semibold text-blue-400">{formattedPriceLow}</p>
          <p className="text-[10px] text-gray-600 mt-1">LMSR Price</p>
        </button>
      </div>

      {/* Dynamic fee */}
      <div className="flex items-center justify-between text-sm mb-4 px-1">
        <span className="text-gray-500 text-xs">Dynamic Fee (entropy-adaptive)</span>
        <span className="text-yellow-400 font-mono text-sm">{formattedFee}</span>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">
          Amount (tokens)
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          min="0"
          step="0.01"
          className="w-full rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3
                     text-white font-mono text-lg placeholder-gray-700
                     focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all"
        />
      </div>

      {/* Cost estimate */}
      <div className="flex items-center justify-between text-sm mb-6 px-1">
        <span className="text-gray-500 text-xs">Estimated Cost</span>
        <span className="text-white font-mono">{estimatedCost} ETH</span>
      </div>

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={!isConnected || !amount || isPending}
        className={`w-full rounded-xl py-3.5 font-semibold transition-all ${
          outcome === "HIGH_VOL"
            ? "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
            : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
        } disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none`}
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
