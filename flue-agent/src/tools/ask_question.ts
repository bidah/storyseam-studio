import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";

// Ask the user a question and surface it as an interactive card in the chat.
//
// flue has NO blocking HITL — a tool's `run` can't suspend the turn and wait for
// a human (see whistlewood.md "Asking the user"). So this is a NON-BLOCKING
// recreation of eve's `ask_question`: the tool call surfaces as a `dynamic-tool`
// part whose `input` ({ question, options }) the web/mobile clients render as a
// card with clickable option buttons. `run` returns immediately and tells the
// model to STOP so it doesn't answer on the user's behalf; the user's pick (or a
// typed reply) arrives as the next ordinary user message and the turn continues.
//
// Root-agent only: a subagent runs to completion inside one tool call and can't
// pause either, so it must not call this.
export const askQuestion = () =>
  defineTool({
    name: "ask_question",
    description:
      "Ask the AUTHOR one question and pause for their answer — it renders as an interactive card in the chat. Use whenever a choice is genuinely the user's to make (which reference/take to keep, which model/duration, whether to overwrite, a yes/no go-ahead) instead of guessing. Provide `question` (markdown; keep it short). Provide `options` — 2–6 short, mutually-exclusive choices — to render clickable buttons, or OMIT `options` for a free-text answer. Call this as the FINAL action of your turn and then STOP: do not answer for them or call more tools. Their selection arrives as the next user message and you continue from there. Do NOT call this from a subagent.",
    input: v.object({
      question: d(
        v.pipe(v.string(), v.minLength(1)),
        "The question, as markdown. Keep it to a sentence or two; numbered context lines are fine (single newlines render as line breaks).",
      ),
      options: v.optional(
        d(
          v.array(
            v.object({
              id: d(
                v.pipe(v.string(), v.minLength(1)),
                "Stable short id for the option (e.g. 'fantasy', 'overwrite').",
              ),
              label: d(
                v.pipe(v.string(), v.minLength(1)),
                "Button text the user sees — and the message that is sent on their behalf when they pick it.",
              ),
              style: v.optional(
                d(
                  v.picklist(["primary", "secondary", "danger"]),
                  "Button emphasis. Use 'danger' for a destructive/irreversible choice; default is 'secondary'.",
                ),
              ),
            }),
          ),
          "2–6 clickable choices. Omit entirely for a free-text answer (the user types their reply).",
        ),
      ),
    }),
    async run({ input }) {
      // Non-blocking acknowledgement. The client reads `input` off the tool part
      // to draw the card; this result exists only to end the turn cleanly.
      return {
        presented: true,
        question: input.question,
        options: input.options ?? [],
        note: "This question is now shown to the user as an interactive card. End your turn now — do NOT answer on their behalf or call another tool. Their reply arrives as the next user message.",
      };
    },
  });
