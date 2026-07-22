# Agent evals (vitest-evals)

Behavioural checks against a **running** whistlewood agent — does it answer, and
does it reach for the right tool? These are separate from `npm test`: they need a
live agent endpoint and burn model credits, so they run behind `FLUE_BASE_URL`.

## Run

```sh
# 1. start the agent locally (its own Cloudflare Worker)
npm run flue:dev            # → http://localhost:8788 (wrangler dev)

# 2. in another terminal, point the evals at it
FLUE_BASE_URL=http://localhost:8788 npm run test:evals
```

Against a deployed preview instead:

```sh
FLUE_BASE_URL=https://shot-studio-flue.<account>.workers.dev npm run test:evals
```

With no `FLUE_BASE_URL`, the suite **skips** (visible in the report) so it never
breaks a normal `npm test`.

## Env

| var                 | default        | purpose                                                        |
| ------------------- | -------------- | -------------------------------------------------------------- |
| `FLUE_BASE_URL`     | — (skip)       | base URL of the running flue app. Required to run.             |
| `FLUE_AGENT_NAME`   | `whistlewood`  | agent to prompt.                                               |
| `FLUE_EVAL_USER`    | `eval-user`    | `userId` segment of the instance id.                           |
| `FLUE_EVAL_PROJECT` | `p_eval`       | `projectId` segment of the instance id.                        |
| `FLUE_AUTH_HEADER`  | —              | one header for a protected target, e.g. `authorization: Bearer …`. |

The agent instance id is `${userId}~${projectId}~${chatId}`
(`flue-agent/src/lib/instance-id.ts`); the harness varies `chatId` per case so
every eval gets a fresh conversation.

## How it works

`harness.ts` uses the real `@flue/sdk` client:

1. `client.agents.prompt(name, id, { message })` — prompt a fresh instance and
   wait for the terminal result (assistant text + model + usage).
2. `client.agents.history(name, id)` — read the conversation back and collect the
   set of tool names the agent actually called (the `toolName` on `dynamic-tool`
   parts, same signal the web UI reads in `src/lib/swr.js`).

Scoring in `whistlewood.eval.ts` asserts on the returned text and the tool set.
Tool-choice checks are **lenient** (regex over called tools) on purpose — model
phrasing varies; we verify the agent wires a prompt to the right *capability*,
not one exact call sequence.

## Reports

vitest-evals can render a standalone report:

```sh
npx vitest-evals serve vitest-results.json
```
