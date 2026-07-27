import { putJson } from './api';
import type { GenSettings } from './gen-defaults';

// The project's image-generation PROMPTS — the style presets (the house look
// prepended to every generation) and the character/location/prop sheet prompts
// layered on top when a generation is tagged as a design sheet. Both live in the
// `visual-world` doc, so every write invalidates the `visualWorld` resource.
//
// Port of the web Settings page (src/routes/settings.jsx). Same routes, same
// semantics: `/prompts` REPLACES the preset library (so a delete is "PUT the
// list without it"), and `/sheet-prompts` merge-patches — sending an empty
// string resets that prompt to its server-side seed default.

export type StylePrompt = {
  id: string;
  name: string;
  image: string;
  video: string;
  builtin?: boolean;
};

export type SheetKind = 'character' | 'location' | 'prop';

export type PromptsDoc = {
  prompts?: StylePrompt[];
  sheetPrompts?: Partial<Record<SheetKind, string>>;
  settings?: GenSettings;
};

export const SHEET_META: Record<
  SheetKind,
  { label: string; title: string; footer: string; placeholder: string }
> = {
  character: {
    label: 'Character sheet',
    title: 'Character sheet prompt',
    footer:
      'Added on top of the style prompt when a generation is tagged as a character sheet — from ' +
      'the World composer, or when you ask the agent for one. Clear it to restore the default.',
    placeholder: 'Turnaround views, neutral background, consistent proportions…',
  },
  location: {
    label: 'Location sheet',
    title: 'Location sheet prompt',
    footer:
      'Added on top of the style prompt when a generation is tagged as a location sheet. Clear ' +
      'it to restore the default.',
    placeholder: 'Establishing wide view plus key-angle vignettes, no characters…',
  },
  prop: {
    label: 'Prop sheet',
    title: 'Prop sheet prompt',
    footer:
      'Added on top of the style prompt when a generation is tagged as a prop sheet — the objects ' +
      'characters carry and handle, as multi-view reference art the video models can lock onto. ' +
      'Clear it to restore the default.',
    placeholder: 'Front, three-quarter and side views of the same object, no hands, neutral backdrop…',
  },
};

export function isSheetKind(v: unknown): v is SheetKind {
  return v === 'character' || v === 'location' || v === 'prop';
}

// A blank preset. The id is client-side but PERMANENT once saved — the server
// preserves what it is sent (normalizePrompt only invents one when missing).
export function newStylePrompt(): StylePrompt {
  return {
    id: `prompt-${Date.now().toString(36)}`,
    name: 'New prompt',
    image: '',
    video: '',
    builtin: false,
  };
}

// Replaces the whole preset library (add / edit / delete all go through here).
export const saveStylePrompts = (prompts: StylePrompt[]) =>
  putJson<{ prompts: StylePrompt[] }>('/api/visual-world/prompts', { prompts });

// Merge-patch one or more sheet prompts; the response carries the normalized
// values, so an emptied prompt comes back as its seed default.
export const saveSheetPrompts = (patch: Partial<Record<SheetKind, string>>) =>
  putJson<{ sheetPrompts: Record<SheetKind, string> }>('/api/visual-world/sheet-prompts', patch);

// Merge-patch the generation defaults (model / aspect ratio).
export const saveGenDefaults = (patch: GenSettings) =>
  putJson<{ settings: GenSettings }>('/api/visual-world/settings', patch);

// The row subtitle in the presets list: the first line of the image block.
export function promptPreview(p: StylePrompt): string {
  const line = String(p.image || '').split('\n').find((l) => l.trim());
  return line ? line.trim() : '';
}
