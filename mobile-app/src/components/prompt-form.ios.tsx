import { Host } from '@expo/ui';
import { Button, Form, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import { background, lineLimit, scrollContentBackground } from '@expo/ui/swift-ui/modifiers';
import { useColors } from '@/lib/colors';
import type { PromptField, PromptFormProps } from './prompt-form.types';

// One field per Section. `useNativeState(initial)` is what seeds the field with
// the stored prompt — a bare TextField starts empty — and it captures its
// initial value on first render, which is why the routes mount these editors
// only once the visual-world doc has loaded. Multi-line blocks use SwiftUI's
// vertical-growth axis capped by `lineLimit`, so a long house-style prompt
// scrolls inside its own cell instead of pushing the Form around.
function Field({ field, onChange }: { field: PromptField; onChange: (v: string) => void }) {
  const text = useNativeState(field.initial);
  const lines = field.lines ?? 1;
  return (
    <Section title={field.title} footer={field.footer ? <Text>{field.footer}</Text> : undefined}>
      <TextField
        text={text}
        placeholder={field.placeholder}
        onTextChange={onChange}
        axis={lines > 1 ? 'vertical' : 'horizontal'}
        modifiers={lines > 1 ? [lineLimit({ min: Math.min(3, lines), max: lines })] : []}
      />
    </Section>
  );
}

// Native SwiftUI prompt editor (iOS) for the settings/style-prompt and
// settings/sheet-prompt screens — the grouped-Form look of the rest of the
// sheet. iOS-only imports live here (.ios.tsx); prompt-form.tsx is the
// cross-platform fallback.
export default function PromptForm({ fields, onChange, destructive }: PromptFormProps) {
  // Match the settings Form's scheme-aware grouped background (SwiftUI would
  // otherwise paint systemGroupedBackground).
  const colors = useColors();
  return (
    <Host style={{ flex: 1 }}>
      <Form modifiers={[scrollContentBackground('hidden'), background(colors.groupedBg)]}>
        {fields.map((f) => (
          <Field key={f.key} field={f} onChange={(v) => onChange(f.key, v)} />
        ))}
        {destructive ? (
          <Section>
            <Button role="destructive" label={destructive.label} onPress={destructive.onPress} />
          </Section>
        ) : null}
      </Form>
    </Host>
  );
}
