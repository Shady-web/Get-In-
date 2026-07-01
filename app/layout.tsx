import type { ReactNode } from "react";

export const metadata = {
  title: "GetIN!!!",
  description: "World Cup companion — hackathon build",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
