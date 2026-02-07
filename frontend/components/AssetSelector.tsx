"use client";

import React from "react";
import type { AssetKey, AssetMeta } from "../lib/types";
import { ASSETS, ASSET_KEYS } from "../lib/types";

/**
 * AssetSelector — Horizontal pill-style selector for switching between
 * the three supported assets (ETH, BTC, SOL).
 */

interface AssetSelectorProps {
  selected: AssetKey;
  onChange: (asset: AssetKey) => void;
}

export default function AssetSelector({
  selected,
  onChange,
}: AssetSelectorProps) {
  return (
    <div className="inline-flex rounded-xl bg-gray-800 p-1 gap-1">
      {ASSET_KEYS.map((key) => {
        const meta: AssetMeta = ASSETS[key];
        const active = key === selected;

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              active
                ? `${meta.bgColor} ${meta.color} ${meta.borderColor} border`
                : "text-gray-400 hover:text-white border border-transparent"
            }`}
          >
            {meta.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
