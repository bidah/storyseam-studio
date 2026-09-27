// What a stage SAYS, apart from what it SOUNDS like — shared by both story
// engines' compilers (./prompts.js for Seedance, ../h3/prompts.js for H3).
//
// A video model speaks what it can read as speech: a quoted phrase, a title,
// a stage name, the words of a voice reference. So a compiler needs to know
// exactly which characters have a line in a segment (a voice reference is
// bound ONLY for them — an unscripted segment handed an audition spoke the
// audition, film-1fd51691, 2026-09-27) and to keep every quotation mark out of
// the prose around the lines.
const key = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

/** A note with its quotation marks taken out — a model speaks what it reads as quoted. */
export const unquote = (t) => String(t || "").replace(/["“”]/g, "").trim();

/**
 * A stage's spoken lines → [{ speaker, delivery, text }]. The H3 Shot list
 * writes them apart from the sound (`lines`, shotlist.js STORY_ENGINES.h3); a
 * Seedance one, and any Shot list from before, has them inside `audio` as
 * `Name, delivery: "line"`, and each quote is read back out, its speaker the
 * last cast name before it.
 */
export function stageLines(stage, names = []) {
  if (Array.isArray(stage.lines)) return stage.lines.filter((l) => str(l?.text));
  const audio = String(stage.audio || "");
  const out = [];
  let from = 0;
  for (const m of audio.matchAll(/["“]([^"”]+)["”]/g)) {
    const before = audio.slice(from, m.index);
    from = m.index + m[0].length;
    const hit = names
      .map((n) => ({ n, at: before.toLowerCase().lastIndexOf(key(n)) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => b.at - a.at)[0];
    const clause = before.split(/[.!?]\s/).at(-1) || "";
    const delivery = hit ? clause.slice(clause.toLowerCase().indexOf(key(hit.n)) + hit.n.length) : "";
    out.push({
      speaker: hit?.n || "",
      delivery: delivery.replace(/\b(says|said|asks|shouts|calls out|whispers|replies)\b/gi, "").replace(/[:,]/g, " ").replace(/\s+/g, " ").trim(),
      text: m[1].trim(),
    });
  }
  return out;
}

/** A stage's sound, with any spoken line (and the sentence carrying it) taken out. */
export function stageSound(stage) {
  const audio = String(stage.audio || "").trim();
  if (Array.isArray(stage.lines)) return unquote(audio);
  return audio
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/["“”]/.test(s))
    .join(" ")
    .trim();
}

/**
 * The cast members who have a line somewhere in the segment, in the order
 * they first speak, spelled as the segment's `characters` spell them. A
 * speaker the cast does not list is kept as written.
 */
export function segmentSpeakers(segment) {
  const names = segment.characters || [];
  const speakers = [];
  for (const st of segment.stages || []) {
    for (const l of stageLines(st, names)) {
      const name = names.find((n) => key(n) === key(l.speaker)) || str(l.speaker);
      if (name && !speakers.some((s) => key(s) === key(name))) speakers.push(name);
    }
  }
  return speakers;
}
