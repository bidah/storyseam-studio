# The specialist room — the shared return contract

Every file in this folder is a subagent that runs in a **child session**. Its caller never
sees the conversation: only the **text of the last message it writes** comes back. Anything
said in an earlier message, and anything worked out in reasoning, is discarded the moment
the turn ends. So, for every agent here:

- **The deliverable IS the final message**, written out in full, every time. Never end on
  a wrap-up ("Pass complete", "the findings are above", "recorded successfully"), a bare
  acknowledgement, a status line, or a promise to follow up. "Above" does not exist for
  the caller; that wrap-up would be the entire output.
- **A tool call is not the end of the turn.** After the last tool call the full deliverable
  is still owed as the message that closes the turn.
- **Nothing here writes `script/reviews.json`.** The root agent records the pass, from the
  envelope below.

## The envelope — the last three lines of every specialist's final message

Each specialist keeps its own body format (a pressure curve is not a dialogue diff). What
is shared is the footer. The final message ends with exactly this, as its last lines:

```
VERDICT: <one line — the specialist's own verdict, in its own terms>
FINDINGS: <integer — how many numbered items the body carries; 0 if none>
SUMMARY: <one sentence the root pastes into the ledger unchanged>
```

Rules for the three lines:

- `FINDINGS` counts the body's **numbered items**: findings, rewrites (one before/after
  pair is one), swings, entries, beats, collated notes. It is a count of what is on the
  page, never an impression. A clean pass is `FINDINGS: 0` with a verdict that says so.
- `SUMMARY` is one sentence, specific enough to be useful on a board six turns later:
  "Scene 2 does not turn; two lines of exposition in scene 4 say the theme aloud." Not
  "several issues found".
- `VERDICT` is the one-line verdict the agent's own instructions already ask for. It goes
  here, last, so the root always finds it in the same place.

## Who carries the envelope

**The fifteen specialists the root calls directly** end with it: `character-doctor`,
`dialogue-doctor`, `first-reader`, `motivation-doctor`, `performance-doctor`,
`plot-doctor`, `producer`, `punch-up`, `scene-doctor`, `story-architect`, `table-read`,
`tension-doctor`, `theme-doctor`, `voice-designer`, `world-continuity`.

**Agents called by another agent do not**: the five arc experts (`heros-journey`,
`story-circle`, `three-act`, `save-the-cat`, `kishotenketsu`) are consumed by
`story-architect`, and `character-actor` by `table-read`. Their caller retypes what it
needs into its own final message and writes the one envelope. `table-read` returns
**one** envelope for the whole room, never one per actor.

## How the root turns an envelope into a ledger entry

```json
{ "specialist": "<agent name>", "draft": "v2", "words": 291,
  "when": "<ISO-8601 UTC>", "findings": 3,
  "verdict": "<VERDICT line>", "summary": "<SUMMARY line>" }
```

`findings` is the `FINDINGS` integer, `summary` the `SUMMARY` line, `verdict` the
`VERDICT` line, all verbatim. `draft` is the `vN` of the newest snapshot in
`script/drafts/` at pass time, and `words` is `wc -w script/script.md` at pass time; the
board decides fresh vs stale by re-running that same command. See the `script-writing`
skill for the writer and `script-agents` for the reader.
