"use client";

import React, { useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseEther, formatEther } from "viem";
import { HEDGE_VAULT_ABI, HEDGE_VAULT_ADDRESS } from "../lib/contracts";

/**
 * VaultDeposit — Deposit ETH into the HedgeVault with a configurable hedge ratio.
 *
 * Users choose what percentage of their deposit buys HIGH_VOL tokens
 * as regime insurance.  The slider ranges from 0% to 30%.
 */

export default function VaultDeposit() {
  const { address, isConnected } = useAccount();
  const [depositAmount, setDepositAmount] = useState("");
  const [hedgeRatio, setHedgeRatio] = useState(10); // percentage (0-30)

  // Read user's existing position
  const { data: position } = useReadContract({
    address: HEDGE_VAULT_ADDRESS,
    abi: HEDGE_VAULT_ABI,
    functionName: "getPosition",
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
      address: HEDGE_VAULT_ADDRESS,
      abi: HEDGE_VAULT_ABI,
      functionName: "deposit",
      args: [BigInt(hedgeRatio * 100)], // convert % to bps
      value: parseEther(depositAmount),
    });
  };

  const handleWithdraw = () => {
    if (!isConnected) return;

    writeContract({
      address: HEDGE_VAULT_ADDRESS,
      abi: HEDGE_VAULT_ABI,
      functionName: "withdrawBase",
    });
  };

  // Format existing position
  const existingEth = position ? formatEther(position[0] as bigint) : "0";
  const existingTokens = position ? formatEther(position[1] as bigint) : "0";

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6">
      <h2 className="text-xl font-semibold text-white mb-2">Hedge Vault</h2>
      <p className="text-sm text-gray-400 mb-6">
        Deposit ETH and hedge against high-volatility regimes automatically.
      </p>

      {/* Existing position */}
      {position && (position[0] as bigint) > BigInt(0) && (
        <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-4 mb-6">
          <p className="text-xs text-gray-500 mb-2">Your Position</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-400">Base ETH</p>
              <p className="text-lg font-mono text-white">{existingEth}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Hedge Tokens</p>
              <p className="text-lg font-mono text-red-400">{existingTokens}</p>
            </div>
          </div>
          <button
            onClick={handleWithdraw}
            className="mt-3 w-full rounded-lg py-2 text-sm border border-gray-600
                       text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Withdraw Base ETH
          </button>
        </div>
      )}

      {/* Deposit amount */}
      <div className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">Deposit Amount (ETH)</label>
        <input
          type="number"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          placeholder="0.0"
          min="0"
          step="0.01"
          className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3
                     text-white font-mono text-lg placeholder-gray-600
                     focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>

      {/* Hedge ratio slider */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-gray-400">Hedge Ratio</label>
          <span className="text-sm font-mono text-indigo-400">{hedgeRatio}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="30"
          step="1"
          value={hedgeRatio}
          onChange={(e) => setHedgeRatio(parseInt(e.target.value))}
          className="w-full accent-indigo-500"
        />
        <div className="flex justify-between text-xs text-gray-600 mt-1">
          <span>0% (no hedge)</span>
          <span>30% (max)</span>
        </div>
      </div>

      {/* Allocation breakdown */}
      {depositAmount && parseFloat(depositAmount) > 0 && (
        <div className="rounded-xl bg-gray-800/50 p-4 mb-6">
          <p className="text-xs text-gray-500 mb-3">Allocation Breakdown</p>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">Base ETH Position</span>
              <span className="text-sm font-mono text-white">
                {baseAmountEth.toFixed(4)} ETH
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-400">→ HIGH_VOL Hedge</span>
              <span className="text-sm font-mono text-red-400">
                {hedgeAmountEth.toFixed(4)} ETH
              </span>
            </div>
            {/* Visual bar */}
            <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-red-500"
                style={{ width: `${hedgeRatio}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Regime payoff scenarios */}
      {depositAmount && parseFloat(depositAmount) > 0 && (
        <div className="rounded-xl bg-gray-800/50 p-4 mb-6">
          <p className="text-xs text-gray-500 mb-3">Projected Payoffs</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-xs text-blue-400 mb-1">If LOW_VOL</p>
              <p className="text-sm font-mono text-white">
                {baseAmountEth.toFixed(4)} ETH
              </p>
              <p className="text-xs text-gray-500">
                (hedge tokens expire worthless)
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-red-400 mb-1">If HIGH_VOL</p>
              <p className="text-sm font-mono text-green-400">
                {(baseAmountEth + hedgeAmountEth * 2).toFixed(4)} ETH
              </p>
              <p className="text-xs text-gray-500">
                (hedge tokens pay out ~2×)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Deposit button */}
      <button
        onClick={handleDeposit}
        disabled={!isConnected || !depositAmount || isPending}
        className="w-full rounded-xl py-3 font-semibold bg-indigo-600 hover:bg-indigo-500
                   text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
