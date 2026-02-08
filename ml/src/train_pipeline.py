"""
Master Training Pipeline — Finance Multiverse.

Single entry point that runs the full pipeline for all three assets:
    1. Fetch OHLCV data for ETH, BTC, SOL
    2. Build 16-feature matrices (self + cross) for each asset
    3. Fit HMM regime labels per asset (self-vol only)
    4. Train XGBoost classifiers per asset (full 16 features)

Run once before deployment:
    python -m src.train_pipeline          # from ml/
    python ml/src/train_pipeline.py       # from repo root

Options:
    --asset eth       Train single asset only
    --skip-hmm        Skip HMM step (use existing labels)
    --skip-xgb        Skip XGBoost step
"""

import argparse
import time

try:
    from src.features import ASSETS, ASSET_SHORT, build_feature_matrix, fetch_all_ohlcv
    from src.hmm import fit_hmm_for_asset
    from src.xgboost_model import train_asset
except ImportError:
    from features import ASSETS, ASSET_SHORT, build_feature_matrix, fetch_all_ohlcv
    from hmm import fit_hmm_for_asset
    from xgboost_model import train_asset


def run_pipeline(
    asset_filter: str | None = None,
    skip_hmm: bool = False,
    skip_xgb: bool = False,
) -> None:
    start = time.time()

    # Determine which assets to train
    if asset_filter:
        short_to_sym = {v: k for k, v in ASSET_SHORT.items()}
        sym = short_to_sym.get(asset_filter.lower())
        if sym is None:
            print(f"Unknown asset: {asset_filter}. Use eth/btc/sol.")
            return
        target_assets = [sym]
    else:
        target_assets = list(ASSETS)

    asset_names = ", ".join(target_assets)
    print("=" * 60)
    print(f"  Training Pipeline — {asset_names}")
    print("=" * 60)

    # 1. Fetch data for ALL assets (needed for cross-features even if
    #    only training one model)
    print(f"\n[1/4] Fetching OHLCV data for all assets …")
    all_ohlcv = fetch_all_ohlcv(limit=5000)
    for sym, df in all_ohlcv.items():
        print(f"  {sym}: {len(df)} rows")

    # 2. Build full feature matrices (including GARCH)
    print(f"\n[2/4] Building feature matrices …")
    feature_matrices: dict[str, object] = {}
    for sym in target_assets:
        print(f"\n  >>> {sym}")
        df = build_feature_matrix(sym, all_ohlcv, include_garch=True)
        feature_matrices[sym] = df
        print(f"  Feature matrix shape: {df.shape}")

    # 3. HMM labelling
    labelled: dict[str, object] = {}
    if not skip_hmm:
        print(f"\n[3/4] Fitting HMM regime labels …")
        for sym in target_assets:
            _, labelled_df = fit_hmm_for_asset(sym, feature_matrices[sym])
            labelled[sym] = labelled_df
    else:
        print(f"\n[3/4] Skipping HMM (--skip-hmm)")

    # 4. XGBoost training
    if not skip_xgb:
        print(f"\n[4/4] Training XGBoost classifiers …")
        for sym in target_assets:
            # Use freshly labelled df if available, else load from CSV
            df = labelled.get(sym, None)
            train_asset(sym, df=df)
    else:
        print(f"\n[4/4] Skipping XGBoost (--skip-xgb)")

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"  Pipeline complete in {elapsed:.1f}s")
    print(f"{'='*60}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Full training pipeline")
    parser.add_argument("--asset", type=str, default=None,
                        help="Single asset short name (eth/btc/sol)")
    parser.add_argument("--skip-hmm", action="store_true",
                        help="Skip HMM labelling (use existing CSVs)")
    parser.add_argument("--skip-xgb", action="store_true",
                        help="Skip XGBoost training")
    args = parser.parse_args()

    run_pipeline(
        asset_filter=args.asset,
        skip_hmm=args.skip_hmm,
        skip_xgb=args.skip_xgb,
    )


if __name__ == "__main__":
    main()
