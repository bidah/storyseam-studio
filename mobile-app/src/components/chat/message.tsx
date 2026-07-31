import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Check, ChevronRight, ExternalLink, FileText, Globe, Wrench } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { apiUrl } from '@/lib/api';
import { useEffectiveScheme } from '@/lib/theme';
import { StudioUI } from '@/genui/StudioUI';
import { detectOptions } from '@/genui/detect-options';
import { ChatMarkdown } from './markdown';
import { getChatColors, useChatColors } from './theme';
import type {
  AgentMessage,
  AskQuestionInput,
  MessagePart,
  QuestionState,
  SentAttachment,
} from './types';
import {
  hostOf,
  parseSourcesOutput,
  QUESTION_TOOLS,
  splitImages,
  visibleParts,
  SOURCE_TOOLS,
  userText,
  type ImageRef,
  type Source,
} from './helpers';

// The agent writes media URLs app-relative (`/storyboard-media/…`); the phone
// needs them absolute against the worker. Same normalization the genui
// renderers do — anything already absolute passes through.
function mediaUri(src?: string | null): string | undefined {
  if (!src) return undefined;
  return /^(https?:|data:|file:)/.test(src) ? src : apiUrl(src);
}

// Renderers for each flue part type — a native port of the web AgentChat.jsx
// message walk: every part of every message renders in order, by `type`
// (`text`, `reasoning`, `dynamic-tool`, `file`).
//
// Interactive questions: flue has no BLOCKING HITL, so the `render_ui` tool is a
// non-blocking recreation — its `dynamic-tool` part carries an openui-lang
// program that renders through the shared component contract (src/genui/) as an
// interactive card: option rows, thumbnail grids, recommendations,
// confirmations. There is no server-side `inputResponse`, so the answer is just
// the next user message: tapping a component sends its `send` string (a typed
// reply works the same way), and `deriveQA` resolves pending/answered.
//
// `ask_question` was the predecessor and still appears in older transcripts, so
// `QuestionCard` stays for those — new turns only ever produce `render_ui`.

// Alpha-suffixed hex helpers for the amber question card (amber is a brand
// constant across schemes; RN accepts 8-digit #RRGGBBAA).
const AMBER = getChatColors('dark').amber;
const AMBER_BORDER = `${AMBER}55`;
const AMBER_BG = `${AMBER}14`;

