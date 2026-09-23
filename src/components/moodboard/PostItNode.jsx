import { useCallback, useEffect, useRef, useState, memo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  AlignCenter, AlignLeft, Bold, CaseUpper, Check, Highlighter, Italic,
  Square, SquareDashed, Trash2, Underline,
} from "lucide-react";
import { postItIsNotepad } from "@/lib/moodboardPostit";
import { useTextFit } from "@/hooks/useTextFit";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Renders selected text in uppercase via CSS text-transform, stored as
// <span data-uppercase> so it round-trips through the card's HTML content.
const Uppercase = Mark.create({
  name: "uppercase",
  parseHTML() {
    return [{ tag: "span[data-uppercase]" }];
  },
  renderHTML() {
    return ["span", { "data-uppercase": "" }, 0];
  },
});

// Highlights selected text with a bright lime background, stored as
// <mark data-highlight> so it round-trips through the card's HTML content.
const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark[data-highlight]" }];
  },
  renderHTML() {
    return ["mark", { "data-highlight": "" }, 0];
  },
});

// An empty TipTap document serializes as `<p></p>` (or a few `<br>` variants),
// while a freshly created card stores `""`. Those are the SAME document, and
// treating them as different breaks undo: undoing back to an empty note writes
// `""`, TipTap immediately re-emits `<p></p>`, that lands as a new edit, and the
// next undo just re-empties it — the stack can never advance past the note.
const EMPTY_DOC = /^\s*(?:<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)*$/i;
const sameDoc = (a, b) => {
  const norm = (h) => (EMPTY_DOC.test(h || "") ? "" : h);
  return norm(a) === norm(b);
};

