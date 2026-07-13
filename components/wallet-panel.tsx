"use client";

// Wallet: playable balance on top, then a Deposit / Withdraw toggle.
// Deposit is an in-app claim of free devnet SOL straight from the GetIN house
// pool (up to 0.5 SOL, once a day) - no external faucet. The custodial address
// is still shown so real deposits sent there are auto-credited.

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { authFetch } from "@/lib/api-client";
import { Solana } from "@/components/solana";
import { useAutoClear } from "@/lib/use-auto-clear";
import type { PlayerRecord } from "@/lib/player";

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
const MAX_AIRDROP_SOL = 0.5;
const AIRDROP_CHIPS = [0.1, 0.25, 0.5] as const;

export function WalletPanel({
  onPlayerUpdate,
  solLamports,
}: {
  onPlayerUpdate?: (p: PlayerRecord) => void;
  /** The player's spendable lamports, so this card tracks the header pill in
   *  lockstep (both update together after any claim / withdraw / bet). */
  solLamports?: number | null;
}) {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");

  // Claim (deposit from house)
  const [solClaimed, setSolClaimed] = useState<boolean | null>(null);
  const [claimAmount, setClaimAmount] = useState("0.1");
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claimErr, setClaimErr] = useState<string | null>(null);

  // Withdraw
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<string | null>(null);
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null);

  // Transient notifications clear themselves after a few seconds.
  useAutoClear(claimMsg, setClaimMsg, 5000);
  useAutoClear(claimErr, setClaimErr, 5000);
  useAutoClear(withdrawMsg, setWithdrawMsg, 6000);
  useAutoClear(withdrawErr, setWithdrawErr, 6000);

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

  const loadClaimStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/claim/daily");
      const body = await res.json();
      setSolClaimed(body?.ok ? Boolean(body.sol) : false);
    } catch {
      setSolClaimed(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadClaimStatus();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load, loadClaimStatus]);

  // Whenever the player's spendable balance changes elsewhere (a claim, a
  // withdrawal, a settled bet), re-pull the wallet so its USD/on-chain fields
  // stay consistent with the headline number.
  useEffect(() => {
    if (solLamports != null) void load();
  }, [solLamports, load]);

  // Headline balance tracks the player's spendable lamports (same source as
  // the header pill), falling back to the wallet fetch before the player loads.
  const liveLamports = solLamports ?? wallet?.lamports ?? 0;
  const liveSol = liveLamports / 1e9;

  async function claimSol() {
    const sol = Number(claimAmount);
    setClaiming(true);
    setClaimMsg(null);
    setClaimErr(null);
    try {
      const res = await authFetch("/api/wallet/airdrop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sol }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Claim failed.");
      if (body.player) onPlayerUpdate?.(body.player as PlayerRecord);
      setSolClaimed(true);
      setClaimMsg(`${(body.lamports / 1e9).toFixed(3)} SOL credited from the house pool.`);
      void load();
    } catch (err) {
      setClaimErr(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  }

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
      if (body.player) onPlayerUpdate?.(body.player as PlayerRecord);
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

  const claimNum = Number(claimAmount);
  const claimValid = Number.isFinite(claimNum) && claimNum >= 0.01 && claimNum <= MAX_AIRDROP_SOL;

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
              {liveSol.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              <span className="muted" style={{ fontSize: 22 }}>
                SOL
              </span>
            </p>
            <p className="muted" style={{ fontSize: 14 }}>
              ≈ ${Math.round(liveSol * wallet.rate).toLocaleString()} at ${wallet.rate}/SOL
              {wallet.stale ? " · last known (RPC offline)" : ""}
            </p>
            <p className="caption muted">
              Bet with this SOL from any market. Withdraw it any time.
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
        <p className="caption section-label">Claim test SOL</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Claim free devnet SOL straight from the GetIN house pool - no faucet.
          Pick any amount up to {MAX_AIRDROP_SOL} SOL, once a day.
        </p>

        {solClaimed ? (
          <div
            style={{
              display: "grid",
              gap: 4,
              padding: "14px 16px",
              borderRadius: "var(--radius-buttons)",
              background: "rgba(60, 232, 138, 0.07)",
              border: "1px solid rgba(60, 232, 138, 0.3)",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--color-tape-green)" }}>
              Claimed for today
            </p>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Come back tomorrow for more test SOL.
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {AIRDROP_CHIPS.map((c) => (
                <button
                  key={c}
                  className={`pill tab ${Number(claimAmount) === c ? "active" : ""}`}
                  style={{ justifyContent: "center", height: 42 }}
                  onClick={() => setClaimAmount(String(c))}
                >
                  {c} SOL
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                style={{ maxWidth: 150 }}
                inputMode="decimal"
                placeholder="Amount"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value.replace(/[^\d.]/g, ""))}
                disabled={claiming}
                aria-label="Amount to claim in SOL"
              />
              <span className="muted" style={{ fontSize: 12, flex: 1 }}>
                0.01 – {MAX_AIRDROP_SOL} SOL
              </span>
            </div>
            <button
              className="btn btn-primary"
              disabled={claiming || !claimValid}
              onClick={() => void claimSol()}
            >
              {claiming
                ? "Claiming…"
                : claimValid
                  ? `Claim ${claimNum} SOL from the house`
                  : `Enter up to ${MAX_AIRDROP_SOL} SOL`}
            </button>
          </>
        )}
        {claimMsg && (
          <p style={{ fontSize: 13, color: "var(--color-tape-green)", textAlign: "center" }}>
            {claimMsg}
          </p>
        )}
        {claimErr && <p className="error-text" style={{ textAlign: "center" }}>{claimErr}</p>}

        {wallet && (
          <>
            <div className="divider">or receive to your address</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflowWrap: "anywhere",
                  fontSize: 12,
                  background: "var(--surface-elevated-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-buttons)",
                  padding: "10px 12px",
                }}
              >
                {wallet.address}
              </code>
              <button
                className="pill tab"
                onClick={() => void copy()}
                aria-label="Copy address"
                style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
              >
                {copied ? (
                  <>
                    Copied <Check size={13} aria-hidden />
                  </>
                ) : (
                  "Copy"
                )}
              </button>
            </div>
          </>
        )}
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
            {wallet ? `${liveSol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL spendable` : ""}
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
