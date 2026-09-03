"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setAuthToken } from "./api";

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** EIP-6963 "announce provider" event payload - the standard way multiple
 * injected wallet extensions coexist without clobbering `window.ethereum`. */
export interface Eip6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

const BASE_CHAIN_ID_HEX = "0x2105"; // 8453

/** Well-known rdns identifiers for the wallets this app surfaces explicitly. */
export const METAMASK_RDNS = "io.metamask";
export const COINBASE_RDNS = "com.coinbase.wallet";
export const RAINBOW_RDNS = "me.rainbow";
export const TRUST_WALLET_RDNS = "com.trustwallet.app";
export const RABBY_RDNS = "io.rabby";
export const OKX_WALLET_RDNS = "com.okex.wallet";
export const BRAVE_WALLET_RDNS = "com.brave.wallet";

interface WalletState {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  hasProvider: boolean;
  /** Providers discovered via EIP-6963, keyed by rdns. Empty on wallets/browsers
   * that don't announce (older MetaMask, some mobile in-app browsers) - callers
   * should still fall back to plain `window.ethereum` detection in that case. */
  discoveredProviders: Record<string, Eip6963ProviderDetail>;
  /** True when `address` is a demo identity, not a real connected wallet. */
  isDemo: boolean;
  /** True when signed in via username/password rather than a wallet or demo mode. */
  isLocal: boolean;
  /** The signed-in username, when `isLocal` - shown in place of a wallet's short hex address. */
  username: string | null;
  /**
   * Connect and sign in. `rdns` picks a specific EIP-6963-announced provider
   * (e.g. MetaMask vs Coinbase Wallet when both are installed); omit it to
   * use the ambient `window.ethereum` (single-wallet browsers, or a generic
   * injected fallback).
   */
  connect: (rdns?: string) => Promise<void>;
  disconnect: () => void;
  switchToBase: () => Promise<void>;
  /**
   * Lets a judge without a wallet extension (or one who doesn't want to
   * connect) explore the app anyway. The client always displays this
   * session under the same fixed label (DEMO_IDENTITY, below) - but the
   * backend session behind it is a fresh, isolated identity every time,
   * with its own auto-provisioned sandbox Safe (see POST
   * /api/auth/demo-session) never shared with any other visitor.
   */
  enterDemoMode: () => Promise<void>;
  /**
   * Creates a username/password account and signs in as it. Throws (with a
   * message suitable for display) on a taken username or a rejected
   * password - callers should catch and show `error.message` rather than
   * relying on the shared `error` state, mirroring signIn's own contract.
   */
  signUp: (username: string, password: string) => Promise<void>;
  /** Signs in to an existing username/password account. */
  logIn: (username: string, password: string) => Promise<void>;
}

