# Deploying the flue agent (shot-studio-flue)

The chat agent is its own Cloudflare Worker (`shot-studio-flue`). The main
`shot-studio-uploads` Worker proxies `/eve/*` to it. These steps need your
Cloudflare account (an authenticated `wrangler`) and the secrets below.

## 1. Authenticate

```bash
cd flue-agent
npx wrangler login    # if not already logged in
```

## 2. (Optional) Cloudflare AI Gateway for Anthropic

To route the Anthropic calls through AI Gateway (caching / logging / limits):

1. Create a gateway in the Cloudflare dashboard (AI → AI Gateway).
2. The Anthropic endpoint is:
   `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/anthropic`
3. Set it as the `ANTHROPIC_GATEWAY_URL` secret below. If unset, calls go direct
   to Anthropic with `ANTHROPIC_API_KEY`.

## 3. Set secrets

```bash
cd flue-agent
npx wrangler secret put ANTHROPIC_API_KEY        # Anthropic key
npx wrangler secret put FLUE_PROXY_SECRET        # MUST equal the main Worker's
npx wrangler secret put SHOT_STUDIO_API          # main Worker origin, e.g. https://shot-studio-uploads.<...>.workers.dev
npx wrangler secret put HIGGSFIELD_MCP_URL       # https://mcp.higgsfield.ai/mcp
npx wrangler secret put DAYTONA_API_KEY          # optional (bash/skills sandbox)
npx wrangler secret put ANTHROPIC_GATEWAY_URL    # optional (step 2)
```

`FLUE_PROXY_SECRET` is the shared HMAC key. Set the SAME value here and on the
main Worker (`cd ../worker && npx wrangler secret put FLUE_PROXY_SECRET`). Until
then the main Worker falls back to the already-provisioned `EVE_PROXY_SECRET`, so
setting `FLUE_PROXY_SECRET` on this worker to the same value also works.

## 4. Deploy

```bash
# from repo root
npm run flue:deploy        # flue build && wrangler deploy  (in flue-agent/)
```

Note the deployed URL (e.g. `https://shot-studio-flue.<subdomain>.workers.dev`).

## 5. Point the main Worker at it

`worker/wrangler.jsonc` has `FLUE_ORIGIN` set to the flue Worker URL — confirm it
matches the deployed URL, then deploy the main Worker:

```bash
npm run worker:deploy
```

(A later consolidation can replace the public-URL proxy with a Cloudflare
**service binding** between the two Workers.)

## 6. Retire the old eve agent

The eve agent was a Vercel project (`shot-studio-agent`). After confirming the
flue agent works, delete that Vercel project (or stop deploying it). The repo's
root `vercel.json` and the `agent/` directory have already been removed.

## Verify

Chat in the app: send a turn, confirm streaming, a tool that writes (e.g.
`save_shotlist`), a Higgsfield render, and the model picker switching Sonnet /
Opus / Fable. The auth boundary can be smoke-tested with `flue dev`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/health          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/agents/whistlewood/u~p~c   # 401 (no proxy header)
```
