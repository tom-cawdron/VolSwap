import RegimeGauge from "@/components/RegimeGauge";
import TradePanel from "@/components/TradePanel";
import VaultDeposit from "@/components/VaultDeposit";

export default function Home() {
  return (
    <main className="min-h-screen p-6 md:p-12 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-2">
          Finance Multiverse
        </h1>
        <p className="text-gray-400 text-lg">
          Regime-based volatility hedging — powered by ML prediction markets.
        </p>
      </header>

      {/* Dashboard grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Regime Gauge */}
        <div className="lg:col-span-1">
          <RegimeGauge
            data={{
              pHighVol: 0.73,
              pLowVol: 0.27,
              entropy: 0.54,
              regime: "HIGH_VOL",
              confidence: 0.73,
              timestamp: Math.floor(Date.now() / 1000),
            }}
          />
        </div>

        {/* Center: Trade Panel */}
        <div className="lg:col-span-1">
          <TradePanel />
        </div>

        {/* Right: Vault */}
        <div className="lg:col-span-1">
          <VaultDeposit />
        </div>
      </div>
    </main>
  );
}
