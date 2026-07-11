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
  title: "GetIN!!! · FIFA World Cup 26",
  description: "FIFA World Cup 26 live betting - call it before the whistle.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#030907",
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
