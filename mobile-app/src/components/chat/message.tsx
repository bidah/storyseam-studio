import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Check, ChevronRight, ExternalLink, FileText, Globe, Wrench } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from './markdown';
import { getChatColors, useChatColors } from './theme';
import type {
  AgentMessage,
  AskQuestionInput,
  MessagePart,
  QuestionState,
  SentAttachment,
} from './types';
import { hostOf, parseSourcesOutput, SOURCE_TOOLS, userText, type Source } from './helpers';

// Renderers for each flue part type — a native port of the web AgentChat.jsx
// message walk: every part of every message renders in order, by `type`
// (`text`, `reasoning`, `dynamic-tool`, `file`).
//
// Interactive questions: flue has no BLOCKING HITL, so the `ask_question` tool
// is a non-blocking recreation — its `dynamic-tool` part renders as a
// `QuestionCard` with clickable options. There is no server-side `inputResponse`,
// so the answer is just the next user message: tapping an option sends its label
// (a typed reply works the same way), and `deriveQA` resolves pending/answered.

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
function ToolChip({ part }: { part: MessagePart }) {
  const c = useChatColors();
  const name = part.toolName || 'tool';
  const errored = part.state === 'output-error';
  const running = !errored && part.state !== 'output-available';
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
          {errored ? ' · failed' : ''}
        </Text>
        {running ? (
          <ActivityIndicator size="small" color={c.mutedForeground} style={{ transform: [{ scale: 0.7 }] }} />
        ) : !errored ? (
          <Check size={12} color={c.mutedForeground} />
        ) : null}
      </View>
      {errored && part.errorText ? (
        <Text className="max-w-full text-[11px] text-destructive">{part.errorText}</Text>
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
  if (!part.text?.trim()) return null;
  return (
    <View className="self-stretch rounded-md border border-border bg-muted/30">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Collapse reasoning' : 'Expand reasoning'}
        className="flex-row items-center gap-1.5 px-2.5 py-1.5 active:opacity-70"
        onPress={() => setOpen((v) => !v)}
      >
        <ChevronRight
          size={13}
          color={c.mutedForeground}
          style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
        />
        <Text className="text-[12px] font-medium text-muted-foreground">Reasoning</Text>
      </Pressable>
      {open ? (
        <Text className="px-2.5 pb-2 text-[12px] leading-4 text-muted-foreground">{part.text}</Text>
      ) : null}
    </View>
  );
}

// A flue `file` part — an attachment carried on a message. Historical bytes
// aren't served, but a durably-recorded attachment (or an optimistic local echo)
// carries a `url` we can render; images inline, everything else as a chip.
function FilePart({ part }: { part: MessagePart }) {
  const c = useChatColors();
  const isImage = part.mediaType?.startsWith('image/');
  if (part.url && isImage) {
    return (
      <Image
        source={{ uri: part.url }}
        accessibilityLabel={part.filename || 'attachment'}
        contentFit="contain"
        transition={150}
        style={{ width: 180, height: 180, borderRadius: 10, backgroundColor: c.muted }}
      />
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
}: {
  part: MessagePart;
  qa?: QuestionState;
  canRespond: boolean;
  onRespond?: (label: string) => void;
}) {
  switch (part.type) {
    case 'text':
      return part.text ? <ChatMarkdown text={part.text} streaming={part.state === 'streaming'} /> : null;
    case 'reasoning':
      return <ReasoningRow part={part} />;
    case 'dynamic-tool': {
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
      return <FilePart part={part} />;
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
        <Image
          key={`${a.url}:${i}`}
          source={{ uri: a.url }}
          accessibilityLabel={a.name || 'attachment'}
          contentFit="cover"
          transition={150}
          style={{ width: 76, height: 76, borderRadius: 10, backgroundColor: c.muted }}
        />
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
}: {
  message: AgentMessage;
  atts: SentAttachment[] | null;
  qa?: QuestionState;
  canRespond: boolean;
  onRespond?: (label: string) => void;
}) {
  if (message.role === 'user') {
    const text = userText(message);
    return (
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
    );
  }
  return (
    <View className="gap-2 px-4">
      {(message.parts || []).map((part, i) => (
        <PartView
          key={part.toolCallId ?? `${part.type ?? 'part'}:${i}`}
          part={part}
          qa={qa}
          canRespond={canRespond}
          onRespond={onRespond}
        />
      ))}
    </View>
  );
});
