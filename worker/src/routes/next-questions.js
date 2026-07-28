// POST /api/next-questions — the four "where to go next" follow-ups offered
// under a finished agent turn (the pattern AI search engines use to keep a
// conversation moving).
//
// It is deliberately NOT an agent tool. Making the agent generate its own
// follow-ups costs a turn of the expensive chat model, and — worse — asks it to
// stop working in order to speculate about what you might want next. So this is
// a separate, cheap call on a small Workers AI model (the same arrangement
// `chat-title.js` uses), fired by the CLIENT once a turn settles.
//
// Two things ground it, and the grounding is the whole point of the route
// existing server-side rather than in the browser:
//
//   1. `buildStatus` — the project's REAL pipeline digest, straight off D1. The
//      model is told there are 148 shots with no stills, not left to guess.
//   2. `CAPABILITIES` — what this app can actually do, including the script
//      specialists. Without it a small model happily suggests "export to
//      Premiere" or "add subtitles", neither of which exists here.
//
// And the fallback matters as much as the model: `buildSuggestions` already
// derives a good deck from the same digest deterministically, so a failed,
// slow, or nonsense generation degrades to real, stage-appropriate moves rather
// than to nothing. The model's job is to beat that baseline using the
// CONVERSATION, not to be the only source of suggestions.
import { buildStatus } from "./status.js";
import { buildSuggestions, FALLBACK_SUGGESTIONS } from "../lib/suggestions.ts";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** How many follow-ups the UI shows. Four is the AI-search convention. */
const WANT = 4;
/** Turns of context handed to the model — enough for the thread's direction. */
const MAX_TURNS = 6;
/** Per-message cap. A pasted script would otherwise blow the context window. */
const MAX_CHARS = 700;

// What the app can actually do, in the model's vocabulary. Ordered by pipeline
// stage so the suggestions it invents stay inside the product.
const CAPABILITIES = [
  "world bible (story map, story depth, character + location rosters)",
  "script drafts (write, revise, propose a diff, pin a draft, sign it off)",
  "script specialists it can delegate to: story architect (arc/structure), motivation doctor (why a beat happens), plot doctor (holes, continuity, setups/payoffs), dialogue doctor (voice, subtext, rhythm)",
  "visual world (concept art, locked style preset)",
  "character / location / prop sheets (reference art)",
  "shot list (per-shot camera, action, dialogue, prompts)",
  "storyboard stills (one image per shot)",
  "radio (voice-cast the dialogue, render per-line takes)",
  "sound studio (SFX, ambience, music cues)",
  "video renders (Seedance / Veo via Higgsfield, fal or Atlas)",
  "complete cuts (stitch takes, score with music) and the Remotion timeline editor",
  "asset library",
];

const SYSTEM = [
  "You suggest the next things an author could ask their film-production assistant to do.",
  "You are given where their episode actually stands and the last few turns of their chat.",
  "",
  "Write exactly 4 suggestions. Each has:",
  '- "label": what the author taps. 3 to 8 words, written in THEIR voice as a request',
  '  ("Board the rest of scene 2"), never as a question to them.',
  '- "prompt": the fuller message that gets sent when they tap it — one or two sentences',
  "  naming the specific thing (a shot number, a character, a draft) so the assistant can",
  "  start without another round of questions.",
  "",
  "Rules:",
  "- Suggest only things the listed capabilities cover. Never invent a feature.",
  "- Follow the CONVERSATION. The best suggestion is usually the obvious next step after",
  "  what just happened, not a generic project chore.",
  "- Use the real numbers and names from the status. Never invent a shot id or a character.",
  "- Four DIFFERENT directions. Do not offer the same move reworded.",
  "- No preamble, no markdown, no numbering. Reply with JSON only.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, prompt: { type: "string" } },
        required: ["label", "prompt"],
      },
    },
  },
  required: ["questions"],
};

/** Trim a transcript turn to something worth spending context on. */
function turnLine(m) {
  const role = m?.role === "assistant" ? "Assistant" : "Author";
  const text = String(m?.text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return `${role}: ${text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text}`;
}

/**
 * The deterministic deck, shaped like the model's output. This is what ships
 * when generation fails — `buildSuggestions` composes full briefs from the same
 * digest, so the floor is genuinely useful rather than a placeholder.
 */
function derived(status) {
  const cards = status ? buildSuggestions(status, { max: WANT }) : FALLBACK_SUGGESTIONS;
  return cards.slice(0, WANT).map((c) => ({ label: c.title, prompt: c.prompt }));
}

/** Keep only well-formed, non-duplicate suggestions. */
function clean(raw) {
  const out = [];
  const seen = new Set();
  for (const q of Array.isArray(raw) ? raw : []) {
    const label = String(q?.label || "")
      .replace(/\s+/g, " ")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/^[-*\d.)\s]+/, "")
      .trim();
    const prompt = String(q?.prompt || "").replace(/\s+/g, " ").trim();
    if (!label || !prompt) continue;
    if (label.length > 60) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, prompt });
    if (out.length === WANT) break;
  }
  return out;
}

/** Pull the questions array out of whatever shape the model replied with. */
function parseQuestions(res) {
  // Workers AI returns `response` as an object when the model honoured the JSON
  // schema, and as a string when it fell back to plain text.
  const r = res?.response;
  if (r && typeof r === "object") return r.questions ?? r;
  const text = String(r || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return obj?.questions ?? obj;
  } catch {
    return null;
  }
}

export function registerNextQuestions(app) {
  app.post("/api/next-questions", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);

    const body = await c.req.json().catch(() => null);
    const turns = (Array.isArray(body?.messages) ? body.messages : [])
      .slice(-MAX_TURNS)
      .map(turnLine)
      .filter(Boolean);

    // The digest is the floor as well as the grounding, so a failure to read it
    // is survivable — we just lose the project-specific half of the prompt.
    let status = null;
    try {
      status = await buildStatus(c.env, c.get("projectId"));
    } catch {
      status = null;
    }

    const fallback = derived(status);

    // Nothing to follow up on: a brand-new chat gets the derived deck, which is
    // exactly the landing screen's suggestions.
    if (!turns.length) return c.json({ questions: fallback, source: "derived" });

    const user = [
      "WHERE THE EPISODE STANDS (JSON digest):",
      JSON.stringify(status ?? {}),
      "",
      "WHAT THE ASSISTANT CAN DO:",
      ...CAPABILITIES.map((c2) => `- ${c2}`),
      "",
      "THE CONVERSATION SO FAR (oldest first):",
      ...turns,
      "",
      `Now write the ${WANT} suggestions as JSON.`,
    ].join("\n");

    try {
      const res = await c.env.AI.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        max_tokens: 500,
        temperature: 0.7,
        response_format: { type: "json_schema", json_schema: SCHEMA },
      });
      const questions = clean(parseQuestions(res));
      // A partial generation is topped up from the derived deck rather than
      // shown short — four slots is the layout, and the derived moves are good.
      if (questions.length < WANT) {
        const have = new Set(questions.map((q) => q.label.toLowerCase()));
        for (const f of fallback) {
          if (questions.length === WANT) break;
          if (have.has(f.label.toLowerCase())) continue;
          questions.push(f);
        }
      }
      if (!questions.length) return c.json({ questions: fallback, source: "derived" });
      return c.json({ questions, source: "model" });
    } catch {
      // Model unavailable / over quota / cold — the derived deck is the point of
      // having a deterministic baseline. Never fail this route.
      return c.json({ questions: fallback, source: "derived" });
    }
  });
}
