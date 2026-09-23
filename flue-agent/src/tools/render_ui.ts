import { defineTool } from "@flue/runtime";
import { createParser } from "@openuidev/lang-core";
import * as v from "valibot";
import { d } from "./_util.js";
import schema from "../lib/genui-schema.json";

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

// ---------------------------------------------------------------------------
// The dead-end guard
// ---------------------------------------------------------------------------
//
// A parametersheet with no button is the one malformed card the parser CAN'T
// catch: `Card([KeyValue(...)])` is perfectly valid openui-lang, so it renders,
// and the message above it says "tap Confirm when you're ready" — with nothing
// to tap. The turn is already over (render_ui is the final action), so the
// author's only way out is to type the go-ahead the card was supposed to send.
// Seen in the wild on a Higgsfield submit confirmation.
//
// The rule can't be "every card needs a send": a MediaGrid of a finished image
// and an AudioList of a finished take are deliberately tap-free (the contract
// says as much). So the guard is narrow — a card built around the PARAM blocks,
// which exist to be confirmed, with nothing tappable and no result to look at.

/** Blocks that state the terms of a decision; they need an answer next to them. */
const PARAM_BLOCKS = new Set(["KeyValue", "Compare"]);

/** Result-showcase blocks — a card built around these is legitimately tap-free. */
const SHOWCASE_BLOCKS = new Set(["MediaGrid", "MediaItem", "AudioList", "AudioItem"]);

/** Components that answer without a `send` prop of their own. */
const IMPLICITLY_TAPPABLE = new Set(["Chips"]);

/**
 * Positional prop order per component, straight off the schema the parser uses.
 * Sub-components (`Action`, `Option`, `MediaItem`, …) survive parsing as UNEVALUATED
 * `Comp` AST nodes with positional `args` — their parent renderer resolves them —
 * so finding an `Action`'s `send` means mapping arg index → prop name ourselves.
 */
const PROP_ORDER: Record<string, string[]> = Object.fromEntries(
  Object.entries(
    (schema as { $defs?: Record<string, { properties?: Record<string, unknown> }> }).$defs ?? {},
  ).map(([name, def]) => [name, Object.keys(def.properties ?? {})]),
);

/** One component the program contains, with its `send` if it carries one. */
interface Visited {
  typeName: string;
  send?: unknown;
}

/** Walk every component in a parsed program — resolved elements and `Comp` args alike. */
function walkComponents(node: unknown, visit: (found: Visited) => void) {
  if (Array.isArray(node)) {
    for (const child of node) walkComponents(child, visit);
    return;
  }
  if (!node || typeof node !== "object") return;

  const el = node as {
    type?: string;
    typeName?: string;
    props?: Record<string, unknown>;
    k?: string;
    name?: string;
    args?: unknown[];
    v?: unknown;
  };

  if (el.type === "element" && typeof el.typeName === "string") {
    visit({ typeName: el.typeName, send: el.props?.send });
    if (el.props) for (const value of Object.values(el.props)) walkComponents(value, visit);
    return;
  }

  if (el.k === "Comp" && typeof el.name === "string") {
    const order = PROP_ORDER[el.name] ?? [];
    const sendAt = order.indexOf("send");
    const arg = sendAt >= 0 ? (el.args?.[sendAt] as { k?: string; v?: unknown } | undefined) : undefined;
    visit({ typeName: el.name, send: arg?.k === "Str" ? arg.v : undefined });
    walkComponents(el.args, visit);
    return;
  }

  // Any other AST node (literals, object rows, arrays of them) — keep descending.
  for (const value of Object.values(el)) walkComponents(value, visit);
}

/** True when the card states terms but gives the author no way to answer them. */
function isDeadEnd(root: unknown): boolean {
  const seen = new Set<string>();
  let tappable = false;
  walkComponents(root, ({ typeName, send }) => {
    seen.add(typeName);
    if (IMPLICITLY_TAPPABLE.has(typeName)) tappable = true;
    if (typeof send === "string" && send.trim()) tappable = true;
  });
  if (tappable) return false;
  const statesTerms = [...PARAM_BLOCKS].some((name) => seen.has(name));
  const showsResult = [...SHOWCASE_BLOCKS].some((name) => seen.has(name));
  return statesTerms && !showsResult;
}

/** Row components that put a picture or a clip on the card — the ones whose loss is visible. */
const MEDIA_ROWS = ["MediaItem", "AudioItem"];

