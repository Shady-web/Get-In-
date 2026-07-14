"use client";

// "How GetIN works" — opens automatically on a player's first visit and on
// demand from the coin pill in the header. The body is the shared <HowItWorks>
// component, so this modal and the logged-out landing never show different
// copy.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { HowItWorks } from "@/components/how-it-works";

const SEEN_KEY = "getin.economySeen";

/** Controls first-visit auto-open; the header button can force it too. */
export function useEconomyExplainer() {
  const [open, setOpen] = useState(false);
  // Whether the player has dismissed the explainer ("Got it") at least once.
  // Starts false so first-time visitors still see the inline how-it-works.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY)) {
        setSeen(true);
      } else {
        const id = window.setTimeout(() => setOpen(true), 700);
        return () => window.clearTimeout(id);
      }
    } catch {
      /* ignore */
    }
  }, []);
  function close() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setSeen(true);
    setOpen(false);
  }
  return { open, seen, openExplainer: () => setOpen(true), close };
}

export function EconomyExplainer({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="How GetIN works" onClick={onClose}>
      <div className="modal-sheet fade-in" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p className="caption section-label" style={{ color: "#5ff29a" }}>
              How it works
            </p>
            <h2 className="display" style={{ fontSize: 28, marginTop: 3 }}>
              How GetIN works
            </h2>
          </div>
          <button className="pill tab" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>

        <HowItWorks intro />

        <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 4 }}>
          Got it
        </button>
      </div>
    </div>
  );
}
