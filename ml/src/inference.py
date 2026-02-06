"""
FastAPI Inference Service for Regime Prediction.

Endpoints:
    GET  /predict  — fetch latest data, run model, return regime probabilities
    GET  /health   — health check

Usage:
    uvicorn src.inference:app --reload --port 8000
"""

import time
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from features import (
    FEATURE_COLS,
    fetch_ohlcv,
    engineer_features,
)
from gru import RegimeGRU, SEQ_LEN, DEVICE


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models"


# ---------------------------------------------------------------------------
# App & response schema
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Finance Multiverse — Regime Inference",
    description="Returns regime probabilities from the GRU classifier.",
    version="0.1.0",
)


class RegimePrediction(BaseModel):
    p_high_vol: float
    p_low_vol: float
    entropy: float
    regime: str
    confidence: float
    timestamp: int
    model_hash: str


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool


# ---------------------------------------------------------------------------
# Model loading (singleton)
# ---------------------------------------------------------------------------

_model: RegimeGRU | None = None
_feat_mean: np.ndarray | None = None
_feat_std: np.ndarray | None = None
_model_hash: str = ""


def _load_model() -> RegimeGRU:
    global _model, _feat_mean, _feat_std, _model_hash

    weights_path = MODEL_DIR / "regime_gru.pt"
    norm_path = MODEL_DIR / "feature_norm.npz"

    if not weights_path.exists():
        raise FileNotFoundError(
            f"Model weights not found at {weights_path}. Run `python src/gru.py` first."
        )

    model = RegimeGRU(input_dim=len(FEATURE_COLS)).to(DEVICE)
    state_dict = torch.load(weights_path, map_location=DEVICE, weights_only=True)
    model.load_state_dict(state_dict)
    model.eval()

    # Compute model hash (keccak256 proxy — sha256 here for simplicity)
    import hashlib
    raw_bytes = weights_path.read_bytes()
    _model_hash = hashlib.sha256(raw_bytes).hexdigest()

    # Load normalisation params
    if norm_path.exists():
        norms = np.load(norm_path)
        _feat_mean = norms["mean"]
        _feat_std = norms["std"]
    else:
        _feat_mean = np.zeros(len(FEATURE_COLS))
        _feat_std = np.ones(len(FEATURE_COLS))

    _model = model
    return model


def get_model() -> RegimeGRU:
    global _model
    if _model is None:
        _load_model()
    return _model  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    try:
        _load_model()
        print("Model loaded successfully.")
    except FileNotFoundError as e:
        print(f"WARNING: {e}")
        print("Inference will fail until the model is trained.")


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok", model_loaded=_model is not None)


@app.get("/predict", response_model=RegimePrediction)
async def predict():
    """
    Full inference loop:
    1. Fetch latest SEQ_LEN+200 hours of ETH data (buffer for feature warmup)
    2. Engineer features
    3. Normalise
    4. Run GRU
    5. Return regime probabilities + entropy
    """
    model = get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # 1. Fetch data
    try:
        raw_df = fetch_ohlcv("ETH/USDT", "1h", limit=SEQ_LEN + 250)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {e}")

    # 2. Feature engineering
    df = engineer_features(raw_df)
    if len(df) < SEQ_LEN:
        raise HTTPException(
            status_code=500,
            detail=f"Not enough data after feature engineering: {len(df)} < {SEQ_LEN}",
        )

    # 3. Normalise
    features = df[FEATURE_COLS].values[-SEQ_LEN:]
    features = (features - _feat_mean) / (_feat_std + 1e-8)

    # 4. Inference
    x = torch.tensor(features, dtype=torch.float32).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        probs = model(x)  # (1, 2)

    p_low = probs[0, 0].item()
    p_high = probs[0, 1].item()

    # 5. Entropy
    entropy = -float(torch.sum(probs * torch.log(probs + 1e-9)).item())
    confidence = max(p_high, p_low)
    regime = "HIGH_VOL" if p_high > p_low else "LOW_VOL"

    return RegimePrediction(
        p_high_vol=round(p_high, 6),
        p_low_vol=round(p_low, 6),
        entropy=round(entropy, 6),
        regime=regime,
        confidence=round(confidence, 6),
        timestamp=int(time.time()),
        model_hash=_model_hash,
    )
