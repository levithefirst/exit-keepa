"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const BASE_CHAIN_ID_HEX = "0x2105"; // 8453

interface WalletState {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  hasProvider: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToBase: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasProvider = typeof window !== "undefined" && Boolean(window.ethereum);

  useEffect(() => {
    if (!hasProvider) return;
    const eth = window.ethereum!;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts[0] ?? null);
    };
    const onChainChanged = (...args: unknown[]) => {
      setChainId(parseInt(args[0] as string, 16));
    };
    eth.on?.("accountsChanged", onAccountsChanged);
    eth.on?.("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [hasProvider]);

  const connect = useCallback(async () => {
    if (!hasProvider) {
      setError("No wallet extension detected. Install MetaMask, Coinbase Wallet, or another injected wallet.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await window.ethereum!.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts[0] ?? null);
      const chainHex = (await window.ethereum!.request({ method: "eth_chainId" })) as string;
      setChainId(parseInt(chainHex, 16));
    } catch (err) {
      // Handles a rejected connection request explicitly rather than
      // leaving the UI stuck on "connecting".
      setError((err as { message?: string }).message ?? "Wallet connection was rejected");
    } finally {
      setConnecting(false);
    }
  }, [hasProvider]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
  }, []);

  const switchToBase = useCallback(async () => {
    if (!hasProvider) return;
    try {
      await window.ethereum!.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_ID_HEX }],
      });
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not switch network to Base");
    }
  }, [hasProvider]);

  const value = useMemo(
    () => ({ address, chainId, connecting, error, hasProvider, connect, disconnect, switchToBase }),
    [address, chainId, connecting, error, hasProvider, connect, disconnect, switchToBase],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
