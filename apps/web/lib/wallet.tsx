"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setAuthToken } from "./api";

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
  /** True when `address` is a demo identity, not a real connected wallet. */
  isDemo: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToBase: () => Promise<void>;
  /**
   * Lets a judge without a wallet extension (or one who doesn't want to
   * connect) explore the app anyway - registers a Safe/strategies under a
   * fixed local demo identity instead of blocking the whole UI on wallet
   * availability.
   */
  enterDemoMode: () => Promise<void>;
}

const DEMO_IDENTITY = "demo-mode";

const WalletContext = createContext<WalletState | null>(null);

/** UTF-8 string -> 0x-prefixed hex, the wire format personal_sign expects. */
function toHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasProvider = typeof window !== "undefined" && Boolean(window.ethereum);

  useEffect(() => {
    if (!hasProvider) return;
    const eth = window.ethereum!;
    const onAccountsChanged = () => {
      // The account changing invalidates any session signed for the old
      // one - never keep acting as an address the wallet no longer has
      // selected. A full reconnect (with a fresh signature) is required.
      setAuthToken(null);
      setAddress(null);
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

  /**
   * Proves the connected address actually controls that key: request a
   * one-time nonce, sign a human-readable challenge embedding it via
   * personal_sign, exchange the signature for a session token. Every API
   * call after this attaches that token - see lib/api.ts. Never sets
   * `address` unless this succeeds, so the rest of the app never has to
   * handle a "wallet connected but not authenticated" state.
   */
  async function signIn(walletAddress: string): Promise<void> {
    const { message } = await api.authNonce(walletAddress);
    const signature = (await window.ethereum!.request({
      method: "personal_sign",
      params: [toHex(message), walletAddress],
    })) as string;
    const { token } = await api.authVerify(walletAddress, signature);
    setAuthToken(token);
  }

  const connect = useCallback(async () => {
    if (!hasProvider) {
      setError("No wallet extension detected. Install MetaMask, Coinbase Wallet, or another injected wallet.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await window.ethereum!.request({ method: "eth_requestAccounts" })) as string[];
      const account = accounts[0];
      if (!account) throw new Error("No account was returned by the wallet");

      // Prove key possession before this address is trusted anywhere in
      // the app - a rejected or failed signature means connection failed,
      // not "connected but unauthenticated."
      await signIn(account);

      setAddress(account);
      const chainHex = (await window.ethereum!.request({ method: "eth_chainId" })) as string;
      setChainId(parseInt(chainHex, 16));
    } catch (err) {
      setAuthToken(null);
      // Handles a rejected connection/signature request explicitly rather
      // than leaving the UI stuck on "connecting".
      setError((err as { message?: string }).message ?? "Wallet connection was rejected");
    } finally {
      setConnecting(false);
    }
  }, [hasProvider]);

  const disconnect = useCallback(() => {
    setAuthToken(null);
    setAddress(null);
    setChainId(null);
  }, []);

  const enterDemoMode = useCallback(async () => {
    setError(null);
    try {
      const { token } = await api.authDemoSession();
      setAuthToken(token);
      setAddress(DEMO_IDENTITY);
      setChainId(8453);
    } catch (err) {
      setError((err as Error).message ?? "Could not start demo mode");
    }
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

  const isDemo = address === DEMO_IDENTITY;

  const value = useMemo(
    () => ({
      address,
      chainId,
      connecting,
      error,
      hasProvider,
      isDemo,
      connect,
      disconnect,
      switchToBase,
      enterDemoMode,
    }),
    [address, chainId, connecting, error, hasProvider, isDemo, connect, disconnect, switchToBase, enterDemoMode],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
