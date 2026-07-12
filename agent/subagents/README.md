# Script specialist subagents

Focused **scriptwriting** specialists the root agent delegates to. Each is an eve
[declared subagent](https://github.com/vercel/eve/blob/main/docs/subagents.mdx):
its own directory is a separate agent root with its own `instructions.md` and
model wiring, and it inherits **nothing** from the parent. The `description` in
each `agent.ts` is what the root reads to decide when to hand off.

```
subagents/
├── plot-doctor/          finds plot holes, continuity errors, coherence fixes
├── motivation-doctor/    "the whys" — everything caused by character, not convenience
├── dialogue-doctor/      voice consistency, subtext, punch-up
└── story-architect/      the "arc agent" — picks a structure, then delegates to:
    └── subagents/
        ├── heros-journey/    Campbell / Vogler, 12 stages
        ├── story-circle/     Dan Harmon, 8 steps
        ├── three-act/        setup / confrontation / resolution
        ├── save-the-cat/     Blake Snyder, 15 beats
        └── kishotenketsu/    4-act, conflict-optional (Ki / Shō / Ten / Ketsu)
```

## Advisor pattern (why they don't edit the script)

Subagents are isolated and do **not** carry the script tools (`get_script`,
`save_script`, …). Those tools resolve the active project from per-session
durable state that only the root's channel hook sets
(`channels/eve.ts` → `lib/context.ts`), which does not thread through a delegated
subagent session. So the specialists **analyze and recommend**; the **root agent**
holds the tools and applies their output:

1. Root reads the script with `get_script`.
2. Root delegates, passing the script (or the relevant scenes) in the message.
3. Specialist returns a report / outline / rewrites.
4. Root applies them with `append_script` / `save_script` (offering `new_draft`
   first for anything large).

The one exception to "no side effects": `story-architect` uses the built-in
`ask_question` tool to interview the author for which arc to build before it
consults the matching expert.

## Model wiring

Because subagents inherit nothing, each `agent.ts` spreads `modelConfig()` from
`agent/lib/model.ts` — the single source of truth for the gateway model (and the
`OLLAMA_MODEL` offline fallback) shared with the root `agent.ts`.

## Adding another specialist

1. `mkdir agent/subagents/<kebab-id>/`.
2. `agent.ts`: `export default defineAgent({ ...modelConfig(), description: "…" })`
   — make the description precise; it's the routing signal.
3. `instructions.md`: the specialist's system prompt. Keep it advisor-shaped
   (return recommendations; the root applies them) unless you also add the tools
   it needs into its own `tools/`.
4. Mention it in the root `agent/instructions.md` "Script specialists" section.
