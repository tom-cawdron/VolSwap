# VolSwap — Bet on Chaos or Calm

> *Will crypto markets get more chaotic or stay calm? Our AI reads the signals — you bet on what happens next.*

A volatility prediction market powered by XGBoost regime detection, LMSR pricing, and an automated hedging vault on Base Sepolia — built for **ETH Oxford 2026**.

---

## Team

| Role | Name | University | Deliverables |
|------|------|------------|--------------|
| ML Lead | Tom Cawdron | LSE (Mathematics with Data Science) | Feature engineering, XGBoost training, calibration, inference API |
| Quant / Econ | Ilyes Kallel | UCL | LMSR maths, dynamic fee derivation, pitch deck economics |
| Smart Contract Dev | Filippo | UCL | Solidity contracts, testing, deployment to testnet |

**Sponsors:** Flare (FTSO price feeds) · Sui (Smart contracts)

---

## The Problem

Crypto holders currently hedge with stop-losses (reactive), options (expensive, directional), or stablecoins (zero upside). **None of these hedge against regime shifts** — the transition from calm to chaotic markets that cause the most devastating losses (Luna, FTX contagion, March 2020).

## The Solution

VolSwap lets users bet on **volatility regimes** — will the market get more chaotic or calm down?

- **CHAOTIC** — you think 24h realised volatility will increase.
- **CALM** — you think 24h realised volatility will decrease.
- **Simple** — new rounds open every hour, resolve 24 hours later. Correct callers split the pool.

No directional exposure. No complex options Greeks. Just volatility.

---

## Architecture

```
Binance API (ETH, BTC, SOL — 1h OHLCV)
    │
    ▼
Feature Engineering (Python / ccxt)
  • 14 features per asset: 8 self + 6 cross-asset
  • realised_vol_24h, vol_of_vol, volume_zscore, hl_range, GARCH(1,1)
    │
    ▼
Regime Classifier (XGBoost + Platt Scaling)
  • One calibrated model per asset (ETH, BTC, SOL)
  • Trained on HMM-generated ground truth labels
  • Output: P(HIGH_VOL), P(LOW_VOL), Shannon entropy
    │
    ▼
Inference API (FastAPI, off-chain)
  • GET /predict/{asset}  — single-asset prediction
  • GET /predict/all      — all three assets in one call
  • Live data fetch → feature build → XGBoost → calibrated probs
    │
    ▼
Oracle Bridge (push_update.py)
  • Fetches prediction from inference API
  • Signs & pushes to RegimeOracle.sol on-chain
  • Model hash verification + commit-reveal
    │
    ▼
Smart Contract Layer (Solidity — Base Sepolia)
  • RegimeOracle.sol      — on-chain regime probability store
  • MultiverseMarket.sol  — round-based LMSR AMM with entropy-adaptive fees
  • HedgeVault.sol        — deposit ETH, auto-hedge with CHAOTIC tokens
    │
    ▼
Frontend (Next.js 14 + wagmi v2 + viem + RainbowKit)
  • Live regime gauges for ETH, BTC, SOL
  • Hourly rounds: pick CHAOTIC or CALM, 0.5% fee
  • Vault deposit with hedge ratio slider
```

### Round Lifecycle

1. **Open** — A new round opens every hour, snapshotting the current 24h realised volatility.
2. **Trading** — Users have 1 hour to bet CHAOTIC or CALM. Multiple rounds overlap.
3. **Resolution** — 24 hours after open, actual vol is compared to the snapshot. If vol increased, CHAOTIC wins. If vol decreased, CALM wins.
4. **Payout** — Winners split the entire round pool proportionally.

### Tamper-Proofing

1. **Commit-Reveal** — Oracle commits `keccak256(probs || nonce)` at block N, reveals at N+k.
2. **Model Hash On-Chain** — `SHA-256(model_weights)` stored at deployment; mismatches are rejected.
3. **Stretch Goal** — ZK proof of inference via EZKL.

---

