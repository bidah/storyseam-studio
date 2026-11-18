---
name: providers
description: >-
  Resolve which backend renders this story and verify its access before anything is spent.
  Use for "/providers", "which provider am I on", "switch to atlas", "set up fal", "the MCP
  server isn't connected", "where do I put the API key". Storyseam is provider-agnostic: the
  pipeline is the same, the backend is config. NEVER handle a key value — name the env var
  and let the user set it.
---

# Providers — the backend is configuration, not code

The Storyseam spec is provider-agnostic. The script, the shot list, the block structure and
the continuity chain do not change when the backend does. What changes is **how a job is
submitted, how media is passed, and how access is proven** — and that lives in a provider
adapter, installed from the registry.

## `config.json`

A provider is named **per capability**, because a story can legitimately render video on one
backend and stills on another:

```json
"providers": {
  "video": { "id": "higgsfield", "access": "mcp" },
  "image": { "id": "higgsfield", "access": "mcp" }
}
```

```json
"providers": {
  "video": { "id": "atlas", "access": "api_key", "key_env": "ATLAS_KEY" },
  "image": { "id": "atlas", "access": "api_key", "key_env": "ATLAS_KEY" }
}
```

**`key_env` names a variable. It never holds a value.** `config.json` is committed; a key in
it is a leaked key.

## Access types

| `access` | What it means | How it is satisfied |
| --- | --- | --- |
| `mcp` | the provider is reached through MCP tools | the user connects the MCP server in their client — **Storyseam cannot install or connect it** |
| `api_key` | the provider is reached over HTTP with a bearer token | the user exports the named env var in the shell Storyseam runs in |

## The credential rule — this one is absolute

**Never ask the user to paste an API key into the chat. Never type one yourself. Never write
one into `config.json`, `storyseam.md`, `.storyseam/`, or any file.**

When a key is missing, say where to get it and what to export, then **stop**:

> Atlas Cloud needs an API key. Get one at https://www.atlascloud.ai, then
> `export ATLAS_KEY=...` in the shell you run Storyseam from, and re-run.

`bin/provider-check.py` reports only whether a variable is **set** and its **length** — never
its value, so a truncated paste is diagnosable without the secret ever being displayed.

## Resolve and verify — before anything is spent

```bash
bin/provider-check.py                     # every provider in ./config.json
bin/provider-check.py atlas fal           # specific ones
bin/registry-add.py provider-atlas        # install the adapter skill
```

The order at the start of any run that will cost money:

1. Read `config.json` → `providers.video.id`, `providers.image.id`, and `mcp_servers`: a
   provider reached by MCP has an entry there with its install command per agent
   (`docs/spec.md` §10). If its server is not connected, print that line
   (`npx storyseam mcp --agent <yours>`) and stop.
2. Install each adapter if missing (`bin/registry-add.py provider-<id>`).
3. `bin/provider-check.py`. For `api_key`, that is conclusive. For `mcp`, **probe the tool
   yourself** — the script cannot see your tools, it only tells you which one to probe.
4. If access is unsatisfied, **stop and say so**. Do not silently fall back to another
   provider: the shot list, the budget and the resolution were decided for the configured
   one, and a silent swap spends money the author did not agree to.

## What actually differs between backends

The adapter skills carry the detail. What the pipeline needs to know:

| | Higgsfield | Atlas Cloud | fal.ai |
| --- | --- | --- | --- |
| Access | `mcp` | `api_key` (`ATLAS_KEY`) | `api_key` (`FAL_KEY`) |
| Job shape | MCP tools | one prediction API, model in the body | a queue per endpoint, model in the path |
| Reference media | **upload → confirm → `media_id`** | plain public URLs | plain public URLs |
| Voice reference | black-frame `.mp4` in `video_references` | **`reference_audios`, native lip-sync** | (no Seed Audio equivalent) |
| Billing unit | credits | credits | **dollars, token-based** |

Three consequences worth internalising:

- **Media handling is the biggest practical difference.** On the API-key providers the stills
  must be *publicly reachable URLs*, so they have to be published somewhere before a render.
  `.storyseam/media.json` records how each reference was registered: a `media_id` on
  Higgsfield, a public `url` on Atlas or fal. The audit reads it the same way on both.
- **The black-frame voice trick is a Higgsfield workaround, not a Seedance requirement.** On
  Atlas, pass the `.mp3` directly in `reference_audios` and skip
  `bin/voice-to-blackmp4.sh` entirely.
- **`producer`'s credit arithmetic is Higgsfield-specific.** On fal, price in dollars —
  roughly $0.22 per second at 480p, so a 30s block is about $6.60. Reporting "300 credits"
  for a fal render tells the author nothing.

## Switching provider mid-story

Legitimate, but not free of consequences — say them out loud before doing it:

- **Model availability changes.** `gpt_image_2` is Higgsfield-only. Moving stills to Atlas
  means `image.model` becomes `nano_banana_2`, and `gpt-image-2-director` no longer applies —
  install the right director for the new model.
- **Already-rendered blocks do not match.** Different backends of the same model still differ in
  sampling. Switching mid-film shows at the seam. Finish the film, or re-render from block 1.
- **Re-run `/cast`.** References uploaded as Higgsfield `media_id`s mean nothing to Atlas;
  they need to be public URLs instead.

Check availability first — `providers.json` lists what each backend serves, and
`models.json` lists which providers serve a given model.
