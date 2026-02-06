"""
One-command launcher for the entire Finance Multiverse stack.

Usage:
    python launch.py              # train (if needed) + start all services
    python launch.py --skip-train # start services only
    python launch.py --train-only # train models without launching servers
"""

import argparse
import subprocess
import sys
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ML_DIR = ROOT / "ml"
FRONTEND_DIR = ROOT / "frontend"
MODELS_DIR = ML_DIR / "models"
VENV_PYTHON = ROOT / "venv" / "Scripts" / "python.exe"

# Use venv python if available, else system python
PYTHON = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


def run(cmd: list[str], cwd: Path = ROOT, check: bool = True):
    print(f"\n{'='*60}")
    print(f"  Running: {' '.join(cmd)}")
    print(f"  Dir:     {cwd}")
    print(f"{'='*60}\n")
    return subprocess.run(cmd, cwd=str(cwd), check=check)


def install_deps():
    """Install Python + Node dependencies if needed."""
    # Python deps
    req = ROOT / "requirements.txt"
    if req.exists():
        print(">> Installing Python dependencies...")
        run([PYTHON, "-m", "pip", "install", "-q", "-r", str(req)])
    else:
        print(">> No requirements.txt found, skipping Python deps.")

    # Node deps
    if (FRONTEND_DIR / "package.json").exists():
        if not (FRONTEND_DIR / "node_modules").exists():
            print(">> Installing Node dependencies...")
            run(["npm", "install"], cwd=FRONTEND_DIR)
        else:
            print(">> node_modules exists, skipping npm install.")


def train_models():
    """Train HMM + GRU if model files don't exist."""
    hmm_ok = (MODELS_DIR / "hmm_baseline.pkl").exists()
    gru_ok = (MODELS_DIR / "regime_gru.pt").exists()

    if hmm_ok and gru_ok:
        print(">> Models already trained. Use --force-train to retrain.")
        return

    if not hmm_ok:
        print(">> Training HMM baseline...")
        run([PYTHON, "src/hmm.py"], cwd=ML_DIR)

    if not gru_ok:
        print(">> Training GRU classifier...")
        run([PYTHON, "src/gru.py"], cwd=ML_DIR)

    print(">> Models ready.")


def start_inference_api() -> subprocess.Popen:
    """Start the FastAPI inference server on port 8000."""
    print("\n>> Starting Inference API on http://localhost:8000 ...")
    proc = subprocess.Popen(
        [PYTHON, "-m", "uvicorn", "src.inference:app",
         "--port", "8000", "--app-dir", str(ML_DIR)],
        cwd=str(ROOT),
    )
    # Wait a moment and check it didn't crash
    time.sleep(3)
    if proc.poll() is not None:
        print("ERROR: Inference API failed to start.")
        sys.exit(1)
    print(">> Inference API running (PID {}).".format(proc.pid))
    return proc


def start_frontend() -> subprocess.Popen:
    """Start the Next.js dev server on port 3000."""
    print("\n>> Starting Frontend on http://localhost:3000 ...")
    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(FRONTEND_DIR),
        shell=True,
    )
    time.sleep(3)
    if proc.poll() is not None:
        print("ERROR: Frontend failed to start.")
        sys.exit(1)
    print(">> Frontend running (PID {}).".format(proc.pid))
    return proc


def main():
    parser = argparse.ArgumentParser(description="Launch Finance Multiverse stack")
    parser.add_argument("--skip-train", action="store_true",
                        help="Skip model training, launch servers only")
    parser.add_argument("--train-only", action="store_true",
                        help="Train models only, don't launch servers")
    parser.add_argument("--force-train", action="store_true",
                        help="Retrain models even if they already exist")
    parser.add_argument("--skip-deps", action="store_true",
                        help="Skip dependency installation")
    args = parser.parse_args()

    print("""
    ╔═══════════════════════════════════════════════╗
    ║       Finance Multiverse — Launcher           ║
    ╚═══════════════════════════════════════════════╝
    """)

    # 1. Dependencies
    if not args.skip_deps:
        install_deps()

    # 2. Training
    if not args.skip_train:
        if args.force_train:
            # Delete existing models to force retrain
            for f in MODELS_DIR.glob("*"):
                f.unlink()
        train_models()

    if args.train_only:
        print("\n>> Training complete. Exiting (--train-only).")
        return

    # 3. Launch services
    procs = []
    try:
        procs.append(start_inference_api())
        procs.append(start_frontend())

        print(f"""
    ╔═══════════════════════════════════════════════╗
    ║  All services running!                        ║
    ║                                               ║
    ║  Inference API:  http://localhost:8000         ║
    ║  API Docs:       http://localhost:8000/docs    ║
    ║  Frontend:       http://localhost:3000         ║
    ║                                               ║
    ║  Press Ctrl+C to stop all services.           ║
    ╚═══════════════════════════════════════════════╝
        """)

        # Block until Ctrl+C
        for p in procs:
            p.wait()

    except KeyboardInterrupt:
        print("\n>> Shutting down...")
        for p in procs:
            p.terminate()
        for p in procs:
            p.wait(timeout=5)
        print(">> All services stopped.")


if __name__ == "__main__":
    main()
