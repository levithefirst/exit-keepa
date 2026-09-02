import type { Metadata } from "next";
import { Bricolage_Grotesque, Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "../lib/wallet";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const accent = Fraunces({ subsets: ["latin"], style: ["italic"], variable: "--font-accent", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Exit Keepa",
  description: "Automated Safe exit strategies, executed via KeeperHub on Base.",
};

// Runs before paint, so the page never flashes the wrong theme. Prefers
// a stored choice from ThemeToggle; falls back to the OS preference on
// a visitor's first-ever load. Always lands on an explicit light/dark —
// see ThemeToggle.tsx for why that matters.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem("exit-keepa-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${accent.variable} ${body.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
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
