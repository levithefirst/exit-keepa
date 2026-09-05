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
  metadataBase: new URL("https://exit-keepa-web.vercel.app"),
  title: {
    default: "Exit Keepa | Automated DeFi exits",
    template: "%s | Exit Keepa",
  },
  description: "Set an exit condition for your DeFi position and let Exit Keepa watch and execute the permitted exit through your Safe on Base.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Exit Keepa",
    title: "Exit Keepa | Automated DeFi exits",
    description: "Set an exit condition. Exit Keepa watches your DeFi position and executes the permitted exit when the condition is met.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Exit Keepa | Automated DeFi exits",
    description: "Set an exit condition. Walk away. Exit Keepa watches and executes the permitted exit through your Safe on Base.",
  },
  icons: {
    icon: "/icon.svg",
  },
};

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
    <html lang="en" className={`${display.variable} ${accent.variable} ${body.variable}`} suppressHydrationWarning>
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
