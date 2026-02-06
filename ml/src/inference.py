"""
FastAPI Inference Service for Regime Prediction.

Endpoints:
    GET  /predict  — fetch latest data, run model, return regime probabilities
    GET  /health   — health check

Migration note (Feb 2026):
    Switched from GRU (PyTorch) to XGBoost + Platt scaling.
    GARCH(1,1) features are now computed at inference time.
    Output JSON schema is UNCHANGED — oracle bridge and frontend
    are fully compatible without modification.

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
from pydantic import BaseModel

try:
    from src.features import ALL_FEATURE_COLS, fetch_ohlcv, engineer_features
    from src.xgboost_model import load_model
except ImportError:
    from features import ALL_FEATURE_COLS, fetch_ohlcv, engineer_features
    from xgboost_model import load_model

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models"

# Minimum rows of engineered data needed for a single prediction
MIN_ROWS: int = 1


# ---------------------------------------------------------------------------
# App & response schema
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Finance Multiverse — Regime Inference",
    description="Returns regime probabilities from the XGBoost classifier.",
    version="0.2.0",
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

_model: Any = None
_feature_cols: list[str] = []
_model_hash: str = ""


def _load_model() -> None:
    global _model, _feature_cols, _model_hash

    model_path = MODEL_DIR / "xgb_regime.joblib"

    if not model_path.exists():
        raise FileNotFoundError(
            f"Model not found at {model_path}. "
            "Run `python -m src.xgboost_model` first."
        )

    _model, _feature_cols = load_model()

    # Compute model hash (sha256)
    raw_bytes = model_path.read_bytes()
    _model_hash = hashlib.sha256(raw_bytes).hexdigest()

    logger.info("XGBoost model loaded (%d features).", len(_feature_cols))


def get_model() -> Any:
    global _model
    if _model is None:
        _load_model()
    return _model


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup() -> None:
    try:
        _load_model()
        print("Model loaded successfully.")
    except FileNotFoundError as e:
        print(f"WARNING: {e}")
        print("Inference will fail until the model is trained.")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", model_loaded=_model is not None)


@app.get("/predict", response_model=RegimePrediction)
async def predict() -> RegimePrediction:
    """
    Full inference loop:
    1. Fetch latest 500 hours of ETH data (buffer for GARCH + feature warmup)
    2. Engineer all features (technical + GARCH)
    3. Extract most-recent row
    4. Run XGBoost predict_proba
    5. Compute entropy
    6. Return JSON — same schema as before migration
    """
    model = get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # 1. Fetch data (720h = 30 days — enough for 168h GARCH burn-in + warm-up)
    try:
        raw_df = fetch_ohlcv("ETH/USDT", "1h", limit=720)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {e}")

    # 2. Full feature engineering including GARCH
    df = engineer_features(raw_df, include_garch=True)
    if len(df) < MIN_ROWS:
        raise HTTPException(
            status_code=500,
            detail=f"Not enough data after feature engineering: {len(df)}",
        )

    # 3. Most-recent feature vector — fill any residual NaN from GARCH
    #    convergence failures so XGBoost never sees missing values
    latest_row = df[_feature_cols].iloc[[-1]].fillna(0.0).values

    # 4. Predict
    proba = model.predict_proba(latest_row)  # shape (1, 2)
    p_low: float = float(proba[0, 0])
    p_high: float = float(proba[0, 1])

    # 5. Shannon entropy
    eps = 1e-9
    entropy = -float(p_low * np.log(p_low + eps) + p_high * np.log(p_high + eps))
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
