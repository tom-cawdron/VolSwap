"""
Multi-Asset Feature Engineering Pipeline for Regime Detection.

Fetches OHLCV data from Binance via ccxt for ETH/USDT, BTC/USDT, and
SOL/USDT, and computes per-asset self-features plus cross-asset features
used by the HMM labeller and XGBoost classifier.

Feature structure per model (14 columns):
    8 self-features   — base technical + GARCH(1,1)
    3 cross-features  — from other asset 1
    3 cross-features  — from other asset 2

Isolation rules:
    - HMM  only sees [realised_vol_24h, vol_of_vol] from the target asset.
    - GARCH is fitted only on the target asset's own returns.
    - Cross-asset features are XGBoost inputs only.
"""

import logging
from typing import Optional

import ccxt
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Asset universe
# ---------------------------------------------------------------------------

ASSETS: list[str] = ["ETH/USDT", "BTC/USDT", "SOL/USDT"]

# Short prefix used for cross-feature column naming
ASSET_PREFIX: dict[str, str] = {
    "ETH/USDT": "eth",
    "BTC/USDT": "btc",
    "SOL/USDT": "sol",
}

# Canonical short name (used in file/model naming)
ASSET_SHORT: dict[str, str] = {
    "ETH/USDT": "eth",
    "BTC/USDT": "btc",
    "SOL/USDT": "sol",
}


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


def fetch_all_ohlcv(
    symbols: list[str] | None = None,
    timeframe: str = "1h",
    limit: int = 5000,
    exchange_id: str = "binance",
) -> dict[str, pd.DataFrame]:
    """
    Fetch OHLCV for all assets in one go.

    Returns a dict keyed by symbol, e.g. {"ETH/USDT": df, ...}.
    """
    if symbols is None:
        symbols = ASSETS
    data: dict[str, pd.DataFrame] = {}
    for sym in symbols:
        logger.info("Fetching %s %s (limit=%d) …", sym, timeframe, limit)
        data[sym] = fetch_ohlcv(sym, timeframe, limit, exchange_id)
    return data


# ---------------------------------------------------------------------------
# Self-feature computation (per-asset)
# ---------------------------------------------------------------------------

def add_log_returns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["log_return"] = np.log(df["close"] / df["close"].shift(1))
    return df


def add_realised_vol(df: pd.DataFrame, windows: list[int] | None = None) -> pd.DataFrame:
    df = df.copy()
    if windows is None:
        windows = [24, 168]
    for w in windows:
        df[f"realised_vol_{w}h"] = df["log_return"].rolling(w).std() * np.sqrt(w)
    return df


def add_vol_of_vol(df: pd.DataFrame, window: int = 48) -> pd.DataFrame:
    df = df.copy()
    df["vol_of_vol"] = df["realised_vol_24h"].rolling(window).std()
    return df


def add_volume_zscore(df: pd.DataFrame, window: int = 168) -> pd.DataFrame:
    df = df.copy()
    roll_mean = df["volume"].rolling(window).mean()
    roll_std = df["volume"].rolling(window).std()
    df["volume_zscore"] = (df["volume"] - roll_mean) / roll_std
    return df


