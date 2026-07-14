import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Wrench,
  XCircle,
} from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from './markdown';
import { chatColors } from './theme';
import type { AgentMessage, InputRequestOption, MessagePart, SentAttachment } from './types';
import { userText } from './helpers';

// Renderers for each eve part type — a native port of the web AgentChat.jsx
// message walk: every part of every message renders in order, by `type`.

export type Respond = (
  responses: Array<{ requestId: string; optionId?: string; text?: string }>,
) => void;

function ToolChip({ part }: { part: MessagePart }) {
  const name = part.toolName || 'tool';
  const errored = part.state === 'output-error';
  const running = !errored && part.state !== 'output-available';
  return (
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

function optionClasses(style?: string) {
  if (style === 'danger') return { box: 'bg-destructive', text: 'text-destructive-foreground' };
  if (style === 'primary') return { box: 'bg-primary', text: 'text-primary-foreground' };
  return { box: 'bg-secondary', text: 'text-secondary-foreground' };
}

// HITL card: an eve `ask_question` rendered inline on its tool part. Options
// are real buttons; once answered it collapses to a persistent "Responded: …".
function InputRequestCard({
  part,
  canRespond,
  onRespond,
}: {
  part: MessagePart;
  canRespond: boolean;
  onRespond: Respond;
}) {
  const req = part.toolMetadata?.eve?.inputRequest;
  if (!req) return null;
  const res = part.toolMetadata?.eve?.inputResponse;
  const selected = req.options?.find((o) => o.id === res?.optionId);

  const pick = (opt: InputRequestOption) => {
    Haptics.selectionAsync().catch(() => {});
    onRespond([{ requestId: req.requestId, optionId: opt.id }]);
  };

  return (
    <View className="gap-2 self-stretch rounded-xl border border-warning/40 bg-warning/10 p-3">
      {req.prompt ? <ChatMarkdown text={req.prompt} muted /> : null}
      {res ? (
        <Text className="text-sm font-medium text-foreground">
          Responded: {selected?.label ?? res.text ?? res.optionId}
        </Text>
      ) : req.options?.length ? (
        <View className="flex-row flex-wrap gap-2">
          {req.options.map((opt) => {
            const c = optionClasses(opt.style);
            return (
              <Pressable
                key={opt.id}
                accessibilityRole="button"
                disabled={!canRespond}
                onPress={() => pick(opt)}
                className={cn(
                  'max-w-full rounded-lg px-3 py-2 active:opacity-80',
                  c.box,
                  !canRespond && 'opacity-50',
                )}
              >
                <Text className={cn('text-[13px] font-semibold leading-snug', c.text)}>
                  {opt.label ?? opt.id}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text className="text-xs text-muted-foreground">Type your answer below to continue.</Text>
      )}
    </View>
  );
}

function authTitle(part: MessagePart): string {
  const name = part.displayName || 'service';
  if (part.state === 'required') return `Connect ${name}`;
  if (part.outcome === 'authorized') return `${name} connected`;
  return `${name} authorization ${part.outcome ?? 'ended'}`;
}

// OAuth connect card — opens the provider URL in the in-app browser.
function AuthorizationCard({ part }: { part: MessagePart }) {
  const isAuthorized = part.state === 'completed' && part.outcome === 'authorized';
  const isCompleted = part.state === 'completed';
  const Icon = isAuthorized ? CheckCircle2 : isCompleted ? XCircle : KeyRound;
  const iconColor = isAuthorized
    ? chatColors.primary
    : isCompleted
      ? chatColors.destructive
      : chatColors.primary;
  const instructions = part.authorization?.instructions;
  const showInstructions = !!instructions && instructions !== part.description;
  const url = part.authorization?.url;

  return (
    <View
      className={cn(
        'flex-row items-start gap-2.5 self-stretch rounded-xl border p-3',
        isAuthorized
          ? 'border-primary/40 bg-primary/10'
          : isCompleted
            ? 'border-destructive/40 bg-destructive/10'
            : 'border-primary/40 bg-primary/5',
      )}
    >
      <View className="mt-0.5 h-7 w-7 items-center justify-center rounded-full bg-muted">
        <Icon size={15} color={iconColor} />
      </View>
      <View className="min-w-0 flex-1 gap-1.5">
        <Text className="text-sm font-medium text-foreground">{authTitle(part)}</Text>
        {part.description ? (
          <Text className="text-sm text-muted-foreground">{part.description}</Text>
        ) : null}
        {showInstructions ? (
          <Text className="text-sm text-muted-foreground">{instructions}</Text>
        ) : null}
        {part.state === 'required' && part.authorization?.userCode ? (
          <View className="flex-row items-center gap-2">
            <Text className="text-sm text-muted-foreground">Code</Text>
            <View className="rounded-md bg-background px-2 py-1">
              <Text className="font-mono text-sm text-foreground">{part.authorization.userCode}</Text>
            </View>
          </View>
        ) : null}
        {part.state === 'required' && url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sign in with ${part.displayName || 'service'}`}
            className="mt-1 flex-row items-center gap-1.5 self-start rounded-lg bg-primary px-3 py-2 active:opacity-80"
            onPress={() => WebBrowser.openBrowserAsync(url).catch(() => {})}
          >
            <ExternalLink size={14} color={chatColors.primaryForeground} />
            <Text className="text-[13px] font-semibold text-primary-foreground">
              Sign in with {part.displayName || 'service'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function PartView({
  part,
  canRespond,
  onRespond,
}: {
  part: MessagePart;
  canRespond: boolean;
  onRespond: Respond;
}) {
  switch (part.type) {
    case 'step-start':
      return null;
    case 'text':
      return part.text ? <ChatMarkdown text={part.text} streaming={part.state === 'streaming'} /> : null;
    case 'reasoning':
      return <ReasoningRow part={part} />;
    case 'authorization':
      return <AuthorizationCard part={part} />;
    case 'dynamic-tool':
      if (part.toolMetadata?.eve?.inputRequest) {
        return <InputRequestCard part={part} canRespond={canRespond} onRespond={onRespond} />;
      }
      return <ToolChip part={part} />;
    default:
      return null;
  }
}

// Thumbnails for the images a user turn was sent with (re-rendered from the
// ordinal-aligned attachments record — eve's projection drops image parts).
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
  canRespond,
  onRespond,
}: {
  message: AgentMessage;
  atts: SentAttachment[] | null;
  canRespond: boolean;
  onRespond: Respond;
}) {
  if (message.role === 'user') {
    const text = userText(message);
    return (
      <View className="items-end px-4">
        {text ? (
          <View className="max-w-[88%] rounded-2xl bg-secondary px-3.5 py-2.5">
            <Text className="text-[15px] leading-[21px] text-foreground" selectable>
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
          canRespond={canRespond}
          onRespond={onRespond}
        />
      ))}
    </View>
  );
});
