"""
Multi-Asset Oracle Bridge — Push ML regime updates on-chain.

Reads regime probabilities for ETH, BTC, and SOL from the inference API
(/predict/all) and pushes each to its own RegimeOracle contract address.

Environment variables (per-asset oracle addresses):
    ORACLE_ADDRESS_ETH   — RegimeOracle address for ETH
    ORACLE_ADDRESS_BTC   — RegimeOracle address for BTC
    ORACLE_ADDRESS_SOL   — RegimeOracle address for SOL

Usage:
    python push_update.py                         # one-shot, all assets
    python push_update.py --loop --interval 14400 # every 4h
    python push_update.py --asset eth             # single asset
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

INFERENCE_URL = os.getenv("INFERENCE_URL", "http://localhost:8000")
RPC_URL = os.getenv("RPC_URL", "http://127.0.0.1:8545")
PRIVATE_KEY = os.getenv("ORACLE_PRIVATE_KEY", "")

# Per-asset oracle contract addresses
ORACLE_ADDRESSES: dict[str, str] = {
    "eth": os.getenv("ORACLE_ADDRESS_ETH", os.getenv("ORACLE_ADDRESS", "")),
    "btc": os.getenv("ORACLE_ADDRESS_BTC", ""),
    "sol": os.getenv("ORACLE_ADDRESS_SOL", ""),
}

VALID_ASSETS = ["eth", "btc", "sol"]

# Minimal ABI for RegimeOracle.pushUpdate and postCommit
ORACLE_ABI = [
    {
        "inputs": [
            {"name": "_pHigh", "type": "uint256"},
            {"name": "_pLow", "type": "uint256"},
            {"name": "_entropy", "type": "uint256"},
            {"name": "_modelHash", "type": "bytes32"},
        ],
        "name": "pushUpdate",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "_commitHash", "type": "bytes32"}],
        "name": "postCommit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "latestUpdate",
        "outputs": [
            {"name": "pHighVol", "type": "uint256"},
            {"name": "pLowVol", "type": "uint256"},
            {"name": "entropy", "type": "uint256"},
            {"name": "timestamp", "type": "uint256"},
            {"name": "modelHash", "type": "bytes32"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "registeredModelHash",
        "outputs": [{"name": "", "type": "bytes32"}],
        "stateMutability": "view",
        "type": "function",
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def to_uint256(prob: float) -> int:
    """Convert a probability [0, 1] to uint256 scaled by 1e18."""
    return int(prob * 1e18)


def fetch_all_predictions() -> list[dict]:
    """Call /predict/all and return list of prediction dicts."""
    url = f"{INFERENCE_URL.rstrip('/')}/predict/all"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    return data["predictions"]


def fetch_single_prediction(asset: str) -> dict:
    """Call /predict/{asset} and return the prediction dict."""
    url = f"{INFERENCE_URL.rstrip('/')}/predict/{asset}"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def compute_model_hash(asset: str = "eth") -> bytes:
    """
    Compute the SHA-256 hash of the model weights file.
    Returns 32-byte hash suitable for bytes32 in Solidity.
    """
    model_path = Path(__file__).resolve().parents[1] / "ml" / "models" / f"xgb_{asset}.joblib"
    if not model_path.exists():
        print(f"WARNING: Model file not found at {model_path}, using zero hash.")
        return b"\x00" * 32

    raw = model_path.read_bytes()
    return hashlib.sha256(raw).digest()


# ---------------------------------------------------------------------------
# Push update on-chain
# ---------------------------------------------------------------------------

def push_update(w3: Web3, contract, account, prediction: dict, model_hash: bytes) -> str:
    """Build and send the pushUpdate transaction."""
    p_high = to_uint256(prediction["p_high_vol"])
    p_low = to_uint256(prediction["p_low_vol"])
    entropy = to_uint256(prediction["entropy"])

    tx = contract.functions.pushUpdate(
        p_high, p_low, entropy, model_hash
    ).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 200_000,
        "gasPrice": w3.eth.gas_price,
    })

    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    return receipt["transactionHash"].hex()


# ---------------------------------------------------------------------------
# Commit-reveal (optional)
# ---------------------------------------------------------------------------

def post_commit(w3: Web3, contract, account, prediction: dict, nonce: int) -> str:
    """Post a commit hash for the upcoming update (tamper-proofing)."""
    p_high = to_uint256(prediction["p_high_vol"])
    p_low = to_uint256(prediction["p_low_vol"])
    entropy = to_uint256(prediction["entropy"])

    commit_data = Web3.solidity_keccak(
        ["uint256", "uint256", "uint256", "uint256"],
        [p_high, p_low, entropy, nonce],
    )

    tx = contract.functions.postCommit(commit_data).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 100_000,
        "gasPrice": w3.eth.gas_price,
    })

    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    return receipt["transactionHash"].hex()


# ---------------------------------------------------------------------------
# Per-asset push
# ---------------------------------------------------------------------------

def push_asset(w3: Web3, account, prediction: dict) -> None:
    """Push a single asset's prediction on-chain."""
    asset = prediction["asset"]
    oracle_addr = ORACLE_ADDRESSES.get(asset, "")

    if not oracle_addr:
        print(f"  [{asset.upper()}] No oracle address configured — skipping on-chain push.")
        print(f"    P(HIGH_VOL) = {prediction['p_high_vol']:.4f}")
        print(f"    Regime      = {prediction['regime']}")
        return

    contract = w3.eth.contract(
        address=Web3.to_checksum_address(oracle_addr),
        abi=ORACLE_ABI,
    )

    model_hash = compute_model_hash(asset)
    tx_hash = push_update(w3, contract, account, prediction, model_hash)

    print(f"  [{asset.upper()}] TX: {tx_hash}")
    print(f"    P(HIGH_VOL) = {prediction['p_high_vol']:.4f}")
    print(f"    Regime      = {prediction['regime']}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_once(asset_filter: str | None = None):
    """Execute a single predict → push cycle for all (or one) asset(s)."""
    print("=" * 60)
    print(f"Oracle Push Update — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 1. Connect to chain
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print(f"ERROR: Cannot connect to {RPC_URL}")
        sys.exit(1)
    print(f"Connected to chain ID {w3.eth.chain_id}")

    if not PRIVATE_KEY:
        print("ERROR: Set ORACLE_PRIVATE_KEY env var")
        sys.exit(1)

    account = w3.eth.account.from_key(PRIVATE_KEY)
    print(f"Operator: {account.address}")

    # 2. Fetch predictions
    if asset_filter:
        print(f"\nFetching prediction for {asset_filter} …")
        predictions = [fetch_single_prediction(asset_filter)]
    else:
        print("\nFetching predictions for all assets …")
        predictions = fetch_all_predictions()

    # 3. Push each
    print("\nPushing updates on-chain …")
    for pred in predictions:
        push_asset(w3, account, pred)

    print("\nDone ✓")


def main():
    parser = argparse.ArgumentParser(description="Push regime updates to oracle contracts")
    parser.add_argument("--loop", action="store_true", help="Run continuously")
    parser.add_argument("--interval", type=int, default=14400, help="Seconds between updates (default: 4h)")
    parser.add_argument("--asset", type=str, default=None, help="Single asset (eth/btc/sol)")
    args = parser.parse_args()

    if args.loop:
        print(f"Running in loop mode (interval = {args.interval}s)")
        while True:
            try:
                run_once(asset_filter=args.asset)
            except Exception as e:
                print(f"ERROR: {e}")
            time.sleep(args.interval)
    else:
        run_once(asset_filter=args.asset)


if __name__ == "__main__":
    main()
