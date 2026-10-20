"use client";
import { useEffect, useMemo, type ReactNode } from "react";
import { WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { AuthProvider } from "@/lib/auth/client";
import { PhantomSignSheet } from "./PhantomSignSheet";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => { if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined); }, []);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new BackpackWalletAdapter()], []);
  // We only sign a login message, never transactions, so no ConnectionProvider/RPC is needed.
  return (
    <WalletProvider wallets={wallets} autoConnect>
      <AuthProvider>{children}<PhantomSignSheet /></AuthProvider>
    </WalletProvider>
  );
}
