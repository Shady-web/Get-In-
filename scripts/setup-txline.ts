/**
 * GetIN!!! - one-time TxLINE data API token setup.
 *
 * Run this ONCE from your terminal. It will:
 *   1. Generate (or reuse) a Solana keypair, saved to a gitignored file.
 *   2. Print the wallet address and PAUSE so you can fund it
 *        - devnet:  use the faucet (https://faucet.solana.com) or `solana airdrop`
 *        - mainnet: send it a little real SOL for transaction fees
 *   3. Get a guest JWT from  POST /auth/guest/start
 *   4. Subscribe on-chain to the free real-time World Cup tier
 *        - mainnet: service level 12 (real-time)
 *        - devnet:  service level 1
 *   5. Activate an API token via  POST /api/token/activate
 *   6. Print your TxLINE data API token.
 *
 * IMPORTANT: this is a *terminal* script. The token it prints is a server-side
 * secret - put it in .env.local (server-only) and never ship it to the browser.
 *
 * Run it with:   npm run setup:txline
 * (or directly:  NETWORK=devnet npx tsx scripts/setup-txline.ts)
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Per-network configuration (from the TxLINE "program addresses" docs page).
// ---------------------------------------------------------------------------

type NetworkName = "devnet" | "mainnet";

interface NetworkConfig {
  rpcUrl: string;
  apiOrigin: string; // used for /auth/guest/start
  apiBase: string; // used for /api/token/activate
  programId: string;
  txlMint: string;
  freeServiceLevel: number; // World Cup real-time free tier
}

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    apiBase: "https://txline.txodds.com/api",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
    freeServiceLevel: 12, // real-time World Cup & Int Friendlies
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    apiBase: "https://txline-dev.txodds.com/api",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
    freeServiceLevel: 1, // devnet free tier
  },
};

// PDA seeds (from the program addresses page).
const TREASURY_SEED = "token_treasury_v2";
const PRICING_MATRIX_SEED = "pricing_matrix";

// ---------------------------------------------------------------------------
// Small helpers for readable output and readable failures.
// ---------------------------------------------------------------------------

const log = (msg: string) => console.log(msg);
const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`);

/** Throw with a clean, human message instead of a stack-trace wall. */
class SetupError extends Error {}
const fail = (msg: string): never => {
  throw new SetupError(msg);
};

async function pause(question: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  await rl.question(question);
  rl.close();
}

