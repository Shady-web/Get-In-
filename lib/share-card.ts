// Client-side: render the streak share card to a 1080x1080 PNG and download
// it. Pure canvas drawing in the Fey palette; no server involved.

interface ShareCardData {
  name: string;
  streak: number;
  points: number;
  bestStreak: number;
}

const C = {
  canvas: "#0e1233",
  card: "#171c44",
  border: "#262d5e",
  snow: "#ffffff",
  fog: "#9aa3c7",
  ember: "#ffc247",
};

export async function downloadStreakCard(data: ShareCardData): Promise<void> {
  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported in this browser.");

  const family =
    getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  // Make sure the webfont is ready before drawing with it.
  try {
    await document.fonts.ready;
  } catch {
    /* draw with whatever is available */
  }

  // Background
  ctx.fillStyle = C.canvas;
  ctx.fillRect(0, 0, size, size);

  // Card surface
  const pad = 90;
  const r = 48;
  ctx.fillStyle = C.card;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, r);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";

  // Section label
  ctx.fillStyle = C.ember;
  ctx.font = `500 34px ${family}`;
  ctx.fillText("G E T I N ! ! !   S T R E A K", size / 2, 235);

  // The number
  ctx.fillStyle = C.snow;
  ctx.font = `600 330px ${family}`;
  ctx.fillText(String(data.streak), size / 2, 620);

  // Caption
  ctx.fillStyle = C.fog;
  ctx.font = `400 42px ${family}`;
  ctx.fillText("correct calls in a row by", size / 2, 720);

  ctx.fillStyle = C.snow;
  ctx.font = `600 52px ${family}`;
  ctx.fillText(data.name, size / 2, 795);

  // Footer stats
  ctx.fillStyle = C.fog;
  ctx.font = `500 30px ${family}`;
  ctx.fillText(
    `${data.points} PTS TOTAL  ·  BEST STREAK ${data.bestStreak}  ·  WORLD CUP 2026`,
    size / 2,
    900,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not render the card.");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `getin-streak-${data.streak}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
