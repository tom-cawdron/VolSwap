"""
Hidden Markov Model (HMM) Baseline for Regime Detection.

Fits a 2-state Gaussian HMM on volatility features to produce
ground-truth regime labels used to train the XGBoost classifier.

Migration note (Feb 2026):
    - Added explicit label-swap check (means_[0] > means_[1] → swap)
      to guarantee label 1 = HIGH_VOL regardless of HMM initialisation.
    - Output CSV now includes GARCH(1,1) features alongside the base
      technical features, ready for direct consumption by xgboost_model.py.

Usage:
    python -m src.hmm          # run from ml/ directory
    python ml/src/hmm.py       # run from repo root
"""

import os
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from hmmlearn.hmm import GaussianHMM

try:
    from src.features import HMM_FEATURE_COLS, get_feature_df
except ImportError:
    from features import HMM_FEATURE_COLS, get_feature_df


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"
MODEL_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# HMM Training
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

    # Identify which state has higher mean of the first feature (realised_vol_24h)
    means = model.means_[:, 0]  # first feature = realised_vol_24h
    high_state = int(np.argmax(means))

    # Remap: high_state → 1, other → 0
    if high_state == 1:
        return raw_labels  # already correct
    return 1 - raw_labels  # flip


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("HMM Regime Detection — Ground Truth Label Generation")
    print("=" * 60)

    # 1. Fetch and engineer features (including GARCH)
    print("\n[1/4] Fetching data and engineering features (incl. GARCH) …")
    df = get_feature_df(symbol="ETH/USDT", timeframe="1h", limit=5000)
    hmm_features = df[HMM_FEATURE_COLS].values
    print(f"  HMM input features: {HMM_FEATURE_COLS}")
    print(f"  HMM feature matrix shape: {hmm_features.shape}")
    print(f"  Total columns (with GARCH): {len(df.columns)}")

    # 2. Fit HMM (only on pure volatility features — no GARCH inputs)
    print("\n[2/4] Fitting 2-state Gaussian HMM …")
    model = fit_hmm(hmm_features)
    print(f"  Converged: {model.monitor_.converged}")
    print(f"  Log-likelihood: {model.score(hmm_features):.2f}")
    print(f"  State means:\n{model.means_}")

    # 3. Label regimes
    print("\n[3/4] Generating regime labels …")
    df["regime_label"] = label_regimes(model, hmm_features)
    regime_counts = df["regime_label"].value_counts()
    print(f"  LOW_VOL (0): {regime_counts.get(0, 0)} samples")
    print(f"  HIGH_VOL (1): {regime_counts.get(1, 0)} samples")

    # 4. Save artefacts
    print("\n[4/4] Saving artefacts …")
    hmm_path = MODEL_DIR / "hmm_baseline.pkl"
    with open(hmm_path, "wb") as f:
        pickle.dump(model, f)
    print(f"  HMM model → {hmm_path}")

    labelled_path = DATA_DIR / "labelled_features.csv"
    df.to_csv(labelled_path)
    print(f"  Labelled data → {labelled_path}")

    # Quick visualisation
    fig, axes = plt.subplots(2, 1, figsize=(14, 6), sharex=True)
    axes[0].plot(df.index, df["realised_vol_24h"], linewidth=0.6)
    axes[0].set_ylabel("Realised Vol (24h)")
    axes[0].set_title("ETH/USDT Realised Volatility with HMM Regime Labels")

    colours = df["regime_label"].map({0: "steelblue", 1: "crimson"})
    axes[1].scatter(df.index, df["realised_vol_24h"], c=colours, s=1, alpha=0.7)
    axes[1].set_ylabel("Realised Vol (24h)")
    axes[1].set_xlabel("Time")

    fig.tight_layout()
    plot_path = DATA_DIR / "hmm_regimes.png"
    fig.savefig(plot_path, dpi=150)
    print(f"  Plot → {plot_path}")
    plt.close(fig)

    print("\nDone ✓")


if __name__ == "__main__":
    main()
