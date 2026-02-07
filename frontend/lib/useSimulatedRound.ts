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
  /** Inject tokens into the active round (demo mock trades) */
  addDemoTokens: (highTokens: number, lowTokens: number, collateral: number) => void;
}

// ─── Persistence (survives re-renders, resets on page reload) ────────

/** Pre-seed rounds so the demo starts mid-activity */
function seedRounds(): SimulatedRound[] {
  const now = Math.floor(Date.now() / 1000);

  // 2 resolved rounds in the past
  const resolved1: SimulatedRound = {
    roundId: 1,
    snapshotVol: 0.022,
    tradingEnd: now - 90000,
    resolutionTime: now - 3600,
    totalCollateral: 2.847,
    totalHighTokens: 1.62,
    totalLowTokens: 1.05,
    resolved: true,
    highVolWon: true,
    resolvedVol: 0.029,
    startedAt: now - 93600,
  };

  const resolved2: SimulatedRound = {
    roundId: 2,
    snapshotVol: 0.031,
    tradingEnd: now - 86400,
    resolutionTime: now - 1800,
    totalCollateral: 3.215,
    totalHighTokens: 1.15,
    totalLowTokens: 1.88,
    resolved: true,
    highVolWon: false,
    resolvedVol: 0.027,
    startedAt: now - 90000,
  };

  // 1 pending round (trading closed, awaiting resolution)
  const pending1: SimulatedRound = {
    roundId: 3,
    snapshotVol: 0.026,
    tradingEnd: now - 1200,
    resolutionTime: now + 84600,
    totalCollateral: 1.932,
    totalHighTokens: 1.12,
    totalLowTokens: 0.68,
    resolved: false,
    highVolWon: false,
    resolvedVol: 0,
    startedAt: now - 4800,
  };

  // Active round — mid-trading (started ~30 min ago, 30 min left)
  const active: SimulatedRound = {
    roundId: 4,
    snapshotVol: 0.024,
    tradingEnd: now + 1800,
    resolutionTime: now + 1800 + 86400,
    totalCollateral: 2.45 + Math.random() * 1.5,
    totalHighTokens: 1.35 + Math.random() * 0.5,
    totalLowTokens: 0.92 + Math.random() * 0.3,
    resolved: false,
    highVolWon: false,
    resolvedVol: 0,
    startedAt: now - 1800,
  };

  return [resolved1, resolved2, pending1, active];
}

let _persistedRounds: SimulatedRound[] = seedRounds();

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
    // Auto-start first round when prediction data arrives (only if no seeded rounds)
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
    /** Inject tokens into the active round (for demo mock trades) */
    addDemoTokens: (highTokens: number, lowTokens: number, collateral: number) => {
      if (!activeRound) return;
      const updated = _persistedRounds.map((r) =>
        r.roundId === activeRound.roundId
          ? {
              ...r,
              totalHighTokens: r.totalHighTokens + highTokens,
              totalLowTokens: r.totalLowTokens + lowTokens,
              totalCollateral: r.totalCollateral + collateral,
            }
          : r,
      );
      updateRounds(updated);
    },
  };
}
