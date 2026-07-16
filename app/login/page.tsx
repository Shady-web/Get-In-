"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { WcBadge } from "@/components/wc-badge";
import { GetinWordmark } from "@/components/getin-wordmark";

// Minimal shape of the Phantom provider we rely on (window.solana).
interface PhantomProvider {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (
    message: Uint8Array,
    display?: "utf8" | "hex",
  ) => Promise<{ signature: Uint8Array }>;
}

// The exact text the wallet signs. Must stay in lockstep with the server
// (app/api/auth/solana/route.ts): statement first, the address inline, and an
// ISO `Issued:` timestamp the server checks for freshness.
function buildSolanaChallenge(address: string): string {
  const nonce = Math.random().toString(36).slice(2);
  return [
    "Sign in to GetIN",
    "",
    `Wallet: ${address}`,
    `Issued: ${new Date().toISOString()}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [identifier, setIdentifier] = useState(""); // email OR username
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Already signed in? Nothing to do here - go straight to the app. Reaching
  // /login never signs you out; it only shows the form when there's no
  // session. "Join" links land here with ?mode=signup.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("mode") === "signup") {
        setMode("signup");
      }
    } catch {
      /* ignore */
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) router.replace("/match");
      else setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function requireSupabase() {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError(
        "Auth is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
      return null;
    }
    return supabase;
  }

  async function onSignIn() {
    const supabase = requireSupabase();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      // One field, two ways in: emails go straight through, usernames get
      // mapped to their email server-side first.
      let loginEmail = identifier.trim().toLowerCase();
      if (!loginEmail.includes("@")) {
        const res = await fetch("/api/auth/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: loginEmail }),
        });
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body?.error ?? "No account with that username.");
        loginEmail = body.email as string;
      }
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (authErr) {
        throw new Error(
          /invalid/i.test(authErr.message) ? "Wrong email/username or password." : authErr.message,
        );
      }
      router.push("/match");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you in.");
      setBusy(false);
    }
  }

  async function onSignUp() {
    const supabase = requireSupabase();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), username: username.trim(), password }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Could not create the account.");
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authErr) throw new Error(authErr.message);
      router.push("/match");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
      setBusy(false);
    }
  }

  async function onGoogle() {
    const supabase = requireSupabase();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: authErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/match` },
    });
    if (authErr) {
      setError(authErr.message);
      setBusy(false);
    }
  }

  // Sign in with a Solana wallet (Phantom). We never trust the address the
  // browser reports: the wallet signs a fresh, timestamped challenge, the
  // server verifies that signature, then mints a real Supabase session for the
  // wallet. From that point the wallet is just another logged-in user, so
  // wallet/bets/balances all keep working through the same auth model.
  async function onSolana() {
    const supabase = requireSupabase();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const provider = (window as unknown as { solana?: PhantomProvider }).solana;
      if (!provider?.isPhantom) {
        throw new Error("Phantom wallet not found. Install Phantom, then try again.");
      }
      const { publicKey } = await provider.connect();
      const address = publicKey.toString();
      const message = buildSolanaChallenge(address);
      const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
      let binary = "";
      for (const byte of signature) binary += String.fromCharCode(byte);
      const signatureB64 = btoa(binary);

      const res = await fetch("/api/auth/solana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, message, signature: signatureB64 }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Wallet sign-in failed.");

      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: body.email as string,
        password: body.password as string,
      });
      if (authErr) throw new Error(authErr.message);
      router.push("/match");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Wallet sign-in failed.";
      // Phantom throws a 4001 when the user dismisses the popup: keep it calm.
      const message = /reject|4001|denied/i.test(raw) ? "Wallet request cancelled." : raw;
      setError(message);
      setBusy(false);
    }
  }

  const submit = mode === "signin" ? onSignIn : onSignUp;
  const canSubmit =
    mode === "signin"
      ? identifier.trim().length >= 3 && password.length >= 6
      : username.trim().length >= 3 && email.includes("@") && password.length >= 6;

  return (
    <main className="shell confetti" style={{ justifyContent: "center", gap: 26, paddingTop: 36 }}>
      <header style={{ textAlign: "center", display: "grid", gap: 12, justifyItems: "center" }}>
        <WcBadge size={72} />
        <p className="caption" style={{ color: "var(--color-ash)" }}>
          FIFA World Cup 26 · Live Predictions
        </p>
        <div style={{ marginTop: -2 }}>
          <GetinWordmark size={48} />
        </div>
        <p style={{ fontSize: 15, color: "var(--color-ash)" }}>
          Call the result before the whistle. Climb the board.
        </p>
      </header>

      {checking ? (
        <section className="card" style={{ display: "grid", gap: 12 }}>
          <div className="skeleton" style={{ height: 40 }} />
          <div className="skeleton" style={{ height: 44 }} />
          <div className="skeleton" style={{ height: 44 }} />
          <div className="skeleton" style={{ height: 44, opacity: 0.7 }} />
        </section>
      ) : (
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            className={`pill tab ${mode === "signin" ? "active" : ""}`}
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            className={`pill tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
          >
            Create account
          </button>
        </div>

        {mode === "signin" ? (
          <input
            className="input"
            placeholder="Email or username"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={busy}
          />
        ) : (
          <>
            <input
              className="input"
              placeholder="Username (3-20, letters/numbers/_)"
              autoComplete="username"
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
            <input
              className="input"
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </>
        )}
        <input
          className="input"
          type="password"
          placeholder="Password (6+ characters)"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && !busy && void submit()}
          disabled={busy}
        />

        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !canSubmit}>
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div className="divider">or</div>

        <button className="btn btn-ghost" onClick={() => void onGoogle()} disabled={busy}>
          Continue with Google
        </button>

        <button className="btn btn-ghost" onClick={() => void onSolana()} disabled={busy}>
          Sign in with Solana
        </button>

        {error && <p className="error-text">{error}</p>}
      </section>
      )}

      <footer style={{ textAlign: "center" }}>
        <button
          className="pill"
          onClick={() => router.push("/match")}
          style={{ cursor: "pointer", color: "var(--color-fog)", display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <ArrowLeft size={14} aria-hidden /> Browse matches without signing in
        </button>
      </footer>
    </main>
  );
}
