import { NextResponse } from "next/server";
import { createHash, createHmac } from "crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// How stale a signed challenge may be. The client stamps the message with an
// ISO timestamp; anything older than this is rejected so a captured signature
// can't be replayed days later. Compared as an absolute delta, so it also
// tolerates a client clock that runs a little ahead of the server.
const MAX_AGE_MS = 10 * 60 * 1000;

// Human-readable statement the wallet signs. Kept in lockstep with the client
// (app/login/page.tsx buildSolanaChallenge). Binding the wallet address and a
// timestamp into the signed text is what makes the signature a proof of
// ownership rather than a reusable token.
const STATEMENT = "Sign in to GetIN";

/**
 * A Supabase Auth user is identified by an email + password. A wallet has
 * neither, so we derive both deterministically from the address: the email is
 * a stable synthetic address, the password is an HMAC over the wallet keyed by
 * a server-only secret. The password never leaves the server except back to
 * the same browser that just proved it owns the wallet, and it is unguessable
 * without the secret - so nobody can log in as a wallet without a fresh signed
 * challenge OR knowledge of the service-role key (which is server-only).
 */
// Domain the synthetic wallet emails live under. Supabase/GoTrue rejects
// addresses whose domain isn't a real, well-formed TLD ("Email address is
// invalid"), so we use the same real domain the app already uses for its own
// accounts rather than a made-up one like ".getin". Overridable via env.
const WALLET_EMAIL_DOMAIN =
  (process.env.WALLET_EMAIL_DOMAIN || "getin.gg").replace(/^@/, "").trim() || "getin.gg";

function walletEmail(address: string): string {
  // Hash the address for the local-part: base58 is case-sensitive but email
  // local-parts are folded to lowercase by GoTrue, so two distinct addresses
  // could otherwise collide onto one email. A hex digest is stable, unique,
  // and case-safe.
  const digest = createHash("sha256").update(address).digest("hex").slice(0, 40);
  return `sol_${digest}@${WALLET_EMAIL_DOMAIN}`;
}

function walletPassword(address: string, secret: string): string {
  return createHmac("sha256", secret).update(`solana:${address}`).digest("hex");
}

/**
 * POST /api/auth/solana { address, message, signature }
 *
 * Verifies that `signature` is a valid ed25519 signature of `message` by
 * `address`, that the message is our freshly-issued challenge for this wallet,
 * then upserts a Supabase Auth user for the wallet and returns credentials the
 * browser uses to open a real Supabase session (signInWithPassword). From
 * there the wallet is just another logged-in user: the post-login bootstrap
 * (/api/player) creates the players row, and every protected route keeps
 * verifying the Supabase session exactly as before. Nothing about the existing
 * email/Google paths changes.
 */
export async function POST(request: Request) {
  let address: string;
  let message: string;
  let signature: string;
  try {
    const body = await request.json();
    address = String(body?.address ?? "").trim();
    message = String(body?.message ?? "");
    signature = String(body?.signature ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!address || !message || !signature) {
    return NextResponse.json(
      { ok: false, error: "Missing wallet address, message or signature." },
      { status: 400 },
    );
  }

  // The address must be a real Solana public key; toBytes() gives us the raw
  // 32-byte key to verify against.
  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = new PublicKey(address).toBytes();
  } catch {
    return NextResponse.json({ ok: false, error: "That is not a valid Solana address." }, { status: 400 });
  }

  // The signed text must be our statement, for this exact wallet.
  if (!message.startsWith(STATEMENT) || !message.includes(address)) {
    return NextResponse.json({ ok: false, error: "Unexpected challenge message." }, { status: 400 });
  }

  // Freshness: pull the ISO timestamp the client stamped in and reject stale
  // (or future-dated) challenges.
  const issuedMatch = message.match(/Issued:\s*(\S+)/);
  const issuedAt = issuedMatch ? Date.parse(issuedMatch[1]) : NaN;
  if (Number.isNaN(issuedAt) || Math.abs(Date.now() - issuedAt) > MAX_AGE_MS) {
    return NextResponse.json(
      { ok: false, error: "Challenge expired. Please try signing in again." },
      { status: 400 },
    );
  }

  // Verify the ed25519 signature. The signature arrives base64-encoded.
  let sigBytes: Uint8Array;
  try {
    sigBytes = new Uint8Array(Buffer.from(signature, "base64"));
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed signature." }, { status: 400 });
  }
  const messageBytes = new TextEncoder().encode(message);
  const ok = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Signature did not verify." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  // Secret keying the derived password: never NEXT_PUBLIC, always server-side.
  const secret =
    process.env.SOLANA_AUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Server auth secret is not configured." },
      { status: 503 },
    );
  }

  const email = walletEmail(address);
  const password = walletPassword(address, secret);

  // Upsert the wallet's Supabase user. First time: create it. Thereafter it
  // already exists with this same deterministic password, so we just hand the
  // credentials back and let the browser sign in.
  const { error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { solana_address: address, login: "solana" },
  });
  if (createErr && !/already|registered|exists/i.test(createErr.message)) {
    return NextResponse.json(
      { ok: false, error: `Could not sign in with wallet: ${createErr.message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, email, password });
}
