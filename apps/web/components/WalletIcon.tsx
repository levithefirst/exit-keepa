import { WALLET_ICON_SVG } from "../lib/walletIconSvg";

/** Renders one of the real, official wallet logomarks from WALLET_ICON_SVG.
 * `dangerouslySetInnerHTML` is safe here: the markup is static, committed
 * source (not runtime-fetched or user-supplied), so there's no injection
 * surface - it's the standard way to embed pre-existing SVG source without
 * hand-converting every attribute to JSX camelCase. */
export function WalletIcon({ id, label }: { id: keyof typeof WALLET_ICON_SVG; label: string }) {
  return (
    <span
      className="block h-9 w-9 shrink-0 overflow-hidden rounded-lg"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: WALLET_ICON_SVG[id] }}
    />
  );
}
