"use client";

// Deposit screen: the player's custodial GetIN devnet address, a copy
// button, and a faucet link. We never fund wallets - players grab test SOL
// themselves. Balances show in SOL and USD at a hard-coded 1 SOL = $150.

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api-client";
import { Solana } from "@/components/solana";

interface WalletInfo {
  address: string;
  lamports: number;
  sol: number;
  usd: number;
  onchain: number;
  rate: number;
  stale: boolean;
}

const MIN_WITHDRAW_SOL = 0.0067;

export function WalletPanel() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<string | null>(null);
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null);

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

  async function withdraw() {
    setWithdrawing(true);
    setWithdrawMsg(null);
    setWithdrawErr(null);
    try {
      const res = await authFetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: toAddress.trim(), sol: Number(amount) }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Withdrawal failed.");
      setWithdrawMsg(
        `Sent ${(body.lamports / 1e9).toFixed(4)} SOL. Tx ${String(body.signature).slice(0, 8)}…`,
      );
      setAmount("");
      setToAddress("");
      void load();
    } catch (err) {
      setWithdrawErr(err instanceof Error ? err.message : "Withdrawal failed.");
    } finally {
      setWithdrawing(false);
    }
  }

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
            <p
              className="display"
              style={{
                fontSize: 44,
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                justifyContent: "center",
              }}
            >
              <Solana size={34} />
              {wallet.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })}
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

      {/* One action at a time: Deposit and Withdraw never crowd each other. */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className={`pill tab ${mode === "deposit" ? "active" : ""}`}
          style={{ flex: 1, justifyContent: "center" }}
          onClick={() => setMode("deposit")}
        >
          Deposit
        </button>
        <button
          className={`pill tab ${mode === "withdraw" ? "active" : ""}`}
          style={{ flex: 1, justifyContent: "center" }}
          onClick={() => setMode("withdraw")}
        >
          Withdraw
        </button>
      </div>

      {mode === "deposit" ? (
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
      ) : (
      /* Withdraw to an external devnet address */
      <div className="card fade-in" style={{ display: "grid", gap: 12 }}>
        <p className="caption section-label">Withdraw SOL</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Send devnet SOL from your GetIN wallet to any external devnet
          address. Minimum {MIN_WITHDRAW_SOL} SOL.
        </p>
        <input
          className="input"
          placeholder="Destination devnet address"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          disabled={withdrawing}
          aria-label="Destination address"
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="input"
            style={{ maxWidth: 160 }}
            inputMode="decimal"
            placeholder="Amount in SOL"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            disabled={withdrawing}
            aria-label="Amount in SOL"
          />
          <span className="muted" style={{ fontSize: 12, flex: 1 }}>
            {wallet ? `${wallet.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL spendable` : ""}
          </span>
        </div>
        <button
          className="btn btn-primary"
          disabled={withdrawing || !toAddress.trim() || Number(amount) < MIN_WITHDRAW_SOL}
          onClick={() => void withdraw()}
        >
          {withdrawing ? "Sending…" : "Withdraw SOL"}
        </button>
        {withdrawMsg && (
          <p style={{ fontSize: 13, color: "var(--color-tape-green)" }}>{withdrawMsg}</p>
        )}
        {withdrawErr && <p className="error-text">{withdrawErr}</p>}
      </div>
      )}
    </section>
  );
}
