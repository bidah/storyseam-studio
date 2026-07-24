import { create } from 'zustand';

// Payload shared by the two screens of the /image-model-picker nested-stack
// sheet (index = the 6 default models + a "More models" pill; more = the rest).
// The composer fills this before pushing the sheet; the pick still returns via
// the picker-bus requestId, so this holds display data only.
export type ModelOption = { value: string; label: string };

type State = {
  options: ModelOption[];
  selected: string;
  requestId: string | null;
  set: (p: { options: ModelOption[]; selected: string; requestId: string }) => void;
};

export const useImageModelPickerStore = create<State>((set) => ({
  options: [],
  selected: '',
  requestId: null,
  set: (p) => set(p),
}));

// Preferred image models, in the order they should appear in the default set.
// Matched loosely against the free-form Higgsfield label (the catalog ids
// churn). First match per pattern wins; the rest fill the 6 slots in catalog
// order, and everything left over goes behind "More models".
const PREFERRED = [
  /nano\s*banana\s*pro/i, // Nano Banana Pro (also the "(default)" row)
  /gpt[\s-]*image\s*2/i, // GPT Image 2
  /soul/i, // Higgsfield Soul 2.0
  /nano\s*banana\s*2/i, // Nano Banana 2
];

export const DEFAULT_MODEL_COUNT = 6;

export function splitImageModels(options: ModelOption[]): {
  top: ModelOption[];
  rest: ModelOption[];
} {
  const used = new Set<number>();
  const top: ModelOption[] = [];
  for (const re of PREFERRED) {
    const idx = options.findIndex((o, i) => !used.has(i) && re.test(o.label));
    if (idx >= 0) {
      used.add(idx);
      top.push(options[idx]);
    }
  }
  for (let i = 0; i < options.length && top.length < DEFAULT_MODEL_COUNT; i++) {
    if (!used.has(i)) {
      used.add(i);
      top.push(options[i]);
    }
  }
  const rest = options.filter((_, i) => !used.has(i));
  return { top, rest };
}
