"""
Multi-Asset Oracle Bridge — Push ML regime updates on-chain + manage rounds.

Reads regime probabilities + realised volatility from the inference API
and pushes to RegimeOracle contracts.  Also opens new market rounds hourly
and resolves expired ones via MultiverseMarket.

Environment variables (per-asset):
    ORACLE_ADDRESS_ETH / BTC / SOL  — RegimeOracle addresses
    MARKET_ADDRESS_ETH / BTC / SOL  — MultiverseMarket addresses

Usage:
    python push_update.py                         # one-shot, all assets
    python push_update.py --loop --interval 3600  # every hour (open rounds)
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

# Per-asset market contract addresses
MARKET_ADDRESSES: dict[str, str] = {
    "eth": os.getenv("MARKET_ADDRESS_ETH", ""),
    "btc": os.getenv("MARKET_ADDRESS_BTC", ""),
    "sol": os.getenv("MARKET_ADDRESS_SOL", ""),
}

VALID_ASSETS = ["eth", "btc", "sol"]

# ---------------------------------------------------------------------------
# ABIs (minimal)
# ---------------------------------------------------------------------------

ORACLE_ABI = [
    {
        "inputs": [
            {"name": "_pHigh", "type": "uint256"},
            {"name": "_pLow", "type": "uint256"},
            {"name": "_entropy", "type": "uint256"},
            {"name": "_realisedVol", "type": "uint256"},
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
            {"name": "realisedVol", "type": "uint256"},
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

MARKET_ABI = [
    {
        "inputs": [],
        "name": "openNewRound",
        "outputs": [{"name": "roundId", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "roundId", "type": "uint256"}],
        "name": "resolveRound",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "currentRoundId",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "", "type": "uint256"}],
        "name": "rounds",
        "outputs": [
            {"name": "snapshotVol", "type": "uint256"},
            {"name": "tradingEnd", "type": "uint256"},
            {"name": "resolutionTime", "type": "uint256"},
            {"name": "totalCollateral", "type": "uint256"},
            {"name": "totalHighTokens", "type": "uint256"},
            {"name": "totalLowTokens", "type": "uint256"},
            {"name": "qHigh", "type": "int256"},
            {"name": "qLow", "type": "int256"},
            {"name": "resolved", "type": "bool"},
            {"name": "highVolWon", "type": "bool"},
            {"name": "resolvedVol", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def to_uint256(value: float) -> int:
    """Convert a float [0, 1] or small decimal to uint256 scaled by 1e18."""
    return int(value * 1e18)


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
# Push oracle update on-chain
# ---------------------------------------------------------------------------

def push_update(w3: Web3, contract, account, prediction: dict, model_hash: bytes) -> str:
    """Build and send the pushUpdate transaction (now includes realisedVol)."""
    p_high = to_uint256(prediction["p_high_vol"])
    p_low = to_uint256(prediction["p_low_vol"])
    entropy = to_uint256(prediction["entropy"])
    realised_vol = to_uint256(prediction.get("realised_vol_24h", 0.0))

    tx = contract.functions.pushUpdate(
        p_high, p_low, entropy, realised_vol, model_hash
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
# Round management
# ---------------------------------------------------------------------------

def open_new_round(w3: Web3, market_contract, account) -> str | None:
    """Open a new prediction round on MultiverseMarket."""
    try:
        tx = market_contract.functions.openNewRound().build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        return receipt["transactionHash"].hex()
    except Exception as e:
        print(f"    Failed to open round: {e}")
        return None


def resolve_expired_rounds(w3: Web3, market_contract, account) -> list[int]:
    """Try to resolve any rounds whose resolutionTime has passed."""
    resolved_ids = []
    try:
        current_id = market_contract.functions.currentRoundId().call()
    except Exception:
        return resolved_ids

    now = int(time.time())

    for rid in range(1, current_id + 1):
        try:
            round_data = market_contract.functions.rounds(rid).call()
            resolution_time = round_data[2]  # resolutionTime
            already_resolved = round_data[8]  # resolved

            if already_resolved or now < resolution_time:
                continue

            tx = market_contract.functions.resolveRound(rid).build_transaction({
                "from": account.address,
                "nonce": w3.eth.get_transaction_count(account.address),
                "gas": 200_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = account.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash)
            resolved_ids.append(rid)
            print(f"    Resolved round {rid}")

        except Exception as e:
            print(f"    Failed to resolve round {rid}: {e}")

    return resolved_ids


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
    """Push a single asset's prediction on-chain + manage rounds."""
    asset = prediction["asset"]
    oracle_addr = ORACLE_ADDRESSES.get(asset, "")
    market_addr = MARKET_ADDRESSES.get(asset, "")

    if not oracle_addr:
        print(f"  [{asset.upper()}] No oracle address configured — skipping on-chain push.")
        print(f"    P(HIGH_VOL)     = {prediction['p_high_vol']:.4f}")
        print(f"    Realised Vol 24h = {prediction.get('realised_vol_24h', 0):.6f}")
        print(f"    Regime          = {prediction['regime']}")
        return

    # 1. Push oracle update (probs + realised vol)
    oracle_contract = w3.eth.contract(
        address=Web3.to_checksum_address(oracle_addr),
        abi=ORACLE_ABI,
    )

    model_hash = compute_model_hash(asset)
    tx_hash = push_update(w3, oracle_contract, account, prediction, model_hash)

    print(f"  [{asset.upper()}] Oracle TX: {tx_hash}")
    print(f"    P(HIGH_VOL)      = {prediction['p_high_vol']:.4f}")
    print(f"    Realised Vol 24h = {prediction.get('realised_vol_24h', 0):.6f}")
    print(f"    Regime           = {prediction['regime']}")

    # 2. Market round management (if market address configured)
    if not market_addr:
        print(f"  [{asset.upper()}] No market address — skipping round management.")
        return

    market_contract = w3.eth.contract(
        address=Web3.to_checksum_address(market_addr),
        abi=MARKET_ABI,
    )

    # 2a. Resolve any expired rounds
    resolved = resolve_expired_rounds(w3, market_contract, account)
    if resolved:
        print(f"  [{asset.upper()}] Resolved rounds: {resolved}")

    # 2b. Auto-cycle: if the current round is resolved, start a new one
    needs_new_round = False
    try:
        current_id = market_contract.functions.currentRoundId().call()
        if current_id == 0:
            needs_new_round = True  # no rounds yet
        else:
            round_data = market_contract.functions.rounds(current_id).call()
            if round_data[8]:  # resolved == True
                needs_new_round = True
                print(f"  [{asset.upper()}] Round {current_id} resolved — auto-cycling to next round")
    except Exception as e:
        print(f"  [{asset.upper()}] Failed to check round state: {e}")

    if needs_new_round:
        tx_hash = open_new_round(w3, market_contract, account)
        if tx_hash:
            new_id = market_contract.functions.currentRoundId().call()
            print(f"  [{asset.upper()}] Opened round {new_id} — TX: {tx_hash}")
    else:
        try:
            cid = market_contract.functions.currentRoundId().call()
            print(f"  [{asset.upper()}] Round {cid} still active — no new round needed")
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_once(asset_filter: str | None = None):
    """Execute a single predict → push → round-manage cycle."""
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

    # 3. Push each (oracle update + round management)
    print("\nPushing updates on-chain …")
    for pred in predictions:
        push_asset(w3, account, pred)

    print("\nDone ✓")


def main():
    parser = argparse.ArgumentParser(description="Push regime updates to oracle contracts + manage market rounds")
    parser.add_argument("--loop", action="store_true", help="Run continuously")
    parser.add_argument("--interval", type=int, default=3600, help="Seconds between updates (default: 1h)")
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
