import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  CircleCheck,
  GitBranch,
  GitPullRequestArrow,
  ListChecks,
  Lock,
  Share2,
  Wand2,
  X,
} from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { postJson, putJson } from '@/lib/api';
import { CLIENT_ID } from '@/lib/client-id';
import { agentIsBusy, useAgent, useSendToAgent } from '@/lib/agent/provider';
import { generateShotListMessage, scriptEditRequest, scriptRewriteRequest } from '@/lib/agent/messages';
import { useColors } from '@/lib/colors';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import { EditableField } from './field';
import { ScreenplayView, SP_LABELS, docLines, type PMNode, type ScriptLine } from './screenplay';
import { ScriptProposalReview } from './script-review';

// Script sub-surface — native, read-only screenplay renderer of the pinned
// draft (body edits stay agent-driven via proposals; see the web ScriptEditor
// for the TipTap editing surface). Title edits, drafts (version control),
// sign/unsign, and shot-list generation mirror the web toolbar 1:1.

export type DraftMeta = { id: string; name: string; lineCount?: number; updatedAt?: string };
export type ScriptData = {
  title: string;
  doc: PMNode | null;
  updatedAt: string | null;
  clientId?: string | null;
  draftId: string;
  draftName: string;
  pinnedId: string;
  drafts: DraftMeta[];
  proposal: any | null;
  signed: boolean;
  signedAt: string | null;
  shotlistExists: boolean;
};

/* ------------------------------------------------------------------ *
 * Sign sheet — name + acknowledgement, then POST /api/script/sign     *
 * ------------------------------------------------------------------ */

function SignModal({
  visible,
  onClose,
  onSigned,
}: {
  visible: boolean;
  onClose: () => void;
  onSigned: (by: string) => Promise<boolean>;
}) {
  const colors = useColors();
  const [by, setBy] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = by.trim();
    if (!name) return;
    setBusy(true);
    const ok = await onSigned(name);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderLeft}>
            <CircleCheck size={16} color={colors.primary} />
            <Text style={styles.sheetTitle}>Sign & close script</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel signing"
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed60]}
            onPress={onClose}
          >
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <Text style={styles.sheetBody}>
          Signing locks this draft as the closed screenplay and unlocks shot-list generation.
          Editing the script afterward unsigns it and requires re-signing.
        </Text>
        <Text style={styles.signedByLabel}>Signed by</Text>
        <Input value={by} onChangeText={setBy} placeholder="your name" autoFocus />
        <Button
          style={styles.mt4}
          title="Sign & close script"
          disabled={!by.trim() || busy}
          loading={busy}
          onPress={submit}
        >
          {!busy ? <CircleCheck size={15} color={colors.primaryForeground} /> : null}
        </Button>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Edit-passage sheet — tap a screenplay block → edit its text here →  *
 * the rewrite is routed to the chat agent as a reviewable proposal    *
 * (the mobile take on the web Script tab's "Ask agent" selection box). *
 * ------------------------------------------------------------------ */

type EditMode = 'edit' | 'ask';

const EDIT_MODES: { value: EditMode; label: string }[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'ask', label: 'Ask agent' },
];

