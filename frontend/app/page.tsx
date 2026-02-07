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
  const { predictions, isLoading, error, lastUpdated, isDemo } = usePredictions();
  const meta = ASSETS[selectedAsset];

  return (
    <div className="min-h-screen">
      {/* ─── Navbar ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <span className="text-white font-bold text-sm">FM</span>
            </div>
            <span className="text-lg font-bold text-white tracking-tight">
              Finance <span className="text-gradient">Multiverse</span>
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Status pill */}
            {isDemo ? (
              <span className="text-[10px] uppercase tracking-wider px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Demo Mode
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            )}

            {/* Connect wallet placeholder */}
            <button className="px-4 py-2 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all">
              Connect Wallet
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* ─── Header ─────────────────────────────────────────────── */}
        <header className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
            Regime Dashboard
          </h1>
          <p className="text-gray-500 text-sm md:text-base max-w-2xl">
            Multi-asset volatility regime prediction — ML-driven prediction markets
            with on-chain hedging.
          </p>
        </header>

        {/* ─── Overview: compact gauges for all 3 assets ──────────── */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">
              Market Overview
            </h2>
            {lastUpdated && (
              <p className="text-[10px] text-gray-600 font-mono">
                {new Date(lastUpdated * 1000).toLocaleTimeString()}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {ASSET_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedAsset(key)}
                className={`text-left transition-all rounded-2xl ${
                  key === selectedAsset
                    ? "ring-2 ring-offset-2 ring-offset-[#050510] " +
                      ASSETS[key].borderColor.replace("border-", "ring-") + "/40"
                    : "hover:ring-1 hover:ring-white/10"
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

          {/* Demo mode notice */}
          {isDemo && (
            <div className="mt-4 rounded-lg bg-amber-500/5 border border-amber-500/15 px-4 py-2.5 flex items-start gap-3">
              <span className="text-amber-400 text-sm mt-0.5">⚠</span>
              <div>
                <p className="text-xs text-amber-400 font-medium">Inference server offline — showing demo data</p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Start the server with: uvicorn src.inference:app --port 8000 --app-dir ml
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ─── Divider ────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-8" />

        {/* ─── Asset Selector ─────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <AssetSelector selected={selectedAsset} onChange={setSelectedAsset} />
            <span className="text-xs text-gray-600">{meta.label} — {meta.symbol}</span>
          </div>
        </div>

        {/* ─── Selected asset detail grid ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
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

        {/* ─── Footer ─────────────────────────────────────────────── */}
        <footer className="border-t border-white/5 pt-6 pb-12 flex items-center justify-between">
          <p className="text-[10px] text-gray-600">
            Finance Multiverse — ETH Oxford 2026
          </p>
          <p className="text-[10px] text-gray-600 font-mono">
            v0.3.0 — multi-asset
          </p>
        </footer>
      </main>
    </div>
  );
}
