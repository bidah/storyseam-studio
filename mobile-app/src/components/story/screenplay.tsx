import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

// Native screenplay renderer for the Script tab. The web app edits the script
// as a TipTap/ProseMirror document whose body blocks are either `screenplay`
// nodes (attrs.spType: scene_heading | action | character | dialogue |
// parenthetical | transition — see src/components/notes/schema.js in the web
// repo) or plain StarterKit blocks (paragraph, heading, lists…). On mobile the
// body is read-only (agent-driven edits arrive as proposals), so we flatten
// the doc into typed lines and map each type to a styled <Text> block.

export type PMNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
};

export type ScriptLine = { type: string; text: string };

// All inline text of a node (hard breaks become newlines).
export function nodeText(node: PMNode | null | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(nodeText).join('');
}

// Flatten a ProseMirror doc into typed screenplay lines (one block = one line).
export function docLines(doc: PMNode | null | undefined): ScriptLine[] {
  const out: ScriptLine[] = [];
  for (const n of doc?.content || []) {
    if (n.type === 'title') continue; // legacy in-doc title (title lives outside the doc now)
    if (n.type === 'screenplay') {
      out.push({ type: n.attrs?.spType || 'action', text: nodeText(n) });
    } else if (n.type === 'heading') {
      out.push({ type: 'heading', text: nodeText(n) });
    } else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
      for (const li of n.content || []) out.push({ type: 'list_item', text: nodeText(li) });
    } else {
      out.push({ type: n.type || 'paragraph', text: nodeText(n) });
    }
  }
  return out;
}

export const SP_LABELS: Record<string, string> = {
  scene_heading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  heading: 'Heading',
  paragraph: 'Text',
  list_item: 'List',
};

// One styled screenplay block. `tone` tints diff rows (add/del) in the review.
export function ScreenplayLine({
  line,
  tone,
}: {
  line: ScriptLine;
  tone?: 'add' | 'del';
}) {
  const toneStyle = tone === 'add' ? styles.toneAdd : tone === 'del' ? [styles.toneDel, styles.lineThrough] : undefined;
  if (!line.text.trim()) return <View style={styles.blank} />;
  switch (line.type) {
    case 'scene_heading':
      return (
        <Text style={[styles.sceneHeading, toneStyle]}>
          {line.text}
        </Text>
      );
    case 'character':
      return (
        <Text style={[styles.character, toneStyle]}>
          {line.text}
        </Text>
      );
    case 'dialogue':
      return (
        <Text style={[styles.dialogue, toneStyle]}>
          {line.text}
        </Text>
      );
    case 'parenthetical':
      return (
        <Text style={[styles.parenthetical, toneStyle]}>
          {line.text}
        </Text>
      );
    case 'transition':
      return (
        <Text style={[styles.transition, toneStyle]}>
          {line.text}
        </Text>
      );
    case 'heading':
      return <Text style={[styles.heading, toneStyle]}>{line.text}</Text>;
    default:
      return <Text style={[styles.paragraph, toneStyle]}>{line.text}</Text>;
  }
}

export function ScreenplayView({
  doc,
  onEditLine,
}: {
  doc: PMNode | null | undefined;
  // When provided, each non-empty block becomes tappable — the Script tab opens
  // an edit sheet that routes the rewrite through the agent (see script.tsx).
  onEditLine?: (line: ScriptLine, index: number) => void;
}) {
  const lines = docLines(doc);
  return (
    <View style={styles.list}>
      {lines.map((l, i) =>
        onEditLine && l.text.trim() ? (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${SP_LABELS[l.type] || 'line'}: ${l.text}`}
            style={({ pressed }) => [styles.editable, pressed && styles.editablePressed]}
            onPress={() => onEditLine(l, i)}
          >
            <ScreenplayLine line={l} />
          </Pressable>
        ) : (
          <ScreenplayLine key={i} line={l} />
        ),
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Minimal line-level diff (LCS) for the proposal review — per-block add/remove
// highlighting, grouped into equal runs and change hunks.

export type DiffSegment =
  | { kind: 'equal'; lines: ScriptLine[] }
  | { kind: 'change'; removed: ScriptLine[]; added: ScriptLine[] };

const lineKey = (l: ScriptLine) => `${l.type}${l.text}`;

export function diffLines(a: ScriptLine[], b: ScriptLine[]): DiffSegment[] {
  const n = a.length;
  const m = b.length;
  // LCS table (docs are at most a few hundred blocks — O(n*m) is fine).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        lineKey(a[i]) === lineKey(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segments: DiffSegment[] = [];
  const pushEqual = (l: ScriptLine) => {
    const last = segments[segments.length - 1];
    if (last?.kind === 'equal') last.lines.push(l);
    else segments.push({ kind: 'equal', lines: [l] });
  };
  const pushChange = (removed?: ScriptLine, added?: ScriptLine) => {
    let last = segments[segments.length - 1];
    if (last?.kind !== 'change') {
      last = { kind: 'change', removed: [], added: [] };
      segments.push(last);
    }
    if (removed) (last as Extract<DiffSegment, { kind: 'change' }>).removed.push(removed);
    if (added) (last as Extract<DiffSegment, { kind: 'change' }>).added.push(added);
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (lineKey(a[i]) === lineKey(b[j])) {
      pushEqual(a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushChange(a[i], undefined);
      i++;
    } else {
      pushChange(undefined, b[j]);
      j++;
    }
  }
  while (i < n) pushChange(a[i++], undefined);
  while (j < m) pushChange(undefined, b[j++]);
  return segments;
}

const styles = StyleSheet.create((theme) => ({
  blank: {
    height: 12,
  },
  sceneHeading: {
    marginTop: 20,
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.foreground,
  },
  character: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: theme.colors.foreground,
  },
  dialogue: {
    paddingHorizontal: 40,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 24,
    color: theme.colors.foreground,
  },
  parenthetical: {
    paddingHorizontal: 40,
    textAlign: 'center',
    fontSize: 14,
    fontStyle: 'italic',
    color: theme.colors.mutedForeground,
  },
  transition: {
    marginTop: 16,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: theme.colors.mutedForeground,
  },
  heading: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.foreground,
  },
  paragraph: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 24,
    color: theme.colors.foreground,
  },
  toneAdd: {
    color: theme.colors.success,
  },
  toneDel: {
    color: theme.colors.destructive,
  },
  lineThrough: {
    textDecorationLine: 'line-through',
  },
  list: {
    gap: 4,
  },
  editable: {
    borderRadius: 6,
  },
  editablePressed: {
    backgroundColor: `${theme.colors.secondary}80`,
  },
}));
