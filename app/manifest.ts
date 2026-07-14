import type { MetadataRoute } from "next";

// PWA manifest so an installed GetIN uses the app logo on the home screen and
// splash. Icons and theme match the brand tile (dark canvas, neon-green mark).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GetIN!!! — FIFA World Cup 26 Predictions",
    short_name: "GetIN",
    description:
      "Play the FIFA World Cup 26 on Solana devnet — free, no risk. Stake live odds, then cash out or convert to SOL.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/getin-appicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
    ],
  };
}
