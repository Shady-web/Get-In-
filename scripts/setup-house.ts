/**
 * GetIN!!! — one-time devnet HOUSE float setup.
 *
 * The house wallet pays every user withdrawal (server-signed), so
 * coin-converted SOL winnings can be cashed out even though users only ever
 * deposit a little real devnet SOL themselves.
 *
 * Usage:
 *   npm run setup:house              generate (or reuse) the house keypair,
 *                                    print its address to fund, and show the
 *                                    HOUSE_WALLET_SECRET line for deploys.
 *   npm run setup:house -- --balance just print the current float (no keygen).
 *
 * The keypair is written to a gitignored .house-keypair.json (Solana-CLI
 * format: a JSON array of the 64-byte secret key). It is a SERVER-SIDE secret
 * — never ship it to the browser. For Vercel, paste the printed
 * HOUSE_WALLET_SECRET value into an env var instead of committing the file.
 */

import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import "dotenv/config";

const KEYPAIR_PATH = process.env.HOUSE_KEYPAIR_PATH || ".house-keypair.json";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function log(msg = "") {
  console.log(msg);
}

/** Load the house keypair: env var first, then the gitignored file. */
function loadExisting(): Keypair | null {
  const secret = process.env.HOUSE_WALLET_SECRET?.trim();
  if (secret) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
  }
  const abs = path.resolve(KEYPAIR_PATH);
  if (fs.existsSync(abs)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(abs, "utf8")) as number[]),
    );
  }
  return null;
}

async function printBalance(keypair: Keypair): Promise<number> {
  const connection = new Connection(RPC_URL, "confirmed");
  const lamports = await connection.getBalance(keypair.publicKey);
  log(`  Float: ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  return lamports;
}

async function main() {
  const balanceOnly = process.argv.includes("--balance");

  log("GetIN!!! devnet house float setup");
  log(`  RPC:     ${RPC_URL}`);
  log(`  Keypair: ${KEYPAIR_PATH}`);

  // --- Balance-only mode: reuse an existing key and just show the float ---
  if (balanceOnly) {
    const existing = loadExisting();
    if (!existing) {
      log("\n❌ No house wallet yet. Run `npm run setup:house` first.\n");
      process.exit(1);
    }
    log(`\n  Address: ${existing.publicKey.toBase58()}`);
    await printBalance(existing);
    log("");
    return;
  }

  // --- Generate or reuse the keypair -------------------------------------
  let keypair = loadExisting();
  const abs = path.resolve(KEYPAIR_PATH);
  const fromEnv = Boolean(process.env.HOUSE_WALLET_SECRET?.trim());

  if (keypair) {
    log(fromEnv ? "\n  Reusing HOUSE_WALLET_SECRET from the environment." : `\n  Reusing ${KEYPAIR_PATH}`);
  } else {
    keypair = Keypair.generate();
    fs.mkdirSync(path.dirname(abs) === "" ? "." : path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(Array.from(keypair.secretKey)));
    fs.chmodSync(abs, 0o600);
    log(`\n  Generated a new house keypair -> ${KEYPAIR_PATH}`);
  }

  const address = keypair.publicKey.toBase58();
  log(`  Address: ${address}`);

  log("\n  Fund it (devnet test SOL, no real value):");
  log(`    • Faucet:  https://faucet.solana.com  (paste the address above)`);
  log(`    • Or CLI:  solana airdrop 2 ${address} --url devnet`);

  log("\n  Checking current float...");
  try {
    await printBalance(keypair);
  } catch (err) {
    log(`  (Could not reach the RPC: ${err instanceof Error ? err.message : "unknown"})`);
  }

  log("\n================ DEPLOY ================");
  log("For Vercel / production, set this SERVER-SIDE env var (never NEXT_PUBLIC_):");
  log(`\n  HOUSE_WALLET_SECRET=${JSON.stringify(Array.from(keypair.secretKey))}`);
  log("\n  Optional: HOUSE_LOW_SOL=1   (warn in the logs below this float)");
  log("\nRe-run `npm run setup:house -- --balance` anytime to check the float.");
  log("=======================================\n");
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
