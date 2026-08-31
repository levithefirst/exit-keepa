import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "../lib/wallet";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Exit Keepa",
  description: "Automated Safe exit strategies, executed via KeeperHub on Base.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <WalletProvider>
          <Nav />
          <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</div>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
