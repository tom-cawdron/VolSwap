"use client";

import { useState } from "react";
import { http, createConfig, WagmiProvider } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  connectorsForWallets,
  RainbowKitProvider,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

// Always use connectorsForWallets so RainbowKit modal works.
// MetaMask + Coinbase work without a projectId; WalletConnect needs one.
const wallets = [metaMaskWallet, coinbaseWallet];
if (projectId) wallets.push(walletConnectWallet);

const connectors = connectorsForWallets(
  [{ groupName: "Recommended", wallets }],
  { appName: "Finance Multiverse", projectId: projectId || "placeholder" }
);

const config = createConfig({
  chains: [baseSepolia],
  connectors,
  transports: {
    [baseSepolia.id]: http(),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#6366f1",
            accentColorForeground: "white",
            borderRadius: "large",
            overlayBlur: "small",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
