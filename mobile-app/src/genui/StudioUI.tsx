/**
 * The mobile host for a `render_ui` tool part — the native twin of
 * `src/genui/StudioUI.jsx`.
 *
 * `buildStudioLibrary()` runs EXACTLY ONCE per bundle (module scope here):
 * `defineComponent` registers every schema in zod's global registry by name, so
 * a second call in the same bundle collides on the ids and crashes JSON-schema
 * conversion.
 *
 * Answering works the way the old `ask_question` card did, because flue can't
 * suspend a turn: tapping anything fires `onAction`, and we post its
 * `humanFriendlyMessage` (the component's `send` string) as the next user
 * message. `deriveQA` in the conversation resolves which card is still pending
 * — only that one stays live.
 */
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Renderer } from '@openuidev/react-lang';
import { TriangleAlert } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { buildStudioLibrary } from './contract';
import { AnsweredContext } from './answered';
import { nativeRenderers } from './renderers';

export const studioLibrary = buildStudioLibrary(nativeRenderers);

/** Stable identity for "no errors", so the success pass can't cause a render. */
const EMPTY_ERRORS: unknown[] = [];

/** One parser error, as a line the author (and we) can read. */
export function errorText(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const err = e as { message?: string; code?: string; statementId?: string };
  const where = err.statementId ? ` (in \`${err.statementId} = …\`)` : '';
  return `${err.message || err.code || 'invalid'}${where}`;
}

/** Whether two error lists say the same thing — see `handleErrors` below. */
function sameErrors(a: unknown[], b: unknown[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((e, i) => errorText(e) === errorText(b[i]));
}

/**
 * Strip a ``` fence the model wrapped the program in. Models add one about a
 * third of the time however firmly the prompt says not to — cheaper to tolerate
 * than to round-trip a correction. (Same helper as appless's `cleanLang`.)
 */
export function cleanLang(text?: string | null): string {
  if (!text) return '';
  const opened = /^\s*```/.test(text);
  let t = text.replace(/^\s*```[\w-]*[^\S\n]*\n?/, '');
  if (opened) {
    const end = t.indexOf('\n```');
    if (end !== -1) t = t.slice(0, end);
  } else {
    t = t.replace(/\n```\s*$/, '');
  }
  return t.trim();
}

/**
 * Render one `render_ui` program.
 *
 * `answerable` gates interaction — false once the card has been answered, while
 * the agent is working, or when the chat is otherwise busy. It rides in on the
 * renderer's `isStreaming` prop, which is what disables the library's
 * interactive elements (see `useSend` in renderers.tsx); a stale card therefore
 * renders identically but inert, rather than vanishing.
 *
 * `answer` is the reply that answered this card, if any — it marks the row the
 * author actually chose (see answered.ts). Inert and answered look nothing
 * alike: one is a card waiting its turn, the other is a decision already made.
 */
export function StudioUI({
  lang,
  answerable,
  answer,
  onRespond,
}: {
  lang?: string | null;
  answerable: boolean;
  answer?: string | null;
  onRespond?: (message: string) => void;
}) {
  const colors = useColors();
  const [errors, setErrors] = useState<unknown[]>(EMPTY_ERRORS);
  const program = cleanLang(lang);

  // `onError` fires on EVERY parse pass, and — per its contract — is "called
  // with [] when all errors are resolved". So the argument has to be inspected:
  // a handler that ignores it and flips a `failed` flag treats the SUCCESS
  // callback as a failure and every card dies. (It did. That was the bug.)
  //
  // It also fires during the renderer's own render pass, so this must be a
  // no-op when nothing changed — an unconditional setState here is a render
  // loop.
  const handleErrors = useCallback((next: unknown) => {
    const list = Array.isArray(next) ? next : next ? [next] : EMPTY_ERRORS;
    setErrors((prev) => (sameErrors(prev, list) ? prev : list));
  }, []);

  if (!program) return null;

  // A malformed program is a model bug, not a user-facing crash: show what was
  // wrong plus the program itself, so the author can still act on it and the
  // failure is diagnosable. (The agent gets the correction on its next turn.)
  if (errors.length) {
    return (
      <View
        style={[
          styles.errorCard,
          { borderColor: `${colors.amber}55`, backgroundColor: `${colors.amber}14` },
        ]}
      >
        <View style={styles.errorHeader}>
          <TriangleAlert size={13} color={colors.amber} />
          <Text style={[styles.errorTitle, { color: colors.amber }]}>
            This card didn&apos;t render
          </Text>
        </View>
        {errors.map((e, i) => (
          <Text key={i} style={styles.errorLine}>
            {errorText(e)}
          </Text>
        ))}
        <Text style={styles.errorLine}>{program}</Text>
      </View>
    );
  }

  return (
    <AnsweredContext.Provider value={answer ?? null}>
      <View style={styles.host}>
        <Renderer
          response={program}
          library={studioLibrary}
          isStreaming={!answerable}
          onAction={(event) => {
            const message = event?.humanFriendlyMessage;
            if (message) onRespond?.(message);
          }}
          onError={handleErrors}
        />
      </View>
    </AnsweredContext.Provider>
  );
}

const styles = StyleSheet.create((theme) => ({
  errorCard: {
    gap: 6,
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  errorLine: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.mutedForeground,
  },
  host: {
    alignSelf: 'stretch',
  },
}));