function EditPassageModal({
  line,
  busy,
  onClose,
  onSend,
}: {
  line: ScriptLine | null;
  busy: boolean;
  onClose: () => void;
  onSend: (message: string) => void;
}) {
  const colors = useColors();
  const [mode, setMode] = useState<EditMode>('edit');
  const [draft, setDraft] = useState(''); // Edit tab: the rewritten passage text
  const [instruction, setInstruction] = useState(''); // Ask tab: the change to request

  // Fresh block tapped → reset both drafts and land on the Edit tab.
  useEffect(() => {
    setDraft(line?.text ?? '');
    setInstruction('');
    setMode('edit');
  }, [line]);

  const original = line?.text ?? '';
  const label = line ? (SP_LABELS[line.type] || 'line').toLowerCase() : 'line';
  const rewritten = draft.trim();
  const canEdit = rewritten.length > 0 && rewritten !== original.trim();
  const canAsk = instruction.trim().length > 0;
  const canSend = mode === 'edit' ? canEdit : canAsk;

  const submit = () => {
    if (!canSend || busy) return;
    onSend(
      mode === 'edit'
        ? scriptRewriteRequest(original, rewritten)
        : scriptEditRequest(original, instruction.trim()),
    );
  };

  return (
    <Modal
      visible={!!line}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.editHeader}>
          <View style={styles.sheetHeaderLeft}>
            <Wand2 size={16} color={colors.primary} />
            <Text style={styles.sheetTitle}>Change passage</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel change"
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed60]}
            onPress={onClose}
          >
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={styles.mb3}>
          <SegmentedNative options={EDIT_MODES} value={mode} onChange={setMode} />
        </View>

        {mode === 'edit' ? (
          <>
            <Text style={styles.editIntro}>
              Rewrite this {label} directly. The agent applies your exact text as a reviewable
              proposal — nothing changes until you accept it.
            </Text>
            <TextInput
              autoFocus
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder="Rewrite this passage…"
              placeholderTextColor={colors.subtleForeground}
              style={styles.editInput}
              textAlignVertical="top"
            />
          </>
        ) : (
          <>
            <Text style={styles.editIntro}>
              Ask the agent to change this {label}. Describe what you want — it proposes the edit as
              a reviewable diff.
            </Text>
            {/* The passage being changed, shown fixed for reference. */}
            <View style={styles.originalBox}>
              <Text style={styles.originalLabel}>
                {SP_LABELS[line?.type ?? ''] || 'Passage'}
              </Text>
              <Text style={styles.originalText}>{original}</Text>
            </View>
            <TextInput
              autoFocus
              multiline
              value={instruction}
              onChangeText={setInstruction}
              placeholder="Describe the change… (e.g. make this line angrier, tighten it, fix the slug)"
              placeholderTextColor={colors.subtleForeground}
              style={styles.askInput}
              textAlignVertical="top"
            />
          </>
        )}

        <Button
          style={styles.mt4}
          title={mode === 'edit' ? 'Send rewrite' : 'Ask agent'}
          disabled={!canSend || busy}
          loading={busy}
          onPress={submit}
        >
          {!busy ? <Wand2 size={15} color={colors.primaryForeground} /> : null}
        </Button>
        <Text style={styles.editFootnote}>
          {busy
            ? 'Agent is busy — finish the current turn first.'
            : 'Opens the Chat tab to watch it apply.'}
        </Text>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Surface                                                             *
 * ------------------------------------------------------------------ */

