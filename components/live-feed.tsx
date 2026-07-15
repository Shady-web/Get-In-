"use client";

// Live match feed: goals and cards as they happen, in a collapsible panel so
// the live match page stays uncluttered. Polls our own /api/events route (the
// same live scores the rest of the page reads) every few seconds. Rendered
// through the shared MatchEventsCard, collapsed by default.

import { useCallback, useEffect, useState } from "react";
import { MatchEventsCard } from "@/components/match-events-card";
import type { MatchEvent } from "@/lib/replay-core";

export function LiveFeed({
  fixtureId,
  home,
  away,
}: {
  fixtureId: number;
  home: string;
  away: string;
}) {
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [clock, setClock] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/events/${fixtureId}`);
      const body = await res.json();
      if (!res.ok || !body.ok) return;
      setEvents(body.events as MatchEvent[]);
      setClock(Number(body.clockSeconds) || 0);
      setLoaded(true);
    } catch {
      /* next poll */
    }
  }, [fixtureId]);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), 10_000);
    return () => window.clearInterval(id);
  }, [poll]);

  if (!loaded) return null; // don't flash an empty card before the first read

  return (
    <MatchEventsCard
      events={events}
      // Show everything up to the current clock (all fetched events qualify).
      vt={Math.max(clock, events.reduce((m, e) => Math.max(m, e.t), 0)) + 1}
      home={home}
      away={away}
      title="Live feed"
      defaultOpen={false}
      hideWhenEmpty={false}
    />
  );
}
