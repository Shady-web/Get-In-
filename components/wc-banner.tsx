// FIFA World Cup 26 promo banner: original inline-SVG artwork (golden
// trophy with glow + player silhouettes) so it stays crisp, matches the
// theme tokens, and ships no copyrighted photos.

export function WorldCupBanner() {
  return (
    <section className="wc-banner confetti" aria-label="FIFA World Cup 26">
      <svg
        className="wc-banner-art"
        viewBox="0 0 200 130"
        aria-hidden
        focusable="false"
      >
        <defs>
          <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe9a8" />
            <stop offset="0.45" stopColor="#ffc247" />
            <stop offset="1" stopColor="#b87f1e" />
          </linearGradient>
          <radialGradient id="glow" cx="0.5" cy="0.45" r="0.55">
            <stop offset="0" stopColor="#ffc247" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffc247" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* trophy glow */}
        <circle cx="100" cy="60" r="58" fill="url(#glow)" />

        {/* player silhouettes, striking poses */}
        <g fill="#0a0e28" opacity="0.9">
          {/* left: mid-kick */}
          <circle cx="38" cy="52" r="7" />
          <path d="M38 59 C30 66 30 76 34 84 L26 100 L31 103 L41 88 L44 96 L38 112 L44 114 L52 96 L46 82 C50 74 48 64 44 60 Z" />
          <circle cx="57" cy="104" r="5" fill="#1f2554" stroke="#3a4180" strokeWidth="1" />
          {/* right: arms-up celebration */}
          <circle cx="163" cy="50" r="7" />
          <path d="M163 57 C156 60 154 70 156 80 L152 108 L158 109 L163 88 L168 109 L174 108 L170 80 C172 70 170 60 163 57 Z" />
          <path d="M156 62 L146 48 L150 44 L159 58 Z" />
          <path d="M170 62 L180 48 L176 44 L167 58 Z" />
        </g>

        {/* the golden trophy: globe held by sweeping shoulders, on a base */}
        <g>
          <ellipse cx="100" cy="112" rx="26" ry="6" fill="#b87f1e" />
          <rect x="82" y="98" width="36" height="12" rx="4" fill="url(#gold)" />
          <path
            d="M92 98 C90 86 88 78 84 70 C78 58 82 46 92 44 C96 43 98 46 97 50 C104 46 110 42 100 34 C90 42 96 46 103 50 C102 46 104 43 108 44 C118 46 122 58 116 70 C112 78 110 86 108 98 Z"
            fill="url(#gold)"
          />
          <circle cx="100" cy="30" r="14" fill="url(#gold)" />
          {/* globe meridians */}
          <path
            d="M100 16 A14 14 0 0 1 100 44 M100 16 A14 14 0 0 0 100 44 M88 26 Q100 32 112 26 M88 35 Q100 29 112 35"
            fill="none"
            stroke="#b87f1e"
            strokeWidth="1.1"
            opacity="0.8"
          />
          {/* shine */}
          <path d="M93 22 Q90 30 94 38" stroke="#ffe9a8" strokeWidth="2" fill="none" opacity="0.9" />
        </g>
      </svg>

      <div className="wc-banner-text">
        <p className="caption" style={{ color: "var(--color-tape-green)" }}>
          The world is watching
        </p>
        <p className="wc-banner-title">
          FIFA WORLD CUP <span className="wc-banner-26">26</span>
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          Every match. Every market. Call it live on GetIN!!!
        </p>
      </div>
    </section>
  );
}
