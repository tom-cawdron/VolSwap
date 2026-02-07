"use client";

import React from "react";
import type { AssetKey, AssetMeta, RegimePrediction } from "../lib/types";
import { ASSETS } from "../lib/types";

/**
 * RegimeGauge — Displays current regime probability as a visual gauge.
 */

interface RegimeGaugeProps {
  asset: AssetKey;
  data: RegimePrediction | null;
  isLoading?: boolean;
  compact?: boolean;
}

function getEntropyLabel(entropy: number): string {
  if (entropy < 0.3) return "High Confidence";
  if (entropy < 0.6) return "Moderate";
  return "Uncertain";
}

function getEntropyColor(entropy: number): string {
  if (entropy < 0.3) return "text-green-400";
  if (entropy < 0.6) return "text-yellow-400";
  return "text-red-400";
}

function getRegimeColor(regime: string): string {
  return regime === "HIGH_VOL" ? "text-red-400" : "text-blue-400";
}

function getRegimeBg(regime: string): string {
  return regime === "HIGH_VOL" ? "bg-red-500/10" : "bg-blue-500/10";
}

const GLOW_MAP: Record<AssetKey, string> = {
  eth: "glow-indigo",
  btc: "glow-amber",
  sol: "glow-emerald",
};

/* ─── Compact card (used in the 3-asset overview row) ─────────────── */

function CompactGauge({ asset, data }: { asset: AssetKey; data: RegimePrediction }) {
  const meta: AssetMeta = ASSETS[asset];
  const angle = data.p_high_vol * 180;
  const gradientId = `cg-${asset}`;

  return (
    <div className={`glass-card rounded-2xl p-5 ${GLOW_MAP[asset]} transition-all hover:scale-[1.02]`}>
      {/* Asset badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${meta.color.replace("text-", "bg-")}`} />
          <span className={`text-sm font-semibold ${meta.color}`}>{meta.shortLabel}</span>
          <span className="text-xs text-gray-500">{meta.symbol}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRegimeBg(data.regime)} ${getRegimeColor(data.regime)}`}>
          {data.regime.replace("_", " ")}
        </span>
      </div>

      {/* Mini gauge */}
      <div className="flex justify-center mb-4">
        <svg viewBox="0 0 200 120" className="w-40 h-26">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1f2937" strokeWidth="10" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke={`url(#${gradientId})`} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${angle * 1.396} 999`} />
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
          </defs>
          <line x1="100" y1="100" x2={100 + 60 * Math.cos(Math.PI - (angle * Math.PI) / 180)} y2={100 - 60 * Math.sin(Math.PI - (angle * Math.PI) / 180)} stroke="white" strokeWidth="2" strokeLinecap="round" />
          <circle cx="100" cy="100" r="3.5" fill="white" />
          <text x="20" y="118" fill="#60A5FA" fontSize="9" fontWeight="600">LOW</text>
          <text x="158" y="118" fill="#F87171" fontSize="9" fontWeight="600">HIGH</text>
        </svg>
      </div>

      {/* Probability + confidence */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-mono font-semibold text-white">
            {(data.p_high_vol * 100).toFixed(1)}%
          </p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">P(High Vol)</p>
        </div>
        <div className="text-right">
          <p className={`text-sm font-medium ${getEntropyColor(data.entropy)}`}>
            {(data.confidence * 100).toFixed(0)}%
          </p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Confidence</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Full gauge (detailed view for selected asset) ───────────────── */

export default function RegimeGauge({
  asset,
  data,
  isLoading,
  compact,
}: RegimeGaugeProps) {
  const meta: AssetMeta = ASSETS[asset];

  if (isLoading || !data) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="h-6 shimmer rounded w-40 mb-5" />
        <div className="h-40 shimmer rounded-xl w-full mb-5" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-16 shimmer rounded-lg" />
          <div className="h-16 shimmer rounded-lg" />
        </div>
      </div>
    );
  }

  if (compact) {
    return <CompactGauge asset={asset} data={data} />;
  }

  const angle = data.p_high_vol * 180;

  return (
    <div className={`glass-card rounded-2xl p-6 ${GLOW_MAP[asset]}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${meta.color.replace("text-", "bg-")}`} />
          <span className={`text-lg font-bold ${meta.color}`}>{meta.shortLabel}</span>
          <h2 className="text-lg font-semibold text-white">Regime Probability</h2>
        </div>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">
          {new Date(data.timestamp * 1000).toLocaleTimeString()}
        </span>
      </div>

      {/* Gauge SVG */}
      <div className="flex justify-center mb-6">
        <svg viewBox="0 0 200 120" className="w-64 h-40">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1f2937" strokeWidth="12" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGradient)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${angle * 1.396} 999`} />
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
          </defs>
          <line x1="100" y1="100" x2={100 + 65 * Math.cos(Math.PI - (angle * Math.PI) / 180)} y2={100 - 65 * Math.sin(Math.PI - (angle * Math.PI) / 180)} stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="100" cy="100" r="4" fill="white" />
          <text x="18" y="118" fill="#60A5FA" fontSize="10" fontWeight="600">LOW</text>
          <text x="156" y="118" fill="#F87171" fontSize="10" fontWeight="600">HIGH</text>
        </svg>
      </div>

      {/* Probabilities */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">P(Low Vol)</p>
          <p className="text-2xl font-mono font-semibold text-blue-400">
            {(data.p_low_vol * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl bg-red-500/5 border border-red-500/10 p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">P(High Vol)</p>
          <p className="text-2xl font-mono font-semibold text-red-400">
            {(data.p_high_vol * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Regime & Entropy */}
      <div className="flex items-center justify-between border-t border-white/5 pt-4">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Current Regime</p>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getRegimeBg(data.regime)} ${getRegimeColor(data.regime)}`}>
            {data.regime.replace("_", " ")}
          </span>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Entropy</p>
          <p className={`text-sm font-medium ${getEntropyColor(data.entropy)}`}>
            {data.entropy.toFixed(3)} — {getEntropyLabel(data.entropy)}
          </p>
        </div>
      </div>

      {/* Model hash */}
      <div className="mt-4 pt-3 border-t border-white/5">
        <p className="text-[10px] text-gray-600 font-mono">
          Model: {data.model_hash.slice(0, 16)}…
        </p>
      </div>
    </div>
  );
}
