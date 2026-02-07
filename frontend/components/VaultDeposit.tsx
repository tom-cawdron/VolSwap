"use client";

import React, { useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { parseEther, formatEther } from "viem";
import { HEDGE_VAULT_ABI, HEDGE_VAULT_ADDRESSES } from "../lib/contracts";
import type { AssetKey } from "../lib/types";
import { ASSETS } from "../lib/types";

/**
 * VaultDeposit — Deposit ETH into the HedgeVault with a configurable hedge ratio.
 * Hedge buys HIGH_VOL tokens in the current market round automatically.
 */

interface VaultDepositProps {
  asset: AssetKey;
}

export default function VaultDeposit({ asset }: VaultDepositProps) {
  const meta = ASSETS[asset];
  const vaultAddress = HEDGE_VAULT_ADDRESSES[asset];

  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [depositAmount, setDepositAmount] = useState("");
  const [hedgeRatio, setHedgeRatio] = useState(10);

  const { data: position } = useReadContract({
    address: vaultAddress,
    abi: HEDGE_VAULT_ABI,
    functionName: "getPosition",
    args: address ? [address] : undefined,
  });

  const { data: hedgeCount } = useReadContract({
    address: vaultAddress,
    abi: HEDGE_VAULT_ABI,
    functionName: "getUserHedgeCount",
    args: address ? [address] : undefined,
  });

  const { writeContract, isPending } = useWriteContract();

  const hedgeAmountEth = depositAmount
    ? (parseFloat(depositAmount) * hedgeRatio) / 100
    : 0;
  const baseAmountEth = depositAmount
    ? parseFloat(depositAmount) - hedgeAmountEth
    : 0;

  const handleDeposit = () => {
    if (!depositAmount || !isConnected) return;
    writeContract({
      address: vaultAddress,
      abi: HEDGE_VAULT_ABI,
      functionName: "deposit",
      args: [BigInt(hedgeRatio * 100)],
      value: parseEther(depositAmount),
    });
  };

  const handleWithdraw = () => {
    if (!isConnected) return;
    writeContract({
      address: vaultAddress,
      abi: HEDGE_VAULT_ABI,
      functionName: "withdrawBase",
    });
  };

  const handleClaimHedge = (index: number) => {
    if (!isConnected) return;
    writeContract({
      address: vaultAddress,
      abi: HEDGE_VAULT_ABI,
      functionName: "claimHedge",
      args: [BigInt(index)],
    });
  };

  // Position now returns (ethDeposited, hedgeRatio, depositTimestamp)
  const existingEth = position ? formatEther((position as [bigint, bigint, bigint])[0]) : "0";
  const existingRatio = position ? Number((position as [bigint, bigint, bigint])[1]) / 100 : 0;
  const numHedges = hedgeCount ? Number(hedgeCount) : 0;

  return (
    <div className="glass-card rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-3 h-3 rounded-full ${meta.color.replace("text-", "bg-")}`} />
        <span className={`text-lg font-bold ${meta.color}`}>{meta.shortLabel}</span>
        <h2 className="text-lg font-semibold text-white">Hedge Vault</h2>
      </div>
      <p className="text-xs text-gray-400 mb-4 leading-relaxed">
        Deposit ETH and automatically protect yourself against volatility spikes on {meta.label}.
        A portion of your deposit buys HIGHER tokens each round — if vol rises, your hedge pays out.
      </p>
      <div className="rounded-lg bg-indigo-500/5 border border-indigo-500/10 px-3 py-2 mb-6">
        <p className="text-[10px] text-indigo-300">
          💡 <span className="font-medium">Hedge Ratio</span> = the % of your deposit that buys vol protection each round. 10% is a good starting point.
        </p>
      </div>

      {/* Existing position */}
      {position && ((position as [bigint, bigint, bigint])[0]) > BigInt(0) && (
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 mb-6">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">Your Position</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500">Base ETH</p>
              <p className="text-lg font-mono font-semibold text-white">{existingEth}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Hedge Ratio</p>
              <p className="text-lg font-mono font-semibold text-indigo-400">{existingRatio}%</p>
            </div>
          </div>
          {numHedges > 0 && (
            <p className="text-[10px] text-gray-500 mt-2">
              {numHedges} active hedge position{numHedges > 1 ? "s" : ""} across rounds
            </p>
          )}
          <button
            onClick={handleWithdraw}
            className="mt-3 w-full rounded-lg py-2 text-sm border border-white/10
                       text-gray-400 hover:text-white hover:bg-white/5 transition-all"
          >
            Withdraw Base ETH
          </button>
        </div>
      )}

      {/* Deposit amount */}
      <div className="mb-4">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">
          Deposit Amount (ETH)
        </label>
        <input
          type="number"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          placeholder="0.0"
          min="0"
          step="0.01"
          className="w-full rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3
                     text-white font-mono text-lg placeholder-gray-700
                     focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all"
        />
      </div>

      {/* Hedge ratio slider */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Hedge Ratio</label>
          <span className="text-sm font-mono font-semibold text-indigo-400">{hedgeRatio}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="30"
          step="1"
          value={hedgeRatio}
          onChange={(e) => setHedgeRatio(parseInt(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>0% (no hedge)</span>
          <span>30% (max)</span>
        </div>
      </div>

      {/* Allocation breakdown */}
      {depositAmount && parseFloat(depositAmount) > 0 && (
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 mb-5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">Allocation</p>
          <div className="space-y-2.5">
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Kept as ETH (safe portion)</span>
              <span className="text-sm font-mono text-white">{baseAmountEth.toFixed(4)} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">→ Vol protection (buys HIGHER)</span>
              <span className="text-sm font-mono text-red-400">{hedgeAmountEth.toFixed(4)} ETH</span>
            </div>
            {/* Visual bar */}
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-red-500 transition-all"
                style={{ width: `${Math.max(hedgeRatio * (100 / 30), 2)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Projected payoffs */}
      {depositAmount && parseFloat(depositAmount) > 0 && (
        <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 mb-5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">Projected Payoffs</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-[10px] text-blue-400 font-medium mb-1">If Vol Drops</p>
              <p className="text-sm font-mono font-semibold text-white">
                {baseAmountEth.toFixed(4)} ETH
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">hedge expires worthless</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-red-400 font-medium mb-1">If Vol Rises</p>
              <p className="text-sm font-mono font-semibold text-green-400">
                {(baseAmountEth + hedgeAmountEth * 2).toFixed(4)} ETH
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">hedge wins ~2×</p>
            </div>
          </div>
        </div>
      )}

      {/* Deposit button */}
      <button
        onClick={isConnected ? handleDeposit : openConnectModal}
        disabled={isConnected && (!depositAmount || isPending)}
        className="w-full rounded-xl py-3.5 font-semibold bg-indigo-600 hover:bg-indigo-500
                   text-white transition-all shadow-lg shadow-indigo-600/20
                   disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {isPending
          ? "Confirming …"
          : isConnected
          ? "Deposit & Hedge"
          : "Connect Wallet"}
      </button>
    </div>
  );
}
