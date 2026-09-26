// The Film job's "Look" stage — the first one: which of the house looks
// (film-plan.ts FILM_STYLES) this Film is made in.
//
// A Film used to be drawn in whatever look the art department's model
// invented, and a premise that said "a pixar like story" came back neon anime.
// So the look is settled before anything is written, and every later stage
// reads it from here (the Sheets stage puts it on the style sheet, on every
// sheet's clause, and on the Series prompt the Director and the shot sheet
// open with).
//
// Chosen (the /director-story gear's Look, make_film's `style`) → that one.
// Otherwise the premise is CLASSIFIED: Workers AI's `typesafe/jev`, a typed
// evaluation model, is asked one `choice` question whose options are the looks
// and whose criteria are each look's `fits`; it answers the pick with a
// probability per look. The winner goes through the pipeline and the whole
// distribution is kept on the step (the card shows the top of it).
//
// It never stops a Film: no AI binding, an error, or an answer that is not one
// of the looks falls back to `filmStyleFor` (the look the prompt NAMES, else the
// default), and says so.
import { FILM_STYLES, filmStyleFor } from "../film-plan.ts";

export const LOOK_MODEL = "typesafe/jev";
const PREMISE_CHARS = 6000; // well inside Jev's 32k window

const pct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;
const labelOf = (id) => FILM_STYLES.find((s) => s.id === id)?.label || id;

/** The Jev request for one premise. */
export function lookQuestion(prompt) {
  return {
    state: String(prompt || "").slice(0, PREMISE_CHARS),
    questions: {
      look: {
        type: "choice",
        instructions:
          "This is the premise of a short film. Which visual look should it be made in? Judge the kind of story " +
          "it is — its genre, audience and world — and any look it asks for by name, which wins.",
        criteria: Object.fromEntries(FILM_STYLES.map((s) => [s.id, s.fits])),
      },
    },
  };
}

/** Jev's answer → { style, confidence, probabilities } | null when it is not one of the looks. */
export function readLookAnswer(out) {
  const a = out?.answers?.look;
  if (!a || !FILM_STYLES.some((s) => s.id === a.choice)) return null;
  const probabilities = Object.fromEntries(
    FILM_STYLES.map((s) => [s.id, Math.max(0, Math.min(1, Number(a.probabilities?.[s.id]) || 0))]),
  );
  return { style: a.choice, confidence: Number(a.confidence) || 0, probabilities };
}

export async function runLookStage({ job, env }) {
  const chosen = FILM_STYLES.find((s) => s.id === job.style);
  if (chosen) {
    return { summary: `${chosen.label} — chosen`, result: { style: chosen.id, by: "chosen" } };
  }

  let failure = null;
  if (env?.AI?.run) {
    try {
      const out = await env.AI.run(LOOK_MODEL, lookQuestion(job.prompt), {
        gateway: { id: env.AI_GATEWAY_ID || "default" },
      });
      const read = readLookAnswer(out);
      if (read) {
        const ranked = Object.entries(read.probabilities).sort((a, b) => b[1] - a[1]);
        const others = ranked.filter(([id]) => id !== read.style).filter(([, p]) => p >= 0.05)
          .map(([id, p]) => `${labelOf(id)} ${pct(p)}`);
        return {
          summary: `${labelOf(read.style)} · ${pct(read.probabilities[read.style])}${others.length ? ` — ${others.join(", ")}` : ""}`,
          result: { ...read, by: "jev", model: out?.model || LOOK_MODEL },
        };
      }
      failure = "the classifier answered no look";
    } catch (err) {
      failure = String(err?.message || err).slice(0, 200);
    }
  } else {
    failure = "no AI binding";
  }

  const fallback = filmStyleFor({ prompt: job.prompt });
  return {
    summary: `${fallback.label} — from the premise's words (${failure})`,
    result: { style: fallback.id, by: "keywords", error: failure },
  };
}
