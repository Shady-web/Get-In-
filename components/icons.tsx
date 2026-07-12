// Shared Lucide icon helpers. Real vector icons replace the emoji/glyph
// stand-ins the UI used before, so everything renders identically across
// platforms (no emoji-font roulette) and inherits currentColor.

import { Check, X, Ban, Circle, Medal, Banknote, Dices, Crown, Lock } from "lucide-react";

export type LegResult = "won" | "lost" | "void" | "pending" | string;

/**
 * The small win / lose / void / open marker used on bet legs and slips.
 * Inherits color from the parent (Lucide draws in currentColor).
 */
export function ResultIcon({ result, size = 14 }: { result: LegResult; size?: number }) {
  const props = { size, strokeWidth: 2.75, "aria-hidden": true } as const;
  if (result === "won") return <Check {...props} />;
  if (result === "lost") return <X {...props} />;
  if (result === "void") return <Ban {...props} />;
  return <Circle {...props} />;
}

// Milestone badge icons, keyed by the semantic name stored in BADGE_DEFS.
const BADGE_ICONS: Record<string, typeof Medal> = {
  medal: Medal, // first win
  banknote: Banknote, // first cash out
  dices: Dices, // 5-leg parlay
  crown: Crown, // bankroll milestone
};

/** A badge's icon when earned, or a padlock while it is still locked. */
export function BadgeIcon({
  name,
  earned,
  size = 22,
}: {
  name: string;
  earned: boolean;
  size?: number;
}) {
  if (!earned) return <Lock size={size} aria-hidden />;
  const Icon = BADGE_ICONS[name] ?? Medal;
  return <Icon size={size} aria-hidden />;
}
