"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, setAuthToken } from "./api";
import { clearStoredSafeId } from "./storage";

export interface Eip1193Provider {
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

declare global { interface Window { ethereum?: Eip1193Provider; } }
export interface Eip6963ProviderDetail { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193Provider; }
const BASE_CHAIN_ID_HEX = "0x2105";
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
  discoveredProviders: Record<string, Eip6963ProviderDetail>;
  isDemo: boolean;
  isLocal: boolean;
  username: string | null;
  connect: (rdns?: string) => Promise<void>;
  disconnect: () => void;
  switchToBase: () => Promise<void>;
  enterDemoMode: () => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  logIn: (username: string, password: string) => Promise<void>;
  /** The exact injected provider selected during wallet connection. */
  getProvider: () => Eip1193Provider | null;
}

const DEMO_IDENTITY = "demo-mode";
const LOCAL_IDENTITY_PREFIX = "local:";
const WalletContext = createContext<WalletState | null>(null);
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
  const [activeProvider, setActiveProvider] = useState<Eip1193Provider | null>(null);
  const hasProvider = (typeof window !== "undefined" && Boolean(window.ethereum)) || Object.keys(discoveredProviders).length > 0;
  const demoInFlight = useRef(false);

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

  useEffect(() => {
    const eth = activeProvider ?? (typeof window !== "undefined" ? window.ethereum : undefined);
    if (!eth) return;
    const onAccountsChanged = () => { setAuthToken(null); setAddress(null); };
    const onChainChanged = (...args: unknown[]) => setChainId(parseInt(args[0] as string, 16));
    eth.on?.("accountsChanged", onAccountsChanged);
    eth.on?.("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [activeProvider]);

  async function signIn(provider: Eip1193Provider, walletAddress: string): Promise<void> {
    const { message } = await api.authNonce(walletAddress);
    const signature = await provider.request({ method: "personal_sign", params: [toHex(message), walletAddress] }) as string;
    const { token } = await api.authVerify(walletAddress, signature);
    setAuthToken(token);
  }

  const connect = useCallback(async (rdns?: string) => {
    const provider = (rdns ? discoveredProviders[rdns]?.provider : undefined) ?? window.ethereum;
    if (!provider) { setError("No wallet extension detected. Install a compatible wallet."); return; }
    setConnecting(true); setError(null);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts[0];
      if (!account) throw new Error("No account was returned by the wallet");
      await signIn(provider, account);
      setActiveProvider(provider);
      setAddress(account);
      const chainHex = await provider.request({ method: "eth_chainId" }) as string;
      setChainId(parseInt(chainHex, 16));
    } catch (err) {
      setAuthToken(null);
      setError((err as { message?: string }).message ?? "Wallet connection was rejected");
    } finally { setConnecting(false); }
  }, [discoveredProviders]);

  const disconnect = useCallback(() => { setAuthToken(null); setAddress(null); setChainId(null); setActiveProvider(null); }, []);
  const enterDemoMode = useCallback(async () => {
    if (demoInFlight.current) return;
    demoInFlight.current = true; setError(null);
    try {
      clearStoredSafeId(DEMO_IDENTITY);
      const { token } = await api.authDemoSession();
      setAuthToken(token); setAddress(DEMO_IDENTITY); setChainId(8453);
    } catch (err) {
      const message = (err as Error).message ?? "Could not start demo mode";
      setError(message); throw new Error(message);
    } finally { demoInFlight.current = false; }
  }, []);
  const signUp = useCallback(async (username: string, password: string) => {
    setError(null);
    try { const { token, address: identity } = await api.authSignup(username, password); setAuthToken(token); setAddress(identity); setChainId(8453); }
    catch (err) { const message = (err as Error).message ?? "Could not create account"; setError(message); throw new Error(message); }
  }, []);
  const logIn = useCallback(async (username: string, password: string) => {
    setError(null);
    try { const { token, address: identity } = await api.authLogin(username, password); setAuthToken(token); setAddress(identity); setChainId(8453); }
    catch (err) { const message = (err as Error).message ?? "Could not sign in"; setError(message); throw new Error(message); }
  }, []);
  const switchToBase = useCallback(async () => {
    const provider = activeProvider ?? window.ethereum;
    if (!provider) return;
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID_HEX }] }); }
    catch (err) { setError((err as { message?: string }).message ?? "Could not switch network to Base"); }
  }, [activeProvider]);
  const getProvider = useCallback(() => activeProvider, [activeProvider]);
  const isDemo = address === DEMO_IDENTITY;
  const isLocal = address?.startsWith(LOCAL_IDENTITY_PREFIX) ?? false;
  const username = isLocal ? (address as string).slice(LOCAL_IDENTITY_PREFIX.length) : null;
  const value = useMemo(() => ({ address, chainId, connecting, error, hasProvider, discoveredProviders, isDemo, isLocal, username, connect, disconnect, switchToBase, enterDemoMode, signUp, logIn, getProvider }), [address, chainId, connecting, error, hasProvider, discoveredProviders, isDemo, isLocal, username, connect, disconnect, switchToBase, enterDemoMode, signUp, logIn, getProvider]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
