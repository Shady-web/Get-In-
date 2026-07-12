import { type Dispatch, type SetStateAction, useEffect } from "react";

/**
 * Clear a transient message a few seconds after it's set, so success/error
 * notifications don't linger on screen. Pass the state value and its setter;
 * the setter is stable, so the timer resets only when the message changes.
 */
export function useAutoClear(
  value: string | null,
  setValue: Dispatch<SetStateAction<string | null>>,
  ms = 4000,
) {
  useEffect(() => {
    if (!value) return;
    const t = window.setTimeout(() => setValue(null), ms);
    return () => window.clearTimeout(t);
  }, [value, setValue, ms]);
}
