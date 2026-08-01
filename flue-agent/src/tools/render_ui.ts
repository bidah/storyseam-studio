import { defineTool } from "@flue/runtime";
import { createParser } from "@openuidev/lang-core";
import * as v from "valibot";
import { d } from "./_util.js";
import schema from "../lib/genui-schema.json" with { type: "json" };

// Draw an interactive card in the chat — the agent's ONE way of asking the
// author anything, and the successor to eve's `ask_question`.
//
// flue has NO blocking HITL: a tool's `run` can't suspend the turn and wait for
// a human (see whistlewood.md "Asking the user"). So this is non-blocking. The
// tool call surfaces as a `dynamic-tool` part whose `input.lang` the web and
// mobile clients render through the shared component contract
// (src/genui/contract.ts). `run` returns immediately and tells the model to
// STOP so it doesn't answer on the author's behalf; their tap posts the picked
// component's `send` string as the next ordinary user message, and the turn
// continues from there.
//
// Root-agent only: a subagent runs to completion inside one tool call and can't
// pause either, so it must not call this.

// The parser is built once per isolate from the schema `npm run genui:sync`
// generates out of the canonical contract — so what we validate here is exactly
// what the clients can render, by construction.
const parser = createParser(schema as never);

// How many parse errors to hand back. A program that produced more than a
// handful is malformed enough that the first few tell the whole story, and the
// model does better with a short list than a wall.
const MAX_ERRORS = 6;

/** One parse error, flattened to the line the model can act on. */
function describe(error: {
  code?: string;
  message?: string;
  statementId?: string;
  component?: string;
}): string {
  const where = error.statementId ? ` (in \`${error.statementId} = …\`)` : "";
  return `${error.message ?? error.code ?? "invalid"}${where}`;
}

export const renderUi = () =>
  defineTool({
    name: "render_ui",
    description:
      "Ask the AUTHOR something by drawing an interactive card in the chat — which reference image to use, which model/duration, whether to overwrite, a go-ahead on a submit, an approval of a plan. Use it whenever a choice is genuinely theirs to make instead of guessing. `lang` is an openui-lang program built from the Studio component library (OptionList, MediaGrid, AudioList, Recommendation, Compare, KeyValue, Steps, Actions, …) — load the **generative-ui** skill for the syntax and component reference before writing one. A finished IMAGE (a concept generation, a character/location/prop sheet, a storyboard still) is handed back through this tool as a MediaGrid card the author can SEE in the chat the moment it is attached — never as a bare markdown link, and never as prose telling them it is on the Visual or Episode tab. Finished AUDIO (a Seed Audio render, radio takes, a sound version going ready) is handed back through this tool as an AudioList card the author can PLAY in the chat — never as a bare /sound-media link. Tiles and rows that merely SHOW the result carry no `send`. Every interactive element carries a `send` string that is posted VERBATIM as the author's next chat message, so write it in THEIR voice ('Use the dawn reference'), never as an instruction to yourself. Only use image URLs a tool actually returned; never invent one. For a free-text answer, don't call this at all — just ask in your message and stop. Call this as the FINAL action of your turn and then STOP: do not answer for them or call more tools. Do NOT call this from a subagent.",
    input: v.object({
      lang: d(
        v.pipe(v.string(), v.minLength(1)),
        "The openui-lang program. One `identifier = Expression` statement per line, `root = Card([...])` FIRST, positional arguments only. Emit it bare — no markdown code fence, no commentary around it.",
      ),
    }),
    async run({ input }) {
      // Models fence the program about a third of the time however firmly the
      // prompt says not to. The clients strip it too (cleanLang), but stripping
      // here as well means the parse below sees what they will see.
      // `d()` returns a GenericSchema, which erases the input's type — every
      // tool here reads its input as unknown, so narrow it at the boundary.
      const lang = String(input.lang ?? "")
        .replace(/^\s*```[\w-]*[^\S\n]*\n?/, "")
        .replace(/\n```\s*$/, "")
        .trim();

      const result = parser.parse(lang);
      const errors = result.meta?.errors ?? [];
      const unresolved = result.meta?.unresolved ?? [];
      const orphaned = result.meta?.orphaned ?? [];

      // A program that won't render is a correctable model mistake, not a dead
      // turn — hand back what's wrong and let it try again, rather than
      // shipping a card that shows the author an error box.
      if (errors.length || unresolved.length) {
        return {
          presented: false,
          errors: errors.slice(0, MAX_ERRORS).map(describe),
          ...(unresolved.length
            ? {
                unresolved,
                unresolvedNote:
                  "These names are referenced but never defined. Add a `name = …` statement for each.",
              }
            : {}),
          note: "This program did NOT render — nothing was shown to the author. Fix the problems above and call render_ui once more with the corrected program. Do not apologise in chat for this; just call the tool again.",
        };
      }

      return {
        presented: true,
        // Silently-dropped statements aren't fatal (the card rendered), but
        // they usually mean the model built a component and forgot to put it in
        // its parent's array — worth saying once so the next card is right.
        ...(orphaned.length
          ? {
              droppedStatements: orphaned,
              droppedNote:
                "These statements were defined but never referenced from root, so they did NOT appear on the card. Include them in their parent's children/items array next time.",
            }
          : {}),
        note: "The card is now shown to the author. End your turn now — do NOT answer on their behalf or call another tool. Their pick arrives as the next user message.",
      };
    },
  });
