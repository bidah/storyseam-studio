import { useQuery } from '@tanstack/react-query';
import { apiJson } from './api';
import { useProjectStore } from './project';

// The Director plugin's shapes (worker/src/routes/director.js, stage.js,
// shot-sheet.js) — only the fields the mobile surfaces read.

export type SeriesSummary = {
  id: string;
  title: string;
  status: 'draft' | 'published';
  aspectRatio: '9:16' | '16:9';
  resolution: string;
  beats: number;
  pins: number;
  sheets: number;
  hasTargetAudio: boolean;
  updatedAt?: string;
};

export type DirectorIndex = { series: SeriesSummary[]; missing?: string[]; selectedId: string | null };

export type Beat = {
  offset: number;
  prompt: string | Record<string, unknown>;
  endImageUrl?: string | null;
};

export type ModelSheet = { kind: 'character' | 'location' | 'style'; name: string; prompt?: string; imageUrl?: string | null };

export type Series = {
  id: string;
  title: string;
  prompt: string;
  imageUrl?: string | null;
  audioUrl?: string | null;
  resolution: string;
  aspectRatio: string;
  status: 'draft' | 'published';
  directions: Beat[];
  modelSheets: ModelSheet[];
};

export type SeriesView = {
  series: Series;
  // `reels` is the planned reel list on the wire (not a count) — count it.
  screening?: { reels?: unknown[] | number; filmSeconds?: number };
  reels?: { reel: number; beats: number; pins: number; seconds: number }[];
  issues?: Record<string, string>;
};

export type Sitting = {
  id: string;
  seriesId: string;
  title?: string;
  seconds?: number;
  recordedAt?: string | number;
  url: string;
  scoredUrl?: string | null;
};

export type SheetSlot = { offset: number; kind: 'opening' | 'pin'; from?: string; brief?: string; filled?: boolean; refused?: string | boolean };
export type Take = {
  id: string;
  seriesId: string;
  runId?: string;
  part?: number;
  parts?: number;
  opensAt?: number;
  status: 'running' | 'done' | 'error';
  startedAt?: string | number;
  error?: string | null;
  url?: string | null;
};
export type ShotSheetView = { seriesId: string; title: string; slots: SheetSlot[]; takes: Take[] };

/** A beat's prompt as text — it may be a plain string or a sections object. */
export function beatText(prompt: Beat['prompt']): string {
  if (typeof prompt === 'string') return prompt;
  if (!prompt || typeof prompt !== 'object') return '';
  return Object.values(prompt)
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' · ');
}

export const mmss = (s?: number | null) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

export function useSeries(id: string | undefined) {
  const projectId = useProjectStore((s) => s.projectId);
  return useQuery<SeriesView>({
    queryKey: [projectId, 'director', id],
    queryFn: () => apiJson<SeriesView>(`/api/director/series/${encodeURIComponent(id as string)}`),
    enabled: !!projectId && !!id,
  });
}

export function useShotSheet(seriesId: string | null | undefined) {
  const projectId = useProjectStore((s) => s.projectId);
  return useQuery<ShotSheetView>({
    queryKey: [projectId, 'shotsheet', seriesId],
    queryFn: () => apiJson<ShotSheetView>(`/api/shotsheet/${encodeURIComponent(seriesId as string)}`),
    enabled: !!projectId && !!seriesId,
  });
}
