import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exit Keepa",
  description: "Automated Safe exit strategies, executed via KeeperHub on Base.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
