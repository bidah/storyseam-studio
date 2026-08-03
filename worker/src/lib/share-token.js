// Share-link tokens for the PUBLIC read-only script view.
//
// A share link must be resolvable with no session and no x-project-id header,
// but the docs table is keyed (project_id, name) — there is no index that finds
// a doc by token alone. So the token carries the project id itself:
//
//   <base64url(projectId)>.<128-bit random hex>
//
// The random half is the actual credential. It is minted once, stored in the
// project's `script-share` doc, and the public route verifies a presented token
// by re-reading that doc and comparing constant-time — which is also what makes
// a link revocable: clear the doc and every copy of the link dies. No signing
// secret is involved, so nothing here can ever double as an identity assertion
// (see lib/proxy-token.js for why that matters when secrets are shared).

const b64u = (s) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64uDecode = (s) => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
};

export function makeShareToken(projectId) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${b64u(String(projectId))}.${secret}`;
}

// The project id a token claims to be for, or null on garbage. The claim is
// NOT trusted on its own — it only tells the route which `script-share` doc to
// check the token against.
export function shareTokenProject(token) {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  try {
    const pid = b64uDecode(token.slice(0, dot));
    return /^[a-zA-Z0-9._-]+$/.test(pid) ? pid : null;
  } catch {
    return null;
  }
}

// Constant-time equality via digest comparison (same shape as the MCP bearer
// check in routes/mcp.js) so a mismatch can't leak where it diverged.
export async function shareTokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
