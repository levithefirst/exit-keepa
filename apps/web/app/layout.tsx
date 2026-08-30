import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "../lib/wallet";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: "Exit Keepa",
  description: "Automated Safe exit strategies, executed via KeeperHub on Base.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Nav />
          <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
        </WalletProvider>
      </body>
    </html>
  );
}