function PostItNode({ data, selected, dragging }) {
  const { content, color, onUpdate, onDelete, onEditStart, onEditEnd } = data;
  const border = data.border ?? false;
  const onSetBorder = data.onSetBorder;
  const onSetAlign = data.onSetAlign;
  const [isEditing, setIsEditing] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  // A brand-new card suppresses the placeholder: the note was just created by a
  // double-click and the cursor is already in it, so "Type something…" would be
  // noise the user has to read past.
  const [isFresh, setIsFresh] = useState(false);
  const isFreshRef = useRef(isFresh);
  const contentRef = useRef(null);
  // The editor's callbacks are created once, so they can't close over `content`.
  const latestContent = useRef(content);

  useEffect(() => {
    isFreshRef.current = isFresh;
  }, [isFresh]);
  useEffect(() => {
    latestContent.current = content;
  }, [content]);

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, Uppercase, Highlight],
    content,
    editable: isEditing,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // Entering edit mode (and focusing) makes TipTap emit its canonical
      // serialization even when nothing was typed. Reporting that as an edit
      // would push a no-op onto the undo stack — see sameDoc above.
      if (sameDoc(html, latestContent.current)) return;
      onUpdate(html);
      if (isFreshRef.current && editor.getText().trim().length > 0) setIsFresh(false);
    },
    onBlur: () => {
      setIsEditing(false);
      setShowToolbar(false);
      setIsFresh(false);
      onEditEnd();
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(isEditing);
    if (!isEditing) return;
    const rafId = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus("end");
    });
    return () => cancelAnimationFrame(rafId);
  }, [isEditing, editor]);

  // Stream remote edits in while this client isn't the one editing — otherwise a
  // revalidation mid-sentence would yank the caret to the end.
  useEffect(() => {
    if (!editor || isEditing) return;
    // sameDoc, not `!==`: a stored `""` against the editor's `<p></p>` would
    // otherwise re-set the content on every render forever.
    if (!sameDoc(editor.getHTML(), content)) {
      editor.commands.setContent(content || "", { emitUpdate: false });
    }
  }, [content, editor, isEditing]);

  // A freshly created (empty) card opens straight into edit mode, so a
  // double-click on the canvas is one gesture, not two.
  useEffect(() => {
    // `sameDoc(content, "")`, not `!content`: a note emptied in an earlier
    // session is stored as `<p></p>`, which is just as blank.
    if (selected && sameDoc(content, "") && !isEditing) {
      setIsEditing(true);
      setShowToolbar(true);
      setIsFresh(true);
      onEditStart();
    }
  }, [selected, content, isEditing, onEditStart]);

  const handleClick = useCallback(
    (e) => {
      if (isEditing) return;
      // Two-step interaction: the first click only focuses the card — we let the
      // event reach React Flow so it marks the node selected without entering
      // edit mode. A click on an already-selected card opens the editor.
      if (!selected) return;
      e.stopPropagation();
      setIsEditing(true);
      setShowToolbar(true);
      onEditStart();
    },
    [selected, isEditing, onEditStart],
  );

  const handleDelete = useCallback(
    (e) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete],
  );

  // Above a text-length threshold the square morphs into a taller "notepad"
  // rectangle so long content stays legible; below it, back to a square. Derived
  // purely from content, so it stays in step across clients with nothing to sync.
  const isNotepad = postItIsNotepad(content);

  // Effective alignment: an explicit per-card override wins; otherwise it
  // follows the shape (square → center, notepad → left).
  const align = data.align ?? (isNotepad ? "left" : "center");

  // When the note changes shape, drop any manual alignment override so it
  // re-adopts the new shape's default. Only the client actively editing does
  // this, which keeps it from firing redundantly from every open tab.
  const prevNotepadRef = useRef(isNotepad);
  useEffect(() => {
    if (prevNotepadRef.current === isNotepad) return;
    prevNotepadRef.current = isNotepad;
    if (isEditing && data.align != null) onSetAlign?.(null);
  }, [isNotepad, isEditing, data.align, onSetAlign]);

  // Squares auto-fit their font to the card; the notepad uses a fixed, smaller
  // size (set in CSS), so the fitter is disabled for it.
  useTextFit(contentRef, [content, isEditing, isFresh, isNotepad], !isNotepad);

  if (!editor) return null;

  const toolbarToggle = (key, label, Icon, pressed, onPress) => (
    <Tooltip key={key}>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={pressed}
          aria-label={label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          onPressedChange={onPress}
        >
          <Icon size={14} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div
      className={`post-it-node relative ${isNotepad ? "notepad" : ""} ${border ? "has-border" : ""} ${
        selected ? "selected" : ""
      } ${dragging ? "dragging" : ""} ${isFresh ? "fresh-card" : ""}`}
      style={{ backgroundColor: color }}
      onClick={handleClick}
    >
      {showToolbar && (
        <div className="nodrag noselect absolute -top-11 left-0 z-10 flex items-center gap-1 rounded-none border bg-popover p-1">
          {toolbarToggle("bold", "Bold", Bold, editor.isActive("bold"), () =>
            editor.chain().focus().toggleBold().run(),
          )}
          {toolbarToggle("italic", "Italic", Italic, editor.isActive("italic"), () =>
            editor.chain().focus().toggleItalic().run(),
          )}
          {toolbarToggle("underline", "Underline", Underline, editor.isActive("underline"), () =>
            editor.chain().focus().toggleUnderline().run(),
          )}
          {toolbarToggle("uppercase", "Uppercase", CaseUpper, editor.isActive("uppercase"), () =>
            editor.chain().focus().toggleMark("uppercase").run(),
          )}
          {toolbarToggle("highlight", "Highlight", Highlighter, editor.isActive("highlight"), () =>
            editor.chain().focus().toggleMark("highlight").run(),
          )}
          <Separator orientation="vertical" className="mx-0.5 !h-5" />
          {toolbarToggle("left", "Align left", AlignLeft, align === "left", () => onSetAlign?.("left"))}
          {toolbarToggle("center", "Align center", AlignCenter, align === "center", () =>
            onSetAlign?.("center"),
          )}
          <Separator orientation="vertical" className="mx-0.5 !h-5" />
          {toolbarToggle(
            "border",
            border ? "Remove border" : "Add border",
            border ? SquareDashed : Square,
            border,
            () => onSetBorder?.(!border),
          )}
          <Separator orientation="vertical" className="mx-0.5 !h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                aria-label="Delete note"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleDelete}
              >
                <Trash2 size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-primary hover:text-primary"
                aria-label="Done editing"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(false);
                  setShowToolbar(false);
                  onEditEnd();
                }}
              >
                <Check size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Done</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div
        className={`flex h-full justify-center overflow-hidden p-4 ${
          isNotepad ? "items-start" : "items-center"
        }`}
      >
        <div ref={contentRef} className={`w-full ${isEditing ? "nodrag noselect" : ""}`}>
          {/* Ink stays neutral-900, not a theme token: the card's background is
              the author's chosen post-it color (data), so the text has to
              contrast THAT, not the app surface. */}
          <EditorContent
            editor={editor}
            className={`leading-relaxed text-neutral-900 ${
              align === "left" ? "text-left" : "text-center"
            }`}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(
  PostItNode,
  (prev, next) =>
    prev.selected === next.selected &&
    prev.dragging === next.dragging &&
    prev.data.content === next.data.content &&
    prev.data.color === next.data.color &&
    prev.data.align === next.data.align &&
    prev.data.border === next.data.border,
);
