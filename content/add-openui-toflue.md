# Adding OpenUI to a flue agent

*How to give a [flue](https://flueframework.com) agent a real component library to
ask questions with — one contract, two renderer sets, and a parser in the worker
so a malformed card never reaches the user.*

---

flue ships with tools, skills, subagents and a streaming transcript. What it does
**not** ship with is any notion of a card — a thing the agent draws that the user
can tap. Left alone, every question the model asks comes back as prose, and prose
is where decisions go to die: the user has to type the answer, the model has to
parse the typing, and anything visual — "which of these three references?" —
degrades into a list of markdown image links.

The standard fix is to hand-roll one: define a tool whose input schema *is* your
card, and render it off the `dynamic-tool` transcript part. We did that first, ran
it for a week, and watched it fail in ways worth reading before you repeat them —
see [The obvious version first](#the-obvious-version-first--and-where-it-broke).

This is the write-up of what replaced it: [OpenUI
Lang](https://openui.dev). The agent emits a tiny declarative program, the client
renders it through a component library you define, and a tap posts a message back.
Sixteen components, about 3,000 hand-written lines across an agent worker, a web
client and a React Native client — plus a prompt and a validation schema that are
both *generated* from the same file. The interesting parts are not the components;
they're the four or five places where the naive version silently breaks.

## What it looks like when it works

The agent finishes a paragraph of prose, then calls one tool:

```
render_ui(lang: `
root = Card([intro, refs])
intro = Text("Which reference should I build the clearing from?", "body")
refs = MediaGrid([r1, r2, r3], "Candidates", 3)
r1 = MediaItem("/library/clearing-dawn.png", "Use the dawn clearing reference", "Dawn")
r2 = MediaItem("/library/clearing-dusk.png", "Use the dusk clearing reference", "Dusk")
r3 = MediaItem("/library/clearing-fog.png", "Use the foggy clearing reference", "Fog")
`)
```

The web client draws a shadcn card with a three-up thumbnail grid; the phone draws
the same decision as a native grid with a swipeable full-screen previewer. Tapping
"Use the dawn clearing reference" posts exactly that string as the next user
message, and the agent picks up from there.

That last sentence is the whole architecture. Everything else is plumbing.

## The constraint that shapes everything: flue can't suspend a turn

There is no blocking human-in-the-loop in flue. A tool's `run` cannot park the
turn, wait for a human, and resume with their answer — it returns, and the turn
ends. So a "question" tool can't be request/response.

Two consequences, and they're both load-bearing:

**1. The answer channel is the transcript.** The card doesn't resolve a promise; it
posts an ordinary user message. Which means the entire interactive surface reduces
to one primitive: *every tappable thing carries a string that gets sent as the
user*. In the contract below that prop is called `send`, and it's the only thing
the model has to get right.

**2. You can drop ActionExpressions.** That needs its own section.

Write the `send` rule into the schema description, not just the docs — see
[Gotcha 5](#gotcha-5-send-must-open-with-the-words-on-the-control).

### What an ActionExpression is

OpenUI Lang's native answer to "what happens when this button is pressed" is an
**Action expression**: a small ordered program the model writes *inside* the UI
program, bound to a component prop typed `ActionExpression`.

```
onSubmit = Action([@Run(result), @Run(data), @Reset($draft)])
saveBtn  = Button("Save", onSubmit)
```

`Action([...])` takes a list of `@`-prefixed steps that execute in order. There are
five, and each one implies machinery behind it:

| Step | What it does | Needs |
| --- | --- | --- |
| `@ToAssistant("msg")` | send a message to the assistant | nothing — just a message channel |
| `@OpenUrl("https://…")` | navigate the client somewhere | nothing |
| `@Run(ref)` | execute a `Mutation(...)` or re-fetch a `Query(...)` | a **client-invocable tool surface** |
| `@Set($var, value)` | write a `$variable` | the bindings system |
| `@Reset($a, $b)` | restore `$variable`s to their declared defaults | the bindings system |

So the full feature set is really three systems stacked: **bindings**
(`$variables` bound to inputs and selects), **client-side tool calls**
(`Query` / `Mutation` the *card* can fire on its own, re-fetching on a filter
change), and **actions** that sequence them. That's how you get a dashboard with a
live date-range dropdown out of a single model-authored program — genuinely
impressive, and a lot of grammar.

One detail worth knowing even if you drop the rest: a `Button` with **no** Action
prop implicitly behaves as `Action([@ToAssistant(label)])` — its label goes to the
assistant. The transcript round-trip is the library's own default.

### Why we dropped it

Because on flue, four of the five steps have nothing to attach to, and the fifth is
already our whole model.

- **`@Run` has no counterpart.** `Query` / `Mutation` assume the client can invoke
  a tool directly and re-render with the result. In flue, tools run server-side
  inside the agent's turn; there is no client-invocable tool surface, and the
  agent's own tools are the only way to touch project state (they carry auth,
  approval gates, versioned writes). A card that could fetch on its own would be a
  second, unauthenticated path into the same data.
- **`@Set` / `@Reset` only pay off next to `@Run`.** Bindings exist so a filter can
  re-fetch a query. With no query to re-fetch, a `$variable` is state that lives
  and dies inside one card. Our one genuinely stateful interaction — multi-select —
  is a dozen lines of React context in the renderers, and the *model* never has to
  know it exists: it writes `select: "many"` and we do the rest.
- **`@ToAssistant` is exactly our `send`.** The one step that does work on flue
  collapses to a single string prop. `send: z.string()` in the schema, one
  `triggerAction(send)` in the host.
- **`@OpenUrl` is the one real loss** — and it belongs to the agent, not the card.
  Deep-linking the app is a *turn-level* decision ("I've written the scene, take me
  to the Script tab"), so it's a `navigate` tool that pushes down an SSE channel the
  client already owns. Same capability, one authority.

The rest is cost. Every enabled feature is prompt surface: turning expressions on
adds the Action section, the built-in functions section, the Query/Mutation
sections, interactive filters, the tool-workflow rules, and expression-aware
streaming rules — thousands of tokens the model reads on *every* card it draws, to
describe capabilities it can't use here. And it's failure surface: nested
expressions referencing declared statements are a real thing for a mid-size model
to malform, and the failure lands in the user's transcript. A string prop can't be
malformed — only misworded, which is a prompt problem
([Gotcha 5](#gotcha-5-send-must-open-with-the-words-on-the-control)), not a parse
error.

Dropping it is one line in the prompt generator, and it's declarative rather than
subtractive — the sections are simply never emitted:

```js
library.prompt({ toolCalls: false, bindings: false, /* … */ });
```

`toolCalls: false` kills `@Run`, `Query` and `Mutation`; `bindings: false` kills
`$variables`, `@Set` and `@Reset`. And because no prop in our contract is typed
`ActionExpression`, the generator's `usesActionExpression` check comes back false
and the entire Action section drops out too. The model is never told about a
mechanism it can't use.

**When to keep it:** if your framework can suspend a turn, or your cards are
dashboards rather than questions — anything where the card should stay alive and
re-fetch after it's drawn — the expressions are the whole point. Our cards are
disposable: they exist to capture one decision and then go inert.

## The obvious version first — and where it broke

flue ships nothing for cards, so the natural way to add one is the way we did it
for the first week: **define a tool whose input schema *is* the card**, and render
that input in the client. flue hands you a `dynamic-tool` transcript part with the
model's `input` on it; you draw whatever you like from it. Total cost, 61 lines:

```ts
export const askQuestion = () =>
  defineTool({
    name: "ask_question",
    description: "Ask the AUTHOR one question — it renders as an interactive card…",
    input: v.object({
      question: d(v.string(), "The question, as markdown. Keep it to a sentence or two."),
      options: v.optional(v.array(v.object({
        id: v.string(),
        label: d(v.string(), "Button text — and the message sent on their behalf."),
        style: v.optional(v.picklist(["primary", "secondary", "danger"])),
      }))),
    }),
    async run({ input }) {
      return { presented: true, note: "End your turn now — do NOT answer on their behalf…" };
    },
  });
```

```jsx
function QuestionCard({ part, pending, onRespond }) {
  const { question, options = [] } = part.input || {};
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <Markdown text={question} />
      {options.map((opt) => (
        <Button key={opt.id} disabled={!pending} onClick={() => onRespond(opt.label)}>
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
```

This is genuinely good, and if you need one card shape forever you should stop
here. Note what it already gets right — the same things the OpenUI version keeps:
non-blocking, `run` returns an instruction to STOP, the answer is the next user
message, `deriveQA` resolves pending-vs-answered from the transcript. The
interaction model didn't change. **What changed is who owns the card's shape.**

Here's where it ran out of road, in the order we hit it.

### 1. One tool is one layout

The schema *is* the design: markdown plus a flat row of buttons. Every new shape —
a thumbnail grid, a params confirmation, a plan preview, two options weighed on
identical rows — is a new tool, a new description, a new renderer on **both**
clients, and a deploy of both workers. Ship five shapes and the model now chooses
between five near-identical tools before it can ask a question, which is prompt
budget spent on your own taxonomy.

With a component library, the shapes are *compositions*. `KeyValue` + `Actions` is
a submit confirmation; nobody designed it as one. The model assembles the card at
runtime from parts we already validated, and a new card shape costs zero
deployments.

### 2. Anything the schema can't express leaks through the strings

This is the part worth internalising, because it happens to every "the tool input
is the UI" design and it never announces itself.

**Leak one — images.** There was no image field, so showing three candidate
references meant the model writing `![](https://…/clearing-dawn.png)` into
`question`. Media picking, escaping through a prose field, at the mercy of a
markdown renderer.

**Leak two — behaviour.** One option had to open the app's media picker instead of
posting its label. There was no field to say so, so the client sniffed the
**label**:

```js
function isUploadOption(opt) {
  if (opt?.id === "upload") return true;
  return /\b(upload|attach)\b/i.test(opt?.label || "") &&
         /\b(image|reference|ref)\b/i.test(opt?.label || "");
}
```

A component contract, smuggled through a button label and recovered with a regex.
It worked until the model wrote "Add a photo instead", and it silently coupled the
agent's prose style to a client behaviour nobody could see from either side.

The OpenUI version deletes both: images are `MediaGrid` of `MediaItem` with a real
`src`, and the one intercept left matches on `send` — the string the contract
*defines* as "what the author would say" — rather than on a label the model chose
for how it reads.

### 3. Two clients, one JSON, no contract

Web and mobile each hand-drew a card from the same loose JSON. Nothing said they
had to agree, and they didn't: the label-sniff existed only on web, so on the phone
the upload option was a button that posted a sentence and did nothing. A parity bug
invisible to types, tests and code review, because the "contract" was a `question`
string and an array of labels.

Now both clients implement the same sixteen names against the same schemas, and a
`vendored-in-sync` guard fails the build when the copies drift. Same decision, two
design languages, enforced.

### 4. The prompt was hand-maintained

`ask_question`'s description was the entire spec, written by hand, updated by
memory. Nothing connected it to what the clients could actually draw — the drift
was structurally invisible.

Generating the prompt from the library inverts that. A component's `description` is
the same string the model reads and the schema the worker validates against, so the
prompt cannot describe a component the renderers don't implement, and a card that
parses is a card that renders.

### 5. Nothing was checked

`{question, options}` validates trivially — every genuinely broken card (a bad
markdown image, a label the regex missed, six options where two were meant) was
well-formed input and shipped straight to the user. There was no failure the model
could learn from, because there was no failure the *system* could see.

`render_ui` parses the whole program in the worker and hands the errors back as a
tool result. The model retries and fixes it before the user sees anything.

### The honest trade

61 lines became about 3,000, plus a third-party dependency, a `patch-package` patch
for React Native, and a sync script you must remember to run. That is not free, and
for a single yes/no button it is a bad deal.

The threshold is specific: **when you're adding the third card-shaped tool, or the
first time you smuggle structure through a string field, the contract has already
paid for itself.** The second is the louder signal — a regex over a button label is
your design telling you the schema stopped fitting.

## Architecture

```
src/genui/contract.ts            ← CANONICAL. names + zod schemas + descriptions
        │
        ├── buildStudioLibrary(webRenderers)     → src/genui/renderers.jsx   (shadcn)
        ├── buildStudioLibrary(nativeRenderers)  → mobile/genui/renderers.tsx (RN)
        │
        └── npm run genui:sync
              ├── mobile-app/src/genui/contract.ts        (vendored copy)
              ├── flue-agent/…/generative-ui/SKILL.md     (library.prompt())
              └── flue-agent/src/lib/genui-schema.json    (library.toJSONSchema())
                          │
                          └── render_ui tool parses the model's program against it
```

One file describes the components. Renderers decide how each one *looks*, never
what it *is*. The agent's prompt and the worker's validator are both **generated**
from the same file, so the three can't drift — a component the renderers don't
implement can't appear in the prompt, and a program the clients can't render is
rejected in the worker.

## Install

```bash
# clients (web + React Native)
npm i @openuidev/react-lang zod

# the flue agent worker — parser only, no React
npm i --prefix flue-agent @openuidev/lang-core
```

Versions this was built against: `@openuidev/react-lang@0.2.9`,
`@openuidev/lang-core@0.2.10`, `zod@4` (imported as `zod/v4`),
`@flue/runtime@1.0.0-beta.9`.

The agent worker deliberately gets `lang-core`, not `react-lang` — pulling React
into a Cloudflare Worker to validate a string is not a trade you want.

## Step 1 — the contract

One module, one exported function. It takes a set of renderers and returns a
library, so both design systems instantiate the *same* definitions:

```ts
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";

// The message an interactive element posts on the user's behalf. Described ONCE
// so every component's prompt signature says the same thing about it.
const SEND =
  "the message sent AS THE USER when this is picked — write it as the user would " +
  "('Use the second reference'), never as an instruction to yourself. It MUST OPEN " +
  "WITH the words shown on the control itself…";

export function buildStudioLibrary(renderers: StudioRenderers): Library {
  const Option = defineComponent({
    name: "Option",
    props: z.object({
      title: z.string(),
      send: z.string(),
      subtitle: z.string().optional().nullable(),
      meta: z.string().optional().nullable(),
      badge: z.string().optional().nullable(),
      tone: z.enum(["normal", "danger"]).optional(),
    }),
    description: `One choice in an OptionList, rendered as a tappable row. title: the choice. send: ${SEND}. subtitle: one line of why-you'd-pick-this. meta: a short right-aligned qualifier ("~40s", "12 credits"). …`,
    component: renderers.Option,
  });

  const OptionList = defineComponent({
    name: "OptionList",
    props: z.object({
      options: z.array(Option.ref),          // ← typed child reference
      header: z.string().optional().nullable(),
      select: z.enum(["one", "many"]).optional(),
      send: z.string().optional().nullable(),
      confirm: z.string().optional().nullable(),
    }),
    description: `THE default way to ask the author to choose — an inset card of Option rows…`,
    component: renderers.OptionList,
  });

  return createLibrary({
    root: "Card",
    id: "shot-studio-chat",
    components: [Card, Section, Text, Callout, Option, OptionList, MediaItem,
                 MediaGrid, Recommendation, Column, Compare, KeyValue, Steps,
                 Chips, Action, Actions],
    componentGroups: [
      {
        name: "Choosing",
        components: ["OptionList", "Option", "Actions", "Action", "Chips"],
        notes: [
          "OptionList is the DEFAULT decision surface — reach for it first.",
          "Actions is for a plain go/no-go; Chips is for optional side-quests.",
          "Every option's `send` is written in the AUTHOR's voice.",
        ],
      },
      // …"Picking media", "Proposing", "Framing"
    ],
  });
}
```

Three things worth copying:

- **`description` is prompt engineering, not documentation.** It is verbatim what
  the model reads. Ours name the *situations* a component is for ("a cost, an
  overwrite warning, a blocked prerequisite") rather than describing pixels, and
  they interpolate shared constants like `SEND` so a rule is written once and lands
  in every signature that needs it.
- **`componentGroups` carries the judgement.** Per-component descriptions can't say
  "prefer this one over that one"; the group `notes` can, and they're the cheapest
  place to fix a model that keeps picking the wrong component.
- **Ship fewer components than you think.** Sixteen covers everything: choose one,
  choose several, pick an image, approve a proposal, compare two things, show
  params, show a plan. Every extra component is prompt surface and a second
  renderer to write.

Keep the library **small and orthogonal**, and let the descriptions do the
steering.

### Multi-select without server state

`select: "many"` on a list means taps toggle instead of sending, and a confirm
button composes the message from the list's `send` plus the picked children's:

> `"Add these characters to the World"` + `"Miles"`, `"Vera"`
> → `"Add these characters to the World: Miles, Vera"`

All of that lives in the renderers (a React context the children toggle into). The
model just picks the mode. The one thing to spell out in the description: in a
`"many"` list each item's `send` is a **noun phrase**, in a `"one"` list it's a
**whole sentence** — they compose differently, and models get this wrong unless you
say it.

## Step 2 — the renderers

One export per contract component. Every renderer receives `{ props, renderNode }`;
`renderNode` evaluates a typed child the parser handed you.

```jsx
import { useTriggerAction, useIsStreaming } from "@openuidev/react-lang";

// The tap handler for anything carrying a `send`. Returns undefined when there's
// nothing to send, so callers render a non-interactive element instead of a dead
// button.
function useSend(send) {
  const triggerAction = useTriggerAction();
  const streaming = useIsStreaming();
  if (!send || streaming) return undefined;
  return () => triggerAction(send);
}

export function OptionList({ props, renderNode }) {
  const options = Array.isArray(props.options) ? props.options : [];
  const { Provider, Footer } = useMultiSelect(props);
  return (
    <div>
      <Header>{props.header}</Header>
      <Provider>
        <InsetCard>
          {options.map((opt, i) => (
            <div key={i}>
              {i > 0 ? <Separator className="ml-3 w-auto" /> : null}
              {renderNode(opt)}
            </div>
          ))}
        </InsetCard>
        <Footer />
      </Provider>
    </div>
  );
}
```

Two notes:

- **`useIsStreaming` is your disabled state.** The host passes `isStreaming` to
  `<Renderer>`; we repurpose it as "this card is no longer answerable" (already
  answered, or the agent is busy). A stale card then renders *identically but
  inert* rather than vanishing from the transcript — the user can still read what
  they were asked.
- **Defend every array.** `Array.isArray(props.options) ? … : []`. The program is
  model-authored; a child array can be missing even when the parse succeeded.

The React Native set implements the same sixteen names against native primitives.
Nothing else changes — the contract, the tool, the prompt and the parser are all
platform-agnostic.

## Step 3 — the host component

Where the transcript part meets the renderer.

```jsx
import { Renderer } from "@openuidev/react-lang";
import { buildStudioLibrary } from "./contract";
import { webRenderers } from "./renderers";

// Runs EXACTLY ONCE per bundle — see Gotcha 2.
export const studioLibrary = buildStudioLibrary(webRenderers);

const EMPTY_ERRORS = [];  // stable identity, so the success pass can't re-render

export function StudioUI({ lang, answerable, onRespond }) {
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const program = cleanLang(lang);

  const handleErrors = useCallback((next) => {
    const list = Array.isArray(next) ? next : next ? [next] : EMPTY_ERRORS;
    setErrors((prev) => (sameErrors(prev, list) ? prev : list));
  }, []);

  if (!program) return null;
  if (errors.length) return <ProgramFailed errors={errors} program={program} />;

  return (
    <Renderer
      response={program}
      library={studioLibrary}
      isStreaming={!answerable}
      onAction={(event) => {
        const message = event?.humanFriendlyMessage;   // ← the `send` string
        if (message) onRespond?.(message);
      }}
      onError={handleErrors}
    />
  );
}
```

`onRespond` is your chat client's "send a user message". That's the entire
interaction model.

The error branch renders **the errors plus the program text**. It is tempting to
show a friendly "something went wrong" — don't. When every card broke (see Gotcha
1) the fallback swallowed the reason, and the failure was undiagnosable from a
screenshot.

## Step 4 — the tool

```ts
import { defineTool } from "@flue/runtime";
import { createParser } from "@openuidev/lang-core";
import * as v from "valibot";
import schema from "../lib/genui-schema.json" with { type: "json" };

// Built once per isolate from the schema `npm run genui:sync` generates out of
// the canonical contract — so what we validate is exactly what the clients can
// render, by construction.
const parser = createParser(schema as never);

export const renderUi = () =>
  defineTool({
    name: "render_ui",
    description:
      "Ask the AUTHOR something by drawing an interactive card in the chat… " +
      "`lang` is an openui-lang program built from the Studio component library " +
      "(OptionList, MediaGrid, Recommendation, Compare, KeyValue, Steps, Actions, …) — " +
      "load the **generative-ui** skill for the syntax before writing one. " +
      "Every interactive element carries a `send` string that is posted VERBATIM as " +
      "the author's next chat message… Call this as the FINAL action of your turn and " +
      "then STOP. Do NOT call this from a subagent.",
    input: v.object({
      lang: d(
        v.pipe(v.string(), v.minLength(1)),
        "The openui-lang program. One `identifier = Expression` statement per line, " +
        "`root = Card([...])` FIRST, positional arguments only. Emit it bare — no " +
        "markdown code fence, no commentary around it.",
      ),
    }),
    async run({ input }) {
      const lang = stripFence(String(input.lang ?? ""));
      const result = parser.parse(lang);
      const errors = result.meta?.errors ?? [];
      const unresolved = result.meta?.unresolved ?? [];
      const orphaned = result.meta?.orphaned ?? [];

      if (errors.length || unresolved.length) {
        return {
          presented: false,
          errors: errors.slice(0, 6).map(describe),
          unresolved,
          note: "This program did NOT render — nothing was shown to the author. Fix " +
                "the problems above and call render_ui once more. Do not apologise " +
                "in chat for this; just call the tool again.",
        };
      }

      return {
        presented: true,
        ...(orphaned.length ? { droppedStatements: orphaned, droppedNote:
          "These statements were defined but never referenced from root, so they " +
          "did NOT appear on the card. Include them in their parent's children array." } : {}),
        note: "The card is now shown to the author. End your turn now — do NOT answer " +
              "on their behalf or call another tool. Their pick arrives as the next " +
              "user message.",
      };
    },
  });
```

Register it in `tools/index.ts` alongside the rest; nothing special.

**Parse in the worker.** This is the single highest-value 20 lines in the
integration. Without it a typo ships a card that renders an error box at the user
and the model never learns; with it the model gets a correctable tool result and
fixes it on the next call, invisibly. The parser's three buckets each map to a
different message:

| Bucket | Meaning | What you tell the model |
| --- | --- | --- |
| `errors` | malformed statement / bad props | the flattened message + which statement |
| `unresolved` | a name referenced but never defined | "add a `name = …` statement for each" |
| `orphaned` | defined but never reached from `root` | not fatal — the card rendered without it |

**Return-value-as-prompt.** `run`'s return is the model's next observation, so
write it as an instruction. `"End your turn now — do NOT answer on their behalf"`
does real work: without it models routinely draw the card and then cheerfully
answer their own question in the same turn.

**Root-agent only.** A subagent runs to completion inside one tool call and can't
pause either, so it must hand its question back to the root agent instead of
calling `render_ui`. Say so in the tool description *and* the skill front-matter —
the model only reads one of them at any given moment.

## Step 5 — generate the prompt from the library

The library can describe itself. That's what makes "one contract" true rather than
aspirational:

```js
const library = buildStudioLibrary(new Proxy({}, { get: () => () => null }));

// 1. the agent's playbook: template + generated component reference
const reference = library.prompt({
  preamble: "You are drawing one small interactive card inside the chat…",
  additionalRules: [
    "Keep the whole program under ~20 statements.",
    "Every `send` string is written in the AUTHOR's voice…",
    "NEVER invent plausible-looking data. Every id, filename, url, count and " +
      "duration must come from a tool result you actually received.",
    "This library has no tables, charts or form inputs.",
  ],
  examples: [/* three complete programs */],
  toolCalls: false,
  bindings: false,
});
await writeFile(SKILL, template.replace(MARKER, reference));

// 2. the parser schema the worker validates against
await writeFile(AGENT_SCHEMA, JSON.stringify(library.toJSONSchema(), null, 2));

// 3. the vendored copy for the second client
await writeFile(MOBILE_CONTRACT, BANNER + (await readFile(CONTRACT, "utf8")));
```

Details that saved us:

- **Stub renderers.** `library.prompt()` and `toJSONSchema()` only read names,
  schemas and descriptions, so a `Proxy` returning `() => null` is enough — no
  React, no React Native, no DOM in the build script.
- **Node strips TS natively** (24+), so the script imports the canonical `.ts`
  contract directly. No build step to keep in sync with a bundler config.
- **Override the library's generic rules.** `prompt()`'s built-ins end with advice
  like *"when asked about data, generate realistic/plausible data"* and a nudge
  toward tables and charts. Both are actively wrong for a production tool — a
  plausible-looking id or image URL is a bug, not a placeholder. Our
  `additionalRules` contradict them explicitly, and the skill body says it again in
  prose.
- **The skill is a template with a marker.** `SKILL.template.md` holds the
  hand-written half (when to draw a card, one-vs-many, "never enumerate choices in
  prose"); the generated component reference is spliced in at
  `<!-- GENERATED:COMPONENTS -->`. Register the *generated* `SKILL.md` in flue's
  `skills.ts`, and never edit it by hand.
- **Put hard constraints in the skill's `description:`, not only the body.** The
  description is what the model sees before deciding to load the skill, so the
  non-negotiables (`send` is posted verbatim; never invent URLs; STOP after the
  call; root-agent only) go there too.

Then guard the drift. We have a `vendored-in-sync` check in `npm run guards` that
fails the build when a vendored copy no longer matches its source — the failure
mode is otherwise silent: everything builds, the agent is just prompted with
components the renderers no longer have.

## Step 6 — wiring the transcript

The tool call arrives as a `dynamic-tool` part. Render it, and resolve which card
is still live:

```jsx
case "dynamic-tool": {
  if (part.toolName === "render_ui") {
    const pending = qa?.pendingId === part.toolCallId;
    return (
      <StudioUI
        lang={part.input?.lang}
        answerable={pending && canRespond}
        onRespond={onRespond}
      />
    );
  }
  …
}
```

`deriveQA` walks the messages once: a card is *answered* by the first user message
after it, and the last card with nothing after it is the one still pending. Only
that one is interactive; older ones render inert. Because the answer is just a user
message, this also means a typed reply resolves a card exactly like a tap does —
which is the behaviour you want, and it costs nothing.

## Gotchas

### Gotcha 1 — `onError` fires on success too

`Renderer`'s `onError` is documented *"called with `[]` when all errors are
resolved"*. So it fires on the **success** pass as well.

```jsx
onError={() => setFailed(true)}   // ← every card on both platforms shows "didn't render"
```

That one line broke 100% of cards over perfectly valid programs. Inspect the
argument, and make the handler a no-op when nothing changed — `onError` fires
*during* the renderer's own render pass, so an unconditional `setState` there is a
render loop. Hence the `EMPTY_ERRORS` constant and the `sameErrors` comparison in
Step 3.

### Gotcha 2 — `buildStudioLibrary()` must run exactly once per bundle

`defineComponent` registers each schema in zod's **global registry by name**.
Calling the builder twice in one bundle collides on the ids and crashes JSON-schema
conversion. Call it once at module scope in a `library` module and import the
instance everywhere. (This is also why the build script instantiates its own copy
in a separate Node process rather than importing the client's.)

### Gotcha 3 — React Native can't render the `Renderer`'s wrapper `<div>`s

`react-lang@0.2.9`'s `Renderer` ends by wrapping its output in two unconditional
`<div>`s — a `position: relative` shell and an opacity layer for the query-loading
overlay. RN cannot render `div`, so **every** card died with *"View config getter
callback for component `div` must be a function"* before any of our components were
reached. Nothing was wrong with the renderers; they were never called.

Fix with `patch-package`: replace both wrappers with `Fragment` and drop the
`DefaultQueryLoader` fallback (it injects DOM styles). We use no `Query()` /
`Mutation()`, so the overlay has nothing to show and behaviour is unchanged.

```diff
-		children: jsxs("div", {
-			style: { position: "relative" },
-			children: [isQueryLoading && (queryLoader ?? jsx(DefaultQueryLoader, {})), jsx("div", {
-				style: { opacity: isQueryLoading ? .7 : 1, transition: "opacity 0.2s ease" },
+		children: jsxs(Fragment, {
+			children: [isQueryLoading && queryLoader, jsx(Fragment, {
 				children: jsx(RenderNode, { node: result.root })
 			})]
```

Patching rather than pinning RN to an older release keeps **one** `react-lang`
across web, mobile and the prompt/schema tooling — which is what makes "one
contract, two renderer sets" true — and a patch fails loudly on upgrade instead of
drifting silently.

### Gotcha 4 — models fence the program

About a third of the time, however firmly the prompt says not to, the model wraps
the program in a ``` fence. Strip it in **both** places: in the tool (so the parse
sees what the client will see) and in the client (so a card from before you shipped
the tool-side strip still renders). Cheaper than round-tripping a correction.

### Gotcha 5 — `send` must open with the words on the control

A row labelled *"Extend your world"* whose `send` was *"Let's extend the world.
Read the bible, then propose three or four more characters…"* posts a message that
shares no opening words with the label. In the transcript it reads as though
something else was tapped — and that posted message is the user's **only**
confirmation that the row they hit is the row they meant.

Keep the brief (it's what makes a tap start real work instead of the agent
interviewing its way back to the request), but put it *after* the label:

```ts
export function leadWithLabel(label: string, prompt: string): string {
  const shown = label.trim();
  const brief = prompt.trim();
  if (!shown) return brief;
  const bare = shown.replace(/[.?!…]+$/u, "");
  return brief.toLowerCase().startsWith(bare.toLowerCase()) ? brief : `${shown} — ${brief}`;
}
```

For cards *you* build client-side, call that helper. For cards the **agent** writes
the rule has to live in the contract's `SEND` description — it's the only place the
model reads.

## Two things you get almost for free

Once a card is just "a program string rendered by `<StudioUI>`", the *client* can
author programs too, and they're indistinguishable from the agent's.

**Prose rescue.** Models keep writing `A) … B) …` however firmly the skill says to
draw a card. A detector synthesizes the program they should have written and
renders it through the same host. Keep the heuristics strict — trailing position,
sequential markers, 2–6 short items, a cue word or `?` above, newest settled turn
only, and nothing if the agent already drew a card. A false positive turns a recap
into buttons that post nonsense.

**Follow-ups.** Under a finished turn, four "where to go next" rows — generated by a
small model grounded on real pipeline state, with a deterministic deck as the
fallback so the floor is always real moves. It's an `OptionList` built by
`nextQuestionsProgram()`, rendered by the same `<StudioUI>`, answered by the same
transcript round-trip.

Both are ~150 lines because the hard part — a rendering contract both clients
implement — already existed.

## Checklist

1. `npm i @openuidev/react-lang zod` (clients) · `@openuidev/lang-core` (agent worker)
2. Write `contract.ts`: `defineComponent` per component, descriptions written *at
   the model*, `createLibrary` with `componentGroups` for the judgement calls
3. Implement one renderer set per platform; wire `useSend` → `triggerAction(send)`
4. Host component: `<Renderer>` + `onAction` → post as user + an `onError` handler
   that **inspects its argument**
5. `render_ui` tool: valibot input, parse against the generated JSON Schema, return
   errors as instructions
6. Sync script: `library.prompt()` → SKILL.md, `library.toJSONSchema()` → the
   parser schema, contract → vendored copies. Guard the drift in CI
7. Transcript wiring: render `dynamic-tool` parts, derive which card is still
   pending, gate interactivity on it
8. Patch `react-lang`'s DOM wrappers if you render on React Native

The part to get right first is Step 2's descriptions. The components are an
afternoon; teaching the model *when* to reach for each one is the whole job.