/** POST JSON and return parsed body, turning HTTP errors into readable ones. */
async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
    });
  } catch (e) {
    return fail(`Network error calling ${url}\n  ${(e as Error).message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    return fail(
      `${url} returned HTTP ${res.status} ${res.statusText}\n  ${text.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${url} returned non-JSON response:\n  ${text.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// Keypair: load from a gitignored file, or generate + save a fresh one.
// ---------------------------------------------------------------------------

function loadOrCreateKeypair(keypairPath: string): {
  keypair: Keypair;
  created: boolean;
} {
  const abs = path.resolve(keypairPath);
  if (fs.existsSync(abs)) {
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(raw)), created: false };
  }
  const keypair = Keypair.generate();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // Solana-CLI-compatible format: a JSON array of the 64-byte secret key.
  fs.writeFileSync(abs, JSON.stringify(Array.from(keypair.secretKey)));
  fs.chmodSync(abs, 0o600);
  return { keypair, created: true };
}

// ---------------------------------------------------------------------------
// Main flow.
// ---------------------------------------------------------------------------

async function main() {
  const network = (process.env.NETWORK ?? "").toLowerCase() as NetworkName;
  if (network !== "devnet" && network !== "mainnet") {
    fail(
      `Set NETWORK to "devnet" or "mainnet" in your .env (got "${process.env.NETWORK ?? ""}").`,
    );
  }
  const cfg = NETWORKS[network];
  const keypairPath = process.env.KEYPAIR_PATH ?? ".txline-keypair.json";
  const rpcUrl = process.env.SOLANA_RPC_URL ?? cfg.rpcUrl;
  const weeks = Number(process.env.DURATION_WEEKS ?? 48); // 48 weeks = ~12 months

  log(`GetIN!!! TxLINE setup - network: ${network}`);
  log(`  RPC:        ${rpcUrl}`);
  log(`  API origin: ${cfg.apiOrigin}`);
  log(`  Service level (free World Cup tier): ${cfg.freeServiceLevel}`);

  // --- Step 1: keypair --------------------------------------------------
  step(1, "Loading Solana keypair");
  const { keypair, created } = loadOrCreateKeypair(keypairPath);
  const wallet = keypair.publicKey;
  log(created ? `  Generated a new keypair -> ${keypairPath}` : `  Reusing ${keypairPath}`);
  log(`  Wallet address: ${wallet.toBase58()}`);

  const connection = new Connection(rpcUrl, "confirmed");

  // --- Step 2: fund + pause --------------------------------------------
  step(2, "Fund the wallet so it can pay Solana transaction fees");
  const balance = await connection.getBalance(wallet);
  log(`  Current balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (network === "devnet") {
    log(`  Devnet: fund it at https://faucet.solana.com (paste the address above)`);
    log(`          or run:  solana airdrop 1 ${wallet.toBase58()} --url devnet`);
  } else {
    log(`  Mainnet: send a little real SOL (~0.02 is plenty) to the address above.`);
  }
  await pause("\n  Press Enter once the wallet is funded to continue... ");

  const funded = await connection.getBalance(wallet);
  log(`  Balance now: ${(funded / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (funded === 0) {
    fail("Wallet still has 0 SOL - fund it and re-run this script.");
  }

  // --- Step 3: guest JWT ------------------------------------------------
  step(3, "Requesting a guest JWT");
  const guest = await postJson(`${cfg.apiOrigin}/auth/guest/start`, {});
  const jwt: string | undefined = guest?.token;
  if (!jwt) fail(`/auth/guest/start did not return a "token" field.`);
  log(`  Got guest JWT (${jwt!.slice(0, 12)}...).`);

  // --- Step 4: subscribe on-chain --------------------------------------
  step(4, `Subscribing on-chain to service level ${cfg.freeServiceLevel} for ${weeks} weeks`);
  const programId = new PublicKey(cfg.programId);
  const tokenMint = new PublicKey(cfg.txlMint);

  // The TxL mint may be a classic SPL Token OR a Token-2022 mint (devnet uses
  // Token-2022). Read the mint's owning program from chain and use THAT program
  // everywhere, so account addresses and instructions match what the mint needs.
  const mintInfo = await connection.getAccountInfo(tokenMint);
  if (!mintInfo) {
    fail(`TxL mint ${cfg.txlMint} was not found on ${network}. Check NETWORK/RPC.`);
  }
  const tokenProgramId = mintInfo!.owner;

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(TREASURY_SEED)],
    programId,
  );
  const [pricingMatrix] = PublicKey.findProgramAddressSync(
    [Buffer.from(PRICING_MATRIX_SEED)],
    programId,
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    wallet,
    false,
    tokenProgramId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    tokenMint,
    tokenTreasuryPda,
    true, // owner is a PDA (off-curve)
    tokenProgramId,
  );

  const anchorWallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });

  // The free tier costs 0 TxL, but the program still references the user's
  // token account - make sure it exists so the instruction can't fail on it.
  try {
    await getAccount(connection, userTokenAccount, undefined, tokenProgramId);
  } catch {
    log("  Creating your token account (one-time, small rent)...");
    const ix = createAssociatedTokenAccountIdempotentInstruction(
      wallet, // payer
      userTokenAccount,
      wallet, // owner
      tokenMint,
      tokenProgramId,
    );
    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx, []);
  }

  let program: anchor.Program;
  try {
    // Fetches the published IDL straight from the chain.
    program = await anchor.Program.at(programId, provider);
  } catch (e) {
    return fail(
      `Could not load the program IDL from ${cfg.programId} on ${network}.\n  ${(e as Error).message}`,
    );
  }

  let txSig: string;
  try {
    txSig = await (program.methods as any)
      .subscribe(cfg.freeServiceLevel, weeks)
      .accountsPartial({
        user: wallet,
        pricingMatrix,
        tokenMint,
        userTokenAccount,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram: tokenProgramId,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
  } catch (e: any) {
    const logs = e?.logs ? `\n  Program logs:\n    ${e.logs.join("\n    ")}` : "";
    return fail(`On-chain subscribe failed.\n  ${e?.message ?? e}${logs}`);
  }
  log(`  Subscribed. Transaction: ${txSig}`);

  // --- Step 5: activate the API token ----------------------------------
  step(5, "Activating your API token");
  const leagues: string[] = []; // standard World Cup tier: no per-league scoping
  const message = `${txSig}:${leagues.join(",")}:${jwt}`; // -> "sig::jwt"
  const walletSignature = Buffer.from(
    nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
  ).toString("base64");

  // Note: this endpoint returns the API token as a PLAIN-TEXT string, not JSON,
  // so we read the raw body ourselves instead of using the JSON helper.
  const activateUrl = `${cfg.apiBase}/token/activate`;
  let activateRes: Response;
  try {
    activateRes = await fetch(activateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ txSig, walletSignature, leagues }),
    });
  } catch (e) {
    return fail(`Network error calling ${activateUrl}\n  ${(e as Error).message}`);
  }
  const activateBody = (await activateRes.text()).trim();
  if (!activateRes.ok) {
    return fail(
      `${activateUrl} returned HTTP ${activateRes.status} ${activateRes.statusText}\n  ${activateBody.slice(0, 500)}`,
    );
  }
  // Accept either a raw token string or a JSON object with a "token" field.
  let apiToken = activateBody;
  if (activateBody.startsWith("{")) {
    try {
      apiToken = JSON.parse(activateBody)?.token ?? "";
    } catch {
      /* fall through to the emptiness check below */
    }
  }
  if (!apiToken) fail(`/api/token/activate did not return a token.`);

  // --- Done -------------------------------------------------------------
  log("\n================ SUCCESS ================");
  log("Your TxLINE data API token:\n");
  log(`  ${apiToken}`);
  log("\nAdd it to .env.local (SERVER-ONLY - never expose to the browser):");
  log(`  TXLINE_NETWORK=${network}`);
  log(`  TXLINE_API_TOKEN=${apiToken}`);
  log(`  TXLINE_API_BASE=${cfg.apiBase}`);
  log("========================================\n");
}

main().catch((err) => {
  if (err instanceof SetupError) {
    console.error(`\n❌ ${err.message}\n`);
  } else {
    console.error(`\n❌ Unexpected error:\n${err?.stack ?? err}\n`);
  }
  process.exit(1);
});
