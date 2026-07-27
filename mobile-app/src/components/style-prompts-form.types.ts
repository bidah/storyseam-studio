// Shared contract for the settings/style-prompts LIST screen — the project's
// reusable style presets (the house look prepended to every generation). One row
// per preset; tapping pushes the editor (settings/style-prompt), swiping deletes.
// The route owns the doc and every write.

export type StylePresetRow = {
  id: string;
  name: string;
  // First line of the image block, as the row's secondary text.
  preview: string;
  // Seeded by the server rather than authored here — labelled, not protected.
  builtin: boolean;
};

export type StylePromptsFormProps = {
  presets: StylePresetRow[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  // True while a save is in flight — disables the destructive/add actions.
  busy?: boolean;
};

export const STYLE_PROMPTS_FOOTNOTE =
  'The reusable style presets of the visual world generator. The image block is prepended to ' +
  'every scene as the house style; the video block is kept for later Seedance renders. Swipe a ' +
  'preset to delete it.';
