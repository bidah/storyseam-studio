import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { History, Music, Play, RefreshCw, Share2, TriangleAlert } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { CutPlayer } from '@/components/cuts/cut-player';
import { fmtTime, segDuration, type CutGen, type CutsPayload } from '@/components/cuts/types';
import { agentIsBusy, useAgent } from '@/lib/agent/provider';
import { scoreCutMessage, stitchCutMessage } from '@/lib/agent/messages';
import { mediaUrl } from '@/lib/api';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { cn } from '@/lib/utils';

// Cuts tab — the complete-cut surface. The latest generation plays in an
// expo-video card with a seekable segment strip; stitching / scoring runs
// THROUGH the agent chat (stitch_cuts / score_cut), like every other
// mutation; history lists every immutable version for A/B + share.

// Share the ORIGINAL full-res mp4 (playback uses the 720p proxy): download it
// to the cache via expo-file-system, then hand the local file to the share
// sheet.
async function downloadAndShare(gen: CutGen) {
  const url = mediaUrl(gen.url);
  if (!url) throw new Error('No file to share');
  const dest = new File(Paths.cache, `complete-cut-v${gen.v}.mp4`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest);
  await Sharing.shareAsync(file.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
}

export default function CutsScreen() {
  const { data, isLoading, error, refetch } = useProjectResource<CutsPayload>('cuts');
  const invalidate = useInvalidate();
  const agent = useAgent();
  const busy = agentIsBusy(agent);

  const [refreshing, setRefreshing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [playingV, setPlayingV] = useState<number | null>(null); // null = follow latest
  const [autoPlay, setAutoPlay] = useState(false);
  const [sharingV, setSharingV] = useState<number | null>(null);

  // Re-read the cut when the agent finishes a turn (it may have just run
  // stitch_cuts / score_cut) — fire only on the transition INTO "ready",
  // parity with the web tab.
  const status = agent?.status;
  const prevStatus = useRef(status);
  useEffect(() => {
    const enteredReady = status === 'ready' && prevStatus.current !== 'ready';
    prevStatus.current = status;
    if (enteredReady) invalidate('cuts');
  }, [status, invalidate]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const sendToAgent = useCallback(
    async (message: string) => {
      try {
        const turn = agent.send({ message });
        toast('Sent to agent — watch the Chat tab');
        await turn;
      } catch (e: any) {
        toast.error(String(e?.message || e));
      }
    },
    [agent],
  );

  const segs = data?.segments ?? [];
  const usable = segs.filter((s) => s.file);
  const missing = segs.filter((s) => s.missing);
  const fallbacks = usable.filter((s) => s.fallback);
  const total = usable.reduce((a, s) => a + segDuration(s), 0);
  const music = data?.music ?? [];
  const history = data?.history ?? [];
  const output = data?.output ?? null;
  const hasScored = history.some((g) => g.kind === 'scored');

  const activeGen =
    (playingV != null ? history.find((g) => g.v === playingV) : undefined) ?? output;

  const stitch = () => sendToAgent(stitchCutMessage(data?.range, usable.length || undefined));
  const score = () => sendToAgent(scoreCutMessage(data?.range));

  const share = async (gen: CutGen) => {
    if (sharingV != null) return;
    setSharingV(gen.v);
    try {
      await downloadAndShare(gen);
    } catch (e: any) {
      toast.error(String(e?.message || 'Share failed'));
    } finally {
      setSharingV(null);
    }
  };

  let body: React.ReactNode;
  if (isLoading && !data) {
    body = <Loading />;
  } else if (error && !data) {
    body = (
      <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />
    );
  } else {
    body = (
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#a1a1aa" />
        }
      >
        {/* Range summary + stitch-plan health */}
        <View className="flex-row flex-wrap items-center gap-2">
          {data?.range?.from ? (
            <Text className="text-sm font-semibold text-foreground">
              {data.range.from} → {data.range.to}
            </Text>
          ) : null}
          <Badge variant="outline" label={`${usable.length} scenes`} />
          <Badge variant="success" label={`~${fmtTime(total)}`} />
          {fallbacks.length > 0 ? (
            <Badge variant="warning" label={`${fallbacks.length} fallback`}>
              <TriangleAlert size={11} color="#fbbf24" />
            </Badge>
          ) : null}
          {missing.length > 0 ? (
            <Badge
              variant="warning"
              label={`${missing.length} missing take${missing.length === 1 ? '' : 's'}`}
            >
              <TriangleAlert size={11} color="#fbbf24" />
            </Badge>
          ) : null}
        </View>

        {/* Latest (or user-picked) generation */}
        {activeGen ? (
          <Card className="gap-3 p-3">
            <View className="flex-row flex-wrap items-center gap-2">
              {activeGen.kind === 'scored' ? (
                <Music size={15} color="#10b981" />
              ) : (
                <Play size={15} color="#10b981" />
              )}
              <Text className="text-sm font-semibold text-foreground">v{activeGen.v}</Text>
              <Badge
                variant={activeGen.kind === 'scored' ? 'success' : 'muted'}
                label={activeGen.kind === 'scored' ? 'scored' : 'base'}
              />
              {output && activeGen.v === output.v ? (
                <Badge variant="info" label="latest" />
              ) : (
                <Badge variant="warning" label="older version" />
              )}
              <View className="ml-auto">
                <Button
                  size="icon"
                  variant="ghost"
                  accessibilityLabel={`Share cut v${activeGen.v}`}
                  loading={sharingV === activeGen.v}
                  onPress={() => share(activeGen)}
                >
                  {sharingV === activeGen.v ? null : <Share2 size={18} color="#fafafa" />}
                </Button>
              </View>
            </View>

            <CutPlayer gen={activeGen} autoPlay={autoPlay} />

            <Text className="text-xs text-muted-foreground">
              {fmtTime(activeGen.totalDuration)} total
              {activeGen.kind === 'scored'
                ? ` · ${activeGen.music?.length || 0} cues ~${Math.abs(activeGen.gainDb ?? -22)} dB bed`
                : ''}
              {activeGen.at ? ` · ${new Date(activeGen.at).toLocaleString()}` : ''}
            </Text>
          </Card>
        ) : (
          <View className="rounded-2xl border border-dashed border-border">
            <Empty title="No cut yet" hint="Select takes on Episode, then stitch." />
          </View>
        )}

        {/* Agent actions */}
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            title={output ? 'Re-stitch cut' : 'Stitch cut'}
            disabled={busy || usable.length === 0}
            onPress={stitch}
          >
            <RefreshCw size={15} color="#ecfdf5" />
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            title={hasScored ? 'Re-score music' : 'Add music'}
            disabled={busy || !output || music.length === 0}
            onPress={score}
          >
            <Music size={15} color="#fafafa" />
          </Button>
        </View>
        {busy ? (
          <Text className="text-xs text-muted-foreground">
            Agent is busy — wait for the current turn to finish (watch the Chat tab).
          </Text>
        ) : null}
        {output && output.kind !== 'scored' && music.length > 0 ? (
          <View className="flex-row items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5">
            <Music size={13} color="#38bdf8" />
            <Text className="flex-1 text-xs text-muted-foreground">
              {music.length} background-music cue{music.length === 1 ? '' : 's'} ready — Add music
              renders a scored version (it becomes the new latest).
            </Text>
          </View>
        ) : null}

        {/* Version history */}
        {history.length > 0 ? (
          <View className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              title={showVersions ? 'Hide versions' : `Versions (${history.length})`}
              onPress={() => setShowVersions((v) => !v)}
            >
              <History size={14} color="#a1a1aa" />
            </Button>
            {showVersions ? (
              <Card className="gap-0 p-1">
                <View className="px-3 pt-2">
                  <Eyebrow>Complete-cut history</Eyebrow>
                </View>
                {history.map((g, i) => {
                  const isActive = activeGen?.v === g.v;
                  return (
                    <Fragment key={g.v}>
                      {i > 0 ? <View className="h-px bg-border/60" /> : null}
                      <View
                        className={cn(
                          'flex-row items-center gap-3 rounded-xl px-3 py-3',
                          isActive && 'bg-secondary',
                        )}
                      >
                        {g.kind === 'scored' ? (
                          <Music size={14} color="#10b981" />
                        ) : (
                          <Play size={14} color="#a1a1aa" />
                        )}
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-foreground">
                            v{g.v} · {g.kind === 'scored' ? 'scored' : 'base'}
                            {i === 0 ? ' · latest' : ''}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {fmtTime(g.totalDuration)}
                            {g.at ? ` · ${new Date(g.at).toLocaleString()}` : ''}
                          </Text>
                        </View>
                        <Button
                          size="icon"
                          variant="ghost"
                          accessibilityLabel={`Play v${g.v}`}
                          onPress={() => {
                            setPlayingV(g.v);
                            setAutoPlay(true);
                          }}
                        >
                          <Play size={16} color={isActive ? '#10b981' : '#fafafa'} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          accessibilityLabel={`Share v${g.v}`}
                          loading={sharingV === g.v}
                          onPress={() => share(g)}
                        >
                          {sharingV === g.v ? null : <Share2 size={16} color="#fafafa" />}
                        </Button>
                      </View>
                    </Fragment>
                  );
                })}
              </Card>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return <View className="flex-1 bg-background">{body}</View>;
}
