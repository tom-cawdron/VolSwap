"""
GARCH(1,1) Feature Generator for Regime Detection.

Fits a GARCH(1,1) model on ETH hourly log returns using the ``arch`` library
and extracts conditional-volatility features for the XGBoost classifier.

Extracted features per timestep:
    - sigma_t:                 conditional volatility estimate
    - garch_alpha:             ARCH coefficient (shock persistence)
    - garch_beta:              GARCH coefficient (volatility persistence)
    - garch_persistence:       alpha + beta (overall persistence)
    - standardised_residual:   epsilon_t / sigma_t (surprise magnitude)

A *rolling* window approach is used so that future information never leaks
into past feature rows.  If GARCH fails to converge for a window, the
function falls back to realised volatility and logs a warning.

Migration note (Feb 2026):
    NEW file — part of HMM → GARCH(1,1) → XGBoost migration.
    Replaces the GRU's implicit temporal modelling with explicit
    volatility-dynamics features.
"""

import warnings
from typing import Optional

import numpy as np
import pandas as pd
from arch import arch_model  # type: ignore[import-untyped]

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GARCH_WINDOW: int = 168          # 7 days of hourly bars for rolling fit
GARCH_P: int = 1
GARCH_Q: int = 1
GARCH_DIST: str = "Normal"      # can also try "StudentsT"

GARCH_FEATURE_COLS: list[str] = [
    "sigma_t",
    "garch_alpha",
    "garch_beta",
    "garch_persistence",
    "standardised_residual",
]


# ---------------------------------------------------------------------------
# Core fitting
# ---------------------------------------------------------------------------

def fit_garch_single(
    log_returns: np.ndarray,
    p: int = GARCH_P,
    q: int = GARCH_Q,
    dist: str = GARCH_DIST,
) -> dict[str, float]:
    """
    Fit a GARCH(p, q) model on a window of log returns.

    Returns a dict with sigma_t (last conditional vol), alpha, beta,
    persistence, and the last standardised residual.

    If the model fails to converge, returns a fallback dict using
    realised volatility as the sigma_t estimate.
    """
    # Scale returns to percentage for numerical stability (arch convention)
    # Convert to pandas Series as arch_model requires it
    scaled = pd.Series(log_returns * 100.0)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            am = arch_model(scaled, vol="Garch", p=p, q=q, dist=dist, mean="Zero")
            res = am.fit(disp="off", show_warning=False)

        alpha: float = float(res.params.get("alpha[1]", 0.0))
        beta: float = float(res.params.get("beta[1]", 0.0))
        cond_vol = res.conditional_volatility
        sigma_t: float = float(cond_vol.iloc[-1]) / 100.0   # undo scaling
        resid = res.resid
        std_resid: float = float(
            (resid.iloc[-1] / cond_vol.iloc[-1]) if cond_vol.iloc[-1] > 0 else 0.0
        )

        return {
            "sigma_t": sigma_t,
            "garch_alpha": alpha,
            "garch_beta": beta,
            "garch_persistence": alpha + beta,
            "standardised_residual": std_resid,
        }

    except Exception as exc:  # noqa: BLE001
        # Fallback: realised vol as sigma proxy
        warnings.warn(
            f"GARCH convergence failed ({exc!r}); falling back to realised vol.",
            stacklevel=2,
        )
        rv = float(np.std(log_returns))
        return {
            "sigma_t": rv,
            "garch_alpha": np.nan,
            "garch_beta": np.nan,
            "garch_persistence": np.nan,
            "standardised_residual": 0.0,
        }


# ---------------------------------------------------------------------------
# Rolling feature extraction
# ---------------------------------------------------------------------------

def extract_garch_features(
    df: pd.DataFrame,
    window: int = GARCH_WINDOW,
    log_return_col: str = "log_return",
) -> pd.DataFrame:
    """
    Apply rolling GARCH(1,1) over *df* and return a DataFrame of GARCH
    features aligned to the original index.

    Rows where insufficient history exists (< *window*) are filled with NaN.
    These are expected to be dropped downstream by ``features.engineer_features``.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain *log_return_col*.
    window : int
        Rolling window size in rows (hours for 1h data).
    log_return_col : str
        Column name of log returns.

    Returns
    -------
    pd.DataFrame
        Same index as *df*, with columns from ``GARCH_FEATURE_COLS``.
    """
    n = len(df)
    out = {col: np.full(n, np.nan) for col in GARCH_FEATURE_COLS}
    returns = df[log_return_col].values

    for i in range(window, n):
        window_returns = returns[i - window : i]
        # Skip if window is all-zero or constant (no variance to model)
        if np.std(window_returns) < 1e-12:
            continue
        result = fit_garch_single(window_returns)
        for col in GARCH_FEATURE_COLS:
            out[col][i] = result[col]

    garch_df = pd.DataFrame(out, index=df.index)

    # Forward-fill NaN alpha/beta from convergence failures (parameters
    # are slow-moving so last-known value is a reasonable proxy).
    garch_df[["garch_alpha", "garch_beta", "garch_persistence"]] = (
        garch_df[["garch_alpha", "garch_beta", "garch_persistence"]].ffill()
    )

    return garch_df


# ---------------------------------------------------------------------------
# Quick-run GARCH on latest data (for inference)
# ---------------------------------------------------------------------------

def extract_garch_features_latest(
    log_returns: np.ndarray,
    window: int = GARCH_WINDOW,
) -> dict[str, float]:
    """
    Convenience wrapper: fit GARCH on the *last* ``window`` returns
    and return a single row of features as a dict.

    Used at inference time when we only need the current-timestep features.
    """
    if len(log_returns) < window:
        warnings.warn(
            f"Only {len(log_returns)} returns available (need {window}); "
            "using all available data for GARCH fit.",
            stacklevel=2,
        )
        window = len(log_returns)
    return fit_garch_single(log_returns[-window:])


# ---------------------------------------------------------------------------
# Assertions / smoke tests
# ---------------------------------------------------------------------------

def _smoke_test() -> None:
    """Quick sanity check with synthetic data."""
    np.random.seed(42)
    n = 500
    returns = np.random.normal(0, 0.02, size=n)  # ~2% hourly vol (extreme)
    df = pd.DataFrame({"log_return": returns})
    garch_df = extract_garch_features(df, window=168)

    assert garch_df.shape == (n, len(GARCH_FEATURE_COLS)), "Shape mismatch"
    assert garch_df["sigma_t"].iloc[168:].notna().all(), "NaN sigma_t after warmup"
    assert (garch_df["sigma_t"].iloc[168:] >= 0).all(), "Negative sigma_t"

    latest = extract_garch_features_latest(returns, window=168)
    assert "sigma_t" in latest, "Missing sigma_t key"
    assert latest["sigma_t"] >= 0, "Negative sigma_t (latest)"

    print("GARCH smoke test passed ✓")


if __name__ == "__main__":
    _smoke_test()
