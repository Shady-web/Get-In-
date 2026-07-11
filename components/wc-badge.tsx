// The FIFA World Cup 26 emblem, shown as a rounded badge tile so its square
// black artwork reads as an intentional crest against the app's dark canvas.
// The asset lives in /public (user-provided); swap public/wc26.jpg to change
// it. Decorative — labelled for screen readers, never a load-bearing control.

export function WcBadge({ size = 28, ring = true }: { size?: number; ring?: boolean }) {
  return (
    <img
      src="/wc26.jpg"
      alt="FIFA World Cup 26"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        flex: "none",
        objectFit: "cover",
        borderRadius: Math.max(6, Math.round(size * 0.26)),
        border: ring ? "1px solid var(--color-border)" : "none",
        boxShadow: ring ? "var(--frost-edge), 0 0 16px rgba(255, 197, 48, 0.14)" : "none",
      }}
    />
  );
}
