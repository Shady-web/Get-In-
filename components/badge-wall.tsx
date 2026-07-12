"use client";

// Badge wall: milestone badges (first cash out, 5-leg parlay win, 10-win
// streak, ...). The server awards them idempotently on read, so anything
// already achieved lights up the first time this loads.

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { authFetch } from "@/lib/api-client";
import { BadgeIcon } from "@/components/icons";

interface BadgeStatus {
  id: string;
  icon: string;
  name: string;
  hint: string;
  earnedAt: string | null;
}

export function BadgeWall() {
  const [badges, setBadges] = useState<BadgeStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch("/api/badges")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body?.error ?? "badges unavailable");
        if (!cancelled) setBadges(body.badges as BadgeStatus[]);
      })
      .catch(() => {
        if (!cancelled) setBadges(null); // no Supabase: hide quietly
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!badges) return null;
  const earned = badges.filter((b) => b.earnedAt).length;

  return (
    <section className="card fade-in" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <p className="caption section-label">
          <Trophy size={13} aria-hidden style={{ verticalAlign: -2, marginRight: 5 }} /> Badges
        </p>
        <span className="muted" style={{ fontSize: 11 }}>
          {earned}/{badges.length} earned
        </span>
      </div>
      <div className="badge-grid">
        {badges.map((b) => (
          <div
            key={b.id}
            className={`badge ${b.earnedAt ? "earned" : "locked"}`}
            title={b.hint}
          >
            <span className="badge-icon" aria-hidden>
              <BadgeIcon name={b.icon} earned={Boolean(b.earnedAt)} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{b.name}</span>
            <span className="muted" style={{ fontSize: 10.5 }}>
              {b.earnedAt
                ? new Date(b.earnedAt).toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                  })
                : b.hint}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
