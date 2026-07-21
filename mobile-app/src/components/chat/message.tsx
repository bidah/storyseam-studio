import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, ChevronRight, FileText, Wrench } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from './markdown';
import { chatColors } from './theme';
import type { AgentMessage, MessagePart, SentAttachment } from './types';
import { userText } from './helpers';

// Renderers for each flue part type — a native port of the web AgentChat.jsx
// message walk: every part of every message renders in order, by `type`
// (`text`, `reasoning`, `dynamic-tool`, `file`). flue has no blocking HITL — the
// agent asks questions as plain assistant text and the user replies with the
// next message — so there is no input-request card and no `inputResponses` path.

// A compact chip for a flue `dynamic-tool` part. `state` is one of
// input-available / output-available / output-error.
function ToolChip({ part }: { part: MessagePart }) {
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
        <Wrench size={12} color={errored ? chatColors.destructive : chatColors.mutedForeground} />
        <Text
          className={cn('text-[12px]', errored ? 'text-destructive' : 'text-muted-foreground')}
          numberOfLines={1}
        >
          {name}
          {errored ? ' · failed' : ''}
        </Text>
        {running ? (
          <ActivityIndicator size="small" color={chatColors.mutedForeground} style={{ transform: [{ scale: 0.7 }] }} />
        ) : !errored ? (
          <Check size={12} color={chatColors.mutedForeground} />
        ) : null}
      </View>
      {errored && part.errorText ? (
        <Text className="max-w-full text-[11px] text-destructive">{part.errorText}</Text>
      ) : null}
    </View>
  );
}

function ReasoningRow({ part }: { part: MessagePart }) {
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
          color={chatColors.mutedForeground}
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
  const isImage = part.mediaType?.startsWith('image/');
  if (part.url && isImage) {
    return (
      <Image
        source={{ uri: part.url }}
        accessibilityLabel={part.filename || 'attachment'}
        contentFit="contain"
        transition={150}
        style={{ width: 180, height: 180, borderRadius: 10, backgroundColor: chatColors.muted }}
      />
    );
  }
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-md border border-border bg-muted/50 px-2 py-1">
      <FileText size={12} color={chatColors.mutedForeground} />
      <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
        {part.filename || part.mediaType || 'attachment'}
      </Text>
    </View>
  );
}

function PartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      return part.text ? <ChatMarkdown text={part.text} streaming={part.state === 'streaming'} /> : null;
    case 'reasoning':
      return <ReasoningRow part={part} />;
    case 'dynamic-tool':
      return <ToolChip part={part} />;
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
          style={{ width: 76, height: 76, borderRadius: 10, backgroundColor: chatColors.muted }}
        />
      ))}
    </View>
  );
}

export const MessageRow = memo(function MessageRow({
  message,
  atts,
}: {
  message: AgentMessage;
  atts: SentAttachment[] | null;
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
        <PartView key={part.toolCallId ?? `${part.type ?? 'part'}:${i}`} part={part} />
      ))}
    </View>
  );
});
