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
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Renderer } from '@openuidev/react-lang';
import { TriangleAlert } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { buildStudioLibrary } from './contract';
import { nativeRenderers } from './renderers';

export const studioLibrary = buildStudioLibrary(nativeRenderers);

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
 */
export function StudioUI({
  lang,
  answerable,
  onRespond,
}: {
  lang?: string | null;
  answerable: boolean;
  onRespond?: (message: string) => void;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const program = cleanLang(lang);

  if (!program) return null;

  // A malformed program is a model bug, not a user-facing crash: show the
  // program as text so the author can still act on it, and keep the thread
  // usable. (The agent gets the correction on its next turn from the user.)
  if (failed) {
    return (
      <View
        className="gap-1.5 self-stretch rounded-2xl border p-3"
        style={{ borderColor: `${colors.amber}55`, backgroundColor: `${colors.amber}14` }}
      >
        <View className="flex-row items-center gap-1.5">
          <TriangleAlert size={13} color={colors.amber} />
          <Text className="text-[12px] font-medium" style={{ color: colors.amber }}>
            This card didn&apos;t render
          </Text>
        </View>
        <Text className="text-[12px] leading-4 text-muted-foreground">{program}</Text>
      </View>
    );
  }

  return (
    <View className="self-stretch">
      <Renderer
        response={program}
        library={studioLibrary}
        isStreaming={!answerable}
        onAction={(event) => {
          const message = event?.humanFriendlyMessage;
          if (message) onRespond?.(message);
        }}
        onError={() => setFailed(true)}
      />
    </View>
  );
}
