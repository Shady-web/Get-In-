/**
 * Server-only TxLINE client.
 *
 * This reads your TxLINE API token from the environment, so it must NEVER be
 * imported from a Client Component or shipped to the browser. Only server code
 * (API routes / Server Components) should touch this file.
 *
 * Every TxLINE data request needs TWO credentials:
 *   - a short-lived guest JWT (fetched fresh here, per request)
 *   - your long-lived API token (from scripts/setup-txline.ts), kept server-side
 */

function requireEnv() {
  const apiBase = process.env.TXLINE_API_BASE; // e.g. https://txline-dev.txodds.com/api
  const apiToken = process.env.TXLINE_API_TOKEN; // printed by scripts/setup-txline.ts
  if (!apiBase) {
    throw new Error("TXLINE_API_BASE is not set — see .env.example (put it in .env.local).");
  }
  if (!apiToken) {
    throw new Error("TXLINE_API_TOKEN is not set — run `npm run setup:txline`, then add it to .env.local.");
  }
  return { apiBase, apiToken };
}

/** The guest JWT is short-lived, so grab a fresh one for each request. */
async function getGuestJwt(origin: string): Promise<string> {
  const res = await fetch(`${origin}/auth/guest/start`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Guest auth failed: HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body?.token) throw new Error("Guest auth returned no token.");
  return body.token;
}

/**
 * Read a response body, but stop after `maxMs` if the server keeps the
 * connection open (live SSE streams for in-play matches never "end").
 * Whatever arrived before the cutoff is returned.
 */
async function readBodyWithTimeLimit(res: Response, maxMs: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const decoder = new TextDecoder();
  let out = "";
  const deadline = Date.now() + maxMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (chunk === "timeout") break;
    if (chunk.done) return out + decoder.decode();
    out += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return out;
}

/**
 * Some TxLINE endpoints (e.g. /scores/updates/{fixtureId}) respond as a
 * Server-Sent Events stream: one "data: {...}" line per update, not a JSON
 * array. Parse those lines into an array of objects.
 */
function parseSseEvents(text: string): unknown[] {
  const events: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // Ignore a trailing half-received event from a live stream cutoff.
    }
  }
  return events;
}

/**
 * GET a TxLINE data endpoint (path is relative to the API base, e.g.
 * "/fixtures/snapshot"). Returns parsed JSON — and if the endpoint responds
 * as an SSE stream, returns the parsed events as an array instead.
 */
export async function txlineGet<T = unknown>(pathAndQuery: string): Promise<T> {
  const { apiBase, apiToken } = requireEnv();
  const origin = apiBase.replace(/\/api\/?$/, ""); // strip trailing /api for the auth host
  const jwt = await getGuestJwt(origin);

  const res = await fetch(`${apiBase}${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Api-Token": apiToken,
    },
    cache: "no-store", // sports data is live — never cache it
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isStream = contentType.includes("text/event-stream");

  // For live streams, collect up to 5s of events; normal responses read fully.
  const text = isStream ? await readBodyWithTimeLimit(res, 5_000) : await res.text();

  if (!res.ok) {
    throw new Error(`TxLINE ${pathAndQuery} failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const trimmed = text.trim();
  if (!trimmed) return null as T;
  if (isStream || trimmed.startsWith("data:")) {
    return parseSseEvents(trimmed) as T;
  }
  return JSON.parse(trimmed) as T;
}
