// The GetIN logo mark: a rounded dark tile with the glowing green "i" (dot +
// bar) that stands in for the "IN" of GetIN. Rendered inline as an SVG so it
// stays crisp at any size and never depends on a font. Decorative brand tile,
// labelled for screen readers. Mirrors public/getin-appicon.svg.

export function GetinMark({ size = 26 }: { size?: number }) {
  const glowId = "getin-mark-glow";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="GetIN"
      style={{ flex: "none", display: "block", borderRadius: Math.round(size * 0.22) }}
    >
      <defs>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#39FF14" floodOpacity="0.55" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="22" fill="#0a0a0a" />
      <g filter={`url(#${glowId})`}>
        <rect x="43" y="40" width="14" height="44" rx="4" fill="#39FF14" />
        <circle cx="50" cy="24" r="10" fill="#39FF14" />
        <circle cx="50" cy="24" r="10" fill="none" stroke="#39FF14" strokeWidth="3" />
      </g>
    </svg>
  );
}
