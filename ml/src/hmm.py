"""
Multi-Asset HMM Regime Detection — Ground Truth Label Generation.

Fits a 2-state Gaussian HMM **per asset** on that asset's own
[realised_vol_24h, vol_of_vol] to produce ground-truth regime labels.

Isolation rule:
    HMM only sees self-asset volatility features.
    No cross-asset features. No GARCH features.

Artefacts per asset:
    models/hmm_{asset}.pkl          — fitted HMM model
    data/labelled_{asset}.csv       — full feature matrix + regime_label
    data/hmm_regimes_{asset}.png    — regime visualisation

Usage:
    python -m src.hmm                   # all 3 assets
    python -m src.hmm --asset eth       # single asset
"""

import argparse
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from hmmlearn.hmm import GaussianHMM

try:
    from src.features import (
        ASSETS, ASSET_SHORT, HMM_FEATURE_COLS,
        build_feature_matrix, fetch_all_ohlcv,
    )
except ImportError:
    from features import (
        ASSETS, ASSET_SHORT, HMM_FEATURE_COLS,
        build_feature_matrix, fetch_all_ohlcv,
    )

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"
MODEL_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# HMM Training (generic, per-asset)
# ---------------------------------------------------------------------------

def fit_hmm(
    features: np.ndarray,
    n_components: int = 2,
    n_iter: int = 200,
    covariance_type: str = "full",
    random_state: int = 42,
) -> GaussianHMM:
    """Fit a Gaussian HMM on the feature matrix."""
    model = GaussianHMM(
        n_components=n_components,
        covariance_type=covariance_type,
        n_iter=n_iter,
        random_state=random_state,
    )
    model.fit(features)
    return model


def label_regimes(model: GaussianHMM, features: np.ndarray) -> np.ndarray:
    """
    Predict regime labels and ensure label 1 = HIGH_VOL.

    The HMM assigns arbitrary label indices.  We remap so that the state
    with the higher mean realised-vol gets label 1 (HIGH_VOL).
    """
    raw_labels = model.predict(features)
    means = model.means_[:, 0]  # first feature = realised_vol_24h
    high_state = int(np.argmax(means))
    if high_state == 1:
        return raw_labels
    return 1 - raw_labels


def fit_hmm_for_asset(
    asset_symbol: str,
    feature_df: pd.DataFrame,
) -> tuple[GaussianHMM, pd.DataFrame]:
    """
    Fit HMM for one asset and add regime_label column to its feature df.

    Parameters
    ----------
    asset_symbol : str
        e.g. "ETH/USDT"
    feature_df : pd.DataFrame
        Full feature matrix (from build_feature_matrix) for this asset.

    Returns
    -------
    (model, labelled_df)
    """
    short = ASSET_SHORT[asset_symbol]
    print(f"\n--- HMM for {asset_symbol} ({short}) ---")

    # HMM only sees self-asset volatility features
    hmm_features = feature_df[HMM_FEATURE_COLS].values
    print(f"  HMM input features: {HMM_FEATURE_COLS}")
    print(f"  HMM feature matrix shape: {hmm_features.shape}")

    model = fit_hmm(hmm_features)
    print(f"  Converged: {model.monitor_.converged}")
    print(f"  Log-likelihood: {model.score(hmm_features):.2f}")
    print(f"  State means:\n{model.means_}")

    feature_df = feature_df.copy()
    feature_df["regime_label"] = label_regimes(model, hmm_features)
    counts = feature_df["regime_label"].value_counts()
    print(f"  LOW_VOL (0): {counts.get(0, 0)} | HIGH_VOL (1): {counts.get(1, 0)}")

    # Save model
    hmm_path = MODEL_DIR / f"hmm_{short}.pkl"
    with open(hmm_path, "wb") as f:
        pickle.dump(model, f)
    print(f"  Model → {hmm_path}")

    # Save labelled CSV
    csv_path = DATA_DIR / f"labelled_{short}.csv"
    feature_df.to_csv(csv_path)
    print(f"  Data  → {csv_path}")

    # Plot
    fig, axes = plt.subplots(2, 1, figsize=(14, 6), sharex=True)
    axes[0].plot(feature_df.index, feature_df["realised_vol_24h"], linewidth=0.6)
    axes[0].set_ylabel("Realised Vol (24h)")
    axes[0].set_title(f"{asset_symbol} Realised Volatility with HMM Regime Labels")

    colours = feature_df["regime_label"].map({0: "steelblue", 1: "crimson"})
    axes[1].scatter(feature_df.index, feature_df["realised_vol_24h"], c=colours, s=1, alpha=0.7)
    axes[1].set_ylabel("Realised Vol (24h)")
    axes[1].set_xlabel("Time")

    fig.tight_layout()
    plot_path = DATA_DIR / f"hmm_regimes_{short}.png"
    fig.savefig(plot_path, dpi=150)
    plt.close(fig)
    print(f"  Plot  → {plot_path}")

    return model, feature_df


def fit_all_hmms(
    all_ohlcv: dict[str, pd.DataFrame] | None = None,
) -> dict[str, pd.DataFrame]:
    """
    Fit HMM for all assets. Returns dict of labelled DataFrames.

    If all_ohlcv is None, fetches data automatically.
    """
    if all_ohlcv is None:
        print("[1/2] Fetching data for all assets …")
        all_ohlcv = fetch_all_ohlcv(limit=5000)

    print("[2/2] Building features and fitting HMMs …")
    labelled: dict[str, pd.DataFrame] = {}
    for sym in ASSETS:
        df = build_feature_matrix(sym, all_ohlcv, include_garch=True)
        _, labelled_df = fit_hmm_for_asset(sym, df)
        labelled[sym] = labelled_df

    return labelled


# ---------------------------------------------------------------------------
# Main (standalone usage)
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="HMM regime labelling")
    parser.add_argument(
        "--asset", type=str, default=None,
        help="Single asset short name (eth/btc/sol). Omit for all.",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("HMM Regime Detection — Ground Truth Label Generation")
    print("=" * 60)

    if args.asset:
        short_to_sym = {v: k for k, v in ASSET_SHORT.items()}
        sym = short_to_sym.get(args.asset.lower())
        if sym is None:
            print(f"Unknown asset: {args.asset}. Use eth/btc/sol.")
            return
        print(f"\nFetching data for {sym} (+ cross-asset data) …")
        all_ohlcv = fetch_all_ohlcv(limit=5000)
        df = build_feature_matrix(sym, all_ohlcv, include_garch=True)
        fit_hmm_for_asset(sym, df)
    else:
        fit_all_hmms()

    print("\nDone ✓")


if __name__ == "__main__":
    main()
