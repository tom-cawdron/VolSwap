"use client";

import React from "react";
import type { AssetKey, AssetMeta, RegimePrediction } from "../lib/types";
import { ASSETS } from "../lib/types";

/**
 * RegimeGauge — Displays current regime probability as a visual gauge.
 *
 * Shows:
 *  - Asset badge
 *  - Large probability arc (speedometer style)
 *  - HIGH_VOL vs LOW_VOL labels
 *  - Entropy-based confidence meter
 *  - Last update timestamp
 */

interface RegimeGaugeProps {
  asset: AssetKey;
  data: RegimePrediction | null;
  isLoading?: boolean;
  /** Compact mode for dashboard overview cards */
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
  return regime === "HIGH_VOL" ? "text-red-500" : "text-blue-500";
}

/* ─── Compact card (used in the 3-asset overview row) ─────────────── */

function CompactGauge({ asset, data }: { asset: AssetKey; data: RegimePrediction }) {
  const meta: AssetMeta = ASSETS[asset];
  const angle = data.p_high_vol * 180;

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 p-4">
      {/* Asset badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-sm font-bold ${meta.color}`}>{meta.shortLabel}</span>
        <span className="text-xs text-gray-500">{meta.symbol}</span>
      </div>

      {/* Mini gauge */}
      <div className="flex justify-center mb-3">
        <svg viewBox="0 0 200 120" className="w-36 h-24">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#374151" strokeWidth="12" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#g)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${angle * 1.396} 999`} />
          <defs>
            <linearGradient id="g" x1="0%" y1="0%" x2="100%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
          </defs>
          <line x1="100" y1="100" x2={100 + 65 * Math.cos(Math.PI - (angle * Math.PI) / 180)} y2={100 - 65 * Math.sin(Math.PI - (angle * Math.PI) / 180)} stroke="white" strokeWidth="2" strokeLinecap="round" />
          <circle cx="100" cy="100" r="4" fill="white" />
          <text x="20" y="118" fill="#3B82F6" fontSize="10" fontWeight="bold">LOW</text>
          <text x="160" y="118" fill="#EF4444" fontSize="10" fontWeight="bold">HIGH</text>
        </svg>
      </div>

      {/* Regime label */}
      <div className="text-center">
        <span className={`text-lg font-bold ${getRegimeColor(data.regime)}`}>
          {data.regime.replace("_", " ")}
        </span>
        <p className="text-xs text-gray-500 mt-1">
          {(data.confidence * 100).toFixed(1)}% confidence
        </p>
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
      <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-4" />
        <div className="h-48 bg-gray-800 rounded-full w-48 mx-auto" />
      </div>
    );
  }

  if (compact) {
    return <CompactGauge asset={asset} data={data} />;
  }

  const angle = data.p_high_vol * 180;

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className={`text-lg font-bold ${meta.color}`}>{meta.shortLabel}</span>
          <h2 className="text-xl font-semibold text-white">Regime Probability</h2>
        </div>
        <span className="text-xs text-gray-500">
          Updated {new Date(data.timestamp * 1000).toLocaleTimeString()}
        </span>
      </div>

      {/* Gauge SVG */}
      <div className="flex justify-center mb-6">
        <svg viewBox="0 0 200 120" className="w-64 h-40">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#374151" strokeWidth="12" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGradient)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${angle * 1.396} 999`} />
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
          </defs>
          <line x1="100" y1="100" x2={100 + 65 * Math.cos(Math.PI - (angle * Math.PI) / 180)} y2={100 - 65 * Math.sin(Math.PI - (angle * Math.PI) / 180)} stroke="white" strokeWidth="2" strokeLinecap="round" />
          <circle cx="100" cy="100" r="4" fill="white" />
          <text x="20" y="118" fill="#3B82F6" fontSize="10" fontWeight="bold">LOW</text>
          <text x="160" y="118" fill="#EF4444" fontSize="10" fontWeight="bold">HIGH</text>
        </svg>
      </div>

      {/* Probabilities */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-1">P(LOW_VOL)</p>
          <p className="text-2xl font-mono text-blue-400">
            {(data.p_low_vol * 100).toFixed(1)}%
          </p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-1">P(HIGH_VOL)</p>
          <p className="text-2xl font-mono text-red-400">
            {(data.p_high_vol * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Regime & Confidence */}
      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
        <div>
          <p className="text-xs text-gray-500">Current Regime</p>
          <p className={`text-lg font-bold ${getRegimeColor(data.regime)}`}>
            {data.regime.replace("_", " ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Entropy</p>
          <p className={`text-sm font-medium ${getEntropyColor(data.entropy)}`}>
            {data.entropy.toFixed(3)} — {getEntropyLabel(data.entropy)}
          </p>
        </div>
      </div>

      {/* Model hash */}
      <div className="mt-3 pt-3 border-t border-gray-800">
        <p className="text-xs text-gray-600 font-mono truncate">
          Model: {data.model_hash.slice(0, 16)}…
        </p>
      </div>
    </div>
  );
}
