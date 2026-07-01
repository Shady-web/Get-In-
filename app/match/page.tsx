"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  clearStoredPlayer,
  displayName,
  getStoredPlayer,
  type StoredPlayer,
} from "@/lib/player";

export default function MatchScreen() {
  const router = useRouter();
  const { disconnect } = useWallet();
  const [player, setPlayer] = useState<StoredPlayer | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const stored = getStoredPlayer();
    if (!stored) {
      router.replace("/");
      return;
    }
    setPlayer(stored);
    setChecked(true);
  }, [router]);

  function signOut() {
    clearStoredPlayer();
    disconnect().catch(() => {});
    router.replace("/");
  }

  if (!checked || !player) return null;

  const points = player.player?.total_points ?? 0;
  const streak = player.player?.best_streak ?? 0;

  return (
    <main className="shell" style={{ gap: "var(--section-gap)" }}>
      <header className="topbar">
        <div className="brand">
          GetIN<span className="bang">!!!</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="pill" title={player.identity}>
            {displayName(player)}
          </span>
          <button
            className="pill"
            onClick={signOut}
            style={{ cursor: "pointer", color: "var(--color-fog)" }}
          >
            Out
          </button>
        </div>
      </header>

      <section style={{ display: "flex", gap: 10 }}>
        <span className="pill">
          <span className="k">Points</span> {points}
        </span>
        <span className="pill">
          <span className="k">Best streak</span> {streak}
        </span>
      </section>

      <section style={{ display: "grid", gap: "var(--element-gap)" }}>
        <p className="caption section-label">Matches</p>

        <div className="card" style={{ textAlign: "center", display: "grid", gap: 8 }}>
          <h2 className="heading-sm">No matches on the board yet</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Fixtures land here as soon as they go live. Your picks, odds and
            points will all live on this screen.
          </p>
        </div>

        {/* Placeholder rows hinting at the fixture list to come */}
        <div className="row" aria-hidden>
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 99 }} />
          <div style={{ flex: 1, display: "grid", gap: 6 }}>
            <div className="skeleton" style={{ height: 12, width: "60%" }} />
            <div className="skeleton" style={{ height: 10, width: "35%" }} />
          </div>
          <div className="skeleton" style={{ height: 24, width: 52, borderRadius: 6 }} />
        </div>
        <div className="row" aria-hidden style={{ opacity: 0.6 }}>
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 99 }} />
          <div style={{ flex: 1, display: "grid", gap: 6 }}>
            <div className="skeleton" style={{ height: 12, width: "50%" }} />
            <div className="skeleton" style={{ height: 10, width: "30%" }} />
          </div>
          <div className="skeleton" style={{ height: 24, width: 52, borderRadius: 6 }} />
        </div>
      </section>
    </main>
  );
}
