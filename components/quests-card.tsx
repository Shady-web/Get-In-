"use client";

// Daily quests: 3 rotating challenges a day with coin rewards. The board
// (and each claim) is validated server-side; this card just shows progress
// bars and a Claim button when a quest is finished.

import { useCallback, useEffect, useState } from "react";
import type { PlayerRecord, StoredPlayer } from "@/lib/player";
import { authFetch } from "@/lib/api-client";
import { Coin } from "@/components/coin";

interface QuestStatus {
  id: string;
  title: string;
  detail: string;
  reward: number;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
}

export function QuestsCard({
  player,
  onPlayerUpdate,
}: {
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
}) {
  const [quests, setQuests] = useState<QuestStatus[] | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/quests");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "quests unavailable");
      setQuests(body.quests as QuestStatus[]);
    } catch {
      setQuests(null); // no Supabase (or a hiccup): hide the card quietly
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(quest: QuestStatus) {
    setClaiming(quest.id);
    try {
      const res = await authFetch("/api/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questId: quest.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Could not claim.");
      if (body.player) onPlayerUpdate(body.player as PlayerRecord);
      setFlash(`+${body.reward} coins: ${quest.title}!`);
      window.setTimeout(() => setFlash(null), 4000);
      await load();
    } catch {
      await load(); // e.g. already claimed in another tab: resync
    } finally {
      setClaiming(null);
    }
  }

  if (!quests || quests.length === 0) return null;

  return (
    <section className="card fade-in" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <p className="caption section-label">🎯 Daily quests</p>
        <span className="muted" style={{ fontSize: 11 }}>
          new set at midnight UTC
        </span>
      </div>

      {flash && (
        <p className="fade-in" style={{ color: "var(--color-tape-green)", fontSize: 13, fontWeight: 600 }}>
          {flash}
        </p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {quests.map((q) => (
          <div key={q.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {q.title}
                <span className="muted" style={{ fontWeight: 400 }}>
                  {" "}
                  · {q.detail}
                </span>
              </span>
              <span className="quest-bar" aria-hidden>
                <span
                  className="quest-bar-fill"
                  style={{ width: `${Math.round((q.progress / q.target) * 100)}%` }}
                />
              </span>
            </span>
            <span className="muted" style={{ fontSize: 11, minWidth: 34, textAlign: "right" }}>
              {q.progress}/{q.target}
            </span>
            {q.claimed ? (
              <span style={{ color: "var(--color-tape-green)", fontSize: 12, fontWeight: 600 }}>
                Claimed ✓
              </span>
            ) : q.done ? (
              <button
                className="pill tab active"
                disabled={claiming === q.id}
                onClick={() => void claim(q)}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {claiming === q.id ? (
                  "..."
                ) : (
                  <>
                    Claim +{q.reward} <Coin size={13} />
                  </>
                )}
              </button>
            ) : (
              <span
                style={{
                  color: "var(--color-ember-orange)",
                  fontSize: 12,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                +{q.reward} <Coin size={13} />
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
