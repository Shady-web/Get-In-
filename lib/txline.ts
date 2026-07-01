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
 * GET a TxLINE data endpoint (path is relative to the API base, e.g.
 * "/fixtures/snapshot"). Returns the parsed JSON body.
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

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`TxLINE ${pathAndQuery} failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}
