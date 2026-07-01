import type { ReactNode } from "react";
import { txlineGet } from "@/lib/txline";

// Fetch fresh on every load so we're testing the live TxLINE connection.
export const dynamic = "force-dynamic";

// A deliberately plain smoke-test page: it just proves the server-side token
// works end to end. The real, styled UI comes later (refero-ui-styles skill).
export default async function Home() {
  let status: ReactNode;
  try {
    const data = await txlineGet<unknown[]>("/fixtures/snapshot");
    const fixtures = Array.isArray(data) ? data : [];
    status = (
      <>
        <p style={{ color: "#0a7d34" }}>✅ Connected to TxLINE — {fixtures.length} fixtures returned.</p>
        <pre style={preStyle}>{JSON.stringify(fixtures.slice(0, 3), null, 2)}</pre>
      </>
    );
  } catch (err) {
    status = (
      <p style={{ color: "#b00020" }}>
        ⚠️ {err instanceof Error ? err.message : "Could not reach TxLINE."}
      </p>
    );
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ margin: 0 }}>GetIN!!!</h1>
      <p style={{ color: "#555" }}>World Cup fixtures via the server-side TxLINE route.</p>
      {status}
      <p>
        Raw JSON: <a href="/api/worldcup">/api/worldcup</a>
      </p>
    </main>
  );
}

const mainStyle = {
  fontFamily: "system-ui, sans-serif",
  padding: 24,
  maxWidth: 640,
  margin: "0 auto",
  lineHeight: 1.5,
} as const;

const preStyle = {
  background: "#f4f4f5",
  padding: 12,
  borderRadius: 8,
  overflowX: "auto",
  fontSize: 13,
} as const;