## Key Innovation: Entropy-Adaptive Fees

The AMM trading fee **scales with Shannon entropy** of the model output:

$$H = -\sum_i p_i \log(p_i)$$

$$\text{fee} = 0.5\% + 4.5\% \times \frac{H}{H_{\max}}$$

| Model State | Entropy | Fee | Rationale |
|---|---|---|---|
| Very confident | < 0.3 | ~0.5% | Tight spread — reward trading on clear signal |
| Moderate | 0.3–0.6 | ~2.0% | Standard spread |
| Uncertain | > 0.6 | ~5.0% | Wide spread — protect LPs from noise |

**No existing prediction market (Polymarket, Augur, Gnosis) adapts fees to model confidence.**

---

## ML Pipeline

### Feature Engineering (14 features per asset)

| Category | Features |
|----------|----------|
| Self (8) | `log_return`, `realised_vol_24h`, `realised_vol_7d`, `vol_of_vol`, `volume_zscore`, `hl_range`, `garch_vol`, `garch_resid` |
| Cross (6) | `{other}_log_return`, `{other}_realised_vol_24h`, `{other}_volume_zscore` × 2 other assets |

### Model Stack

```
Binance 1h OHLCV (720 bars)
    │
    ├── HMM (2-state Gaussian) → ground truth labels per asset
    │       Uses only: realised_vol_24h, vol_of_vol
    │       Saved to: ml/data/labelled_{asset}.csv
    │
    └── XGBoost + Platt Scaling → calibrated regime probabilities
            Uses all 14 features (self + cross-asset)
            Saved to: ml/models/xgb_{asset}.joblib
```

- **Assets:** ETH, BTC, SOL (each gets its own model)
- **Data source:** Binance via ccxt, 1h candles
- **Outputs:** `p_high_vol`, `p_low_vol`, `entropy`, `regime`, `confidence`, `realised_vol_24h`

---

## Quick Start

### One-Command Launch

```bash
python launch.py
```

This will:
1. Install Python & Node dependencies (if missing)
2. Train HMM + XGBoost for all three assets (skipped if models exist)
3. Start the Inference API on **http://localhost:8000**
4. Start the Frontend on **http://localhost:3000**

Press `Ctrl+C` to stop all services.

#### Launcher Flags

| Flag | Description |
|------|-------------|
| `--skip-train` | Skip training, launch servers only (models must exist) |
| `--skip-deps` | Skip pip/npm install (fastest start) |
| `--force-train` | Retrain all models from scratch |
| `--train-only` | Train models without starting servers |

### Manual Setup

<details>
<summary>Step-by-step (if you prefer not using the launcher)</summary>

#### ML Pipeline
```bash
pip install -r requirements.txt

# Train HMM labels + XGBoost classifiers for all assets
cd ml
python -m src.train_pipeline

# Or train a single asset
python -m src.train_pipeline --asset eth

# Launch inference API
uvicorn src.inference:app --reload --port 8000 --app-dir ml
```

#### Smart Contracts (Foundry)
```bash
cd contracts
forge install
forge build
forge test
```

