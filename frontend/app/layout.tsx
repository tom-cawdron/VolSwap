import type { Metadata } from "next";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "VolSwap — Bet on Chaos",
  description:
    "Bet on whether crypto markets get more chaotic or calmer. AI-driven volatility prediction markets.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#050510] text-white antialiased noise-bg">
        {/* Ambient gradient blobs */}
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-indigo-600/[0.07] blur-[120px]" />
          <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-violet-600/[0.05] blur-[120px]" />
          <div className="absolute -bottom-40 left-1/3 w-[500px] h-[500px] rounded-full bg-blue-600/[0.04] blur-[120px]" />
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
