"use client";

// Deposit screen: the player's custodial GetIN devnet address, a copy
// button, and a faucet link. We never fund wallets - players grab test SOL
// themselves. Balances show in SOL and USD at a hard-coded 1 SOL = $150.

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api-client";

interface WalletInfo {
  address: string;
  lamports: number;
  sol: number;
  usd: number;
  onchain: number;
  rate: number;
  stale: boolean;
}

export function WalletPanel() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/wallet");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Wallet unavailable.");
      setWallet(body.wallet as WalletInfo);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet unavailable.");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function copy() {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the address is selectable */
    }
  }

  return (
    <section style={{ display: "grid", gap: "var(--element-gap)", maxWidth: 640, margin: "0 auto", width: "100%" }}>
      <div className="card fade-in" style={{ display: "grid", gap: 10, textAlign: "center" }}>
        <p className="caption section-label">Playable balance</p>
        {wallet ? (
          <>
            <p className="display" style={{ fontSize: 44 }}>
              {wallet.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
              <span className="muted" style={{ fontSize: 22 }}>
                SOL
              </span>
            </p>
            <p className="muted" style={{ fontSize: 14 }}>
              ≈ ${wallet.usd.toLocaleString()} at ${wallet.rate}/SOL
              {wallet.stale ? " · last known (RPC offline)" : ""}
            </p>
            <p className="caption muted">
              Bet with this SOL from any market. Deposits are credited here.
            </p>
          </>
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : (
          <div className="skeleton" style={{ height: 64 }} />
        )}
      </div>

      <div className="card fade-in" style={{ display: "grid", gap: 12 }}>
        <p className="caption section-label">Deposit test SOL</p>
        <p className="muted" style={{ fontSize: 13 }}>
          This is your GetIN devnet address. Fund it with free test SOL to
          start playing - new wallets start at 0 and we never top them up.
        </p>
        {wallet && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                overflowWrap: "anywhere",
                fontSize: 12.5,
                background: "var(--surface-elevated-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-buttons)",
                padding: "10px 12px",
              }}
            >
              {wallet.address}
            </code>
            <button className="pill tab" onClick={() => void copy()} aria-label="Copy address">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        )}
        <a
          className="btn btn-primary"
          href="https://faucet.solana.com"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none" }}
        >
          Get test SOL from the faucet ↗
        </a>
        <p className="caption muted" style={{ textAlign: "center" }}>
          Devnet only · test tokens · no real value
        </p>
      </div>
    </section>
  );
}
