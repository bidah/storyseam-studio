// Project-wide image-generation defaults — the model and aspect ratio the World
// composer AND the agent use whenever a generation doesn't override them. They
// live in the project's `visual-world` doc (`settings`), edited on the web at
// Settings › Generation defaults and here on the Settings sheet.
//
// `model: ""` means "the server default" (Nano Banana Pro) — the picker shows it
// as an explicit row using the DEFAULT_MODEL sentinel, because a native Picker
// tag must be a non-empty string, exactly like the web's Radix Select.

export const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;

export const DEFAULT_MODEL = '__default__';
export const DEFAULT_MODEL_LABEL = 'Nano Banana Pro (default)';

export type GenSettings = { model?: string; aspectRatio?: string };

export function toModelTag(model: string | undefined) {
  return model || DEFAULT_MODEL;
}

export function fromModelTag(tag: string) {
  return tag === DEFAULT_MODEL ? '' : tag;
}
