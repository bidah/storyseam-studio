# Deploying the flue agent (shot-studio-flue-v2)

The chat agent is its own Cloudflare Worker (`shot-studio-flue-v2`). The main
`shot-studio-uploads` Worker proxies `/eve/*` to it. These steps need your
Cloudflare account (an authenticated `wrangler`) and the secrets below.

> **Two agent workers are deployed at once.** `shot-studio-flue` (flue 1) stays
> live and untouched: flue 2 stores persisted schema version 8 and the runtime
> REJECTS a version-5 database before any application code runs, so upgrading in
> place would have destroyed every existing chat transcript. Each conversation is
> pinned to the engine that holds it — the `/eve` proxy routes on the chat id's
> `f2-` prefix — and v1 is frozen: no feature lands there.

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

These are set PER WORKER, so the new worker needs its own copies — a secret on
`shot-studio-flue` does not carry over to `shot-studio-flue-v2`.

```bash
cd flue-agent
npx wrangler secret put FLUE_PROXY_SECRET        # MUST equal the main Worker's
npx wrangler secret put SHOT_STUDIO_API          # main Worker origin, e.g. https://shot-studio-uploads.<...>.workers.dev
npx wrangler secret put HIGGSFIELD_MCP_URL       # https://mcp.higgsfield.ai/mcp
npx wrangler secret put CEREBRAS_API_KEY         # required for any cerebras/* turn
npx wrangler secret put DAYTONA_API_KEY          # optional (persistent sandbox tier + upgrade_sandbox)
npx wrangler secret put ANTHROPIC_API_KEY        # optional (no anthropic/* model is allowlisted today)
npx wrangler secret put ANTHROPIC_GATEWAY_URL    # optional (step 2)
npx wrangler secret put CEREBRAS_GATEWAY_URL     # optional
npx wrangler secret put FAL_KEY                  # optional operator fallback (primary path is BYOK)
npx wrangler secret put ATLAS_KEY                # optional operator fallback
npx wrangler secret put EXA_API_KEY              # optional operator fallback
npx wrangler secret put FIRECRAWL_API_KEY        # optional operator fallback
```

`FLUE_PROXY_SECRET` is the shared HMAC key. Set the SAME value here and on the
main Worker (`cd ../worker && npx wrangler secret put FLUE_PROXY_SECRET`). Until
then the main Worker falls back to the already-provisioned `EVE_PROXY_SECRET`, so
setting `FLUE_PROXY_SECRET` on this worker to the same value also works.

## 4. Deploy

```bash
# from repo root
npm run flue:deploy        # vite build && wrangler deploy  (in flue-agent/)
```

`vite build` writes the finalized wrangler config into `dist/` with a deploy
redirect, so `wrangler deploy` runs from the project root with **no `--config`
flag**. Note the deployed URL (e.g.
`https://shot-studio-flue-v2.<subdomain>.workers.dev`).

## 5. Point the main Worker at it

`worker/wrangler.jsonc` declares both origins (`FLUE_ORIGIN`, `FLUE_V2_ORIGIN`)
and both service bindings (`FLUE`, `FLUE_V2`) — confirm `FLUE_V2_ORIGIN` matches
the deployed URL, then deploy the main Worker:

```bash
npm run worker:deploy
```

The service binding requires `shot-studio-flue-v2` to exist already, so deploy
the agent (step 4) BEFORE the main Worker.

## 6. Cut new chats over

`FLUE_V2_NEW_CHATS` in `worker/wrangler.jsonc` is the switch, and the only one:

- `"0"` (default) — new chats are minted on flue 1. v2 is live but unaddressed.
- `"1"` — new chats get an `f2-` id and run on flue 2. Existing chats are
  untouched either way.

Both clients read it from `/eve/health` at startup, so flipping it takes effect
within one page load, with no client redeploy. **Rollback is flipping it back**:
new chats return to v1, and chats already created on v2 keep working on v2,
because their transcripts live there.

Retire `shot-studio-flue` only once old chats stop being opened.

## Verify

Smoke-test the new worker directly before touching the switch — with a
hand-minted proxy token against a scratch project, run: a `get_status` turn, a
`render_ui` card, one subagent delegation, **one bash call in a chat that has NOT
opted into Daytona** (proves the explicit in-memory sandbox — flue 2 gives an
agent without `useSandbox()` no shell at all), one Higgsfield render (proves the
MCP connection), and one gated `restore_version` (proves the two-phase approval
still spans two turns).

`npm run flue:dev` serves the worker locally on Vite for the auth boundary:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/health                    # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/agents/whistlewood/u~p~c  # 401 (no proxy header)
```

A hand-rolled send posts the message object BARE — `{"kind":"user","body":"…"}`,
not `{"message":{…}}` — and returns `202` with a `streamUrl` / `submissionId`;
read the reply back with a `GET` on the same URL.

Then watch Workers Logs on both agent workers for a week. A `submission_settled`
with a non-`completed` outcome is the signal that matters.
