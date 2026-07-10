// Pure match-status helpers, shared by server AND browser. No env access, no
// Supabase, no fetch in here. (The old minute-by-minute prediction card lived
// here too; it was removed along with the points game — betting is the game
// now.)

const FINAL_STATUSES = new Set(["F", "FET", "FPE", "A", "C"]);

/** True once a match has reached a terminal status (full time, abandoned, etc.). */
export function isFinal(statusId: string | null): boolean {
  return statusId !== null && FINAL_STATUSES.has(statusId);
}
