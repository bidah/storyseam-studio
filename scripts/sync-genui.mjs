/**
 * Keep the three consumers of the generative-UI contract in sync.
 *
 * `src/genui/contract.ts` is CANONICAL. This script fans it out to:
 *   1. `mobile-app/src/genui/contract.ts` — a vendored copy, because there is no
 *      workspace here (same arrangement as `render-fn`'s vendored composition).
 *   2. `flue-agent/src/skills/generative-ui/SKILL.md` — the agent's playbook,
 *      assembled from `SKILL.template.md` with the component reference that
 *      `library.prompt()` generates spliced in at the marker.
 *   3. `flue-agent/src/lib/genui-schema.json` — the same library as a JSON
 *      Schema, so `render_ui` can PARSE the model's program in the worker and
 *      hand back real errors instead of shipping a card that won't render.
 *
 * Run it after ANY edit to the contract (`npm run genui:sync`), or the agent
 * will be prompted with components the renderers no longer implement — the same
 * class of silent drift the render-fn sync rule exists to prevent.
 *
 * The prompt is generated against stub renderers: `library.prompt()` only reads
 * names, schemas and descriptions, so nothing needs React Native or the DOM here.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACT = join(ROOT, "src/genui/contract.ts");
const MOBILE_CONTRACT = join(ROOT, "mobile-app/src/genui/contract.ts");
// Pure-logic modules vendored alongside the contract: [source, destination].
const VENDORED = [
  ["src/genui/detect-options.ts", "mobile-app/src/genui/detect-options.ts"],
  ["src/genui/ensure-confirm.ts", "mobile-app/src/genui/ensure-confirm.ts"],
  ["src/genui/card-kind.ts", "mobile-app/src/genui/card-kind.ts"],
  ["src/genui/answered.ts", "mobile-app/src/genui/answered.ts"],
];
const SKILL_DIR = join(ROOT, "flue-agent/src/skills/generative-ui");
const TEMPLATE = join(SKILL_DIR, "SKILL.template.md");
const SKILL = join(SKILL_DIR, "SKILL.md");
const AGENT_SCHEMA = join(ROOT, "flue-agent/src/lib/genui-schema.json");

const MARKER = "<!-- GENERATED:COMPONENTS -->";

const VENDORED_BANNER = `// GENERATED — DO NOT EDIT.
// Vendored from src/genui/contract.ts by \`npm run genui:sync\`. Edit the
// canonical file there and re-run the sync; changes made here are overwritten.

`;

// The preamble the agent reads before the component signatures. Kept here (not
// in the contract) because it is about HOW to write a program, while the
// contract is about WHAT the components are.
const PREAMBLE = `You are drawing one small interactive card inside the Shot Studio chat, directly under a message you have already written. The card is the DECISION — not a second copy of your prose.`;

const ADDITIONAL_RULES = [
  "Arguments are POSITIONAL — never pass them by name. `name = value` and `name: value` are BOTH unsupported: write `Recommendation(\"Save the World bible?\", \"…\", \"Save it now\")`, NEVER `Recommendation(title = \"…\", body = \"…\")`. A keyword form is not parsed away — each `name =` token is counted as an extra positional argument, so the real title/body slots come out null and the whole card fails to render.",
  "`Recommendation` is a hero card with exactly ONE button — its `send`. It has no `actions`/`buttons` array. When a decision needs TWO or more buttons (yes/no, save-now/wait), use an `Actions` block: for a plain question `root = Card([Actions([yes, no])])`, or to keep the proposal framing `root = Card([rec, go])` where `rec` is a `Recommendation` and `go = Actions([yes, no])`.",
  "Keep the whole program under ~20 statements. This renders in a narrow chat rail on a phone as well as on the desktop panel.",
  "Every `send` string is written in the AUTHOR's voice, because it is posted verbatim as their next chat message. Write \"Use the second reference\", never \"The user picked option 2\".",
  "Only use image URLs that a tool actually returned to you. Never invent, guess, or hand-edit a media URL.",
  "Do not restate your chat message inside the card. One short Text at most to frame the choice.",
  "Emit the program as bare openui-lang. Do NOT wrap it in a markdown code fence and do not add commentary before or after it.",
  // The library's built-in rules end with generic generative-UI advice — \"when
  // asked about data, generate realistic/plausible data\", plus a nudge toward
  // tables and charts this library doesn't have. Both are actively wrong here:
  // a plausible-looking shot id or image URL is a bug, not a placeholder. These
  // two rules override them, and the skill body says it again in prose.
  "NEVER invent plausible-looking data. Every id, filename, url, count and duration in the card must come from a tool result you actually received. If you don't have a value, leave the prop out.",
  "This library has no tables, charts or form inputs. Use only the components listed above.",
];

const EXAMPLES = [
  `root = Card([intro, refs])
intro = Text("Which reference should I build the Whistlewood clearing from?", "body")
refs = MediaGrid([r1, r2, r3], "Candidates", 3)
r1 = MediaItem("/library/clearing-dawn_thumb.webp", "/library/clearing-dawn_display.webp", "Use the dawn clearing reference", "Dawn")
r2 = MediaItem("/library/clearing-dusk_thumb.webp", "/library/clearing-dusk_display.webp", "Use the dusk clearing reference", "Dusk")
r3 = MediaItem("/library/clearing-fog_thumb.webp", "/library/clearing-fog_display.webp", "Use the foggy clearing reference", "Fog")`,
  `root = Card([models])
models = OptionList([fast, best], "Render model", "Or tell me a different model.")
fast = Option("Seedance 1.0", "Render it with Seedance", "Fast, good motion, bakes audio", "~40s")
best = Option("Veo 3.1", "Render it with Veo 3.1", "Slower, best for dialogue coverage", "~3m")`,
  `root = Card([intro, takes])
intro = Text("Both takes are rendered — the second leans harder into the rain.", "body")
takes = AudioList([t1, t2], "Rain on the stone bridge")
t1 = AudioItem("/sound-media/trk_2-v1.mp3", "Take 1 — steady drizzle", "Keep take 1", "v1 of the ambience bed", "12s")
t2 = AudioItem("/sound-media/trk_2-v2.mp3", "Take 2 — heavier rain", "Keep take 2", "v2, more low end", "12s")`,
  `root = Card([intro, casting])
intro = Text("Six portraits up — pick your favorite for each and I'll lock them in.", "body")
casting = MediaGrid([m1, m2, s1, s2], null, 2, "one-per-group", "Lock these portraits", "Lock them in")
m1 = MediaItem("/storyboard-media/miles-1_thumb.webp", "/storyboard-media/miles-1_display.webp", "Miles 1", "Miles 1", null, false, "Miles Okonkwo")
m2 = MediaItem("/storyboard-media/miles-2_thumb.webp", "/storyboard-media/miles-2_display.webp", "Miles 2", "Miles 2", null, false, "Miles Okonkwo")
s1 = MediaItem("/storyboard-media/saskia-1_thumb.webp", "/storyboard-media/saskia-1_display.webp", "Saskia 1", "Saskia 1", null, false, "Saskia Voss")
s2 = MediaItem("/storyboard-media/saskia-2_thumb.webp", "/storyboard-media/saskia-2_display.webp", "Saskia 2", "Saskia 2", null, false, "Saskia Voss")`,
  `root = Card([params, go])
params = KeyValue([{label: "Model", value: "nano_banana_pro"}, {label: "Aspect", value: "16:9"}, {label: "References", value: "Sara sheet, clearing dawn"}], "About to submit")
go = Actions([yes, edit])
yes = Action("Generate it", "Go ahead and generate it", "primary")
edit = Action("Change the prompt", "Wait — let me adjust the prompt first")`,
];

async function loadLibrary() {
  // Node 24 strips TS types natively, so the canonical .ts contract imports
  // directly — no build step, nothing to keep in sync with a bundler config.
  const { buildStudioLibrary } = await import(CONTRACT);
  const stub = () => null;
  const renderers = new Proxy({}, { get: () => stub });
  return buildStudioLibrary(renderers);
}

async function main() {
  // 1. Vendor the contract (and its pure-logic siblings) into the mobile app.
  const source = await readFile(CONTRACT, "utf8");
  await mkdir(dirname(MOBILE_CONTRACT), { recursive: true });
  await writeFile(MOBILE_CONTRACT, VENDORED_BANNER + source);
  for (const [from, to] of VENDORED) {
    const text = await readFile(join(ROOT, from), "utf8");
    const dest = join(ROOT, to);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, VENDORED_BANNER.replace("src/genui/contract.ts", from) + text);
  }

  // 2. Generate the agent's skill from the template + the component reference.
  const library = await loadLibrary();
  const reference = library.prompt({
    preamble: PREAMBLE,
    additionalRules: ADDITIONAL_RULES,
    examples: EXAMPLES,
    toolCalls: false,
    bindings: false,
  });

  const template = await readFile(TEMPLATE, "utf8");
  if (!template.includes(MARKER)) {
    throw new Error(`${TEMPLATE} is missing the ${MARKER} marker`);
  }
  const skill = template.replace(
    MARKER,
    `<!-- GENERATED by scripts/sync-genui.mjs from src/genui/contract.ts — do not edit below. -->\n\n${reference.trim()}`,
  );
  await writeFile(SKILL, skill);

  // 3. The parser schema the worker validates against. JSON rather than a
  // module so the flue build treats it as data — the contract itself can't be
  // imported there, it pulls in React through @openuidev/react-lang.
  const schema = library.toJSONSchema();
  await mkdir(dirname(AGENT_SCHEMA), { recursive: true });
  await writeFile(AGENT_SCHEMA, `${JSON.stringify(schema, null, 2)}\n`);

  const names = Object.keys(library.components).length;
  console.log(
    `genui: synced ${names} components → mobile contract + generative-ui skill + agent schema`,
  );
  console.log(`genui: component reference is ${reference.length.toLocaleString()} chars`);
}

await main();
