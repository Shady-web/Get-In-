import { NextResponse } from "next/server";

// Tiny image proxy for country flags (flagcdn.com), served from OUR origin
// so the browser never talks to third parties and flags work behind strict
// networks. Flags are immutable: cache hard.

const CODE_RE = /^[a-z]{2}(-[a-z]{3})?$/; // "ba", "gb-eng"
const memory = new Map<string, ArrayBuffer>();

export async function GET(
  request: Request,
  { params }: { params: { code: string } },
) {
  const { searchParams } = new URL(request.url);
  const retina = searchParams.get("2x") !== null;
  const code = params.code.toLowerCase();
  if (!CODE_RE.test(code)) {
    return NextResponse.json({ error: "Bad flag code." }, { status: 400 });
  }

  const key = `${code}:${retina ? 2 : 1}`;
  let buf = memory.get(key);
  if (!buf) {
    const res = await fetch(
      `https://flagcdn.com/${retina ? "w80" : "w40"}/${code}.png`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "Flag not found." }, { status: 404 });
    }
    buf = await res.arrayBuffer();
    memory.set(key, buf);
  }

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
