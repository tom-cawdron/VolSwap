"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { baseSepolia } from "wagmi/chains";
import RegimeGauge from "@/components/RegimeGauge";
import TradePanel from "@/components/TradePanel";
import VaultDeposit from "@/components/VaultDeposit";
import AssetSelector from "@/components/AssetSelector";
import { usePredictions } from "@/lib/api";
import type { AssetKey } from "@/lib/types";
import { ASSETS, ASSET_KEYS } from "@/lib/types";

export default function Home() {
  const [selectedAsset, setSelectedAsset] = useState<AssetKey>("eth");
  const [activeTab, setActiveTab] = useState<"trade" | "hedge">("trade");
  const { predictions, isLoading, error, lastUpdated, isDemo } = usePredictions();
  const meta = ASSETS[selectedAsset];

  return (
    <div className="min-h-screen">
      {/* ─── Navbar ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <img src="/logo.svg" alt="VolSwap" className="w-9 h-9 rounded-lg" />
            <span className="text-lg font-black text-white tracking-tighter uppercase">
              Vol<span className="text-gradient">Swap</span>
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

            {/* Wallet connection */}
            <ConnectButton.Custom>
              {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
                const connected = mounted && account && chain;
                return (
                  <div {...(!mounted && { "aria-hidden": true, style: { opacity: 0, pointerEvents: "none", userSelect: "none" } })}>
                    {!connected ? (
                      <button
                        onClick={openConnectModal}
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-lg shadow-indigo-600/20"
                      >
                        Connect Wallet
                      </button>
                    ) : chain.id !== baseSepolia.id ? (
                      <button
                        onClick={openChainModal}
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-all"
                      >
                        Wrong Network
                      </button>
                    ) : (
                      <button
                        onClick={openAccountModal}
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full bg-green-400" />
                        {account.displayName}
                      </button>
                    )}
                  </div>
                );
              }}
            </ConnectButton.Custom>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* ─── Header ─────────────────────────────────────────────── */}
        <header className="mb-10">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter mb-2 uppercase">
            Bet on Chaos
          </h1>
          <p className="text-gray-400 text-sm md:text-base max-w-2xl">
            Will crypto markets get more chaotic or stay calm? Our AI reads the signals
            — you bet on what happens next.
          </p>
        </header>

        {/* ─── How It Works ───────────────────────────────────────── */}
        <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { step: "1", icon: "01", title: "AI Reads the Market", desc: "Our model ingests 24h of price data and predicts whether markets are heading into chaos or calming down." },
            { step: "2", icon: "02", title: "You Pick a Side", desc: "New rounds open every hour. CHAOTIC means you think volatility will increase; CALM means you think it will decrease. You have 1 hour to place your bet." },
            { step: "3", icon: "03", title: "Collect Winnings", desc: "24 hours later, actual vol is compared to the snapshot. Correct callers split the entire pool." },
          ].map((s) => (
            <div key={s.step} className="glass-card rounded-xl p-4 flex items-start gap-3">
              <span className="text-sm font-mono font-black text-white bg-white/10 w-8 h-8 flex items-center justify-center border border-white/20">{s.icon}</span>
              <div>
                <p className="text-sm font-semibold text-white mb-0.5">{s.title}</p>
                <p className="text-xs text-gray-400 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </section>

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
              <span className="text-amber-400 text-sm mt-0.5">/!</span>
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

        {/* ─── Asset Selector + Tab Toggle ────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <AssetSelector selected={selectedAsset} onChange={setSelectedAsset} />
            <span className="text-xs text-gray-500">{meta.label} — {meta.symbol}</span>
          </div>

          {/* Tab toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/5">
            <button
              onClick={() => setActiveTab("trade")}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "trade"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Place a Bet
            </button>
            <button
              onClick={() => setActiveTab("hedge")}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === "hedge"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Auto-Hedge
            </button>
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

          {/* Right: Trade Panel (hero) or Vault */}
          <div className="lg:col-span-2">
            {activeTab === "trade" ? (
              <TradePanel asset={selectedAsset} prediction={predictions[selectedAsset]} />
            ) : (
              <VaultDeposit asset={selectedAsset} />
            )}
          </div>
        </div>

        {/* ─── Footer ─────────────────────────────────────────────── */}
        <footer className="border-t border-white/5 pt-6 pb-12 flex items-center justify-between">
          <p className="text-[10px] text-gray-600">
            VolSwap — ETH Oxford 2026
          </p>
          <p className="text-[10px] text-gray-600 font-mono">
            v0.5.0 — volswap
          </p>
        </footer>
      </main>
    </div>
  );
}
