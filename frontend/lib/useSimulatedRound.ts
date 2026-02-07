"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { RegimePrediction } from "./types";

// ─── Config ──────────────────────────────────────────────────────────

/** Trading window: 1 hour — bets accepted during this window */
const TRADING_DURATION_S = 60 * 60; // 1 hour

/**
 * Resolution delay from round start: 25 hours total.
 * Round starts at e.g. 2 pm → trading closes at 3 pm → resolves at 3 pm next day.
 * This means 1h trading + 24h waiting = 25h from round open.
 */
const RESOLUTION_DELAY_S = 25 * 60 * 60; // 25 hours

// ─── Types ───────────────────────────────────────────────────────────

export interface SimulatedRound {
  roundId: number;
  snapshotVol: number;          // decimal, e.g. 0.025 = 2.5%
  tradingEnd: number;           // unix timestamp (seconds)
  resolutionTime: number;       // unix timestamp (seconds)
  totalCollateral: number;      // simulated ETH in pool
  totalHighTokens: number;
  totalLowTokens: number;
  resolved: boolean;
  highVolWon: boolean;
  resolvedVol: number;          // vol at resolution
  startedAt: number;            // unix timestamp when round opened
}

export interface UseSimulatedRoundsResult {
  /** The latest round where trading is open (or the most recent round if none trading) */
  activeRound: SimulatedRound | null;
  /** Rounds where trading has closed but resolution hasn't happened yet */
  pendingRounds: SimulatedRound[];
  /** Recently resolved rounds (for display) */
  resolvedRounds: SimulatedRound[];
  /** All rounds */
  allRounds: SimulatedRound[];
  /** Active round ID shortcut */
  roundId: number;
  isSimulated: boolean;
}

// ─── Persistence (survives re-renders, resets on page reload) ────────

let _persistedRounds: SimulatedRound[] = [];

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Simulates overlapping hourly market rounds with 24h resolution.
 *
 * Lifecycle per round:
 *   1. Opens — snapshots current realised_vol_24h from the prediction
 *   2. Trading window: 1 hour (bets accepted)
 *   3. Trading closes → new round auto-starts immediately
 *   4. Awaiting resolution for 24 hours after trading closes
 *   5. Resolves — compares current realised_vol_24h to snapshot
 *      HIGH wins if current vol > snapshot vol
 *
 * Multiple rounds overlap: while round N awaits resolution,
 * rounds N+1, N+2, … can be open for trading.
 */
export function useSimulatedRound(
  prediction: RegimePrediction | null | undefined,
): UseSimulatedRoundsResult {
  const [rounds, setRounds] = useState<SimulatedRound[]>(_persistedRounds);
  const predRef = useRef(prediction);
  predRef.current = prediction;

  const updateRounds = useCallback((newRounds: SimulatedRound[]) => {
    _persistedRounds = newRounds;
    setRounds(newRounds);
  }, []);

  // ── Create a new round ───────────────────────────────────────────
  const createRound = useCallback((prevRoundId: number): SimulatedRound => {
    const now = Math.floor(Date.now() / 1000);
    const pred = predRef.current;
    const snapshotVol = pred?.realised_vol_24h ?? 0.025;

    // Simulate initial pool activity
    const initialPool = 0.2 + Math.random() * 1.5;
    const highRatio = pred ? pred.p_high_vol : 0.5;

    return {
      roundId: prevRoundId + 1,
      snapshotVol,
      tradingEnd: now + TRADING_DURATION_S,
      resolutionTime: now + RESOLUTION_DELAY_S,
      totalCollateral: initialPool,
      totalHighTokens: initialPool * highRatio * 0.8,
      totalLowTokens: initialPool * (1 - highRatio) * 0.8,
      resolved: false,
      highVolWon: false,
      resolvedVol: 0,
      startedAt: now,
    };
  }, []);

  // ── Resolve a round ──────────────────────────────────────────────
  const resolveRound = useCallback((r: SimulatedRound): SimulatedRound => {
    const pred = predRef.current;
    // Get current realised vol from latest prediction — this is the "real" comparison
    const currentVol = pred?.realised_vol_24h ?? r.snapshotVol;

    // Add slight noise to simulate 24h of price movement
    const noise = (Math.random() - 0.5) * 0.005;
    const resolvedVol = Math.max(0, currentVol + noise);

    const highWon = resolvedVol > r.snapshotVol;

    return {
      ...r,
      resolved: true,
      highVolWon: highWon,
      resolvedVol,
      // Simulate final pool size
      totalCollateral: r.totalCollateral + Math.random() * 1.5,
      totalHighTokens: r.totalHighTokens + Math.random() * 0.5,
      totalLowTokens: r.totalLowTokens + Math.random() * 0.5,
    };
  }, []);

  // ── Lifecycle tick (runs every second) ───────────────────────────
  useEffect(() => {
    // Auto-start first round when prediction data arrives
    if (rounds.length === 0 && prediction) {
      const first = createRound(0);
      updateRounds([first]);
      return;
    }

    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      let current = [..._persistedRounds];
      let changed = false;

      // 1. Resolve any rounds past their resolution time
      for (let i = 0; i < current.length; i++) {
        const r = current[i];
        if (!r.resolved && now >= r.resolutionTime) {
          current[i] = resolveRound(r);
          changed = true;
        }
      }

      // 2. Check if we need a new round (latest round's trading has ended)
      const latestRound = current[current.length - 1];
      if (latestRound && now >= latestRound.tradingEnd) {
        // Trading closed on latest round — start new round
        const newRound = createRound(latestRound.roundId);
        current.push(newRound);
        changed = true;
      }

      // 3. Simulate slow pool growth on the active trading round
      const activeIdx = current.findIndex((r) => !r.resolved && now < r.tradingEnd);
      if (activeIdx >= 0 && Math.random() < 0.08) {
        const r = current[activeIdx];
        current[activeIdx] = {
          ...r,
          totalCollateral: r.totalCollateral + Math.random() * 0.03,
          totalHighTokens: r.totalHighTokens + Math.random() * 0.015,
          totalLowTokens: r.totalLowTokens + Math.random() * 0.015,
        };
        changed = true;
      }

      // 4. Prune: keep only last 30 rounds to avoid unbounded growth
      if (current.length > 30) {
        current = current.slice(-30);
        changed = true;
      }

      if (changed) {
        updateRounds(current);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [rounds, prediction, createRound, resolveRound, updateRounds]);

  // ── Derived views ────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);

  const activeRound = rounds.find((r) => !r.resolved && now < r.tradingEnd) ?? null;
  const pendingRounds = rounds.filter((r) => !r.resolved && now >= r.tradingEnd);
  const resolvedRounds = rounds
    .filter((r) => r.resolved)
    .slice(-10)
    .reverse();

  return {
    activeRound,
    pendingRounds,
    resolvedRounds,
    allRounds: rounds,
    roundId: activeRound?.roundId ?? (rounds.length > 0 ? rounds[rounds.length - 1].roundId : 0),
    isSimulated: true,
  };
}
