"use client";

import React, { useState, useEffect } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { parseEther, formatEther } from "viem";
import { MULTIVERSE_MARKET_ABI, MULTIVERSE_MARKET_ADDRESSES } from "../lib/contracts";
import { useSimulatedRound } from "../lib/useSimulatedRound";
import type { SimulatedRound } from "../lib/useSimulatedRound";
import type { AssetKey, RegimePrediction } from "../lib/types";
import { ASSETS } from "../lib/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * TradePanel — Hourly round-based volatility prediction market.
 *
 * New rounds open every hour. Users bet on whether 24h realised volatility
 * will get more chaotic or stay calmer than the snapshot taken when the round
 * opened. Rounds resolve 24 hours after trading closes. Multiple rounds can
 * be in-flight simultaneously (overlapping).
 */

type Outcome = "CHAOTIC" | "CALM";

interface TradePanelProps {
  asset: AssetKey;
  prediction?: RegimePrediction | null;
}

/** Format seconds into "Xd Yh Zm" or "Xh Ym Zs" */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Closed";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function TradePanel({ asset, prediction }: TradePanelProps) {
  const meta = ASSETS[asset];
  const marketAddress = MULTIVERSE_MARKET_ADDRESSES[asset];
  const isContractDeployed = marketAddress !== ZERO_ADDRESS;

  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [outcome, setOutcome] = useState<Outcome>("CHAOTIC");
  const [amount, setAmount] = useState("");
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // Tick every second for countdowns
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  // ─── Simulated rounds (demo mode when contracts not deployed) ──────
  const {
    activeRound: simActive,
    pendingRounds: simPending,
    resolvedRounds: simResolved,
    roundId: simRoundId,
  } = useSimulatedRound(isContractDeployed ? null : prediction, asset);

  // ─── Read current round ID (on-chain) ──────────────────────────────
  const { data: currentRoundId } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "currentRoundId",
    query: { enabled: isContractDeployed },
  });

  const onChainRoundId = currentRoundId ? Number(currentRoundId) : 0;

  // ─── Read round data (on-chain) ────────────────────────────────────
  const { data: roundData } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "getRound",
    args: onChainRoundId > 0 ? [BigInt(onChainRoundId)] : undefined,
    query: { enabled: isContractDeployed && onChainRoundId > 0 },
  });

  // ─── Read prices for current round (on-chain) ──────────────────────
  const { data: priceHigh } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "priceHighVol",
    args: onChainRoundId > 0 ? [BigInt(onChainRoundId)] : undefined,
    query: { enabled: isContractDeployed && onChainRoundId > 0 },
  });

  const { data: priceLow } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "priceLowVol",
    args: onChainRoundId > 0 ? [BigInt(onChainRoundId)] : undefined,
    query: { enabled: isContractDeployed && onChainRoundId > 0 },
  });

  const { data: fee } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "dynamicFee",
    query: { enabled: isContractDeployed },
  });

  // ─── Read user position in current round (on-chain) ────────────────
  const { data: userPosition } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "getUserPosition",
    args: onChainRoundId > 0 && address ? [BigInt(onChainRoundId), address] : undefined,
    query: { enabled: isContractDeployed && onChainRoundId > 0 && !!address },
  });

  const { writeContract, isPending } = useWriteContract();

  // ─── Unified round values (on-chain OR simulated) ──────────────────
  const onChainRound = roundData as
    | {
      snapshotVol: bigint;
      tradingEnd: bigint;
      resolutionTime: bigint;
      totalCollateral: bigint;
      totalHighTokens: bigint;
      totalLowTokens: bigint;
      seedCollateral: bigint;
      seedHighTokens: bigint;
      seedLowTokens: bigint;
      resolved: boolean;
      highVolWon: boolean;
      resolvedVol: bigint;
    }
    | undefined;

  // Pick active round data source
  const roundId = isContractDeployed ? onChainRoundId : simRoundId;
  const activeRound = isContractDeployed ? null : simActive;

  const snapshotVol = isContractDeployed
    ? (onChainRound ? Number(onChainRound.snapshotVol) / 1e18 : 0)
    : (activeRound?.snapshotVol ?? 0);

  const tradingEnd = isContractDeployed
    ? (onChainRound ? Number(onChainRound.tradingEnd) : 0)
    : (activeRound?.tradingEnd ?? 0);

  const resolutionTime = isContractDeployed
    ? (onChainRound ? Number(onChainRound.resolutionTime) : 0)
    : (activeRound?.resolutionTime ?? 0);

  const totalPool = isContractDeployed
    ? (onChainRound ? Number(onChainRound.totalCollateral) / 1e18 : 0)
    : (activeRound?.totalCollateral ?? 0);

  const seedCollateral = isContractDeployed
    ? (onChainRound ? Number(onChainRound.seedCollateral) / 1e18 : 0)
    : (activeRound?.seedCollateral ?? 0);

  const userPool = totalPool - seedCollateral;

  const isResolved = isContractDeployed
    ? (onChainRound?.resolved ?? false)
    : (activeRound?.resolved ?? false);

  const isTradingOpen = tradingEnd > now && !isResolved;
  const tradingCountdown = Math.max(0, tradingEnd - now);
  const resolutionCountdown = Math.max(0, resolutionTime - now);

  const formattedPriceHigh = priceHigh ? (Number(priceHigh) / 1e18).toFixed(4) : "0.5000";
  const formattedPriceLow = priceLow ? (Number(priceLow) / 1e18).toFixed(4) : "0.5000";

  /** 0.5% fee on every purchase */
  const FEE_RATE = 0.005;
  const formattedFee = "0.5%";

  const userHigh = userPosition ? Number((userPosition as [bigint, bigint])[0]) / 1e18 : 0;
  const userLow = userPosition ? Number((userPosition as [bigint, bigint])[1]) / 1e18 : 0;

  const rawCost = amount
    ? parseFloat(amount) *
    (outcome === "CHAOTIC"
      ? Number(priceHigh ?? 5e17) / 1e18
      : Number(priceLow ?? 5e17) / 1e18)
    : 0;
  const estimatedCost = amount ? (rawCost * (1 + FEE_RATE)).toFixed(6) : "0";

  // Pending + resolved from simulation
  const pendingRounds = isContractDeployed ? [] : simPending;
  const resolvedRounds = isContractDeployed ? [] : simResolved;

  // ─── Actions ───────────────────────────────────────────────────────
  const handleBuy = () => {
    if (!amount || !isConnected || roundId === 0) return;
    writeContract({
      address: marketAddress,
      abi: MULTIVERSE_MARKET_ABI,
      functionName: "buyOutcome",
      args: [BigInt(roundId), outcome === "CHAOTIC", parseEther(amount)],
      value: parseEther(estimatedCost),
    });
  };

  const handleClaim = () => {
    if (!isConnected || roundId === 0) return;
    writeContract({
      address: marketAddress,
      abi: MULTIVERSE_MARKET_ABI,
      functionName: "claimPayout",
      args: [BigInt(roundId)],
    });
  };

  const handleStartNewRound = () => {
    if (!isConnected) return;
    writeContract({
      address: marketAddress,
      abi: MULTIVERSE_MARKET_ABI,
      functionName: "startNewRound",
    });
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="glass-card rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-3 h-3 rounded-full ${meta.color.replace("text-", "bg-")}`} />
        <span className={`text-lg font-bold ${meta.color}`}>{meta.shortLabel}</span>
        <h2 className="text-lg font-black text-white uppercase tracking-tight">Chaos Market</h2>
      </div>

      {/* Contextual question */}
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 mb-5">
        <p className="text-base font-semibold text-white leading-snug">
          Will {meta.shortLabel} get{" "}
          <span className="text-red-400">more chaotic</span> or{" "}
          <span className="text-blue-400">calmer</span> over the next 24h vs today&apos;s{" "}
          <span className="font-mono text-yellow-400">
            {snapshotVol > 0 ? (snapshotVol * 100).toFixed(2) + "%" : "—"}
          </span>
          ?
        </p>
        {prediction && (
          <p className="text-xs text-gray-400 mt-2">
            AI says{" "}
            <span className={prediction.regime === "HIGH_VOL" ? "text-red-400 font-semibold" : "text-blue-400 font-semibold"}>
              {prediction.regime === "HIGH_VOL" ? "MORE CHAOTIC" : "CALMER"}
            </span>{" "}
            with {(prediction.confidence * 100).toFixed(0)}% confidence
          </p>
        )}
      </div>

      {/* ─── Active Round info ─────────────────────────────────────── */}
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Round #{roundId || "—"}
            </p>
            {!isContractDeployed && roundId > 0 && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                Simulated
              </span>
            )}
          </div>
          {isResolved ? (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
              Resolved — {(isContractDeployed ? onChainRound?.highVolWon : activeRound?.highVolWon) ? "CHAOTIC won" : "CALM won"}
            </span>
          ) : isTradingOpen ? (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-900/50 text-green-400 animate-pulse">
              Trading Open
            </span>
          ) : roundId > 0 ? (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-900/40 text-yellow-400">
              Awaiting Resolution
            </span>
          ) : (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
              Waiting for next round
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-gray-500 mb-1">Snapshot Vol</p>
            <p className="text-sm font-mono font-semibold text-white">
              {snapshotVol > 0 ? (snapshotVol * 100).toFixed(3) + "%" : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Trading Ends</p>
            <p className={`text-sm font-mono font-semibold ${isTradingOpen ? "text-green-400" : "text-gray-500"}`}>
              {roundId > 0 ? formatCountdown(tradingCountdown) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Resolves In</p>
            <p className="text-sm font-mono font-semibold text-yellow-400">
              {roundId > 0 ? formatCountdown(resolutionCountdown) : "—"}
            </p>
          </div>
        </div>

        {totalPool > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">User Pool</span>
              <span className="text-sm font-mono text-white">{userPool.toFixed(4)} ETH</span>
            </div>
            {seedCollateral > 0 && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-600">Liquidity Seed</span>
                <span className="text-xs font-mono text-gray-600">{seedCollateral.toFixed(4)} ETH</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Pending Rounds (awaiting resolution) ──────────────────── */}
      {pendingRounds.length > 0 && (
        <div className="rounded-xl bg-yellow-500/[0.03] border border-yellow-500/10 p-4 mb-5">
          <p className="text-xs text-yellow-500 uppercase tracking-wider mb-3 font-semibold">
            Awaiting Resolution ({pendingRounds.length} round{pendingRounds.length > 1 ? "s" : ""})
          </p>
          <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
            {pendingRounds.map((r: SimulatedRound) => (
              <PendingRoundRow key={r.roundId} round={r} now={now} />
            ))}
          </div>
        </div>
      )}

      {/* Outcome buttons: Chaotic / Calm */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <button
          onClick={() => setOutcome("CHAOTIC")}
          className={`rounded-2xl p-6 border-2 transition-all ${outcome === "CHAOTIC"
              ? "border-red-500/60 bg-red-500/10 glow-red scale-[1.02]"
              : "border-white/5 bg-white/[0.02] hover:border-red-500/30 hover:bg-red-500/5"
            }`}
        >
          <p className="text-sm text-gray-400 uppercase tracking-wider mb-1">Chaotic</p>
          <p className="text-2xl font-mono font-bold text-red-400">{formattedPriceHigh}</p>
          <p className="text-xs text-gray-500 mt-1.5">Markets get wilder — you win</p>
        </button>

        <button
          onClick={() => setOutcome("CALM")}
          className={`rounded-2xl p-6 border-2 transition-all ${outcome === "CALM"
              ? "border-blue-500/60 bg-blue-500/10 glow-indigo scale-[1.02]"
              : "border-white/5 bg-white/[0.02] hover:border-blue-500/30 hover:bg-blue-500/5"
            }`}
        >
          <p className="text-sm text-gray-400 uppercase tracking-wider mb-1">Calm</p>
          <p className="text-2xl font-mono font-bold text-blue-400">{formattedPriceLow}</p>
          <p className="text-xs text-gray-500 mt-1.5">Markets settle down — you win</p>
        </button>
      </div>

      {/* Market fee */}
      <div className="flex items-center justify-between text-sm mb-4 px-1">
        <span className="text-gray-400 text-xs group relative cursor-help">
          Market Fee
          <span className="tooltip">0.5% of your trade is taken as a fee</span>
        </span>
        <span className="text-yellow-400 font-mono text-sm">{formattedFee}</span>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">
          Amount (tokens)
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          min="0"
          step="0.01"
          disabled={!isTradingOpen}
          className="w-full rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3
                     text-white font-mono text-lg placeholder-gray-700
                     focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all
                     disabled:opacity-30"
        />
      </div>

      {/* Cost estimate */}
      <div className="flex items-center justify-between text-sm mb-5 px-1">
        <span className="text-gray-500 text-xs">Estimated Cost</span>
        <span className="text-white font-mono">{estimatedCost} ETH</span>
      </div>

      {/* Buy / Claim / Start New Round / Connect button */}
      {isResolved && (userHigh > 0 || userLow > 0) ? (
        <div className="space-y-3">
          <button
            onClick={handleClaim}
            disabled={isPending}
            className="w-full rounded-xl py-3.5 font-semibold bg-green-600 hover:bg-green-500
                       text-white transition-all shadow-lg shadow-green-600/20
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isPending ? "Claiming …" : "Claim Payout"}
          </button>
          <button
            onClick={handleStartNewRound}
            disabled={isPending}
            className="w-full rounded-xl py-3 font-medium text-sm bg-indigo-600/80 hover:bg-indigo-500
                       text-white transition-all shadow-lg shadow-indigo-600/20
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isPending ? "Starting …" : "Start Next Round →"}
          </button>
        </div>
      ) : isResolved ? (
        <button
          onClick={isConnected ? handleStartNewRound : openConnectModal}
          disabled={isConnected && isPending}
          className="w-full rounded-xl py-3.5 font-semibold bg-indigo-600 hover:bg-indigo-500
                     text-white transition-all shadow-lg shadow-indigo-600/20
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {isPending ? "Starting …" : !isConnected ? "Connect Wallet" : "Start Next Round →"}
        </button>
      ) : (
        <button
          onClick={isConnected ? handleBuy : openConnectModal}
          disabled={isConnected && (!amount || isPending || !isTradingOpen)}
          className={`w-full rounded-xl py-3.5 font-semibold transition-all ${!isConnected
              ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
              : outcome === "CHAOTIC"
                ? "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
                : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
            } disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none`}
        >
          {isPending
            ? "Confirming …"
            : !isConnected
              ? "Connect Wallet"
              : !isTradingOpen
                ? "Trading Closed"
                : `Bet ${outcome}`}
        </button>
      )}

      {/* User position in this round */}
      {(userHigh > 0 || userLow > 0) && (
        <div className="mt-4 rounded-xl bg-white/[0.03] border border-white/5 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Your Position (Round #{roundId})</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-red-400">CHAOTIC tokens</p>
              <p className="text-sm font-mono text-white">{userHigh.toFixed(4)}</p>
            </div>
            <div>
              <p className="text-xs text-blue-400">CALM tokens</p>
              <p className="text-sm font-mono text-white">{userLow.toFixed(4)}</p>
            </div>
          </div>
        </div>
      )}

      {/* How payoffs work */}
      <div className="mt-5 rounded-xl bg-white/[0.02] border border-white/5 p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">How It Works</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Each round snapshots the current 24h realised volatility and opens a 1-hour trading window.
          After trading closes, the round waits 24 hours. At resolution, the new realised vol is compared
          to the snapshot — if things got more chaotic, CHAOTIC wins; if markets calmed down, CALM wins.
          Correct callers split the user pool proportionally. A 0.5 ETH liquidity seed is placed on each
          side at round open to ensure fair LMSR pricing — the seed is excluded from payouts.
        </p>
      </div>

      {/* ─── Resolved Rounds ───────────────────────────────────────── */}
      {resolvedRounds.length > 0 && (
        <div className="mt-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Recent Results</p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {resolvedRounds.map((r: SimulatedRound) => (
              <SimResolvedRow key={r.roundId} round={r} />
            ))}
          </div>
        </div>
      )}

      {/* On-chain round history */}
      {isContractDeployed && onChainRoundId > 1 && (
        <div className="mt-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Past Rounds</p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {Array.from({ length: Math.min(onChainRoundId - 1, 10) }, (_, i) => onChainRoundId - 1 - i).map((rid) => (
              <OnChainPastRoundRow key={rid} roundId={rid} marketAddress={marketAddress} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Pending Round Row (simulated, awaiting resolution) ──────────── */

function PendingRoundRow({ round: r, now }: { round: SimulatedRound; now: number }) {
  const countdown = Math.max(0, r.resolutionTime - now);
  const pool = r.totalCollateral - (r.seedCollateral ?? 0);

  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2 flex items-center justify-between text-xs">
      <div className="flex items-center gap-3">
        <span className="text-gray-500 font-mono">#{r.roundId}</span>
        <span className="text-yellow-400 font-medium">Pending</span>
      </div>
      <div className="flex items-center gap-4 text-gray-400 font-mono">
        <span>Snap: {(r.snapshotVol * 100).toFixed(2)}%</span>
        <span className="text-yellow-400">{formatCountdown(countdown)}</span>
        <span className="text-gray-500">{pool.toFixed(3)} ETH</span>
      </div>
    </div>
  );
}

/* ─── Resolved Round Row (simulated) ──────────────────────────────── */

function SimResolvedRow({ round: r }: { round: SimulatedRound }) {
  const pool = r.totalCollateral - (r.seedCollateral ?? 0);
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2 flex items-center justify-between text-xs">
      <div className="flex items-center gap-3">
        <span className="text-gray-500 font-mono">#{r.roundId}</span>
        <span className={`font-semibold ${r.highVolWon ? "text-red-400" : "text-blue-400"}`}>
          {r.highVolWon ? "CHAOTIC" : "CALM"}
        </span>
      </div>
      <div className="flex items-center gap-4 text-gray-400 font-mono">
        <span>
          {(r.snapshotVol * 100).toFixed(2)}% → {(r.resolvedVol * 100).toFixed(2)}%
        </span>
        <span className="text-gray-500">{pool.toFixed(3)} ETH</span>
      </div>
    </div>
  );
}

/* ─── On-chain Past Round Row ─────────────────────────────────────── */

function OnChainPastRoundRow({ roundId, marketAddress }: { roundId: number; marketAddress: `0x${string}` }) {
  const { data: roundData } = useReadContract({
    address: marketAddress,
    abi: MULTIVERSE_MARKET_ABI,
    functionName: "getRound",
    args: [BigInt(roundId)],
  });

  const r = roundData as
    | {
      snapshotVol: bigint;
      totalCollateral: bigint;
      seedCollateral: bigint;
      resolved: boolean;
      highVolWon: boolean;
      resolvedVol: bigint;
    }
    | undefined;

  if (!r) return null;

  const snap = Number(r.snapshotVol) / 1e18;
  const resVol = Number(r.resolvedVol) / 1e18;
  const pool = (Number(r.totalCollateral) - Number(r.seedCollateral)) / 1e18;

  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2 flex items-center justify-between text-xs">
      <div className="flex items-center gap-3">
        <span className="text-gray-500 font-mono">#{roundId}</span>
        {r.resolved ? (
          <span className={`font-semibold ${r.highVolWon ? "text-red-400" : "text-blue-400"}`}>
            {r.highVolWon ? "CHAOTIC" : "CALM"}
          </span>
        ) : (
          <span className="text-yellow-400">Pending</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-gray-400 font-mono">
        <span>{(snap * 100).toFixed(2)}% → {resVol > 0 ? (resVol * 100).toFixed(2) + "%" : "…"}</span>
        <span className="text-gray-500">{pool.toFixed(3)} ETH</span>
      </div>
    </div>
  );
}
