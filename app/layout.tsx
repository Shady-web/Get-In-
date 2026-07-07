import type { ReactNode } from "react";
import { Inter_Tight } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// GSAP's primary font is Mori; Inter Tight is its documented fallback.
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-app",
});

export const metadata = {
  title: "GetIN!!!",
  description: "World Cup live predictions - call it before the whistle.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e100f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>
        <div className="devnet-banner" role="note">
          Devnet · test tokens · no real value
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
