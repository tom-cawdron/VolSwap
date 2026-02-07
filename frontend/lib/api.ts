/**
 * API client for the VolSwap inference service.
 *
 * Fetches regime predictions from the FastAPI backend and exposes
 * React hooks for live polling.  Falls back to demo data when the
 * inference server is unreachable so the UI always renders fully.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AssetKey, RegimePrediction, AllPredictionsResponse } from "./types";

// ─── Config ──────────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_INFERENCE_API ?? "http://localhost:8000";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

// ─── Demo data (shown when inference API is unavailable) ─────────────

const DEMO_PREDICTIONS: Record<AssetKey, RegimePrediction> = {
  eth: {
    asset: "eth",
    p_high_vol: 0.827,
    p_low_vol: 0.173,
    entropy: 0.46,
    regime: "HIGH_VOL",
    confidence: 0.827,
    realised_vol_24h: 0.025,
    timestamp: Math.floor(Date.now() / 1000),
    model_hash: "demo_eth_000000000000",
  },
  btc: {
    asset: "btc",
    p_high_vol: 0.445,
    p_low_vol: 0.555,
    entropy: 0.69,
    regime: "LOW_VOL",
    confidence: 0.555,
    realised_vol_24h: 0.018,
    timestamp: Math.floor(Date.now() / 1000),
    model_hash: "demo_btc_000000000000",
  },
  sol: {
    asset: "sol",
    p_high_vol: 0.453,
    p_low_vol: 0.547,
    entropy: 0.68,
    regime: "LOW_VOL",
    confidence: 0.547,
    realised_vol_24h: 0.035,
    timestamp: Math.floor(Date.now() / 1000),
    model_hash: "demo_sol_000000000000",
  },
};

// ─── Fetch helpers ───────────────────────────────────────────────────

export async function fetchPrediction(
  asset: AssetKey
): Promise<RegimePrediction> {
  const res = await fetch(`${API_BASE}/predict/${asset}`);
  if (!res.ok) throw new Error(`Prediction fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchAllPredictions(): Promise<AllPredictionsResponse> {
  const res = await fetch(`${API_BASE}/predict/all`);
  if (!res.ok) throw new Error(`All-predictions fetch failed: ${res.status}`);
  return res.json();
}

// ─── React hook: poll all predictions ────────────────────────────────

interface UsePredictionsResult {
  predictions: Record<AssetKey, RegimePrediction | null>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  isDemo: boolean;
  refresh: () => void;
}

export function usePredictions(): UsePredictionsResult {
  const [predictions, setPredictions] = useState<
    Record<AssetKey, RegimePrediction | null>
  >({ eth: null, btc: null, sol: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAllPredictions();
      const map: Record<AssetKey, RegimePrediction | null> = {
        eth: null,
        btc: null,
        sol: null,
      };
      for (const p of data.predictions) {
        const key = p.asset as AssetKey;
        if (key in map) map[key] = p;
      }
      setPredictions(map);
      setLastUpdated(data.timestamp);
      setError(null);
      setIsDemo(false);
    } catch (err: unknown) {
      // Fall back to demo data so the UI always looks full
      setPredictions({ ...DEMO_PREDICTIONS });
      setLastUpdated(Math.floor(Date.now() / 1000));
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsDemo(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  return { predictions, isLoading, error, lastUpdated, isDemo, refresh: load };
}
