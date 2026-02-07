"""
Multi-Asset XGBoost Regime Classifier with Platt-Scaling Calibration.

Trains one XGBoost model **per asset** on 14 features (8 self + 6 cross)
using HMM-generated regime labels.  Platt scaling is applied so that
``predict_proba`` returns well-calibrated probabilities for the LMSR AMM.

Artefacts per asset (saved to ml/models/ and ml/outputs/):
    xgb_{asset}.joblib              — calibrated XGBoost pipeline
    xgb_{asset}_feature_cols.json   — ordered feature column list
    feature_importance_{asset}.png  — bar chart
    calibration_{asset}.png         — reliability diagram

Usage:
    python -m src.xgboost_model               # train all 3
    python -m src.xgboost_model --asset eth   # single asset
"""

import argparse
import json
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    log_loss,
    roc_auc_score,
)
from xgboost import XGBClassifier

try:
    from src.features import (
        ASSETS, ASSET_SHORT, get_all_feature_cols,
    )
except ImportError:
    from features import (
        ASSETS, ASSET_SHORT, get_all_feature_cols,
    )


# ---------------------------------------------------------------------------
# Paths & Config
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "outputs"
MODEL_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

TRAIN_RATIO: float = 0.8
RANDOM_SEED: int = 42

XGB_PARAMS: dict = {
    "n_estimators": 300,
    "max_depth": 5,
    "learning_rate": 0.05,
    "eval_metric": "logloss",
    "random_state": RANDOM_SEED,
    "verbosity": 1,
}


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_labelled_data(asset_short: str) -> pd.DataFrame:
    """Load the HMM-labelled feature CSV for one asset."""
    path = DATA_DIR / f"labelled_{asset_short}.csv"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Run the HMM labelling step first."
        )
    return pd.read_csv(path, index_col=0, parse_dates=True)


# ---------------------------------------------------------------------------
# Training (per-asset)
# ---------------------------------------------------------------------------

