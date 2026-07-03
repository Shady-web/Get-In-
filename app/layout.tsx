import type { ReactNode } from "react";
import { Inter_Tight } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Fey's primary font is Calibre; Inter Tight is its documented fallback.
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
  themeColor: "#0e1233",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