/** Does statement `id` in this program define a media row? (`g2 = MediaItem(\"…\")`) */
function definesMediaRow(program: string, id: string): boolean {
  const name = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${name}\\s*=\\s*(?:${MEDIA_ROWS.join("|")})\\s*\\(`, "m").test(program);
}

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
      "Ask the AUTHOR something by drawing an interactive card in the chat — which reference image to use, which model/duration, whether to overwrite, a go-ahead on a submit, an approval of a plan. Use it whenever a choice is genuinely theirs to make instead of guessing. `lang` is an openui-lang program built from the Studio component library (OptionList, MediaGrid, AudioList, Recommendation, Compare, KeyValue, Steps, Actions, …) — load the **generative-ui** skill for the syntax and component reference before writing one. A finished IMAGE (a concept generation, a character/location/prop sheet, a storyboard still) is handed back through this tool as a MediaGrid card the author can SEE in the chat the moment it is attached — never as a bare markdown link, and never as prose telling them it is on the Visual or Episode tab. Finished AUDIO (a Seed Audio render, radio takes, a sound version going ready) is handed back through this tool as an AudioList card the author can PLAY in the chat — never as a bare /sound-media link. Tiles and rows that merely SHOW the result carry no `send`. A card that ASKS for something must contain something to tap: a `KeyValue`/`Compare` of the params you are about to submit ALWAYS ships with an `Actions` block in the same program (`root = Card([params, go])`), because your turn ends here — a card that says 'tap Confirm' with no button strands the author. Every interactive element carries a `send` string that is posted VERBATIM as the author's next chat message, so write it in THEIR voice ('Use the dawn reference'), never as an instruction to yourself. Only use image URLs a tool actually returned; never invent one. For a free-text answer, don't call this at all — just ask in your message and stop. Call this as the FINAL action of your turn and then STOP: do not answer for them or call more tools. Do NOT call this from a subagent.",
    input: v.object({
      lang: d(
        v.pipe(v.string(), v.minLength(1)),
        "The openui-lang program. One `identifier = Expression` statement per line, `root = Card([...])` FIRST, positional arguments only. Emit it bare — no markdown code fence, no commentary around it.",
      ),
    }),
    async run({ data: input }) {
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
          output: {
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
          },
        };
      }

      if (isDeadEnd(result.root)) {
        return {
          output: {
            presented: false,
            errors: [
              "This card lists the terms of a decision (KeyValue/Compare) but contains nothing the author can tap — no Action, Option, MediaItem, AudioItem, Recommendation or Chips carries a `send`.",
            ],
            note: [
              "A parameter card with no button is a dead end: your turn ends here, so the author is told to confirm with nothing to confirm with.",
              "Add the answer to the SAME program and call render_ui once more — e.g.",
              "",
              "root = Card([params, go])",
              'params = KeyValue([{label: "Model", value: "seedance_2_0 (std)"}, {label: "Duration", value: "15s"}], "Confirm render")',
              "go = Actions([yes, edit])",
              'yes = Action("Confirm — render it", "Go ahead and render MS-01", "primary")',
              'edit = Action("Change something first", "Wait — let me change the params first")',
              "",
              "Each `send` is posted verbatim as the author's next message, so write it in THEIR voice. Do not apologise in chat for this; just call the tool again.",
            ].join("\n"),
          },
        };
      }

      // A dropped MEDIA row is a PICTURE the author never saw. The model built
      // the tile, attached the generation, said it made two — and shipped a card
      // holding one, because the second `MediaItem` never made it into the
      // grid's array. That is not a note for next time; it is the whole point of
      // the card, so it comes back as a redraw. The corrected card shows both,
      // and the client drops the partial one it replaces (see genui/card-kind.ts).
      const droppedMedia = orphaned.filter((id) => definesMediaRow(lang, id));
      if (droppedMedia.length) {
        return {
          output: {
            presented: false,
            errors: [
              `These media rows were defined but never referenced from root, so the author cannot see them: ${droppedMedia.join(", ")}.`,
            ],
            note: [
              "A picture or clip you generated is missing from the card you just drew.",
              "Call render_ui once more with the SAME program plus every dropped row listed in its grid's/list's items array — e.g. `shots = MediaGrid([g1, g2], \"Noah Chen\")` when you defined both `g1` and `g2`.",
              "One card holds every image of a batch; do not draw a second card to fix this. Do not apologise in chat; just call the tool again.",
            ].join("\n"),
          },
        };
      }

      return {
        output: {
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
        },
      };
    },
  });