// An `ask_question` tool call, rendered as an interactive card. `part.input` is
// `{ question, options: [{ id, label, style }] }`. Answerable only while it's the
// pending question; once answered it collapses to "Responded: …" from the
// following user message (`answer`).
function QuestionCard({
  part,
  pending,
  answer,
  canRespond,
  onRespond,
}: {
  part: MessagePart;
  pending: boolean;
  answer?: string;
  canRespond: boolean;
  onRespond?: (label: string) => void;
}) {
  const input = (part.input || {}) as AskQuestionInput;
  const question = typeof input.question === 'string' ? input.question : '';
  const options = Array.isArray(input.options) ? input.options : [];
  const answerable = pending && canRespond;
  return (
    <View
      className="gap-2 self-stretch rounded-xl border p-3"
      style={{ borderColor: AMBER_BORDER, backgroundColor: AMBER_BG }}
    >
      {question ? <ChatMarkdown text={question} /> : null}
      {answer ? (
        <Text className="text-[15px] font-medium text-foreground">Responded: {answer}</Text>
      ) : options.length ? (
        <View className="flex-row flex-wrap gap-2">
          {options.map((opt, i) => {
            const label = opt.label || opt.id || '';
            const danger = opt.style === 'danger';
            return (
              <Pressable
                key={opt.id ?? `${label}:${i}`}
                accessibilityRole="button"
                accessibilityLabel={label}
                disabled={!answerable}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onRespond?.(label);
                }}
                className={cn(
                  'rounded-lg border px-3 py-2 active:opacity-70',
                  danger ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-secondary',
                  !answerable && 'opacity-50',
                )}
              >
                <Text
                  className={cn(
                    'text-[14px] font-medium',
                    danger ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text className="text-[12px] text-muted-foreground">Type your answer below to continue.</Text>
      )}
    </View>
  );
}

// A compact chip for a flue `dynamic-tool` part. `state` is one of
// input-available / output-available / output-error.
//
// `tail` is whether the part's message is the transcript's LAST message. flue
// only ever runs tools at the transcript tail, so an unfinished part (no
// output, no error) on any EARLIER message is provably dead — the turn moved
// past it without a result (e.g. the model's tool-call JSON got truncated at
// the output cap and the run failed). Without this, that chip spins forever.
function ToolChip({ part, tail }: { part: MessagePart; tail?: boolean }) {
  const c = useChatColors();
  const name = part.toolName || 'tool';
  const errored = part.state === 'output-error';
  const finished = part.state === 'output-available';
  const interrupted = !tail && !errored && !finished;
  const running = !errored && !finished && !interrupted;
  return (
    <View className="max-w-full flex-col gap-0.5 self-start">
      <View
        className={cn(
          'flex-row items-center gap-1.5 self-start rounded-md border px-2 py-1',
          errored ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/50',
        )}
      >
        <Wrench size={12} color={errored ? c.destructive : c.mutedForeground} />
        <Text
          className={cn('text-[12px]', errored ? 'text-destructive' : 'text-muted-foreground')}
          numberOfLines={1}
        >
          {name}
          {errored ? ' · failed' : interrupted ? ' · interrupted' : ''}
        </Text>
        {running ? (
          <ActivityIndicator size="small" color={c.mutedForeground} style={{ transform: [{ scale: 0.7 }] }} />
        ) : finished ? (
          <Check size={12} color={c.mutedForeground} />
        ) : null}
      </View>
      {errored && part.errorText ? (
        <Text className="max-w-full text-[11px] text-destructive">{part.errorText}</Text>
      ) : interrupted ? (
        <Text className="max-w-full text-[11px] text-muted-foreground">
          The turn ended before this tool finished — nothing was saved. Ask again to retry.
        </Text>
      ) : null}
    </View>
  );
}

// A `web_search` / `fetch_url` result, rendered as a collapsed "Sources · N"
// card that expands into one sub-card per reference. Web opens these in a new
// tab; on mobile each sub-card opens the IN-APP browser (expo-web-browser, the
// same handler markdown link taps use), so a tapped reference doesn't kick the
// user out to Safari and lose the conversation.
function SourcesCard({ data }: { data: { sources: Source[]; query: string } }) {
  const c = useChatColors();
  const [open, setOpen] = useState(false);
  const { sources, query } = data;
  return (
    <View className="self-stretch rounded-md border border-border bg-muted/30">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Collapse sources' : `Expand ${sources.length} sources`}
        className="flex-row items-center gap-1.5 px-2.5 py-1.5 active:opacity-70"
        onPress={() => setOpen((v) => !v)}
      >
        <ChevronRight
          size={13}
          color={c.mutedForeground}
          style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
        />
        <Globe size={12} color={c.primary} />
        <Text className="text-[12px] font-medium text-foreground">Sources</Text>
        <Text className="text-[12px] text-muted-foreground">· {sources.length}</Text>
        {query ? (
          <Text className="flex-1 text-[12px] italic text-muted-foreground" numberOfLines={1}>
            {query}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View className="gap-1.5 border-t border-border p-1.5">
          {sources.map((s, i) => (
            <Pressable
              key={`${s.url}:${i}`}
              accessibilityRole="link"
              accessibilityLabel={`Open ${s.title}`}
              className="gap-0.5 rounded-md border border-border bg-background/60 p-2 active:opacity-70"
              onPress={() => {
                WebBrowser.openBrowserAsync(s.url).catch(() => {});
              }}
            >
              <View className="flex-row items-center gap-1.5">
                <Text className="flex-1 text-[12px] font-medium text-foreground" numberOfLines={2}>
                  {s.title}
                </Text>
                <ExternalLink size={11} color={c.mutedForeground} />
              </View>
              <View className="flex-row items-center gap-1.5">
                <Text className="flex-1 text-[11px] text-muted-foreground" numberOfLines={1}>
                  {hostOf(s.url)}
                  {s.publishedDate ? ` · ${s.publishedDate.slice(0, 10)}` : ''}
                </Text>
              </View>
              {s.snippet ? (
                <Text className="text-[11px] leading-4 text-muted-foreground" numberOfLines={2}>
                  {s.snippet}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ReasoningRow({ part }: { part: MessagePart }) {
  const c = useChatColors();
  const [open, setOpen] = useState(false);
  // Natural height of the body, measured while it's clipped to 0 — Yoga still
  // lays the child out at its content height, so onLayout reports the real
  // number before it has ever been visible. That's what the reveal animates to.
  //
  // It has to be a SHARED value, not JS state: React Compiler is on in this app,
  // and a `bodyH` captured from useState freezes at its first-render 0 inside
  // the worklet — the chevron (no JS capture) turned while the body stayed
  // clipped shut. Shared values are read on the UI thread, so they can't go stale.
  const bodyH = useSharedValue(0);
  // 0 = collapsed, 1 = open. Drives the height reveal AND the chevron rotation
  // off one value, so the two can't drift apart mid-animation.
  const progress = useSharedValue(0);

  const bodyStyle = useAnimatedStyle(() => ({
    height: progress.value * bodyH.value,
    opacity: progress.value,
  }));
  // The chevron rotates on a wrapper View, not on the SVG's own style: a
  // transform handed to react-native-svg doesn't take, which is why the open
  // state used to show a still-pointing-right chevron.
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 90}deg` }],
  }));

  if (!part.text?.trim()) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Writing a Reanimated shared value, which the immutability rule doesn't
    // model (same reason chat/index.tsx disables it file-wide).
    // eslint-disable-next-line react-hooks/immutability
    progress.value = withTiming(next ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  };

  return (
    <View className="my-1 self-stretch rounded-lg border border-border bg-muted/30">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Collapse reasoning' : 'Expand reasoning'}
        className="flex-row items-center gap-2 px-3.5 py-3"
        onPress={toggle}
      >
        <Animated.View style={chevronStyle}>
          <ChevronRight size={13} color={c.mutedForeground} />
        </Animated.View>
        <Text className="text-[12px] font-medium text-muted-foreground">Reasoning</Text>
      </Pressable>
      {/* Always mounted (that's what keeps bodyH measured) and clipped to the
          animated height; untouchable while collapsed. */}
      <Animated.View style={[bodyStyle, { overflow: 'hidden' }]} pointerEvents={open ? 'auto' : 'none'}>
        {/* Absolutely positioned so the clip doesn't squash it: an in-flow child
            of a height:0 parent measures 0 (verified on-device — onLayout
            reported 0 every time, so the reveal had nothing to open to), while
            an absolute one is sized by its content and pinned to the full width. */}
        <View
          style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
          onLayout={(e) => {
            // eslint-disable-next-line react-hooks/immutability
            bodyH.value = e.nativeEvent.layout.height;
          }}
        >
          <Text className="px-3.5 pb-3.5 text-[12px] leading-4 text-muted-foreground">
            {part.text}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

// An image the agent showed in its prose — lifted out of the markdown by
// `splitImages` and drawn here at FULL WIDTH instead of as the 20pt inline dot
// the native markdown renderer produces (see splitImages for why).
//
// The aspect ratio comes from the image itself via `onLoad`: a generated plate
// is 16:9, a character sheet is portrait, and a fixed box would letterbox one to
// serve the other. 16:9 is the placeholder until the first frame decodes, and
// portrait is clamped so a tall sheet can't take over the whole screen.
function ChatImage({ image, index }: { image: ImageRef; index?: number }) {
  const c = useChatColors();
  const [aspect, setAspect] = useState(16 / 9);
  const uri = mediaUri(image.url);
  if (!uri) return null;
  const img = (
    <Image
      source={{ uri }}
      accessibilityLabel={image.alt || 'image'}
      contentFit="cover"
      transition={150}
      onLoad={(e) => {
        const { width, height } = e.source ?? {};
        if (width && height) setAspect(Math.max(0.7, width / height));
      }}
      style={{ width: '100%', height: '100%', backgroundColor: c.muted }}
    />
  );
  return (
    <View className="overflow-hidden self-stretch rounded-xl" style={{ aspectRatio: aspect }}>
      {index === undefined ? (
        img
      ) : (
        <Galeria.Image index={index} style={{ width: '100%', height: '100%' }}>
          {img}
        </Galeria.Image>
      )}
    </View>
  );
}

// A flue `file` part — an attachment carried on a message. Historical bytes
// aren't served, but a durably-recorded attachment (or an optimistic local echo)
// carries a `url` we can render; images inline, everything else as a chip.
//
// `index` is this image's position in the row's Galeria url list (see
// `MessageRow`), so tapping it opens the full-screen swipeable preview — the
// same shared-element viewer the Assets grid and the render_ui MediaGrid use. A
// 180pt thumbnail is not enough to judge a generated image by. It is undefined
// only if the part somehow isn't in that list, in which case the image renders
// untappable rather than through a Galeria.Image with no provider above it.
function FilePart({ part, index }: { part: MessagePart; index?: number }) {
  const c = useChatColors();
  const isImage = part.mediaType?.startsWith('image/');
  if (part.url && isImage) {
    const img = (
      <Image
        source={{ uri: part.url }}
        accessibilityLabel={part.filename || 'attachment'}
        contentFit="contain"
        transition={150}
        style={{ width: '100%', height: '100%', backgroundColor: c.muted }}
      />
    );
    return (
      <View className="overflow-hidden self-start rounded-[10px]" style={{ width: 180, height: 180 }}>
        {index === undefined ? (
          img
        ) : (
          <Galeria.Image index={index} style={{ width: '100%', height: '100%' }}>
            {img}
          </Galeria.Image>
        )}
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-md border border-border bg-muted/50 px-2 py-1">
      <FileText size={12} color={c.mutedForeground} />
      <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
        {part.filename || part.mediaType || 'attachment'}
      </Text>
    </View>
  );
}

function PartView({
  part,
  qa,
  canRespond,
  onRespond,
  offerOptions,
  galeriaIndex,
}: {
  part: MessagePart;
  qa?: QuestionState;
  canRespond: boolean;
  onRespond?: (label: string) => void;
  offerOptions: boolean;
  galeriaIndex: Map<string, number>;
}) {
  switch (part.type) {
    case 'text': {
      if (!part.text) return null;
      const streaming = part.state === 'streaming';
      // Images the agent wrote into its prose are rendered by us, not by the
      // markdown renderer — see splitImages. A message showing pictures isn't a
      // choice list, so the options rescue below doesn't apply to it.
      const segments = splitImages(part.text);
      if (segments.some((s) => s.image)) {
        return (
          <View className="gap-2">
            {segments.map((s, i) =>
              s.image ? (
                <ChatImage
                  key={`img:${s.image.url}:${i}`}
                  image={s.image}
                  index={galeriaIndex.get(s.image.url)}
                />
              ) : (
                <ChatMarkdown key={`md:${i}`} text={s.md} streaming={streaming} />
              ),
            )}
          </View>
        );
      }
      // Models keep writing choices as "A) … B) …" prose however firmly the
      // generative-ui skill says to draw them. `offerOptions` is set only on the
      // last assistant message of a settled turn that produced no card of its
      // own, so a rescued list is answerable exactly when a real one would be —
      // and older messages keep their plain markdown.
      const rescued = !streaming && offerOptions ? detectOptions(part.text) : null;
      if (!rescued) return <ChatMarkdown text={part.text} streaming={streaming} />;
      return (
        <>
          {rescued.body ? <ChatMarkdown text={rescued.body} /> : null}
          <StudioUI lang={rescued.program} answerable={canRespond} onRespond={onRespond} />
        </>
      );
    }
    case 'reasoning':
      return <ReasoningRow part={part} />;
    case 'dynamic-tool': {
      if (part.toolName === 'render_ui') {
        const pending = qa?.pendingId === part.toolCallId;
        return (
          <StudioUI
            lang={(part.input as { lang?: string } | undefined)?.lang}
            answerable={pending && canRespond}
            // What the author replied, so the card can show WHICH option they
            // took rather than just going inert. See genui/answered.ts.
            answer={part.toolCallId ? qa?.answered.get(part.toolCallId) : undefined}
            onRespond={onRespond}
          />
        );
      }
      if (part.toolName === 'ask_question') {
        return (
          <QuestionCard
            part={part}
            pending={qa?.pendingId === part.toolCallId}
            answer={part.toolCallId ? qa?.answered.get(part.toolCallId) : undefined}
            canRespond={canRespond}
            onRespond={onRespond}
          />
        );
      }
      // A finished web search shows its references instead of a bare chip; an
      // in-flight or failed one still falls through to ToolChip.
      if (part.toolName && SOURCE_TOOLS.has(part.toolName)) {
        const sources = parseSourcesOutput(part);
        if (sources) return <SourcesCard data={sources} />;
      }
      return <ToolChip part={part} />;
    }
    case 'file':
      return <FilePart part={part} index={part.url ? galeriaIndex.get(part.url) : undefined} />;
    default:
      return null;
  }
}

// Thumbnails for the images a user turn was sent with, rendered back into the
// bubble (flue's `file` parts don't serve historical bytes, so `atts` comes from
// the composer's ordinal-aligned record).
function SentAttachments({ atts }: { atts: SentAttachment[] | null }) {
  const c = useChatColors();
  if (!atts?.length) return null;
  return (
    <View className="mt-1.5 flex-row flex-wrap justify-end gap-1.5">
      {atts.map((a, i) => (
        // Tappable for the same full-screen look the agent's images get — the
        // ordinal here IS the Galeria index, because a user row's url list is
        // exactly its attachments (see MessageRow).
        <View
          key={`${a.url}:${i}`}
          className="overflow-hidden rounded-[10px]"
          style={{ width: 76, height: 76 }}
        >
          <Galeria.Image index={i} style={{ width: '100%', height: '100%' }}>
            <Image
              source={{ uri: a.url }}
              accessibilityLabel={a.name || 'attachment'}
              contentFit="cover"
              transition={150}
              style={{ width: '100%', height: '100%', backgroundColor: c.muted }}
            />
          </Galeria.Image>
        </View>
      ))}
    </View>
  );
}

export const MessageRow = memo(function MessageRow({
  message,
  atts,
  qa,
  canRespond,
  onRespond,
  isLast = false,
}: {
  message: AgentMessage;
  atts: SentAttachment[] | null;
  qa?: QuestionState;
  canRespond: boolean;
  onRespond?: (label: string) => void;
  isLast?: boolean;
}) {
  // Galeria previews a WHOLE set swipeably, so it needs every url of this row
  // up front and each image needs its position in that list. The scope is one
  // message row: swiping moves between the images of the same bubble (the takes
  // of one generation, the references of one send), not across the transcript.
  const scheme = useEffectiveScheme();

  if (message.role === 'user') {
    const text = userText(message);
    const urls = (atts || []).map((a) => a.url).filter(Boolean);
    return (
      <Galeria urls={urls} theme={scheme}>
        <View className="items-end px-4">
          {text ? (
            <View className="max-w-[88%] rounded-2xl bg-secondary px-3.5 py-2.5">
              <Text className="text-[16px] leading-[23px] text-foreground" selectable>
                {text}
              </Text>
            </View>
          ) : null}
          <SentAttachments atts={atts} />
        </View>
      </Galeria>
    );
  }
  // A prose choice list is only worth rescuing on the newest assistant turn,
  // and only when the agent didn't already draw a card — otherwise the message
  // would carry two competing sets of buttons.
  const drewCard = (message.parts || []).some(
    (p) => p.type === 'dynamic-tool' && QUESTION_TOOLS.has(p.toolName ?? ''),
  );
  // Anything the model wrote AFTER its card is dropped — the card is the last
  // word of the turn — including a whole message written past it, which is the
  // usual shape (one flue message per step). See visibleParts. A message that
  // was nothing BUT that trailing prose renders nothing, not an empty gap.
  const parts = visibleParts(message.parts, !!message.id && !!qa?.sealed?.has(message.id));
  if (!parts.length) return null;
  // The row's image url list, in render order — the images the agent wrote into
  // its prose, plus any image `file` parts. Keyed by the url AS WRITTEN (the
  // absolute form goes to Galeria) so a lookup from either renderer matches. A
  // url that repeats keeps its FIRST index, so the viewer doesn't show the same
  // picture twice.
  const galeriaIndex = new Map<string, number>();
  const urls: string[] = [];
  const add = (raw: string | undefined) => {
    const uri = mediaUri(raw);
    if (!raw || !uri || galeriaIndex.has(raw)) return;
    galeriaIndex.set(raw, urls.length);
    urls.push(uri);
  };
  for (const p of parts) {
    if (p.type === 'text' && p.text) {
      for (const s of splitImages(p.text)) if (s.image) add(s.image.url);
    } else if (p.type === 'file' && p.mediaType?.startsWith('image/')) {
      add(p.url);
    }
  }
  return (
    <Galeria urls={urls} theme={scheme}>
      <View className="gap-2 px-4">
        {parts.map((part, i) => (
          <PartView
            key={part.toolCallId ?? `${part.type ?? 'part'}:${i}`}
            part={part}
            qa={qa}
            canRespond={canRespond}
            onRespond={onRespond}
            offerOptions={isLast && !drewCard}
            galeriaIndex={galeriaIndex}
          />
        ))}
      </View>
    </Galeria>
  );
});
