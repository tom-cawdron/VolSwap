"""
Oracle Bridge — Push ML regime updates on-chain.

Reads regime probabilities from the FastAPI inference service
and pushes them to the RegimeOracle.sol contract.

Usage:
    python push_update.py                         # one-shot
    python push_update.py --loop --interval 14400 # every 4h
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

INFERENCE_URL = os.getenv("INFERENCE_URL", "http://localhost:8000/predict")
RPC_URL = os.getenv("RPC_URL", "http://127.0.0.1:8545")  # local Anvil by default
ORACLE_ADDRESS = os.getenv("ORACLE_ADDRESS", "")
PRIVATE_KEY = os.getenv("ORACLE_PRIVATE_KEY", "")

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


def fetch_prediction() -> dict:
    """Call the inference API and return the prediction."""
    resp = requests.get(INFERENCE_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()


def compute_model_hash(model_path: str | None = None) -> bytes:
    """
    Compute the SHA-256 hash of the model weights file.
    Returns 32-byte hash suitable for bytes32 in Solidity.
    """
    if model_path is None:
        model_path = str(
            Path(__file__).resolve().parents[1] / "ml" / "models" / "regime_gru.pt"
        )
    if not Path(model_path).exists():
        print(f"WARNING: Model file not found at {model_path}, using zero hash.")
        return b"\x00" * 32

    raw = Path(model_path).read_bytes()
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
# Main
# ---------------------------------------------------------------------------

def run_once():
    """Execute a single predict → push cycle."""
    print("=" * 60)
    print(f"Oracle Push Update — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 1. Connect
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print(f"ERROR: Cannot connect to {RPC_URL}")
        sys.exit(1)
    print(f"Connected to chain ID {w3.eth.chain_id}")

    if not ORACLE_ADDRESS:
        print("ERROR: Set ORACLE_ADDRESS env var")
        sys.exit(1)

    contract = w3.eth.contract(
        address=Web3.to_checksum_address(ORACLE_ADDRESS),
        abi=ORACLE_ABI,
    )
    account = w3.eth.account.from_key(PRIVATE_KEY)
    print(f"Operator: {account.address}")

    # 2. Fetch prediction
    print("\nFetching prediction from inference API …")
    prediction = fetch_prediction()
    print(f"  P(HIGH_VOL) = {prediction['p_high_vol']:.4f}")
    print(f"  P(LOW_VOL)  = {prediction['p_low_vol']:.4f}")
    print(f"  Entropy     = {prediction['entropy']:.4f}")
    print(f"  Regime      = {prediction['regime']}")

    # 3. Model hash
    model_hash = compute_model_hash()

    # 4. Push on-chain
    print("\nPushing update on-chain …")
    tx_hash = push_update(w3, contract, account, prediction, model_hash)
    print(f"  TX hash: {tx_hash}")

    # 5. Verify
    latest = contract.functions.latestUpdate().call()
    print(f"\nOn-chain verification:")
    print(f"  pHighVol  = {latest[0] / 1e18:.6f}")
    print(f"  pLowVol   = {latest[1] / 1e18:.6f}")
    print(f"  entropy   = {latest[2] / 1e18:.6f}")
    print(f"  timestamp = {latest[3]}")

    print("\nDone ✓")


def main():
    parser = argparse.ArgumentParser(description="Push regime update to oracle contract")
    parser.add_argument("--loop", action="store_true", help="Run continuously")
    parser.add_argument("--interval", type=int, default=14400, help="Seconds between updates (default: 4h)")
    args = parser.parse_args()

    if args.loop:
        print(f"Running in loop mode (interval = {args.interval}s)")
        while True:
            try:
                run_once()
            except Exception as e:
                print(f"ERROR: {e}")
            time.sleep(args.interval)
    else:
        run_once()


if __name__ == "__main__":
    main()
