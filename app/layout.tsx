import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev Pulse — Autonomous Spot Trading Lab",
  description:
    "A bilingual Jev decision-model showcase using live market intelligence and isolated Bybit Demo Trading spot execution.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
