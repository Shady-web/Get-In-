"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletName } from "@solana/wallet-adapter-phantom";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { setStoredPlayer, type PlayerRecord } from "@/lib/player";

export default function Landing() {
  const router = useRouter();
  const { select, connect, publicKey, wallet, connecting } = useWallet();

  const [guestOpen, setGuestOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState<"wallet" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const walletFlow = useRef(false); // true while a user-initiated connect is in flight
  const finished = useRef(false);

  async function finishLogin(identity: string, kind: "wallet" | "guest") {
    if (finished.current) return;
    finished.current = true;
    setError(null);
    try {
      const res = await fetch("/api/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, kind }),
      });
      const body = (await res.json()) as {
        player?: PlayerRecord | null;
        error?: string;
      };
      if (!res.ok) throw new Error(body?.error ?? "Could not sign you in.");
      setStoredPlayer({ identity, kind, player: body.player ?? null });
      router.push("/match");
    } catch (err) {
      finished.current = false;
      setBusy(null);
      setError(err instanceof Error ? err.message : "Could not sign you in.");
    }
  }

  // --- Wallet flow: select Phantom, connect, then log in with the address ---

  function onConnectWallet() {
    setError(null);
    setBusy("wallet");
    walletFlow.current = true;
    if (publicKey) {
      void finishLogin(publicKey.toBase58(), "wallet");
      return;
    }
    select(PhantomWalletName);
  }

  useEffect(() => {
    if (!walletFlow.current || !wallet || publicKey || connecting) return;
    if (wallet.readyState !== WalletReadyState.Installed) {
      walletFlow.current = false;
      setBusy(null);
      setError("Phantom isn’t installed. Get it at phantom.app, then try again.");
      return;
    }
    connect().catch((err: unknown) => {
      walletFlow.current = false;
      setBusy(null);
      setError(
        err instanceof Error && err.name === "WalletConnectionError"
          ? "Connection was cancelled in Phantom."
          : err instanceof Error
            ? err.message
            : "Could not connect to Phantom.",
      );
    });
  }, [wallet, publicKey, connecting, connect]);

  useEffect(() => {
    if (walletFlow.current && publicKey) {
      walletFlow.current = false;
      void finishLogin(publicKey.toBase58(), "wallet");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  // --- Guest flow -----------------------------------------------------------

  function onGuestSubmit() {
    const name = nickname.trim();
    if (name.length < 2 || name.length > 20) {
      setError("Nickname needs to be 2-20 characters.");
      return;
    }
    setBusy("guest");
    void finishLogin(name, "guest");
  }

  return (
    <main className="shell confetti" style={{ justifyContent: "center", gap: 32 }}>
      <header style={{ textAlign: "center", display: "grid", gap: 10 }}>
        <p className="caption section-label">⚽ World Cup 2026 · Live Predictions</p>
        <h1 className="display">
          <span className="brand-gradient">GetIN</span>
          <span style={{ color: "var(--color-ember-orange)" }}>!!!</span>
        </h1>
        <p style={{ fontSize: 15, color: "var(--color-ash)" }}>
          Call the result before the whistle. Climb the board.
        </p>
      </header>

      <section className="card" style={{ display: "grid", gap: 16 }}>
        <button
          className="btn btn-primary"
          onClick={onConnectWallet}
          disabled={busy !== null}
        >
          {busy === "wallet" ? "Connecting…" : "Connect Wallet"}
        </button>
        <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: -8 }}>
          Phantom · Solana devnet
        </p>

        <div className="divider">or</div>

        {!guestOpen ? (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setGuestOpen(true);
              setError(null);
            }}
            disabled={busy !== null}
          >
            Play as guest
          </button>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <input
              className="input"
              placeholder="Pick a nickname"
              value={nickname}
              maxLength={20}
              autoFocus
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onGuestSubmit()}
              disabled={busy !== null}
            />
            <button
              className="btn btn-ghost"
              onClick={onGuestSubmit}
              disabled={busy !== null || nickname.trim().length < 2}
            >
              {busy === "guest" ? "Getting you in…" : "Let’s go"}
            </button>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </section>

      <footer style={{ textAlign: "center" }}>
        <p className="caption muted">Live data · TxLINE</p>
      </footer>
    </main>
  );
}
