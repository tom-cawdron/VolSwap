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

/** Clamp a number between min and max */
function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Drift a value by a small random step, clamped */
function drift(v: number, step: number, min: number, max: number) {
  return clamp(v + (Math.random() - 0.5) * step, min, max);
}

/** Mutable seed values that drift over time */
const _demoState: Record<AssetKey, { p_high: number; vol: number; entropy: number }> = {
  eth: { p_high: 0.827, vol: 0.025, entropy: 0.46 },
  btc: { p_high: 0.445, vol: 0.018, entropy: 0.69 },
  sol: { p_high: 0.453, vol: 0.035, entropy: 0.68 },
};

/** Generate demo predictions with drifting values */
function generateDemoPredictions(): Record<AssetKey, RegimePrediction> {
  const now = Math.floor(Date.now() / 1000);
  const result = {} as Record<AssetKey, RegimePrediction>;

  for (const key of ["eth", "btc", "sol"] as AssetKey[]) {
    const s = _demoState[key];
    // Drift each value
    s.p_high = drift(s.p_high, 0.03, 0.08, 0.92);
    s.vol = drift(s.vol, 0.003, 0.005, 0.08);
    s.entropy = drift(s.entropy, 0.02, 0.15, 0.95);

    const p_low = 1 - s.p_high;
    result[key] = {
      asset: key,
      p_high_vol: s.p_high,
      p_low_vol: p_low,
      entropy: s.entropy,
      regime: s.p_high > 0.5 ? "HIGH_VOL" : "LOW_VOL",
      confidence: Math.max(s.p_high, p_low),
      realised_vol_24h: s.vol,
      timestamp: now,
      model_hash: `demo_${key}_000000000000`,
    };
  }
  return result;
}

const DEMO_PREDICTIONS = generateDemoPredictions();

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
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setPredictions(generateDemoPredictions());
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

  // Drift demo values every 5 seconds when in demo mode
  useEffect(() => {
    if (isDemo) {
      demoIntervalRef.current = setInterval(() => {
        setPredictions(generateDemoPredictions());
        setLastUpdated(Math.floor(Date.now() / 1000));
      }, 5000);
    } else {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    }
    return () => {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    };
  }, [isDemo]);

  return { predictions, isLoading, error, lastUpdated, isDemo, refresh: load };
}
