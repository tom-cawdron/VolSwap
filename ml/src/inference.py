"""
Multi-Asset FastAPI Inference Service for Regime Prediction.

Endpoints:
    GET  /predict/{asset}  — regime prediction for one asset (eth, btc, sol)
    GET  /predict/all      — predictions for all three assets in one call
    GET  /health           — health check

Models are loaded once at startup and cached.  Each request fetches
live OHLCV data for all three assets (needed for cross-features),
builds the 14-feature vector for the target, and runs the calibrated
XGBoost model.

Output JSON schema per asset is UNCHANGED from the single-asset version.

Usage:
    uvicorn src.inference:app --reload --port 8000 --app-dir ml
"""

import hashlib
import logging
import time
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from src.features import (
        ASSETS, ASSET_SHORT, fetch_all_ohlcv,
        build_feature_matrix, get_all_feature_cols,
    )
    from src.xgboost_model import load_model
except ImportError:
    from features import (
        ASSETS, ASSET_SHORT, fetch_all_ohlcv,
        build_feature_matrix, get_all_feature_cols,
    )
    from xgboost_model import load_model

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models"

# Valid asset short names
VALID_ASSETS: set[str] = set(ASSET_SHORT.values())  # {"eth", "btc", "sol"}

# Reverse lookup: short name → symbol
SHORT_TO_SYMBOL: dict[str, str] = {v: k for k, v in ASSET_SHORT.items()}

MIN_ROWS: int = 1


# ---------------------------------------------------------------------------
# App & response schema
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Finance Multiverse — Regime Inference",
    description="Multi-asset regime probabilities from XGBoost classifiers.",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegimePrediction(BaseModel):
    asset: str
    p_high_vol: float
    p_low_vol: float
    entropy: float
    regime: str
    confidence: float
    realised_vol_24h: float
    timestamp: int
    model_hash: str


class AllPredictions(BaseModel):
    predictions: list[RegimePrediction]
    timestamp: int


class HealthResponse(BaseModel):
    status: str
    models_loaded: dict[str, bool]


# ---------------------------------------------------------------------------
# Model cache (loaded once at startup)
# ---------------------------------------------------------------------------

_models: dict[str, Any] = {}           # short_name → calibrated model
_feature_cols: dict[str, list[str]] = {}  # short_name → column list
_model_hashes: dict[str, str] = {}     # short_name → sha256 hex


def _load_all_models() -> None:
    """Load XGBoost models for all available assets."""
    for short in VALID_ASSETS:
        model_path = MODEL_DIR / f"xgb_{short}.joblib"
        if not model_path.exists():
            logger.warning("Model for %s not found at %s — skipping.", short, model_path)
            continue
        try:
            model, cols = load_model(short)
            _models[short] = model
            _feature_cols[short] = cols
            _model_hashes[short] = hashlib.sha256(model_path.read_bytes()).hexdigest()
            logger.info("Loaded %s model (%d features).", short, len(cols))
        except Exception as e:
            logger.error("Failed to load %s model: %s", short, e)


def get_model(short: str) -> Any:
    if short not in _models:
        raise HTTPException(
            status_code=503,
            detail=f"Model for {short} not loaded. Train it first.",
        )
    return _models[short]


# ---------------------------------------------------------------------------
# Shared prediction logic
# ---------------------------------------------------------------------------

def _predict_asset(
    short: str,
    all_ohlcv: dict,
) -> RegimePrediction:
    """Run prediction for a single asset given pre-fetched OHLCV data."""
    model = get_model(short)
    symbol = SHORT_TO_SYMBOL[short]
    feature_cols = _feature_cols[short]

    # Build feature matrix (all 14 columns)
    df = build_feature_matrix(symbol, all_ohlcv, include_garch=True)
    if len(df) < MIN_ROWS:
        raise HTTPException(
            status_code=500,
            detail=f"Not enough data for {short} after feature engineering: {len(df)}",
        )

    # Latest row, fill NaN safety net
    latest_row = df[feature_cols].iloc[[-1]].fillna(0.0).values

    # Predict — handle models that only saw 1 class during training
    proba = model.predict_proba(latest_row)  # (1, 2) or (1, 1)
    if proba.shape[1] == 2:
        p_low = float(proba[0, 0])
        p_high = float(proba[0, 1])
    else:
        # Degenerate model — single class known
        known_class = model.classes_[0]
        p_high = 1.0 if known_class == 1 else 0.0
        p_low = 1.0 - p_high

    # Shannon entropy
    eps = 1e-9
    entropy = -float(p_low * np.log(p_low + eps) + p_high * np.log(p_high + eps))
    confidence = max(p_high, p_low)
    regime = "HIGH_VOL" if p_high > p_low else "LOW_VOL"

    # Extract current realised 24h volatility
    rv_col = "realised_vol_24h"
    realised_vol = float(df[rv_col].iloc[-1]) if rv_col in df.columns else 0.0

    return RegimePrediction(
        asset=short,
        p_high_vol=round(p_high, 6),
        p_low_vol=round(p_low, 6),
        entropy=round(entropy, 6),
        regime=regime,
        confidence=round(confidence, 6),
        realised_vol_24h=round(realised_vol, 6),
        timestamp=int(time.time()),
        model_hash=_model_hashes.get(short, ""),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup() -> None:
    _load_all_models()
    loaded = list(_models.keys())
    print(f"Models loaded: {loaded if loaded else 'NONE'}")
    if not loaded:
        print("WARNING: No models found. Train models before calling /predict.")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        models_loaded={short: short in _models for short in VALID_ASSETS},
    )


@app.get("/predict/all", response_model=AllPredictions)
async def predict_all() -> AllPredictions:
    """Predict regimes for all three assets in one call."""
    try:
        all_ohlcv = fetch_all_ohlcv(limit=720)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {e}")

    predictions: list[RegimePrediction] = []
    for short in sorted(VALID_ASSETS):
        if short not in _models:
            continue
        pred = _predict_asset(short, all_ohlcv)
        predictions.append(pred)

    return AllPredictions(
        predictions=predictions,
        timestamp=int(time.time()),
    )


@app.get("/predict/{asset}", response_model=RegimePrediction)
async def predict(asset: str) -> RegimePrediction:
    """Predict regime for a single asset."""
    short = asset.lower()
    if short not in VALID_ASSETS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown asset '{asset}'. Valid: {sorted(VALID_ASSETS)}",
        )

    try:
        all_ohlcv = fetch_all_ohlcv(limit=720)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {e}")

    return _predict_asset(short, all_ohlcv)
