// The Solana mark: three sheared bars in the official teal-to-purple
// gradient, used everywhere a SOL balance, stake, or payout is shown. Inline
// SVG so it scales crisply and needs no image asset (the sandbox blocks
// remote images anyway). Gradient id is per-instance so multiple marks on a
// page never collide.

import { useId } from "react";

export function Solana({ size = 16 }: { size?: number }) {
  const gid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 397.7 311.7"
      role="img"
      aria-label="Solana"
      style={{ display: "inline-block", verticalAlign: "-2px", flex: "none" }}
    >
      <defs>
        <linearGradient
          id={gid}
          x1="360.879"
          y1="351.455"
          x2="141.213"
          y2="-69.294"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gid})`}>
        {/* bottom bar */}
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
        {/* top bar */}
        <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
        {/* middle bar */}
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
      </g>
    </svg>
  );
}
