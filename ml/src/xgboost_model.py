"""
XGBoost Regime Classifier with Platt-Scaling Calibration.

Replaces the previous GRU classifier.  Trains an XGBoost model on the
combined feature set (technical volatility features + GARCH(1,1) outputs)
using HMM-generated regime labels as targets.

Post-training, Platt scaling (``CalibratedClassifierCV``, method='sigmoid')
is applied so that ``predict_proba`` outputs well-calibrated probabilities
suitable for direct use in the LMSR AMM.

Artefacts saved to ``ml/models/``:
    - xgb_regime.joblib         — calibrated XGBoost pipeline
    - xgb_feature_cols.json     — ordered feature column list

Artefacts saved to ``ml/outputs/``:
    - feature_importance.png    — XGBoost feature importance bar chart
    - calibration_curve.png     — reliability diagram

Migration note (Feb 2026):
    NEW file — replaces gru.py as the regime classifier.
    Output interface (probability vector) is identical; downstream
    oracle / contracts / frontend are unaffected.

Usage:
    python -m src.xgboost_model     # from ml/
    python ml/src/xgboost_model.py  # from repo root
"""

import json
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")  # non-interactive backend for CI / headless
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
    from src.features import FEATURE_COLS
    from src.garch import GARCH_FEATURE_COLS
except ImportError:
    from features import FEATURE_COLS
    from garch import GARCH_FEATURE_COLS


# ---------------------------------------------------------------------------
# Paths & Config
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "outputs"
MODEL_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Combined feature set: base technical + GARCH
ALL_FEATURE_COLS: list[str] = FEATURE_COLS + GARCH_FEATURE_COLS

TRAIN_RATIO: float = 0.8
RANDOM_SEED: int = 42

# XGBoost hyperparameters
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

def load_labelled_data() -> pd.DataFrame:
    """Load the HMM-labelled + GARCH-enriched feature CSV."""
    path = DATA_DIR / "labelled_features.csv"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Run `python -m src.hmm` first."
        )
    df = pd.read_csv(path, index_col=0, parse_dates=True)

    # Verify GARCH columns are present
    missing = [c for c in ALL_FEATURE_COLS if c not in df.columns]
    if missing:
        raise ValueError(
            f"Missing feature columns in data: {missing}. "
            "Re-run hmm.py (which now includes GARCH features)."
        )

    return df


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_xgboost(
    df: pd.DataFrame,
) -> tuple:
    """
    Train XGBoost + Platt scaling on a temporal train/val split.

    Returns
    -------
    (calibrated_model, X_val, y_val, feature_cols)
    """
    features = df[ALL_FEATURE_COLS].values
    labels = df["regime_label"].values

    split = int(len(features) * TRAIN_RATIO)
    X_train, X_val = features[:split], features[split:]
    y_train, y_val = labels[:split], labels[split:]

    # Handle class imbalance
    n_pos = int(y_train.sum())
    n_neg = len(y_train) - n_pos
    scale_pos_weight = n_neg / max(n_pos, 1)

    print(f"  Train: {len(X_train)} samples  |  Val: {len(X_val)} samples")
    print(f"  Class balance — LOW_VOL: {n_neg}, HIGH_VOL: {n_pos}")
    print(f"  scale_pos_weight = {scale_pos_weight:.3f}")

    # Base XGBoost
    xgb = XGBClassifier(
        **XGB_PARAMS,
        scale_pos_weight=scale_pos_weight,
    )

    # Platt scaling via cross-validated calibration on the training set.
    # This internally trains XGBoost + fits a sigmoid calibration layer.
    calibrated = CalibratedClassifierCV(xgb, method="sigmoid", cv=3)
    calibrated.fit(X_train, y_train)

    return calibrated, X_val, y_val, ALL_FEATURE_COLS


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
    y_proba = model.predict_proba(X_val)[:, 1]

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
    model: CalibratedClassifierCV,
    X_val: np.ndarray,
    y_val: np.ndarray,
    save_path: Path | None = None,
) -> None:
    """Reliability diagram (calibration curve)."""
    y_proba = model.predict_proba(X_val)[:, 1]

    if len(np.unique(y_val)) < 2:
        print("  [WARN] Single-class validation set — skipping calibration curve.")
        return

    fraction_pos, mean_predicted = calibration_curve(y_val, y_proba, n_bins=10)

    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot([0, 1], [0, 1], "k--", label="Perfectly calibrated")
    ax.plot(mean_predicted, fraction_pos, "s-", label="XGBoost + Platt")
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Fraction of positives")
    ax.set_title("Calibration Curve — HIGH_VOL Regime")
    ax.legend()
    fig.tight_layout()

    path = save_path or OUTPUT_DIR / "calibration_curve.png"
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Calibration curve → {path}")


