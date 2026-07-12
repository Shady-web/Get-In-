"use client";

// Daily bonus: a free 100 GI-coin claim once per UTC day. Sits at the top of
// the Matches tab for signed-in players. Reads today's claim status on mount,
// and updates the header coin balance the moment you claim.

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api-client";
import { Coin } from "@/components/coin";
import { useAutoClear } from "@/lib/use-auto-clear";
import type { PlayerRecord, StoredPlayer } from "@/lib/player";

export function DailyBonus({
  player,
  onPlayerUpdate,
}: {
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
}) {
  const [claimed, setClaimed] = useState<boolean | null>(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useAutoClear(msg, setMsg);
  useAutoClear(error, setError);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/claim/daily");
      const body = await res.json();
      setClaimed(body?.ok ? Boolean(body.coins) : false);
    } catch {
      setClaimed(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, player.identity]);

  async function claim() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await authFetch("/api/claim/daily", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Could not claim.");
      if (body.player) onPlayerUpdate(body.player as PlayerRecord);
      setClaimed(true);
      setMsg(`+${body.reward} coins added to your balance`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim.");
    } finally {
      setBusy(false);
    }
  }

  if (claimed === null) return null; // don't flash before status loads

  return (
    <div className="card fade-in" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span className={`daily-coin ${claimed ? "done" : ""}`} aria-hidden>
        <Coin size={26} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
        <p className="caption section-label" style={{ margin: 0 }}>
          Daily bonus
        </p>
        <p className="muted" style={{ fontSize: 12.5 }}>
          {claimed
            ? "Claimed today — come back tomorrow for 100 more."
            : "Grab 100 free GI coins, every day."}
        </p>
        {msg && (
          <p className="caption" style={{ color: "var(--color-tape-green)", letterSpacing: 0 }}>
            {msg}
          </p>
        )}
        {error && <p className="error-text" style={{ fontSize: 12 }}>{error}</p>}
      </div>
      <button
        className="btn btn-primary"
        style={{ width: "auto", flex: "none", minHeight: 44, padding: "10px 18px" }}
        disabled={busy || claimed}
        onClick={() => void claim()}
      >
        {claimed ? "Claimed" : busy ? "Claiming…" : "Claim 100"}
      </button>
    </div>
  );
}
