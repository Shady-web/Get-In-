// The GetIN wordmark (1d "Ping Minimal"): lowercase "getin" with a green "in"
// and a single live ping dot standing in for the dot on the "i". Rendered in
// the app's own Archivo font so it matches the product and scales with `size`.

export function GetinWordmark({ size = 20 }: { size?: number }) {
  const dot = Math.round(size * 0.26);
  return (
    <span
      role="img"
      aria-label="getin"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.round(size * 0.34),
        fontFamily: "var(--font-app)",
        fontWeight: 800,
        fontSize: size,
        letterSpacing: `${size * 0.05}px`,
        lineHeight: 1,
        whiteSpace: "nowrap",
        textTransform: "none",
      }}
    >
      <span>
        <span style={{ color: "#EAF0EA" }}>get</span>
        <span style={{ color: "#39FF14" }}>in</span>
      </span>
      <span
        className="getin-dot"
        aria-hidden
        style={{ width: dot, height: dot, borderRadius: "50%", background: "#39FF14" }}
      />
    </span>
  );
}
