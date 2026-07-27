// PromptEditor — a textarea-shaped TipTap editor for the prompt composers
// (ImageStudio, AgentChat) that adds "@" reference-image mentions on top of
// plain text. The document is text-only plus atomic @imageN chips; everything
// serializes back to a plain string via `getValue()` (chips → "@imageN",
// paragraph breaks → "\n"), so consumers keep working in plain-string land.
//
// The chips track the reference tray, not the other way round: each chip holds
// the reference's stable id, and whenever the `refs` prop changes an effect
// renumbers every chip's label to the reference's current tray position and
// drops chips whose reference was removed. Tag numbering therefore always
// matches the tray order at the moment of submit.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import { refTagLabel } from "@/lib/refTags";
import { RefMention, RefMentionSuggestion } from "./RefMention";

// Walk the doc into { text, mentions } — text nodes verbatim, chips as
// "@imageN", paragraph boundaries as newlines (same walk the vibe-code editor
// uses, minus the marker syntax).
function serialize(editor) {
  let text = "";
  const mentions = [];
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      text += node.text;
    } else if (node.type.name === "refMention") {
      text += `@${node.attrs.label}`;
      mentions.push({ refId: node.attrs.refId, label: node.attrs.label });
    } else if (node.type.name === "paragraph" && text.length > 0) {
      text += "\n";
    }
  });
  return { text: text.trim(), mentions };
}

// Plain text → doc JSON (setContent would otherwise parse the string as HTML).
function textToDoc(text) {
  const lines = String(text || "").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

const PromptEditor = forwardRef(function PromptEditor(
  {
    // Ordered reference images: [{ id, thumb, url, name }] — id must be stable.
    refs = [],
    placeholder = "",
    onChange, // (plainText) — fired on every edit with the serialized text
    onSubmit, // Enter (when submitOnEnter) or Cmd/Ctrl+Enter (always)
    submitOnEnter = false,
    // (File[]) — files pasted OR dropped onto the editor, unfiltered. The
    // consumer classifies and rejects (AgentChat takes images + documents), so
    // this stays agnostic about what a given composer accepts.
    onPasteFiles,
    className,
    autoFocus = false,
  },
  ref,
) {
  // Live-read refs so the suggestion items and key handlers never go stale
  // (the editor instance is created once).
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const submitOnEnterRef = useRef(submitOnEnter);
  submitOnEnterRef.current = submitOnEnter;
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  const editorRef = useRef(null);

  const editor = useEditor({
    extensions: [
      // Text-only schema: keep paragraphs, breaks and undo; drop the markdown
      // formatting a prompt box shouldn't have.
      StarterKit.configure({
        blockquote: false,
        bold: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        strike: false,
        underline: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
      }),
      // showOnlyCurrent: false so the hint renders while the editor is blurred;
      // the CSS keys on .is-editor-empty so it only shows on an empty doc.
      Placeholder.configure({ placeholder, showOnlyCurrent: false }),
      RefMention,
      RefMentionSuggestion.configure({
        getItems: () =>
          refsRef.current.map((r, i) => ({
            refId: r.id,
            label: refTagLabel(i),
            thumb: r.thumb || r.url,
            name: r.name,
          })),
      }),
    ],
    autofocus: autoFocus,
    onUpdate: ({ editor }) => onChangeRef.current?.(serialize(editor).text),
    editorProps: {
      handleKeyDown: (view, event) => {
        // View props run before the suggestion plugin's handlers, so stand
        // down while the "@" picker is open (it owns Enter/arrows).
        const picking = editorRef.current?.storage?.refMentionSuggestion?.active;
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          onSubmitRef.current?.();
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey && submitOnEnterRef.current && !picking) {
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        return false;
      },
      // Cmd/Ctrl+V of a file (a screenshot, a PDF copied in Finder) — hand the
      // raw files up; ProseMirror would otherwise drop them or paste a name.
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length && onPasteFilesRef.current) {
          event.preventDefault();
          onPasteFilesRef.current(files);
          return true;
        }
        return false;
      },
      // Dropping ONTO the editor. The composer may also sit inside a dropzone
      // that catches drops on the surrounding chrome, so stop propagation here
      // — otherwise the same files get added twice, once by each handler.
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length && onPasteFilesRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onPasteFilesRef.current(files);
          return true;
        }
        return false;
      },
    },
  });
  editorRef.current = editor;

  // Reconcile chips with the tray: renumber labels to current positions, drop
  // chips whose reference is gone. Dispatching fires onUpdate → onChange, so
  // the consumer's plain-text state renumbers too.
  useEffect(() => {
    if (!editor) return;
    const indexById = new Map(refs.map((r, i) => [r.id, i]));
    const stale = []; // [{ pos, size, label|null }] — null label = remove
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "refMention") return;
      const idx = indexById.get(node.attrs.refId);
      if (idx === undefined) stale.push({ pos, size: node.nodeSize, label: null });
      else if (node.attrs.label !== refTagLabel(idx))
        stale.push({ pos, size: node.nodeSize, label: refTagLabel(idx), refId: node.attrs.refId });
    });
    if (!stale.length) return;
    const tr = editor.state.tr;
    for (const s of [...stale].reverse()) {
      if (s.label === null) tr.delete(s.pos, s.pos + s.size);
      else tr.setNodeMarkup(s.pos, undefined, { refId: s.refId, label: s.label });
    }
    editor.view.dispatch(tr);
  }, [editor, refs]);

  useImperativeHandle(ref, () => ({
    getValue: () => (editor ? serialize(editor) : { text: "", mentions: [] }),
    clear: () => editor?.commands.clearContent(true),
    focus: () => editor?.commands.focus(),
    setText: (text) => {
      editor?.commands.setContent(textToDoc(text), { emitUpdate: true });
    },
    // Append at the very end of the doc WITHOUT relying on focus: dictation
    // lands here while the composer is hidden behind the recording bar, and a
    // hidden element can't take DOM focus (so `.focus("end")` would leave the
    // selection wherever it was and drop the text in the wrong place, or
    // nowhere). The caller re-focuses once the composer is visible again.
    appendText: (text) => {
      if (!editor) return;
      const { text: cur } = serialize(editor);
      editor
        .chain()
        // Clamps to the last valid text position, so this is the end of the doc.
        .setTextSelection(editor.state.doc.content.size)
        .insertContent({ type: "text", text: cur ? ` ${text}` : text })
        .run();
    },
  }), [editor]);

  return (
    <EditorContent
      editor={editor}
      className={cn("prompt-editor cursor-text", className)}
      onClick={() => editor?.commands.focus()}
    />
  );
});

export default PromptEditor;