def plot_feature_importance(
    model: CalibratedClassifierCV,
    feature_cols: list[str],
    save_path: Path | None = None,
) -> None:
    """Bar chart of XGBoost feature importances (gain)."""
    # Unwrap the calibrated model to get the base XGBoost estimator
    # CalibratedClassifierCV with cv=int stores calibrated_classifiers_
    base_xgb = model.calibrated_classifiers_[0].estimator
    importances = base_xgb.feature_importances_
    indices = np.argsort(importances)[::-1]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.barh(
        range(len(feature_cols)),
        importances[indices[::-1]],
        align="center",
    )
    ax.set_yticks(range(len(feature_cols)))
    ax.set_yticklabels([feature_cols[i] for i in indices[::-1]])
    ax.set_xlabel("Feature Importance (gain)")
    ax.set_title("XGBoost Regime Classifier — Feature Importance")
    fig.tight_layout()

    path = save_path or OUTPUT_DIR / "feature_importance.png"
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Feature importance → {path}")


# ---------------------------------------------------------------------------
# Save / Load
# ---------------------------------------------------------------------------

def save_model(
    model: CalibratedClassifierCV,
    feature_cols: list[str],
) -> Path:
    """Persist calibrated model + feature column order."""
    model_path = MODEL_DIR / "xgb_regime.joblib"
    joblib.dump(model, model_path)
    print(f"  Model saved → {model_path}")

    cols_path = MODEL_DIR / "xgb_feature_cols.json"
    with open(cols_path, "w") as f:
        json.dump(feature_cols, f)
    print(f"  Feature cols → {cols_path}")

    return model_path


def load_model() -> tuple:
    """Load calibrated XGBoost model and feature column list."""
    model_path = MODEL_DIR / "xgb_regime.joblib"
    cols_path = MODEL_DIR / "xgb_feature_cols.json"

    if not model_path.exists():
        raise FileNotFoundError(
            f"{model_path} not found. Run `python -m src.xgboost_model` first."
        )

    model = joblib.load(model_path)
    with open(cols_path) as f:
        feature_cols = json.load(f)

    return model, feature_cols


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    np.random.seed(RANDOM_SEED)

    print("=" * 60)
    print("XGBoost Regime Classifier — Training")
    print("=" * 60)

    # 1. Load data
    print("\n[1/6] Loading labelled data …")
    df = load_labelled_data()
    print(f"  {len(df)} samples, {len(ALL_FEATURE_COLS)} features")

    # 1b. Stationarity check (ADF test on log returns)
    if "log_return" in df.columns:
        from statsmodels.tsa.stattools import adfuller
        adf_stat, adf_p, *_ = adfuller(df["log_return"].dropna())
        print(f"  ADF test on log_return: stat={adf_stat:.4f}, p={adf_p:.6f}")
        assert adf_p < 0.05, (
            f"Log returns are non-stationary (p={adf_p:.4f}). "
            "GARCH assumption violated — investigate data."
        )
        print("  Stationarity check passed ✓")

    # 2. Train
    print("\n[2/6] Training XGBoost + Platt calibration …")
    model, X_val, y_val, feat_cols = train_xgboost(df)

    # 3. Evaluate
    print("\n[3/6] Evaluating …")
    metrics = evaluate_model(model, X_val, y_val)

    # 4. Plots
    print("\n[4/6] Generating plots …")
    plot_calibration_curve(model, X_val, y_val)
    plot_feature_importance(model, feat_cols)

    # 5. Save
    print("\n[5/6] Saving artefacts …")
    save_model(model, feat_cols)

    # Verify output shape matches interface contract
    sample = X_val[:1]
    proba = model.predict_proba(sample)
    assert proba.shape == (1, 2), f"Expected (1,2), got {proba.shape}"
    assert abs(proba.sum() - 1.0) < 1e-6, "Probabilities don't sum to 1"
    print(f"\n  Interface check: predict_proba → shape {proba.shape}, "
          f"sum={proba.sum():.6f} ✓")

    print("\nDone ✓")


if __name__ == "__main__":
    main()
