# Finance Multiverse — Architecture

## System Overview

Finance Multiverse is a regime-based volatility hedging protocol with four layers:

1. **ML Layer** — Off-chain regime detection
2. **Oracle Bridge** — Trust-minimised data relay
3. **Smart Contract Layer** — On-chain market + vault
4. **Frontend** — User-facing dashboard and trading UI

---

## Layer 1: ML Pipeline

### Data Flow

```
Binance API (ETH/USDT 1h candles)
    │
    ▼
features.py — Feature Engineering
    │  log_return, realised_vol (24h, 7d), vol_of_vol, volume_zscore, hl_range
    │
    ├──▶ hmm.py — HMM Baseline (2-state Gaussian)
    │       Produces ground-truth regime labels: 0 = LOW_VOL, 1 = HIGH_VOL
    │       Saved to: ml/data/labelled_features.csv
    │
    └──▶ gru.py — GRU Classifier (PyTorch)
            Input:  sliding windows of 48h features
            Output: softmax [P(LOW_VOL), P(HIGH_VOL)]
            Trained on HMM labels with temporal train/val split
            Saved to: ml/models/regime_gru.pt
```

### Model Architecture

```
RegimeGRU(
  gru: GRU(input=5, hidden=64, layers=2, dropout=0.2)
  fc:  Linear(64 → 2)
  out: Softmax(dim=-1)
)
```

- **Input:** 48 × 5 feature tensor (48 hours, 5 features)
- **Output:** [P(LOW_VOL), P(HIGH_VOL)] probability vector
- **Training:** Cross-entropy vs HMM labels, Adam optimiser, ReduceLROnPlateau

### Inference Service

`inference.py` runs a FastAPI server:

- `GET /predict` — Full loop: fetch data → engineer features → normalise → GRU → return probs
- `GET /health` — Status check
- Response includes: `p_high_vol`, `p_low_vol`, `entropy`, `regime`, `confidence`, `model_hash`

---

## Layer 2: Oracle Bridge

### Architecture

```
FastAPI /predict
    │
    ▼
push_update.py
    │  1. Fetch prediction from inference API
    │  2. Compute model hash (SHA-256 of weights file)
    │  3. Build & sign pushUpdate() transaction
    │  4. Send to RegimeOracle.sol
    │
    ▼
RegimeOracle.sol (on-chain)
```

### Trust Model

| Level | Mechanism | Status |
|-------|-----------|--------|
| L1 | Single operator key | ✅ Implemented |
| L2 | Commit-reveal (tamper-proofing) | ✅ Implemented |
| L3 | Model hash verification | ✅ Implemented |
| L4 | Chainlink Functions (decentralised) | 🔧 Config ready |
| L5 | ZK proof of inference (EZKL) | 📋 Roadmap |

---

## Layer 3: Smart Contracts

### Contract Dependency Graph

```
RegimeOracle
    │
    ├──▶ MultiverseMarket (reads regime probs + entropy)
    │       │
    │       └──▶ HedgeVault (buys HIGH_VOL tokens)
    │
    └── (standalone oracle, no dependencies)
```

### RegimeOracle.sol

- Stores latest `RegimeUpdate { pHighVol, pLowVol, entropy, timestamp, modelHash }`
- All values scaled by 1e18
- Model hash registered at deployment; updates rejected if mismatch
- Commit-reveal: `postCommit(hash)` → later `pushUpdate()` can be verified

### MultiverseMarket.sol (LMSR AMM)

**Pricing (Logarithmic Market Scoring Rule):**

$$C(q) = b \cdot \ln\bigl(e^{q_H/b} + e^{q_L/b}\bigr)$$

$$P(\text{HIGH\_VOL}) = \frac{e^{q_H/b}}{e^{q_H/b} + e^{q_L/b}}$$

- `b` = liquidity parameter (higher → deeper liquidity, less price sensitivity)
- `qHigh`, `qLow` = outstanding token quantities

**Entropy-Adaptive Fee:**

$$\text{fee} = 0.5\% + 4.5\% \times \frac{H}{H_{\max}}$$

where $H = -\sum p_i \log p_i$ is Shannon entropy and $H_{\max} = \ln 2$.

| Model Confidence | Entropy | Fee |
|------------------|---------|-----|
| High | < 0.3 | ~0.5% |
| Moderate | 0.3–0.6 | ~2% |
| Low | > 0.6 | ~5% |

**Round lifecycle:**
- New rounds open every hour with a 1-hour trading window
- `tradingDuration = 1 hour`, `resolutionDelay = 25 hours` (1h trading + 24h waiting)
- Multiple rounds overlap: while round N awaits resolution, rounds N+1, N+2, … can be open

**Trading flow:**
1. User calls `buyOutcome(isHighVol, amount)` during the 1-hour trading window
2. Contract computes LMSR cost difference
3. Applies flat 0.5 fee
4. Mints tokens to buyer
5. Excess ETH refunded

**Resolution:**
- Anyone calls `resolveRound(roundId)` after resolutionTime (25h after round open)
- Compares current 24h realised vol (from oracle) against the snapshot vol from round open
- HIGH wins if realised vol increased, LOW wins if it decreased
- Winners call `claimPayout(roundId)`

### HedgeVault.sol

- User deposits ETH with `hedgeRatio` (0–30%, in basis points)
- `hedgeRatio%` of deposit → buys HIGH_VOL tokens via MultiverseMarket
- Remainder held as base ETH position
- If HIGH_VOL regime materialises → hedge tokens pay out, offsetting drawdown

---

## Layer 4: Frontend

### Tech Stack

- Next.js 14 (App Router)
- wagmi v2 + viem (wallet connection, contract reads/writes)
- TailwindCSS (styling)

### Components

| Component | Purpose |
|-----------|---------|
| `RegimeGauge` | SVG speedometer showing P(HIGH_VOL) vs P(LOW_VOL), entropy meter |
| `TradePanel` | Buy HIGH_VOL / LOW_VOL tokens, shows LMSR prices + dynamic fee |
| `VaultDeposit` | Deposit ETH with hedge ratio slider, shows allocation + projected payoffs |

### Contract Integration

[frontend/lib/contracts.ts](../frontend/lib/contracts.ts) exports:
- Contract addresses (from env vars)
- Full typed ABIs for all three contracts
- Used by wagmi hooks (`useReadContract`, `useWriteContract`)

---

## Deployment

### Local Development

```bash
# Terminal 1: Local chain
cd contracts && anvil

# Terminal 2: Deploy contracts
forge script script/Deploy.s.sol --broadcast --rpc-url http://localhost:8545

# Terminal 3: ML inference
cd ml && uvicorn src.inference:app --reload --port 8000

# Terminal 4: Oracle bridge
cd oracle && python push_update.py --loop --interval 60

# Terminal 5: Frontend
cd frontend && npm run dev
```

### Testnet (Base Sepolia / Arbitrum Sepolia)

1. Set `RPC_URL` and `PRIVATE_KEY` in `.env`
2. Deploy contracts via Foundry
3. Deploy inference API (Railway / Render / EC2)
4. Run `push_update.py` as a cron job or systemd service
5. Set `NEXT_PUBLIC_*` env vars in frontend and deploy (Vercel)
