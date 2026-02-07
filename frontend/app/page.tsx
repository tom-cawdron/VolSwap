"use client";

import { useState } from "react";
import RegimeGauge from "@/components/RegimeGauge";
import TradePanel from "@/components/TradePanel";
import VaultDeposit from "@/components/VaultDeposit";
import AssetSelector from "@/components/AssetSelector";
import { usePredictions } from "@/lib/api";
import type { AssetKey } from "@/lib/types";
import { ASSETS, ASSET_KEYS } from "@/lib/types";

export default function Home() {
  const [selectedAsset, setSelectedAsset] = useState<AssetKey>("eth");
  const { predictions, isLoading, error, lastUpdated } = usePredictions();

  return (
    <main className="min-h-screen p-6 md:p-12 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-2">
          Finance Multiverse
        </h1>
        <p className="text-gray-400 text-lg">
          Multi-asset regime-based volatility hedging — powered by ML prediction markets.
        </p>
      </header>

      {/* Overview: compact gauges for all 3 assets */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">
          Market Overview
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {ASSET_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setSelectedAsset(key)}
              className={`text-left transition-all rounded-2xl ${
                key === selectedAsset
                  ? "ring-2 ring-offset-2 ring-offset-gray-950 " + ASSETS[key].borderColor.replace("border-", "ring-")
                  : "hover:ring-1 hover:ring-gray-700"
              }`}
            >
              <RegimeGauge
                asset={key}
                data={predictions[key]}
                isLoading={isLoading}
                compact
              />
            </button>
          ))}
        </div>

        {/* Error / status bar */}
        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2 text-sm text-red-400">
            API Error: {error}
            <span className="text-gray-500 ml-2">
              — predictions may be stale. Is the inference server running?
            </span>
          </div>
        )}
        {lastUpdated && !error && (
          <p className="mt-3 text-xs text-gray-600">
            Last refresh: {new Date(lastUpdated * 1000).toLocaleTimeString()}
          </p>
        )}
      </section>

      {/* Asset selector */}
      <div className="mb-6">
        <AssetSelector selected={selectedAsset} onChange={setSelectedAsset} />
      </div>

      {/* Selected asset detail grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Detailed Regime Gauge */}
        <div className="lg:col-span-1">
          <RegimeGauge
            asset={selectedAsset}
            data={predictions[selectedAsset]}
            isLoading={isLoading}
          />
        </div>

        {/* Center: Trade Panel */}
        <div className="lg:col-span-1">
          <TradePanel asset={selectedAsset} />
        </div>

        {/* Right: Vault */}
        <div className="lg:col-span-1">
          <VaultDeposit asset={selectedAsset} />
        </div>
      </div>
    </main>
  );
}
