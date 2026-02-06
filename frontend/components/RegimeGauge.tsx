"use client";

import React from "react";

/**
 * RegimeGauge — Displays current regime probability as a visual gauge.
 *
 * Shows:
 *  - Large probability arc (speedometer style)
 *  - HIGH_VOL vs LOW_VOL labels
 *  - Entropy-based confidence meter
 *  - Last update timestamp
 */

interface RegimeData {
  pHighVol: number;
  pLowVol: number;
  entropy: number;
  regime: "HIGH_VOL" | "LOW_VOL";
  confidence: number;
  timestamp: number;
}

interface RegimeGaugeProps {
  data: RegimeData | null;
  isLoading?: boolean;
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

export default function RegimeGauge({ data, isLoading }: RegimeGaugeProps) {
  if (isLoading || !data) {
    return (
      <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-4" />
        <div className="h-48 bg-gray-800 rounded-full w-48 mx-auto" />
      </div>
    );
  }

  const { pHighVol, pLowVol, entropy, regime, confidence, timestamp } = data;
  const angle = pHighVol * 180; // 0° = full LOW_VOL, 180° = full HIGH_VOL

  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Regime Probability</h2>
        <span className="text-xs text-gray-500">
          Updated {new Date(timestamp * 1000).toLocaleTimeString()}
        </span>
      </div>

      {/* Gauge SVG */}
      <div className="flex justify-center mb-6">
        <svg viewBox="0 0 200 120" className="w-64 h-40">
          {/* Background arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="#374151"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* Coloured arc (proportional to P(HIGH_VOL)) */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${angle * 1.396} 999`}
          />
          {/* Gradient definition */}
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
          </defs>
          {/* Needle */}
          <line
            x1="100"
            y1="100"
            x2={100 + 65 * Math.cos(Math.PI - (angle * Math.PI) / 180)}
            y2={100 - 65 * Math.sin(Math.PI - (angle * Math.PI) / 180)}
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="4" fill="white" />
          {/* Labels */}
          <text x="20" y="118" fill="#3B82F6" fontSize="10" fontWeight="bold">
            LOW
          </text>
          <text x="160" y="118" fill="#EF4444" fontSize="10" fontWeight="bold">
            HIGH
          </text>
        </svg>
      </div>

      {/* Probabilities */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-1">P(LOW_VOL)</p>
          <p className="text-2xl font-mono text-blue-400">
            {(pLowVol * 100).toFixed(1)}%
          </p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-1">P(HIGH_VOL)</p>
          <p className="text-2xl font-mono text-red-400">
            {(pHighVol * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Regime & Confidence */}
      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
        <div>
          <p className="text-xs text-gray-500">Current Regime</p>
          <p className={`text-lg font-bold ${getRegimeColor(regime)}`}>
            {regime.replace("_", " ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Entropy</p>
          <p className={`text-sm font-medium ${getEntropyColor(entropy)}`}>
            {entropy.toFixed(3)} — {getEntropyLabel(entropy)}
          </p>
        </div>
      </div>
    </div>
  );
}
