import { useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  CircleCheck,
  GitBranch,
  GitPullRequestArrow,
  ListChecks,
  Lock,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { deleteJson, patchJson, postJson, putJson } from '@/lib/api';
import { CLIENT_ID } from '@/lib/client-id';
import { agentIsBusy, useAgent } from '@/lib/agent/provider';
import { generateShotListMessage } from '@/lib/agent/messages';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { EditableField } from './field';
import { ScreenplayView, docLines, type PMNode } from './screenplay';
import { ScriptProposalReview } from './script-review';

// Script sub-surface — native, read-only screenplay renderer of the pinned
// draft (body edits stay agent-driven via proposals; see the web ScriptEditor
// for the TipTap editing surface). Title edits, drafts (version control),
// sign/unsign, and shot-list generation mirror the web toolbar 1:1.

const MUTED = '#a1a1aa';
const PRIMARY = '#10b981';

type DraftMeta = { id: string; name: string; lineCount?: number; updatedAt?: string };
type ScriptData = {
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

// "2m ago" / "just now" — compact relative time for the drafts list.
function relTime(iso?: string) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ------------------------------------------------------------------ *
 * Drafts sheet — create / pin / rename / delete (the pinned draft is  *
 * the active one both this screen and the agent read/write).          *
 * ------------------------------------------------------------------ */

function DraftsModal({
  visible,
  onClose,
  drafts,
  pinnedId,
}: {
  visible: boolean;
  onClose: () => void;
  drafts: DraftMeta[];
  pinnedId: string;
}) {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      invalidate('script');
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Draft operation failed'));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      await postJson('/api/script/drafts', {
        name: name.trim() || undefined,
        clientId: CLIENT_ID,
      });
      setName('');
      onClose(); // the new draft is now pinned
    });
  const pin = (id: string) => {
    if (id === pinnedId) return;
    run(() => postJson('/api/script/pin', { id, clientId: CLIENT_ID }));
  };
  const rename = (id: string) =>
    run(async () => {
      const v = renameValue.trim();
      if (v) await patchJson(`/api/script/drafts/${id}`, { name: v, clientId: CLIENT_ID });
      setRenaming(null);
    });
  const remove = (id: string) => run(() => deleteJson(`/api/script/drafts/${id}`));

  const sorted = [...drafts].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-background px-4 pt-5">
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <GitBranch size={16} color={PRIMARY} />
            <Text className="text-lg font-semibold text-foreground">Drafts</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close drafts"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            onPress={onClose}
          >
            <X size={18} color={MUTED} />
          </Pressable>
        </View>
        <Text className="mb-3 text-[12px] text-muted-foreground">
          The pinned draft is the active version — both this app and the chat agent read and write
          only the pinned draft. Creating a draft clones the current pinned one, then pins it.
        </Text>

        <View className="mb-4 flex-row gap-2">
          <Input
            className="flex-1"
            value={name}
            onChangeText={setName}
            placeholder={`Draft ${drafts.length + 1}`}
            onSubmitEditing={() => !busy && create()}
          />
          <Button title="Create" disabled={busy} onPress={create}>
            <Plus size={15} color="white" />
          </Button>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="pb-8">
          {sorted.map((d) => {
            const isPinned = d.id === pinnedId;
            return (
              <View
                key={d.id}
                className={cn(
                  'mb-2 rounded-xl border p-3',
                  isPinned ? 'border-primary/50 bg-primary/5' : 'border-border bg-card',
                )}
              >
                <View className="flex-row items-center gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isPinned ? `${d.name} is pinned` : `Pin ${d.name}`}
                    disabled={busy || isPinned}
                    className="flex-1 flex-row items-center gap-2 active:opacity-60"
                    onPress={() => pin(d.id)}
                  >
                    <Pin size={14} color={isPinned ? PRIMARY : MUTED} fill={isPinned ? PRIMARY : 'none'} />
                    <View className="min-w-0 flex-1">
                      {renaming === d.id ? (
                        <TextInput
                          autoFocus
                          value={renameValue}
                          onChangeText={setRenameValue}
                          onBlur={() => rename(d.id)}
                          onSubmitEditing={() => rename(d.id)}
                          className="rounded-lg border border-primary bg-card px-2 py-1 text-[14px] text-foreground"
                          placeholderTextColor="#71717a"
                        />
                      ) : (
                        <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
                          {d.name}
                        </Text>
                      )}
                      <Text className="mt-0.5 text-[11px] text-muted-foreground">
                        {d.lineCount != null ? `${d.lineCount} lines · ` : ''}
                        {relTime(d.updatedAt)}
                        {isPinned ? ' · pinned' : ''}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${d.name}`}
                    disabled={busy}
                    className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
                    onPress={() => {
                      setRenaming(d.id);
                      setRenameValue(d.name);
                    }}
                  >
                    <Pencil size={14} color={MUTED} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${d.name}`}
                    disabled={busy || drafts.length <= 1}
                    className={cn(
                      'h-8 w-8 items-center justify-center rounded-full active:opacity-60',
                      drafts.length <= 1 && 'opacity-30',
                    )}
                    onPress={() => remove(d.id)}
                  >
                    <Trash2 size={14} color="#f87171" />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

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
            <CircleCheck size={16} color={PRIMARY} />
            <Text className="text-lg font-semibold text-foreground">Sign & close script</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel signing"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            onPress={onClose}
          >
            <X size={18} color={MUTED} />
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
          {!busy ? <CircleCheck size={15} color="white" /> : null}
        </Button>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Surface                                                             *
 * ------------------------------------------------------------------ */

export function ScriptSurface() {
  const { data, isPending, error, refetch, isRefetching } = useProjectResource<ScriptData>('script');
  const invalidate = useInvalidate();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

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
    agent.send({ message: generateShotListMessage() }).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast('Sent to agent — watch the Chat tab');
  };

  const hasBody = docLines(script.doc).some((l) => l.text.trim());
  const genDisabled = agentBusy || script.shotlistExists;

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-28 pt-3"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={MUTED} />}
      >
        {/* Toolbar */}
        <View className="mb-3 flex-row flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" title={script.draftName || 'Draft'} onPress={() => setDraftsOpen(true)}>
            <GitBranch size={13} color="#fafafa" />
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
                <CircleCheck size={11} color={PRIMARY} />
              </Badge>
            </Pressable>
          ) : (
            <Button size="sm" variant="outline" title="Sign script" onPress={() => setSignOpen(true)}>
              <CircleCheck size={13} color="#fafafa" />
            </Button>
          )}
          {script.signed ? (
            <Button size="sm" title="Generate shot list" disabled={genDisabled} onPress={generate}>
              {script.shotlistExists ? (
                <Lock size={13} color="white" />
              ) : (
                <ListChecks size={13} color="white" />
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
            <GitPullRequestArrow size={16} color="#f59e0b" />
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

        {/* Screenplay body (read-only — edits are agent-driven via proposals) */}
        {hasBody ? (
          <Card className="px-4 py-5">
            <ScreenplayView doc={script.doc} />
          </Card>
        ) : (
          <Empty
            title="No script yet"
            hint="Ask the agent in Chat to write the screenplay — its edits arrive here as reviewable proposals."
          />
        )}
      </ScrollView>

      <DraftsModal
        visible={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        drafts={script.drafts || []}
        pinnedId={script.pinnedId}
      />
      <SignModal
        visible={signOpen}
        onClose={() => setSignOpen(false)}
        onSigned={(by) => toggleSign(true, by)}
      />
    </View>
  );
}
