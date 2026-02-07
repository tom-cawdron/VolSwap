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
    <div className="inline-flex rounded-xl bg-white/[0.03] border border-white/5 p-1 gap-1">
      {ASSET_KEYS.map((key) => {
        const meta: AssetMeta = ASSETS[key];
        const active = key === selected;

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              active
                ? `${meta.bgColor} ${meta.color} border ${meta.borderColor.replace("border-", "border-")}/40 shadow-sm`
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03] border border-transparent"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${active ? meta.color.replace("text-", "bg-") : "bg-gray-600"}`} />
              {meta.shortLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
