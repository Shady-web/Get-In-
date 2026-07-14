import type { ReactNode } from "react";
import { Anton, Archivo, Space_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// GetIN design system fonts: Anton (condensed display), Archivo (body),
// Space Mono (all numbers). Exposed as CSS variables the styles consume.
const anton = Anton({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-display",
});
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  variable: "--font-app",
});
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

export const metadata = {
  title: "GetIN!!! — Zero to staked in seconds · FIFA World Cup 26",
  description:
    "Play the FIFA World Cup 26 on Solana devnet — free, no risk. Log in, get an auto wallet, claim test SOL, stake live odds, then cash out or convert to SOL. Call it before the whistle.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/getin-favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${archivo.variable} ${spaceMono.variable}`}
    >
      <body>
        <div className="devnet-banner" role="note">
          Devnet · test tokens · no real value
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