const DEMO_IDENTITY = "demo-mode";
// Mirrors the API's routes/auth.ts localIdentity() - a username/password
// account's stable identity string always has this prefix.
const LOCAL_IDENTITY_PREFIX = "local:";

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
  const [discoveredProviders, setDiscoveredProviders] = useState<Record<string, Eip6963ProviderDetail>>({});
  const hasProvider =
    (typeof window !== "undefined" && Boolean(window.ethereum)) || Object.keys(discoveredProviders).length > 0;

  // EIP-6963: listen for every injected wallet extension announcing itself,
  // so MetaMask + Coinbase Wallet (etc.) installed side by side are both
  // detectable instead of only whichever one last clobbered `window.ethereum`.
  useEffect(() => {
    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.rdns) return;
      setDiscoveredProviders((prev) => ({ ...prev, [detail.info.rdns]: detail }));
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  // The provider actually driving the current session - set on a successful
  // connect so disconnect/switchToBase/event-listeners target the wallet the
  // user picked in the modal rather than assuming `window.ethereum` (which
  // may be a *different* extension when more than one is installed).
  const [activeProvider, setActiveProvider] = useState<Eip1193Provider | null>(null);

  useEffect(() => {
    const eth = activeProvider ?? (typeof window !== "undefined" ? window.ethereum : undefined);
    if (!eth) return;
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
  }, [activeProvider]);

  /**
   * Proves the connected address actually controls that key: request a
   * one-time nonce, sign a human-readable challenge embedding it via
   * personal_sign, exchange the signature for a session token. Every API
   * call after this attaches that token - see lib/api.ts. Never sets
   * `address` unless this succeeds, so the rest of the app never has to
   * handle a "wallet connected but not authenticated" state.
   */
  async function signIn(provider: Eip1193Provider, walletAddress: string): Promise<void> {
    const { message } = await api.authNonce(walletAddress);
    const signature = (await provider.request({
      method: "personal_sign",
      params: [toHex(message), walletAddress],
    })) as string;
    const { token } = await api.authVerify(walletAddress, signature);
    setAuthToken(token);
  }

  const connect = useCallback(
    async (rdns?: string) => {
      const provider = (rdns ? discoveredProviders[rdns]?.provider : undefined) ?? window.ethereum;
      if (!provider) {
        setError("No wallet extension detected. Install MetaMask, Coinbase Wallet, or another injected wallet.");
        return;
      }
      setConnecting(true);
      setError(null);
      try {
        const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        const account = accounts[0];
        if (!account) throw new Error("No account was returned by the wallet");

        // Prove key possession before this address is trusted anywhere in
        // the app - a rejected or failed signature means connection failed,
        // not "connected but unauthenticated."
        await signIn(provider, account);

        setActiveProvider(provider);
        setAddress(account);
        const chainHex = (await provider.request({ method: "eth_chainId" })) as string;
        setChainId(parseInt(chainHex, 16));
      } catch (err) {
        setAuthToken(null);
        // Handles a rejected connection/signature request explicitly rather
        // than leaving the UI stuck on "connecting".
        setError((err as { message?: string }).message ?? "Wallet connection was rejected");
      } finally {
        setConnecting(false);
      }
    },
    [discoveredProviders],
  );

  const disconnect = useCallback(() => {
    setAuthToken(null);
    setAddress(null);
    setChainId(null);
    setActiveProvider(null);
  }, []);

  const enterDemoMode = useCallback(async () => {
    setError(null);
    try {
      const { token } = await api.authDemoSession();
      setAuthToken(token);
      setAddress(DEMO_IDENTITY);
      setChainId(8453);
    } catch (err) {
      const message = (err as Error).message ?? "Could not start demo mode";
      setError(message);
      // Re-thrown so a caller (e.g. the homepage's "Try the demo" button)
      // knows this failed and doesn't navigate anywhere on a broken session.
      throw new Error(message);
    }
  }, []);

  const signUp = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const { token, address: identity } = await api.authSignup(username, password);
      setAuthToken(token);
      setAddress(identity);
      setChainId(8453);
    } catch (err) {
      const message = (err as Error).message ?? "Could not create account";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const logIn = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const { token, address: identity } = await api.authLogin(username, password);
      setAuthToken(token);
      setAddress(identity);
      setChainId(8453);
    } catch (err) {
      const message = (err as Error).message ?? "Could not sign in";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const switchToBase = useCallback(async () => {
    const provider = activeProvider ?? window.ethereum;
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_ID_HEX }],
      });
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not switch network to Base");
    }
  }, [activeProvider]);

  const isDemo = address === DEMO_IDENTITY;
  const isLocal = address?.startsWith(LOCAL_IDENTITY_PREFIX) ?? false;
  const username = isLocal ? (address as string).slice(LOCAL_IDENTITY_PREFIX.length) : null;

  const value = useMemo(
    () => ({
      address,
      chainId,
      connecting,
      error,
      hasProvider,
      discoveredProviders,
      isDemo,
      isLocal,
      username,
      connect,
      disconnect,
      switchToBase,
      enterDemoMode,
      signUp,
      logIn,
    }),
    [
      address,
      chainId,
      connecting,
      error,
      hasProvider,
      discoveredProviders,
      isDemo,
      isLocal,
      username,
      connect,
      disconnect,
      switchToBase,
      enterDemoMode,
      signUp,
      logIn,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
