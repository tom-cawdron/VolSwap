"""
Feature Engineering Pipeline for Regime Detection.

Fetches OHLCV data from Binance via ccxt and computes volatility features
used by the HMM labeller and the XGBoost classifier.

Migration note (Feb 2026):
    Updated to integrate GARCH(1,1) features from ``garch.py``.
    The ``engineer_features`` function now appends GARCH outputs to the
    feature matrix.  Downstream callers (inference, training) are
    unaffected — they simply see extra columns.
"""

import logging
from typing import Optional

import ccxt
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_ohlcv(
    symbol: str = "ETH/USDT",
    timeframe: str = "1h",
    limit: int = 5000,
    exchange_id: str = "binance",
) -> pd.DataFrame:
    """Fetch OHLCV candles from a ccxt-supported exchange."""
    exchange = getattr(ccxt, exchange_id)()
    raw = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df.set_index("timestamp", inplace=True)
    return df


# ---------------------------------------------------------------------------
# Feature computation
# ---------------------------------------------------------------------------

def add_log_returns(df: pd.DataFrame) -> pd.DataFrame:
    """Add log-return column."""
    df = df.copy()
    df["log_return"] = np.log(df["close"] / df["close"].shift(1))
    return df


def add_realised_vol(df: pd.DataFrame, windows: list[int] | None = None) -> pd.DataFrame:
    """Annualised realised volatility over rolling windows (in hours)."""
    df = df.copy()
    if windows is None:
        windows = [24, 168]  # 1-day, 7-day
    for w in windows:
        col = f"realised_vol_{w}h"
        df[col] = df["log_return"].rolling(w).std() * np.sqrt(w)
    return df


def add_vol_of_vol(df: pd.DataFrame, window: int = 48) -> pd.DataFrame:
    """Volatility-of-volatility (rolling std of 24h realised vol)."""
    df = df.copy()
    df["vol_of_vol"] = df["realised_vol_24h"].rolling(window).std()
    return df


def add_volume_zscore(df: pd.DataFrame, window: int = 168) -> pd.DataFrame:
    """Z-score of trading volume over a rolling window."""
    df = df.copy()
    roll_mean = df["volume"].rolling(window).mean()
    roll_std = df["volume"].rolling(window).std()
    df["volume_zscore"] = (df["volume"] - roll_mean) / roll_std
    return df


def add_high_low_range(df: pd.DataFrame) -> pd.DataFrame:
    """Normalised high-low range (Parkinson-style proxy)."""
    df = df.copy()
    df["hl_range"] = (df["high"] - df["low"]) / df["close"]
    return df


def add_abs_log_return(df: pd.DataFrame) -> pd.DataFrame:
    """Absolute log return — clean shock-magnitude signal."""
    df = df.copy()
    df["abs_log_return"] = df["log_return"].abs()
    return df


def engineer_features(
    df: pd.DataFrame,
    include_garch: bool = True,
) -> pd.DataFrame:
    """
    Full feature engineering pipeline.

    Returns a DataFrame with columns:
        log_return, realised_vol_24h, realised_vol_168h,
        vol_of_vol, volume_zscore, abs_log_return
        + GARCH(1,1) features when *include_garch* is True:
        sigma_t, garch_alpha, garch_beta, garch_persistence,
        standardised_residual
    """
    df = add_log_returns(df)
    df = add_realised_vol(df, windows=[24, 168])
    df = add_vol_of_vol(df, window=48)
    df = add_volume_zscore(df, window=168)
    df = add_abs_log_return(df)

    if include_garch:
        try:
            from garch import extract_garch_features
        except ImportError:
            from src.garch import extract_garch_features

        logger.info("Extracting GARCH(1,1) features (rolling window) …")
        garch_df = extract_garch_features(df)
        df = pd.concat([df, garch_df], axis=1)

    df.dropna(inplace=True)
    return df


# ---------------------------------------------------------------------------
# Convenience: fetch + engineer in one call
# ---------------------------------------------------------------------------

def get_feature_df(
    symbol: str = "ETH/USDT",
    timeframe: str = "1h",
    limit: int = 5000,
) -> pd.DataFrame:
    """End-to-end: fetch data and return engineered features."""
    raw = fetch_ohlcv(symbol, timeframe, limit)
    return engineer_features(raw)


# HMM input features — only pure volatility measures to avoid
# heterogeneous-cluster problems with a 2-state Gaussian HMM.
HMM_FEATURE_COLS: list[str] = [
    "realised_vol_24h",
    "vol_of_vol",
]

# Base technical feature columns (used by XGBoost alongside GARCH)
FEATURE_COLS: list[str] = [
    "realised_vol_24h",
    "realised_vol_168h",
    "vol_of_vol",
    "volume_zscore",
    "abs_log_return",
]

# Full feature set including GARCH outputs (used by XGBoost classifier)
GARCH_COLS: list[str] = [
    "sigma_t",
    "garch_alpha",
    "garch_beta",
    "garch_persistence",
    "standardised_residual",
]

ALL_FEATURE_COLS: list[str] = FEATURE_COLS + GARCH_COLS


if __name__ == "__main__":
    print("Fetching ETH/USDT 1h data …")
    df = get_feature_df()
    print(f"Shape: {df.shape}")
    print(df[FEATURE_COLS].describe())