export function ScriptSurface() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const { data, isPending, error, refetch } = useProjectResource<ScriptData>('script');
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const invalidate = useInvalidate();
  // Selected: this screen only asks whether a turn is running, so it must not
  // re-render on every streamed batch (see useAgent in lib/agent/provider).
  const agentBusy = useAgent(agentIsBusy);
  const sendToAgent = useSendToAgent();
  const [signOpen, setSignOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editLine, setEditLine] = useState<ScriptLine | null>(null);

  if (isPending) return <Loading />;
  if (error) return <ErrorNote message={String((error as any)?.message || error)} onRetry={refetch} />;

  const script = data as ScriptData;

  // A pending proposal, opened for review, takes over the whole sub-surface.
  if (reviewOpen && script.proposal) {
    return (
      <ScriptProposalReview
        proposal={script.proposal}
        baseTitle={script.title || ''}
        onClose={() => setReviewOpen(false)}
      />
    );
  }

  // Commit the title. The worker's PUT /api/script replaces the pinned draft's
  // {title, doc} wholesale, so the current doc rides along unchanged.
  const commitTitle = async (v: string) => {
    try {
      await putJson('/api/script', { title: v, doc: script.doc ?? null, clientId: CLIENT_ID });
      invalidate('script');
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Save failed'));
    }
  };

  const toggleSign = async (next: boolean, by: string | null): Promise<boolean> => {
    try {
      await postJson('/api/script/sign', { signed: next, by });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      invalidate('script');
      return true;
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Sign failed'));
      return false;
    }
  };

  const generate = () => {
    sendToAgent(generateShotListMessage()).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast('Sent to agent — watch the Chat tab');
  };

  // Share a public read-only link to the script. POST mints the link once and
  // returns the same one thereafter (revocable from the web Share dialog); the
  // page it opens is the worker-served SPA's /share/script/<token> view.
  const shareScript = async () => {
    try {
      const res = (await postJson('/api/script/share', {})) as { url?: string };
      if (!res?.url) throw new Error('No share link returned');
      await Share.share(Platform.OS === 'ios' ? { url: res.url } : { message: res.url });
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Share failed'));
    }
  };

  // Tapped a screenplay block and either rewrote it or asked for a change → route
  // the request (built by the sheet) to the agent as a reviewable proposal, then
  // jump to the Chat tab to watch it stream.
  const sendEdit = (message: string) => {
    sendToAgent(message).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setEditLine(null);
    toast('Sent to agent — review the proposal here when it lands');
  };

  const hasBody = docLines(script.doc).some((l) => l.text.trim());
  const genDisabled = agentBusy || script.shotlistExists;

  return (
    <View style={styles.flex1}>
      <ScrollView
        {...barInset}
        style={styles.flex1}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
      >
        {/* Toolbar */}
        <View style={styles.toolbar}>
          <Button
            size="sm"
            variant="outline"
            title={script.draftName || 'Draft'}
            onPress={() => router.push('/(tabs)/story/drafts')}
          >
            <GitBranch size={13} color={colors.foreground} />
          </Button>
          {script.signed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Unsign the script"
              style={({ pressed }) => [pressed && styles.pressed60]}
              onPress={() => toggleSign(false, null)}
            >
              <Badge
                variant="success"
                label={`Signed${script.signedAt ? ` ${new Date(script.signedAt).toLocaleDateString()}` : ''}`}
              >
                <CircleCheck size={11} color={colors.primary} />
              </Badge>
            </Pressable>
          ) : (
            <Button size="sm" variant="outline" title="Sign script" onPress={() => setSignOpen(true)}>
              <CircleCheck size={13} color={colors.foreground} />
            </Button>
          )}
          <Button size="sm" variant="outline" title="Share" onPress={shareScript}>
            <Share2 size={13} color={colors.foreground} />
          </Button>
          {script.signed ? (
            <Button size="sm" title="Generate shot list" disabled={genDisabled} onPress={generate}>
              {script.shotlistExists ? (
                <Lock size={13} color={colors.primaryForeground} />
              ) : (
                <ListChecks size={13} color={colors.primaryForeground} />
              )}
            </Button>
          ) : null}
        </View>

        {/* Pending proposal banner */}
        {script.proposal ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review the agent's proposed script changes"
            style={({ pressed }) => [styles.proposalBanner, pressed && styles.pressed70]}
            onPress={() => setReviewOpen(true)}
          >
            <GitPullRequestArrow size={16} color={colors.amber} />
            <View style={styles.flex1}>
              <Text style={styles.proposalTitle}>Agent proposed changes</Text>
              <Text style={styles.proposalHint}>Tap to review and accept or reject.</Text>
            </View>
          </Pressable>
        ) : null}

        {/* Title */}
        <EditableField
          value={script.title}
          placeholder="Untitled script"
          multiline={false}
          onCommit={commitTitle}
          style={styles.mb2}
        />

        {/* Screenplay body — tap any block to rewrite it; the change is routed
            to the agent and lands back here as a reviewable proposal. */}
        {hasBody ? (
          <Card style={styles.screenplayCard}>
            <ScreenplayView doc={script.doc} onEditLine={(line) => setEditLine(line)} />
          </Card>
        ) : (
          <Empty
            title="No script yet"
            hint="Ask the agent in Chat to write the screenplay — its edits arrive here as reviewable proposals."
          />
        )}
      </ScrollView>

      <SignModal
        visible={signOpen}
        onClose={() => setSignOpen(false)}
        onSigned={(by) => toggleSign(true, by)}
      />
      <EditPassageModal
        line={editLine}
        busy={agentBusy}
        onClose={() => setEditLine(null)}
        onSend={sendEdit}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex1: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 112,
    paddingTop: 12,
  },
  sheet: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  sheetHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.foreground,
  },
  closeBtn: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  pressed60: {
    opacity: 0.6,
  },
  pressed70: {
    opacity: 0.7,
  },
  sheetBody: {
    marginBottom: 16,
    fontSize: 13,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  signedByLabel: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '600',
    color: `${theme.colors.foreground}CC`,
  },
  mt4: {
    marginTop: 16,
  },
  mb2: {
    marginBottom: 8,
  },
  mb3: {
    marginBottom: 12,
  },
  editIntro: {
    marginBottom: 8,
    fontSize: 13,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  editInput: {
    minHeight: 128,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 24,
    color: theme.colors.foreground,
  },
  askInput: {
    minHeight: 96,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 24,
    color: theme.colors.foreground,
  },
  originalBox: {
    marginBottom: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: `${theme.colors.secondary}66`,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  originalLabel: {
    marginBottom: 4,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.mutedForeground,
  },
  originalText: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  editFootnote: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 11,
    color: theme.colors.mutedForeground,
  },
  toolbar: {
    marginBottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  proposalBanner: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: `${theme.colors.warning}66`,
    backgroundColor: `${theme.colors.warning}1A`,
    padding: 12,
  },
  proposalTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.warning,
  },
  proposalHint: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  screenplayCard: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
}));
