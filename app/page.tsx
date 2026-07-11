"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { WcBadge } from "@/components/wc-badge";

export default function Landing() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [identifier, setIdentifier] = useState(""); // email OR username
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Landing on "/" while already signed in (e.g. the back button) must NOT
  // sign you out - it just means you left the app screen. Bounce a live
  // session straight back to /match; only show the login form when there's
  // genuinely no session. Signing out is explicit, from the account screen.
  useEffect(() => {
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

  // Don't flash the login form while we're resolving an existing session.
  if (checking) return null;

  const submit = mode === "signin" ? onSignIn : onSignUp;
  const canSubmit =
    mode === "signin"
      ? identifier.trim().length >= 3 && password.length >= 6
      : username.trim().length >= 3 && email.includes("@") && password.length >= 6;

  return (
    <main className="shell confetti" style={{ justifyContent: "center", gap: 32 }}>
      <header style={{ textAlign: "center", display: "grid", gap: 12, justifyItems: "center" }}>
        <WcBadge size={72} />
        <p className="caption" style={{ color: "var(--color-ash)" }}>
          FIFA World Cup 26 · Live Betting
        </p>
        <h1 className="display" style={{ marginTop: -2 }}>
          <span className="brand-gradient">GetIN</span>
          <span style={{ color: "var(--color-lime)", textShadow: "0 0 24px rgba(190,255,80,0.4)" }}>
            !!!
          </span>
        </h1>
        <p style={{ fontSize: 15, color: "var(--color-ash)" }}>
          Call the result before the whistle. Climb the board.
        </p>
      </header>

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

        {error && <p className="error-text">{error}</p>}
      </section>

      <footer style={{ textAlign: "center" }}>
        <p className="caption muted">Live data · TxLINE</p>
      </footer>
    </main>
  );
}
