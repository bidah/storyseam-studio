import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { Bot, Check, GitPullRequestArrow, X } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { postJson } from '@/lib/api';
import { CLIENT_ID } from '@/lib/client-id';
import { useColors } from '@/lib/colors';
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

function ContextRun({ lines }: { lines: ScriptLine[] }) {
  const [open, setOpen] = useState(lines.length <= 4);
  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Expand ${lines.length} unchanged lines`}
        style={({ pressed }) => [styles.contextCollapsed, pressed && styles.pressed60]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.contextCollapsedText}>
          ··· {lines.length} unchanged lines — tap to expand
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.contextExpanded}>
      {lines.map((l, i) => (
        <ScreenplayLine key={i} line={l} />
      ))}
    </View>
  );
}

function ChangeHunk({ hunk }: { hunk: Extract<DiffSegment, { kind: 'change' }> }) {
  return (
    <View style={styles.hunk}>
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
  const colors = useColors();
  const invalidate = useInvalidate();
  // This surface takes over the whole Story tab body, which runs to the window
  // edge UNDER the bar cluster — so the docked Accept/Reject row has to clear it
  // itself. `insets.bottom` here is already tab bar + gap + accessory (expo-router
  // wraps each tab in its own SafeAreaProvider), the same number the chat composer
  // pads by; never measure the accessory by hand. See lib/use-tab-bar-inset.ts.
  const insets = useSafeAreaInsets();
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
    <View style={styles.flex1}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <GitPullRequestArrow size={16} color={colors.primary} />
          <Text style={styles.headerTitle}>
            Proposed script edit
          </Text>
          <Badge variant="muted" label={String(proposal.source || 'agent')}>
            <Bot size={11} color={colors.mutedForeground} />
          </Badge>
        </View>
        <View style={styles.statsRow}>
          {stats.added > 0 ? <Text style={styles.statAdded}>+{stats.added}</Text> : null}
          {stats.removed > 0 ? (
            <Text style={styles.statRemoved}>−{stats.removed}</Text>
          ) : null}
          <Text style={styles.statText}>
            {stats.hunks + (titleChanged ? 1 : 0)} change{stats.hunks + (titleChanged ? 1 : 0) === 1 ? '' : 's'}
          </Text>
        </View>
        {proposal.note ? (
          <Text style={styles.note}>{String(proposal.note)}</Text>
        ) : null}
      </View>

      {/* Diff body */}
      <ScrollView style={styles.flex1} contentContainerStyle={styles.diffBody}>
        {titleChanged ? (
          <View style={styles.titleBox}>
            <Text style={styles.titleLabel}>
              Title
            </Text>
            <Text style={styles.titleOld}>{baseTitle || '(untitled)'}</Text>
            <Text style={styles.titleNew}>{proposedTitle || '(untitled)'}</Text>
          </View>
        ) : null}
        {noChanges ? (
          <Text style={styles.noChanges}>
            The proposal matches the current script — nothing to review.
          </Text>
        ) : (
          segments.map((s, i) =>
            s.kind === 'equal' ? <ContextRun key={i} lines={s.lines} /> : <ChangeHunk key={i} hunk={s} />,
          )
        )}
      </ScrollView>

      {/* Actions — pinned above the tab bar + agent accessory. */}
      <View
        style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 8) + 5 }]}
      >
        {noChanges ? (
          <Button style={styles.flex1} title="Dismiss" loading={busy === 'reject'} onPress={reject}>
            <X size={15} color={colors.primaryForeground} />
          </Button>
        ) : (
          <>
            <Button
              style={styles.flex1}
              variant="outline"
              title="Reject"
              loading={busy === 'reject'}
              disabled={!!busy}
              onPress={reject}
            >
              <X size={15} color={colors.foreground} />
            </Button>
            <Button
              style={styles.flex1}
              title="Accept changes"
              loading={busy === 'accept'}
              disabled={!!busy}
              onPress={accept}
            >
              <Check size={15} color={colors.primaryForeground} />
            </Button>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex1: {
    flex: 1,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: `${theme.colors.primary}4D`,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.foreground,
  },
  statsRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statAdded: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.success,
  },
  statRemoved: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.destructive,
  },
  statText: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  note: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  diffBody: {
    paddingBottom: 24,
    paddingTop: 8,
  },
  contextCollapsed: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pressed60: {
    opacity: 0.6,
  },
  contextCollapsedText: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  contextExpanded: {
    paddingHorizontal: 12,
    opacity: 0.6,
  },
  hunk: {
    marginHorizontal: 8,
    marginVertical: 6,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: `${theme.colors.primary}4D`,
    backgroundColor: `${theme.colors.primary}0D`,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  titleBox: {
    marginHorizontal: 8,
    marginVertical: 6,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: `${theme.colors.primary}4D`,
    backgroundColor: `${theme.colors.primary}0D`,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  titleLabel: {
    marginBottom: 4,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.mutedForeground,
  },
  titleOld: {
    fontSize: 15,
    color: theme.colors.destructive,
    textDecorationLine: 'line-through',
  },
  titleNew: {
    fontSize: 15,
    color: theme.colors.success,
  },
  noChanges: {
    paddingHorizontal: 24,
    paddingVertical: 40,
    textAlign: 'center',
    fontSize: 14,
    color: theme.colors.mutedForeground,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
}));
