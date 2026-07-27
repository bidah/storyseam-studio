// Shared contract for the prompt EDITOR screens pushed inside the settings
// stack — the style preset editor (name + image + video) and the three sheet
// prompts (one long block each). Generic on purpose: a prompt editor is just a
// list of labelled text blocks plus an optional destructive action.
//
// The route owns the draft (an `onChange` per field) and the toolbar Save; these
// forms only render and report edits up, exactly like ProviderKeyForm.

export type PromptField = {
  key: string;
  // Section title on iOS / field label on the fallback.
  title: string;
  footer?: string;
  placeholder?: string;
  // The value the field mounts with. Captured ONCE — the editors render only
  // after the doc has loaded, so the mount already has the real text.
  initial: string;
  // Visible lines. 1 keeps a single-line field (the preset name); anything
  // higher grows vertically up to that many lines before scrolling.
  lines?: number;
};

export type PromptFormProps = {
  fields: PromptField[];
  onChange: (key: string, value: string) => void;
  // Rendered as its own destructive section at the bottom (delete a preset).
  destructive?: { label: string; onPress: () => void };
};
