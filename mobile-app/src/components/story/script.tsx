import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  CircleCheck,
  GitBranch,
  GitPullRequestArrow,
  ListChecks,
  Lock,
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
import { cn } from '@/lib/utils';
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
      <View className="flex-1 bg-background px-4 pt-5">
        <View className="mb-2 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <CircleCheck size={16} color={colors.primary} />
            <Text className="text-lg font-semibold text-foreground">Sign & close script</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel signing"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            onPress={onClose}
          >
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <Text className="mb-4 text-[13px] leading-5 text-muted-foreground">
          Signing locks this draft as the closed screenplay and unlocks shot-list generation.
          Editing the script afterward unsigns it and requires re-signing.
        </Text>
        <Text className="mb-1.5 text-[12px] font-semibold text-foreground/80">Signed by</Text>
        <Input value={by} onChangeText={setBy} placeholder="your name" autoFocus />
        <Button
          className="mt-4"
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
      <View className="flex-1 bg-background px-4 pt-5">
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Wand2 size={16} color={colors.primary} />
            <Text className="text-lg font-semibold text-foreground">Change passage</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel change"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            onPress={onClose}
          >
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View className="mb-3">
          <SegmentedNative options={EDIT_MODES} value={mode} onChange={setMode} />
        </View>

        {mode === 'edit' ? (
          <>
            <Text className="mb-2 text-[13px] leading-5 text-muted-foreground">
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
              className="min-h-32 rounded-xl border border-primary bg-card px-3 py-2.5 text-[15px] leading-6 text-foreground"
              textAlignVertical="top"
            />
          </>
        ) : (
          <>
            <Text className="mb-2 text-[13px] leading-5 text-muted-foreground">
              Ask the agent to change this {label}. Describe what you want — it proposes the edit as
              a reviewable diff.
            </Text>
            {/* The passage being changed, shown fixed for reference. */}
            <View className="mb-3 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
              <Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {SP_LABELS[line?.type ?? ''] || 'Passage'}
              </Text>
              <Text className="text-[14px] leading-5 text-foreground">{original}</Text>
            </View>
            <TextInput
              autoFocus
              multiline
              value={instruction}
              onChangeText={setInstruction}
              placeholder="Describe the change… (e.g. make this line angrier, tighten it, fix the slug)"
              placeholderTextColor={colors.subtleForeground}
              className="min-h-24 rounded-xl border border-primary bg-card px-3 py-2.5 text-[15px] leading-6 text-foreground"
              textAlignVertical="top"
            />
          </>
        )}

        <Button
          className="mt-4"
          title={mode === 'edit' ? 'Send rewrite' : 'Ask agent'}
          disabled={!canSend || busy}
          loading={busy}
          onPress={submit}
        >
          {!busy ? <Wand2 size={15} color={colors.primaryForeground} /> : null}
        </Button>
        <Text className="mt-2 text-center text-[11px] text-muted-foreground">
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
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
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
    <View className="flex-1">
      <ScrollView
        {...barInset}
        className="flex-1"
        contentContainerClassName="px-4 pb-28 pt-3"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
      >
        {/* Toolbar */}
        <View className="mb-3 flex-row flex-wrap items-center gap-2">
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
              className="active:opacity-60"
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
            className="mb-3 flex-row items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 active:opacity-70"
            onPress={() => setReviewOpen(true)}
          >
            <GitPullRequestArrow size={16} color={colors.amber} />
            <View className="flex-1">
              <Text className="text-[14px] font-semibold text-warning">Agent proposed changes</Text>
              <Text className="text-[12px] text-muted-foreground">Tap to review and accept or reject.</Text>
            </View>
          </Pressable>
        ) : null}

        {/* Title */}
        <EditableField
          value={script.title}
          placeholder="Untitled script"
          multiline={false}
          onCommit={commitTitle}
          className="mb-2"
        />

        {/* Screenplay body — tap any block to rewrite it; the change is routed
            to the agent and lands back here as a reviewable proposal. */}
        {hasBody ? (
          <Card className="px-4 py-5">
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