def add_abs_log_return(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["abs_log_return"] = df["log_return"].abs()
    return df


def compute_base_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute base technical features on any asset's OHLCV data.

    Returns the DataFrame with added columns:
        log_return, realised_vol_24h, realised_vol_168h,
        vol_of_vol, volume_zscore, abs_log_return
    """
    df = add_log_returns(df)
    df = add_realised_vol(df, windows=[24, 168])
    df = add_vol_of_vol(df, window=48)
    df = add_volume_zscore(df, window=168)
    df = add_abs_log_return(df)
    return df


def compute_garch_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute GARCH(1,1) features on any asset's data.

    Expects df to already have a 'log_return' column.
    Returns a new DataFrame (same index) with GARCH columns.
    """
    try:
        from garch import extract_garch_features
    except ImportError:
        from src.garch import extract_garch_features

    return extract_garch_features(df)


def compute_self_features(df: pd.DataFrame, include_garch: bool = True) -> pd.DataFrame:
    """
    Full self-feature pipeline for one asset: base + optional GARCH.

    Parameters
    ----------
    df : pd.DataFrame
        Raw OHLCV data for a single asset.
    include_garch : bool
        Whether to append GARCH(1,1) features.

    Returns
    -------
    pd.DataFrame with all self-feature columns (NaN rows NOT dropped).
    """
    df = compute_base_features(df)

    if include_garch:
        logger.info("Computing GARCH(1,1) features …")
        garch_df = compute_garch_features(df)
        df = pd.concat([df, garch_df], axis=1)

    return df


# ---------------------------------------------------------------------------
# Cross-asset features
# ---------------------------------------------------------------------------

def compute_cross_features(
    target_returns: pd.Series,
    other_ohlcv: pd.DataFrame,
    prefix: str,
    corr_window: int = 24,
) -> pd.DataFrame:
    """
    Compute 3 cross-features from another asset relative to the target.

    Parameters
    ----------
    target_returns : pd.Series
        log_return series of the target asset (aligned index).
    other_ohlcv : pd.DataFrame
        Raw OHLCV of the other asset.
    prefix : str
        Column prefix, e.g. "btc" → "btc_realised_vol_24h".
    corr_window : int
        Rolling window (hours) for return correlation.

    Returns
    -------
    pd.DataFrame with columns:
        {prefix}_realised_vol_24h
        {prefix}_log_return
        {prefix}_corr_24h
    """
    other = add_log_returns(other_ohlcv)

    other_ret = other["log_return"]
    other_rvol = other_ret.rolling(24).std() * np.sqrt(24)

    # Align indices
    common = target_returns.index.intersection(other_ret.index)
    t_ret = target_returns.reindex(common)
    o_ret = other_ret.reindex(common)

    corr = t_ret.rolling(corr_window).corr(o_ret)

    cross = pd.DataFrame(index=common)
    cross[f"{prefix}_realised_vol_24h"] = other_rvol.reindex(common)
    cross[f"{prefix}_log_return"] = o_ret
    cross[f"{prefix}_corr_24h"] = corr

    return cross


# ---------------------------------------------------------------------------
# Full feature matrix builder
# ---------------------------------------------------------------------------

def build_feature_matrix(
    target_symbol: str,
    all_ohlcv: dict[str, pd.DataFrame],
    include_garch: bool = True,
) -> pd.DataFrame:
    """
    Build the complete 14-column feature DataFrame for one target asset.

    Parameters
    ----------
    target_symbol : str
        e.g. "ETH/USDT"
    all_ohlcv : dict[str, pd.DataFrame]
        OHLCV data keyed by symbol for all assets.
    include_garch : bool
        Whether to compute GARCH features on the target.

    Returns
    -------
    pd.DataFrame
        Rows with NaN dropped. Columns = 8 self + 6 cross features.
    """
    target_df = compute_self_features(all_ohlcv[target_symbol].copy(), include_garch=include_garch)

    # Determine other assets
    other_symbols = [s for s in all_ohlcv if s != target_symbol]

    cross_frames: list[pd.DataFrame] = []
    for other_sym in other_symbols:
        prefix = ASSET_PREFIX[other_sym]
        cross = compute_cross_features(
            target_returns=target_df["log_return"],
            other_ohlcv=all_ohlcv[other_sym].copy(),
            prefix=prefix,
        )
        cross_frames.append(cross)

    # Join cross-features onto target
    for cf in cross_frames:
        target_df = target_df.join(cf, how="left")

    target_df.dropna(inplace=True)
    return target_df


def get_other_symbols(target: str) -> list[str]:
    """Return the two other asset symbols for a given target."""
    return [s for s in ASSETS if s != target]


def get_cross_prefixes(target: str) -> list[str]:
    """Return sorted cross-feature prefixes for a target asset."""
    others = get_other_symbols(target)
    return sorted([ASSET_PREFIX[s] for s in others])


def get_cross_feature_cols(target: str) -> list[str]:
    """Return the 6 cross-feature column names for a target asset."""
    cols: list[str] = []
    for prefix in get_cross_prefixes(target):
        cols.extend([
            f"{prefix}_realised_vol_24h",
            f"{prefix}_log_return",
            f"{prefix}_corr_24h",
        ])
    return cols


# ---------------------------------------------------------------------------
# Feature column lists
# ---------------------------------------------------------------------------

# HMM input — only pure volatility (NO cross, NO GARCH)
HMM_FEATURE_COLS: list[str] = [
    "realised_vol_24h",
    "vol_of_vol",
]

# Base technical self-features
SELF_BASE_COLS: list[str] = [
    "realised_vol_24h",
    "realised_vol_168h",
    "vol_of_vol",
    "volume_zscore",
    "abs_log_return",
]

# GARCH self-features
GARCH_COLS: list[str] = [
    "sigma_t",
    "garch_alpha",
    "garch_beta",
    "garch_persistence",
    "standardised_residual",
]

# All 8 self-features for XGBoost
SELF_FEATURE_COLS: list[str] = SELF_BASE_COLS + GARCH_COLS


def get_all_feature_cols(target: str) -> list[str]:
    """
    Return the full ordered 14-column feature list for a target asset.

    8 self-features + 6 cross-features (3 per other asset, sorted by prefix).
    This is the definitive column order for both training and inference.
    """
    return SELF_FEATURE_COLS + get_cross_feature_cols(target)


# Keep backward compat aliases
FEATURE_COLS = SELF_BASE_COLS
ALL_FEATURE_COLS = SELF_FEATURE_COLS


if __name__ == "__main__":
    print("Fetching all assets …")
    all_data = fetch_all_ohlcv(limit=1000)
    for sym in ASSETS:
        short = ASSET_SHORT[sym]
        cols = get_all_feature_cols(sym)
        print(f"\n{sym} feature columns ({len(cols)}):")
        for c in cols:
            print(f"  {c}")
        df = build_feature_matrix(sym, all_data)
        print(f"  Matrix shape: {df.shape}")
