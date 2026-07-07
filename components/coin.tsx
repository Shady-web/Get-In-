// The GetIN coin: a golden token with "GI" engraved, used everywhere a
// coin balance or stake is shown. Inline SVG so it scales crisply and needs
// no image asset (sandbox blocks remote images anyway).

export function Coin({ size = 16 }: { size?: number }) {
  const id = "gi"; // gradients are namespaced by id; one shared def is fine
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="GI coin"
      style={{ display: "inline-block", verticalAlign: "-2px", flex: "none" }}
    >
      <defs>
        <radialGradient id={`${id}-face`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="45%" stopColor="#ffcf4a" />
          <stop offset="100%" stopColor="#e0961b" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd766" />
          <stop offset="100%" stopColor="#b9740d" />
        </linearGradient>
      </defs>
      {/* outer rim */}
      <circle cx="16" cy="16" r="15" fill={`url(#${id}-rim)`} />
      {/* inner face */}
      <circle cx="16" cy="16" r="12" fill={`url(#${id}-face)`} />
      {/* engraved ring */}
      <circle
        cx="16"
        cy="16"
        r="12"
        fill="none"
        stroke="#a9690b"
        strokeOpacity="0.55"
        strokeWidth="1"
      />
      {/* GI monogram */}
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="12"
        fontWeight="800"
        fontFamily="var(--font-app), Inter Tight, system-ui, sans-serif"
        fill="#7a4d06"
        letterSpacing="-0.5"
      >
        GI
      </text>
      {/* top glint */}
      <ellipse cx="12" cy="9" rx="4.5" ry="2.4" fill="#fff6d5" opacity="0.55" />
    </svg>
  );
}
