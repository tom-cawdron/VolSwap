"""
Feature Engineering Pipeline for Regime Detection.

Fetches OHLCV data from Binance via ccxt and computes volatility features
used by both the HMM baseline and the GRU classifier.
"""

import numpy as np
import pandas as pd
import ccxt
from typing import Optional


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


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Full feature engineering pipeline.

    Returns a DataFrame with columns:
        log_return, realised_vol_24h, realised_vol_168h,
        vol_of_vol, volume_zscore, hl_range
    """
    df = add_log_returns(df)
    df = add_realised_vol(df, windows=[24, 168])
    df = add_vol_of_vol(df, window=48)
    df = add_volume_zscore(df, window=168)
    df = add_high_low_range(df)
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


# Feature columns used by models
FEATURE_COLS = [
    "realised_vol_24h",
    "realised_vol_168h",
    "vol_of_vol",
    "volume_zscore",
    "hl_range",
]


if __name__ == "__main__":
    print("Fetching ETH/USDT 1h data …")
    df = get_feature_df()
    print(f"Shape: {df.shape}")
    print(df[FEATURE_COLS].describe())
