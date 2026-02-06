# Finance Multiverse — Prediction Market Volatility Index

> *"What if you could buy insurance not against a price drop, but against the market becoming unpredictable?"*

A regime-based volatility hedging protocol combining ML-driven regime detection, an LMSR prediction market, and an automated hedging vault — built for **ETH Oxford 2026**.

---

## Team

| Role | Name | University | Deliverables |
|------|------|------------|--------------|
| ML Lead | Tom Cawdron | LSE (Mathematics with Data Science) | Feature engineering, GRU training, calibration, inference API |
| Quant / Econ | Ilyes Kallel | UCL | LMSR maths, dynamic fee derivation, pitch deck economics |
| Smart Contract Dev | Filippo | UCL | Solidity contracts, testing, deployment to testnet |

**Sponsors:** Flare (FTSO price feeds) · Sui (Smart contracts)

---

## The Problem

Crypto holders currently hedge with stop-losses (reactive), options (expensive, directional), or stablecoins (zero upside). **None of these hedge against regime shifts** — the transition from calm to chaotic markets that cause the most devastating losses (Luna, FTX contagion, March 2020).

## The Solution

Finance Multiverse lets users buy **regime tokens** — assets that pay out when the market transitions to a high-volatility regime:

- **Cheaper than options** — regime exposure only, no directional premium.
- **Proactive** — ML model detects early signals of regime change before price moves.
- **Intuitive** — "I think markets are about to get crazy" is a natural belief to trade on.

---

## Architecture

```
Raw Data (Binance API / CoinGecko)
    │
    ▼
Feature Engineering (Python)
  • 30-day realised vol, log returns, vol-of-vol, funding rates
    │
    ▼
Regime Classifier (PyTorch)
  • GRU with 2-state softmax: P(HighVol), P(LowVol)
  • Trained on HMM-generated ground truth labels
    │
    ▼
Inference Engine (FastAPI, off-chain)
  • Runs every epoch (e.g., every 4 hours)
  • Outputs: regime_probs, confidence, Shannon entropy
    │
    ▼
Oracle Bridge (Chainlink Functions / Custom)
  • Signs inference result, pushes to RegimeOracle.sol
  • Commit-reveal for tamper-proofing
    │
    ▼
Smart Contract Layer (Solidity — Base / Arbitrum)
  • RegimeOracle.sol   — on-chain regime probability store
  • MultiverseMarket.sol — LMSR AMM with entropy-adaptive fees
  • HedgeVault.sol      — deposit ETH, auto-hedge with regime tokens
    │
    ▼
Frontend (Next.js + wagmi + viem)
  • Live regime probability gauge
  • Trade interface for conditional tokens
  • Vault deposit with hedge ratio slider
```

### Tamper-Proofing

1. **Commit-Reveal** — Oracle commits `keccak256(probs || nonce)` at block N, reveals at N+k.
2. **Model Hash On-Chain** — `keccak256(model_weights)` stored at deployment; updates need governance.
3. **Stretch Goal** — ZK proof of inference via EZKL.

---

## Key Innovation: Entropy-Adaptive Fees

The AMM trading fee **scales with Shannon entropy** of the model output:

$$H = -\sum_i p_i \log(p_i)$$

| Model State | Entropy | Fee | Rationale |
|---|---|---|---|
| Very confident | < 0.3 | 0.5% | Tight spread — reward trading on clear signal |
| Moderate | 0.3–0.6 | 2.0% | Standard spread |
| Uncertain | > 0.6 | 5.0% | Wide spread — protect LPs from noise |

**No existing prediction market (Polymarket, Augur, Gnosis) adapts fees to model confidence.** This is novel, mathematically grounded, and demonstrates depth at the intersection of ML and market microstructure.

---

## Quick Start

### ML Pipeline
```bash
cd ml
pip install -r requirements.txt

# Train HMM baseline (generates ground truth labels)
python src/hmm.py

# Train GRU regime classifier
python src/gru.py

# Launch inference API
uvicorn src.inference:app --reload --port 8000
```

### Smart Contracts (Foundry)
```bash
cd contracts
forge install
forge build
forge test
```

### Oracle Bridge
```bash
cd oracle
python push_update.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Repo Structure

```
finance-multiverse/
├── ml/
│   ├── data/               # Raw and processed data
│   ├── models/             # Saved model weights
│   ├── notebooks/          # EDA, training, evaluation
│   ├── src/
│   │   ├── features.py     # Feature engineering pipeline
│   │   ├── hmm.py          # HMM baseline for ground truth labels
│   │   ├── gru.py          # GRU regime classifier (PyTorch)
│   │   └── inference.py    # FastAPI inference service
│   └── requirements.txt
├── contracts/
│   ├── src/
│   │   ├── RegimeOracle.sol
│   │   ├── MultiverseMarket.sol
│   │   └── HedgeVault.sol
│   ├── test/
│   └── foundry.toml
├── oracle/
│   ├── push_update.py      # Push model output on-chain
│   └── chainlink/          # Chainlink Functions config
├── frontend/
│   ├── app/                # Next.js app router
│   ├── components/
│   │   ├── RegimeGauge.tsx  # Probability gauge visualisation
│   │   ├── TradePanel.tsx   # Buy/sell regime tokens
│   │   └── VaultDeposit.tsx # Vault deposit + hedge slider
│   └── lib/
│       └── contracts.ts     # ABIs and contract addresses
├── docs/
│   └── architecture.md
└── README.md
```

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
- **Phase 1 (Hackathon):** ETH vol regimes, binary outcome, single chain
- **Phase 2:** Multi-asset (BTC, SOL), multi-regime (Low/Medium/High/Crisis)
- **Phase 3:** Cross-chain, institutional API, lending protocol integration
- **Phase 4:** Regime derivatives — options on regime tokens

### Competitive Moat
- **Data flywheel:** More trading → better price discovery → better regime estimates → more traders
- **Model improvement:** Trading data → labelled outcomes → retrain ML → better predictions
- **Network effects:** Integration as regime oracle creates switching costs

---

## Status

- [x] Project scaffolding
- [x] Architecture design
- [x] Feature engineering pipeline
- [x] HMM baseline (ground truth labels)
- [x] GRU regime classifier
- [x] Inference API (FastAPI)
- [x] RegimeOracle.sol
- [x] MultiverseMarket.sol (LMSR + entropy-adaptive fees)
- [x] HedgeVault.sol
- [x] Oracle bridge script
- [x] Frontend components
- [ ] Foundry tests
- [ ] Testnet deployment
- [ ] Calibration plots & model transparency page
- [ ] Pitch deck

---

## License

MIT