def train_xgboost(
    df: pd.DataFrame,
    feature_cols: list[str],
) -> tuple:
    """
    Train XGBoost + Platt scaling on a temporal train/val split.

    If the default 80/20 temporal split produces a single-class training
    set (e.g. all HIGH_VOL at the tail), the split is adjusted backwards
    to guarantee at least some minority-class samples in training.

    Returns (calibrated_model, X_val, y_val, feature_cols)
    """
    # Verify all feature columns present
    missing = [c for c in feature_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing feature columns: {missing}")

    features = df[feature_cols].values
    labels = df["regime_label"].values

    split = int(len(features) * TRAIN_RATIO)

    # Ensure train set has both classes; slide split forward if needed
    # (when minority class is clustered at the tail of the time series)
    y_train_cand = labels[:split]
    if len(np.unique(y_train_cand)) < 2:
        minority = 1 if y_train_cand.sum() == 0 else 0
        minority_indices = np.where(labels == minority)[0]
        if len(minority_indices) > 0:
            # Include at least 20% of minority samples in training
            min_count = max(3, len(minority_indices) // 5)
            # Place split after the min_count-th minority sample
            new_split = int(minority_indices[min(min_count - 1, len(minority_indices) - 1)]) + 1
            # Leave at least 30 samples for validation
            new_split = min(new_split, len(features) - 30)
            print(f"  [WARN] Adjusted split {split} → {new_split} to include both classes in training.")
            split = new_split

    X_train, X_val = features[:split], features[split:]
    y_train, y_val = labels[:split], labels[split:]

    n_pos = int(y_train.sum())
    n_neg = len(y_train) - n_pos
    scale_pos_weight = n_neg / max(n_pos, 1)

    print(f"  Train: {len(X_train)} samples  |  Val: {len(X_val)} samples")
    print(f"  Class balance — LOW_VOL: {n_neg}, HIGH_VOL: {n_pos}")
    print(f"  scale_pos_weight = {scale_pos_weight:.3f}")
    print(f"  Features: {len(feature_cols)} columns")

    xgb = XGBClassifier(**XGB_PARAMS, scale_pos_weight=scale_pos_weight)
    calibrated = CalibratedClassifierCV(xgb, method="sigmoid", cv=3)
    calibrated.fit(X_train, y_train)

    return calibrated, X_val, y_val, feature_cols


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate_model(
    model: CalibratedClassifierCV,
    X_val: np.ndarray,
    y_val: np.ndarray,
) -> dict[str, float]:
    """Compute accuracy, log-loss, and AUC on the validation set."""
    y_pred = model.predict(X_val)
    proba_raw = model.predict_proba(X_val)

    # Handle case where model only saw 1 class → predict_proba returns (n,1)
    if proba_raw.shape[1] == 1:
        # Model only knows one class; create a 2-col array
        y_proba = np.zeros(len(X_val))
    elif proba_raw.shape[1] == 2:
        y_proba = proba_raw[:, 1]
    else:
        y_proba = proba_raw[:, 1]

    acc = accuracy_score(y_val, y_pred)
    ll = log_loss(y_val, y_proba, labels=[0, 1]) if len(np.unique(y_val)) > 1 else float("nan")
    auc = roc_auc_score(y_val, y_proba) if len(np.unique(y_val)) > 1 else float("nan")

    print(f"\n  Accuracy:  {acc:.4f}")
    print(f"  Log-loss:  {ll:.4f}")
    print(f"  AUC:       {auc:.4f}")

    unique_labels = sorted(set(y_val))
    names = [["LOW_VOL", "HIGH_VOL"][i] for i in unique_labels]
    print("\n  Classification Report:")
    print(classification_report(y_val, y_pred, labels=unique_labels, target_names=names))

    return {"accuracy": acc, "log_loss": ll, "auc": auc}


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

def plot_calibration_curve(
    model, X_val, y_val, asset_short: str,
) -> None:
    proba_raw = model.predict_proba(X_val)
    if proba_raw.shape[1] < 2:
        print("  [WARN] Model outputs single class — skipping calibration curve.")
        return
    y_proba = proba_raw[:, 1]
    if len(np.unique(y_val)) < 2:
        print("  [WARN] Single-class val set — skipping calibration curve.")
        return

    fraction_pos, mean_predicted = calibration_curve(y_val, y_proba, n_bins=10)
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot([0, 1], [0, 1], "k--", label="Perfectly calibrated")
    ax.plot(mean_predicted, fraction_pos, "s-", label="XGBoost + Platt")
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Fraction of positives")
    ax.set_title(f"Calibration Curve — {asset_short.upper()} HIGH_VOL")
    ax.legend()
    fig.tight_layout()
    path = OUTPUT_DIR / f"calibration_{asset_short}.png"
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Calibration curve → {path}")


def plot_feature_importance(
    model, feature_cols: list[str], asset_short: str,
) -> None:
    base_xgb = model.calibrated_classifiers_[0].estimator
    importances = base_xgb.feature_importances_
    indices = np.argsort(importances)[::-1]

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh(range(len(feature_cols)), importances[indices[::-1]], align="center")
    ax.set_yticks(range(len(feature_cols)))
    ax.set_yticklabels([feature_cols[i] for i in indices[::-1]])
    ax.set_xlabel("Feature Importance (gain)")
    ax.set_title(f"XGBoost Feature Importance — {asset_short.upper()}")
    fig.tight_layout()
    path = OUTPUT_DIR / f"feature_importance_{asset_short}.png"
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Feature importance → {path}")


# ---------------------------------------------------------------------------
# Save / Load
# ---------------------------------------------------------------------------

def save_model(
    model, feature_cols: list[str], asset_short: str,
) -> Path:
    """Persist calibrated model + feature column order for one asset."""
    model_path = MODEL_DIR / f"xgb_{asset_short}.joblib"
    joblib.dump(model, model_path)
    print(f"  Model saved → {model_path}")

    cols_path = MODEL_DIR / f"xgb_{asset_short}_feature_cols.json"
    with open(cols_path, "w") as f:
        json.dump(feature_cols, f)
    print(f"  Feature cols → {cols_path}")

    return model_path


def load_model(asset_short: str = "eth") -> tuple:
    """Load calibrated XGBoost model and feature column list for one asset."""
    model_path = MODEL_DIR / f"xgb_{asset_short}.joblib"
    cols_path = MODEL_DIR / f"xgb_{asset_short}_feature_cols.json"

    if not model_path.exists():
        raise FileNotFoundError(
            f"{model_path} not found. Train the {asset_short} model first."
        )

    model = joblib.load(model_path)
    with open(cols_path) as f:
        feature_cols = json.load(f)

    return model, feature_cols


# ---------------------------------------------------------------------------
# Per-asset training entry point
# ---------------------------------------------------------------------------

def train_asset(
    asset_symbol: str,
    df: pd.DataFrame | None = None,
) -> None:
    """
    Full training pipeline for one asset: load data, train, evaluate,
    plot, save.

    Parameters
    ----------
    asset_symbol : str
        e.g. "ETH/USDT"
    df : pd.DataFrame | None
        Pre-loaded labelled DataFrame. If None, loads from CSV.
    """
    short = ASSET_SHORT[asset_symbol]
    feature_cols = get_all_feature_cols(asset_symbol)

    print(f"\n{'='*60}")
    print(f"  XGBoost Training — {asset_symbol} ({short})")
    print(f"{'='*60}")

    # 1. Load data
    if df is None:
        print(f"\n[1/6] Loading labelled data for {short} …")
        df = load_labelled_data(short)
    else:
        print(f"\n[1/6] Using provided labelled DataFrame …")
    print(f"  {len(df)} samples, {len(feature_cols)} features")

    # 1b. Stationarity check
    if "log_return" in df.columns:
        from statsmodels.tsa.stattools import adfuller
        adf_stat, adf_p, *_ = adfuller(df["log_return"].dropna())
        print(f"  ADF test on log_return: stat={adf_stat:.4f}, p={adf_p:.6f}")
        assert adf_p < 0.05, (
            f"Log returns non-stationary (p={adf_p:.4f}). "
            "GARCH assumption violated."
        )
        print("  Stationarity check passed ✓")

    # 2. Train
    print(f"\n[2/6] Training XGBoost + Platt calibration …")
    model, X_val, y_val, feat_cols = train_xgboost(df, feature_cols)

    # 3. Evaluate
    print(f"\n[3/6] Evaluating …")
    metrics = evaluate_model(model, X_val, y_val)

    # 4. Plots
    print(f"\n[4/6] Generating plots …")
    plot_calibration_curve(model, X_val, y_val, short)
    plot_feature_importance(model, feat_cols, short)

    # 5. Save
    print(f"\n[5/6] Saving artefacts …")
    save_model(model, feat_cols, short)

    # 6. Interface check
    sample = X_val[:1]
    proba = model.predict_proba(sample)
    assert proba.shape[0] == 1, f"Expected 1 row, got {proba.shape[0]}"
    assert proba.shape[1] >= 1, f"Expected ≥1 col, got {proba.shape[1]}"
    print(f"\n[6/6] Interface check: predict_proba → shape {proba.shape}, "
          f"sum={proba.sum():.6f} ✓")


def train_all() -> None:
    """Train XGBoost for all assets (loading from saved CSVs)."""
    for sym in ASSETS:
        train_asset(sym)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="XGBoost regime classifier training")
    parser.add_argument(
        "--asset", type=str, default=None,
        help="Single asset short name (eth/btc/sol). Omit for all.",
    )
    args = parser.parse_args()

    np.random.seed(RANDOM_SEED)

    if args.asset:
        short_to_sym = {v: k for k, v in ASSET_SHORT.items()}
        sym = short_to_sym.get(args.asset.lower())
        if sym is None:
            print(f"Unknown asset: {args.asset}. Use eth/btc/sol.")
            return
        train_asset(sym)
    else:
        train_all()

    print("\nDone ✓")


if __name__ == "__main__":
    main()
