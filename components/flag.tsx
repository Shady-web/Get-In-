"use client";

// Country flag chip next to team names. Images come from flagcdn.com
// (free public flag CDN, every FIFA nation incl. gb-eng style codes).
// Unknown teams or failed loads fall back to a ball glyph so fixtures
// never look broken offline or in mock mode.

import { useState } from "react";
import { flagCode, flagUrl } from "@/lib/flags";

export function Flag({ country, size = 18 }: { country: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const code = flagCode(country);
  const h = Math.round(size * 0.75);

  if (!code || failed) {
    return (
      <span
        className="flag-fallback"
        style={{ width: size, height: h, fontSize: h - 2 }}
        aria-hidden
      >
        ⚽
      </span>
    );
  }

  return (
    <img
      className="flag-img"
      src={flagUrl(code)}
      srcSet={`${flagUrl(code, true)} 2x`}
      width={size}
      height={h}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
