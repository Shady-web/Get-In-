"use client";

import type { ReactNode } from "react";

// Auth is Supabase (email/password + Google); there is no wallet-adapter
// context anymore. Kept as a mount point for future client-wide providers.
export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
