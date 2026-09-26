// What an Auto Film's live stream may SAY and what it may SOUND like — one
// sentence, carried verbatim by the Series' own prompt (the Director's
// `configure`) and by every beat of the cue sheet.
//
// Two locks, each learned from a sitting that broke it:
//   - The language. Nothing said "English", and a cel-anime look pulled whole
//     scenes into Japanese. The prompt has to name the language, and name the
//     one it must NOT drift into is not enough — it has to say "only".
//   - No music. The Score stage lays one continuous cue under the kept film
//     afterwards (film-stages/score.js); a stream that brings its own
//     soundtrack fights it, and a bed the Director improvised cannot be ducked
//     or silenced. The stream carries dialogue, foley and effects — nothing else.
export const DEFAULT_FILM_LANGUAGE = "English";

export function filmSoundLock(language = DEFAULT_FILM_LANGUAGE) {
  const lang = String(language || DEFAULT_FILM_LANGUAGE).trim() || DEFAULT_FILM_LANGUAGE;
  return [
    `Every spoken line is in ${lang} only — never any other language, no subtitles, no on-screen text.`,
    "Sound: dialogue, foley and sound effects ONLY. No music, no score, no soundtrack, no singing.",
  ].join(" ");
}
