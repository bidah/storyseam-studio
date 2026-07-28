/**
 * The web surface for the end-of-turn follow-ups. Fetches
 * `POST /api/next-questions` once a turn settles and renders the result through
 * the shared `<StudioUI>`, so the row is an ordinary `OptionList` card.
 *
 * The fetch is keyed on the last message id (`nextQuestionsKey`), so it runs
 * once per completed turn — not on every re-render, scroll or theme flip. A
 * failure renders nothing at all: this is an affordance, not content, and an
 * error box where a suggestion should be is worse than silence.
 */
import { useEffect, useState } from "react";
import { StudioUI } from "./StudioUI";
import { nextQuestionsKey, nextQuestionsProgram, toTurns } from "./next-questions";

export function NextQuestions({ messages, canRespond, onRespond }) {
  const [program, setProgram] = useState(null);
  const key = nextQuestionsKey(messages);

  useEffect(() => {
    let cancelled = false;
    setProgram(null);
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/next-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: toTurns(messages) }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setProgram(nextQuestionsProgram(data?.questions ?? []));
      } catch {
        // Silence is the right failure mode for a suggestion strip.
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Deliberately keyed on the turn, not on `messages` — see the module note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!program) return null;
  return (
    <div className="pt-1">
      <StudioUI lang={program} answerable={canRespond} onRespond={onRespond} />
    </div>
  );
}
