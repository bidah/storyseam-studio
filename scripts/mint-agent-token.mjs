/**
 * Mint the `x-flue-agent-user` assertion a script needs to write through
 * `/api/*` without a browser session.
 *
 *   FLUE_PROXY_SECRET=… node scripts/mint-agent-token.mjs <userId>
 *
 * The same credential the flue agent's tools carry, and verified by the same
 * code (worker/src/lib/proxy-token.js). It is short-lived by design — five
 * minutes — so a long import re-mints rather than holding one open.
 *
 * Against a REAL deployment prefer the session cookie: this needs the
 * deployment's signing secret, and a secret that travels to run a one-off
 * script is a secret with more copies than it had yesterday. Its reason for
 * existing is `wrangler dev`, where there is no browser to sign in with.
 */
import crypto from "node:crypto";

const AGENT_ISSUER = "shot-studio-agent";
const TTL_SECONDS = 300;

const userId = process.argv[2];
const secret = process.env.FLUE_PROXY_SECRET;
if (!userId || !secret) {
  console.error("usage: FLUE_PROXY_SECRET=… node scripts/mint-agent-token.mjs <userId>");
  process.exit(2);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const payload = b64url(
  JSON.stringify({ sub: String(userId), iss: AGENT_ISSUER, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }),
);
const sig = crypto.createHmac("sha256", secret).update(payload).digest();
process.stdout.write(`${payload}.${b64url(sig)}`);
