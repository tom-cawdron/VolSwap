/**
 * API client for the Finance Multiverse inference service.
 *
 * Fetches regime predictions from the FastAPI backend and exposes
 * React hooks for live polling.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AssetKey, RegimePrediction, AllPredictionsResponse } from "./types";

// ─── Config ──────────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_INFERENCE_API ?? "http://localhost:8000";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

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
  refresh: () => void;
}

export function usePredictions(): UsePredictionsResult {
  const [predictions, setPredictions] = useState<
    Record<AssetKey, RegimePrediction | null>
  >({ eth: null, btc: null, sol: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
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

  return { predictions, isLoading, error, lastUpdated, refresh: load };
}
