/**
 * The mobile surface for the end-of-turn follow-ups — the native twin of
 * `src/genui/NextQuestions.jsx`. Fetches `POST /api/next-questions` once a turn
 * settles and renders the result through the shared `<StudioUI>`, so the row is
 * an ordinary `OptionList` card.
 *
 * The fetch is keyed on the last message id (`nextQuestionsKey`), so it runs
 * once per completed turn — not on every re-render or scroll. A failure renders
 * nothing at all: this is an affordance, not content, and an error box where a
 * suggestion should be is worse than silence.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { apiFetch } from '@/lib/api';
import { StudioUI } from './StudioUI';
import { nextQuestionsKey, nextQuestionsProgram, toTurns } from './next-questions';
import type { NextQuestion } from './next-questions';

export function NextQuestions({
  messages,
  canRespond,
  onRespond,
}: {
  messages: Array<{ id?: string; role?: string; parts?: Array<{ type?: string; text?: string }> }>;
  canRespond: boolean;
  onRespond?: (message: string) => void;
}) {
  const [program, setProgram] = useState<string | null>(null);
  const key = nextQuestionsKey(messages);

  useEffect(() => {
    let cancelled = false;
    setProgram(null);
    (async () => {
      try {
        const res = await apiFetch('/api/next-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: toTurns(messages) }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { questions?: NextQuestion[] };
        if (cancelled) return;
        setProgram(nextQuestionsProgram(data?.questions ?? []));
      } catch {
        // Silence is the right failure mode for a suggestion strip.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the turn, not on `messages` — see the module note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!program) return null;
  return (
    <View className="px-4 pt-1">
      <StudioUI lang={program} answerable={canRespond} onRespond={onRespond} />
    </View>
  );
}
