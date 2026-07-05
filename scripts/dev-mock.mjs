// Start the mock TxLINE server AND `next dev` pointed at it, in one command:
//
//   npm run dev:mock
//
// Only TXLINE_* and GEMINI_* are overridden; Supabase env from .env.local
// still applies, so the full game loop (picks -> settlement -> points ->
// leaderboard) runs for real against the fake matches. Cross-platform.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const mock = spawn(process.execPath, [path.join(root, "scripts", "mock-txline.mjs")], {
  stdio: "inherit",
});

const next = spawn(process.execPath, [nextBin, "dev"], {
  stdio: "inherit",
  cwd: root,
  env: {
    ...process.env,
    TXLINE_API_BASE: "http://127.0.0.1:3998/api",
    TXLINE_API_TOKEN: "mock-token",
    TXLINE_NETWORK: "mock",
    // Pundit ticker against the fake Gemini endpoint (no real key or quota
    // used in mock mode, same as TXLINE_*).
    GEMINI_API_KEY: "mock-gemini-key",
    GEMINI_API_BASE: "http://127.0.0.1:3998",
  },
});

const stop = () => {
  mock.kill();
  next.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", stop);
mock.on("exit", (code) => {
  if (code && code !== 0) stop();
});
