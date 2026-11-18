---
description: Write or revise the screenplay (beat outline first, then pages)
argument-hint: [what to write or change]
---
Load the `script-writing` skill and follow it.

Request: $ARGUMENTS

Remember: new material starts as a beat outline the author approves before any pages
exist. Read `config.json` for `target_seconds` and write to that budget — roughly 145
words per minute of finished film. Delegate the craft to the specialists in
`.claude/agents/` in stage order rather than doing it by hand, and record each pass
in `script/reviews.json` yourself from the specialist's `VERDICT` / `FINDINGS` /
`SUMMARY` envelope, with `words` from `wc -w script/script.md`.

End the turn when the script is written. Do not run `/shotlist` in the same turn.
