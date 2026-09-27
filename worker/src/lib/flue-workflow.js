// Talking to a Cloudflare Workflow that lives on the flue worker
// (flue-agent/src/cloudflare.ts): the Deep Film's writers' room (/rooms/:id)
// and every Film's Script flow (/scripts/:id). Both are started by a Film
// stage here, which then only polls the doc the workflow keeps; this is the
// start/status leg, with the worker-minted `x-flue-proxy-user` credential.
import { mintToken, proxySecret, PROXY_HEADER, PROXY_ISSUER } from "./proxy-token.js";

/** A request to the flue worker as `userId`. `what` names it in errors ("The writers' room"). */
export async function flueFetch(env, path, { userId, method = "GET", body, what = "The flue worker" } = {}) {
  const secret = proxySecret(env);
  if (!secret) throw new Error(`FLUE_PROXY_SECRET is not set — ${what.toLowerCase()} cannot be started.`);
  const headers = new Headers({ [PROXY_HEADER]: await mintToken(userId, secret, PROXY_ISSUER) });
  if (body) headers.set("content-type", "application/json");
  const init = { method, headers, body: body ? JSON.stringify(body) : undefined };
  const origin = env.FLUE_V2_ORIGIN || "https://shot-studio-flue-v2.rodrigofigueroa-name.workers.dev";
  const res = env.FLUE_V2?.fetch
    ? await env.FLUE_V2.fetch(new Request(`https://flue.internal${path}`, init))
    : await fetch(`${origin}${path}`, init);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`${what} (${res.status}): ${data.error || data.raw || res.statusText}`);
  return data;
}