#### Oracle Bridge
```bash
cd oracle
python push_update.py
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

</details>

---

## Repo Structure

```
volswap/
├── ml/
│   ├── data/                    # HMM-labelled CSVs (ETH, BTC, SOL)
│   ├── models/                  # Trained XGBoost + feature columns
│   │   ├── xgb_{asset}.joblib
│   │   └── xgb_{asset}_feature_cols.json
│   ├── notebooks/               # EDA, training, evaluation
│   ├── outputs/                 # Feature importance & calibration plots
│   └── src/
│       ├── features.py          # Multi-asset feature engineering (14 cols)
│       ├── garch.py             # GARCH(1,1) volatility fitting
│       ├── hmm.py               # HMM baseline for ground truth labels
│       ├── xgboost_model.py     # XGBoost + Platt scaling per asset
│       ├── train_pipeline.py    # End-to-end training orchestrator
│       └── inference.py         # FastAPI multi-asset inference service
├── contracts/
│   ├── src/
│   │   ├── RegimeOracle.sol     # On-chain regime probability store
│   │   ├── MultiverseMarket.sol # Round-based LMSR AMM
│   │   └── HedgeVault.sol       # Auto-hedge vault
│   ├── test/
│   └── foundry.toml
├── oracle/
│   ├── push_update.py           # Push predictions on-chain
│   └── chainlink/               # Chainlink Functions config
├── frontend/
│   ├── app/
│   │   ├── page.tsx             # Main page (VolSwap branding)
│   │   ├── layout.tsx           # Root layout + metadata
│   │   ├── providers.tsx        # wagmi + RainbowKit providers
│   │   └── globals.css          # Tailwind + custom styles
│   ├── components/
│   │   ├── RegimeGauge.tsx      # CALM/CHAOS probability gauge
│   │   ├── TradePanel.tsx       # Place bets (CHAOTIC / CALM)
│   │   ├── VaultDeposit.tsx     # Vault deposit + hedge slider
│   │   └── AssetSelector.tsx    # ETH / BTC / SOL switcher
│   ├── lib/
│   │   ├── api.ts               # Prediction polling + demo fallback
│   │   ├── types.ts             # Asset types + constants
│   │   └── contracts.ts         # ABIs + contract addresses
│   └── public/
│       └── logo.svg             # VolSwap V logo
├── docs/
│   └── architecture.md
├── launch.py                    # One-command launcher
├── requirements.txt             # All Python dependencies
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| ML | Python, XGBoost, scikit-learn, hmmlearn, arch (GARCH), ccxt |
| API | FastAPI, uvicorn, Pydantic |
| Contracts | Solidity ^0.8.20, Foundry |
| Frontend | Next.js 14 (App Router), TypeScript, TailwindCSS |
| Wallet | wagmi v2, viem, RainbowKit (Base Sepolia) |
| Oracle | web3.py, Chainlink Functions (roadmap) |

---

## Economic Pitch

### Market Size
- Crypto derivatives: ~$3T daily volume
- Prediction markets: Polymarket hit $1B+ monthly volume in 2024
- Regime-based hedging: underserved niche with institutional demand

### Revenue Model
1. **Trading fees:** 0.5–5% per trade (entropy-adaptive), split between LPs and protocol
2. **Vault management fee:** 0.5% annual on AUM
3. **Data/API access:** Sell regime probability feed to lending protocols (auto-adjust LTV ratios)

### Scalability Path
- **Phase 1 (Hackathon):** Multi-asset vol regimes (ETH, BTC, SOL), binary outcome, Base Sepolia
- **Phase 2:** Multi-regime (Low/Medium/High/Crisis), mainnet deployment
- **Phase 3:** Cross-chain, institutional API, lending protocol integration
- **Phase 4:** Regime derivatives — options on regime tokens

### Competitive Moat
- **Data flywheel:** More trading → better price discovery → better regime estimates → more traders
- **Model improvement:** Trading data → labelled outcomes → retrain ML → better predictions
- **Network effects:** Integration as regime oracle creates switching costs

---

## Status

- [x] Project scaffolding & architecture
- [x] Multi-asset feature engineering (14 features, 3 assets)
- [x] HMM baseline (ground truth labels for ETH, BTC, SOL)
- [x] XGBoost regime classifiers (Platt-scaled, per asset)
- [x] FastAPI inference API (multi-asset, live data)
- [x] RegimeOracle.sol
- [x] MultiverseMarket.sol (LMSR + entropy-adaptive fees + hourly rounds)
- [x] HedgeVault.sol
- [x] Oracle bridge script
- [x] Frontend — VolSwap branding, CHAOTIC/CALM betting, regime gauges
- [x] One-command launcher (`launch.py`)
- [ ] Foundry tests
- [ ] Base Sepolia deployment
- [ ] Calibration plots & model transparency page
- [ ] Pitch deck

---

## License

MIT
