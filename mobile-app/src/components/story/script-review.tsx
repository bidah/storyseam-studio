import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { Bot, Check, GitPullRequestArrow, X } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { postJson } from '@/lib/api';
import { CLIENT_ID } from '@/lib/client-id';
import { useInvalidate } from '@/lib/queries';
import {
  diffLines,
  docLines,
  ScreenplayLine,
  type DiffSegment,
  type PMNode,
  type ScriptLine,
} from './screenplay';

// Full-screen review of a pending agent script proposal — the mobile port of
// the web ScriptDiffReview. The diff is per-block (one screenplay element =
// one line): removed blocks strike through in red, added blocks in emerald.
// Mobile keeps it whole-proposal: Accept applies the proposed doc via
// POST /api/script/proposal/accept { doc, title, clientId }; Reject discards
// via POST /api/script/proposal/reject { clientId }.

const MUTED = '#a1a1aa';

function ContextRun({ lines }: { lines: ScriptLine[] }) {
  const [open, setOpen] = useState(lines.length <= 4);
  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Expand ${lines.length} unchanged lines`}
        className="px-3 py-1.5 active:opacity-60"
        onPress={() => setOpen(true)}
      >
        <Text className="text-[12px] text-muted-foreground">
          ··· {lines.length} unchanged lines — tap to expand
        </Text>
      </Pressable>
    );
  }
  return (
    <View className="px-3 opacity-60">
      {lines.map((l, i) => (
        <ScreenplayLine key={i} line={l} />
      ))}
    </View>
  );
}

function ChangeHunk({ hunk }: { hunk: Extract<DiffSegment, { kind: 'change' }> }) {
  return (
    <View className="mx-2 my-1.5 rounded-xl border border-primary/30 bg-primary/5 px-2 py-1.5">
      {hunk.removed.map((l, i) => (
        <ScreenplayLine key={`r${i}`} line={l} tone="del" />
      ))}
      {hunk.added.map((l, i) => (
        <ScreenplayLine key={`a${i}`} line={l} tone="add" />
      ))}
    </View>
  );
}

export function ScriptProposalReview({
  proposal,
  baseTitle,
  onClose,
}: {
  proposal: any;
  baseTitle: string;
  onClose: () => void;
}) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  const segments = useMemo(
    () => diffLines(docLines(proposal.baseDoc as PMNode), docLines(proposal.proposedDoc as PMNode)),
    [proposal],
  );
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    let hunks = 0;
    for (const s of segments) {
      if (s.kind !== 'change') continue;
      hunks += 1;
      added += s.added.length;
      removed += s.removed.length;
    }
    return { added, removed, hunks };
  }, [segments]);

  const proposedTitle =
    typeof proposal.proposedTitle === 'string' ? proposal.proposedTitle : baseTitle;
  const titleChanged = proposedTitle !== baseTitle;
  const noChanges = stats.hunks === 0 && !titleChanged;

  const accept = async () => {
    setBusy('accept');
    try {
      await postJson('/api/script/proposal/accept', {
        doc: proposal.proposedDoc ?? null,
        title: proposedTitle,
        clientId: CLIENT_ID,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      invalidate('script');
      onClose();
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Accept failed'));
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy('reject');
    try {
      await postJson('/api/script/proposal/reject', { clientId: CLIENT_ID });
      invalidate('script');
      onClose();
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Reject failed'));
      setBusy(null);
    }
  };

  return (
    <View className="flex-1">
      {/* Header */}
      <View className="border-b border-primary/30 bg-card px-4 py-3">
        <View className="flex-row items-center gap-2">
          <GitPullRequestArrow size={16} color="#10b981" />
          <Text className="flex-1 text-[15px] font-semibold text-foreground">
            Proposed script edit
          </Text>
          <Badge variant="muted" label={String(proposal.source || 'eve')}>
            <Bot size={11} color={MUTED} />
          </Badge>
        </View>
        <View className="mt-1.5 flex-row items-center gap-2">
          {stats.added > 0 ? <Text className="text-[12px] font-semibold text-success">+{stats.added}</Text> : null}
          {stats.removed > 0 ? (
            <Text className="text-[12px] font-semibold text-destructive">−{stats.removed}</Text>
          ) : null}
          <Text className="text-[12px] text-muted-foreground">
            {stats.hunks + (titleChanged ? 1 : 0)} change{stats.hunks + (titleChanged ? 1 : 0) === 1 ? '' : 's'}
          </Text>
        </View>
        {proposal.note ? (
          <Text className="mt-1 text-[12px] text-muted-foreground">{String(proposal.note)}</Text>
        ) : null}
      </View>

      {/* Diff body */}
      <ScrollView className="flex-1" contentContainerClassName="pb-6 pt-2">
        {titleChanged ? (
          <View className="mx-2 my-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
            <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Title
            </Text>
            <Text className="text-[15px] text-destructive line-through">{baseTitle || '(untitled)'}</Text>
            <Text className="text-[15px] text-success">{proposedTitle || '(untitled)'}</Text>
          </View>
        ) : null}
        {noChanges ? (
          <Text className="px-6 py-10 text-center text-sm text-muted-foreground">
            The proposal matches the current script — nothing to review.
          </Text>
        ) : (
          segments.map((s, i) =>
            s.kind === 'equal' ? <ContextRun key={i} lines={s.lines} /> : <ChangeHunk key={i} hunk={s} />,
          )
        )}
      </ScrollView>

      {/* Actions */}
      <View className="flex-row gap-2 border-t border-border bg-card px-4 py-3 pb-5">
        {noChanges ? (
          <Button className="flex-1" title="Dismiss" loading={busy === 'reject'} onPress={reject}>
            <X size={15} color="white" />
          </Button>
        ) : (
          <>
            <Button
              className="flex-1"
              variant="outline"
              title="Reject"
              loading={busy === 'reject'}
              disabled={!!busy}
              onPress={reject}
            >
              <X size={15} color="#fafafa" />
            </Button>
            <Button
              className="flex-1"
              title="Accept changes"
              loading={busy === 'accept'}
              disabled={!!busy}
              onPress={accept}
            >
              <Check size={15} color="white" />
            </Button>
          </>
        )}
      </View>
    </View>
  );
}
