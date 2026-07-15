// The Script tab's "ask the agent to change this" selection box.
//
// Drag-select any run of the screenplay and a small chat input floats above the
// selection: type the change you want and hit "Ask agent". That routes the
// selected lines + your request to the chat agent (the script-writing skill),
// which proposes the edit as a before→after diff on the Script tab — propose →
// confirm → apply, like every other script change.
//
// Positioning is plain fixed-coordinate placement anchored at the selection's
// start caret (via ProseMirror `coordsAtPos`), flipping below the selection when
// there isn't room above — the same no-tippy / no-floating-ui house style as the
// "/" SlashCommand menu.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgent, agentIsBusy, scriptEditRequest } from "@/components/AgentProvider";

// Viewport coords of the selection's start caret. Returns null if the position
// can't be measured (e.g. the doc changed out from under the stored range).
function anchorFor(editor, from) {
  try {
    const c = editor.view.coordsAtPos(from);
    return { top: c.top, bottom: c.bottom, left: c.left };
  } catch {
    return null;
  }
}

export default function ScriptSelectionAsk({ editor }) {
  const agent = useAgent();
  const busy = agentIsBusy(agent);

  // The selection the box is bound to: { from, to, text } — or null when hidden.
  const [sel, setSel] = useState(null);
  const [coords, setCoords] = useState(null); // recomputed anchor rect, or null
  const [pos, setPos] = useState(null); // measured {left, top} for the box
  const [value, setValue] = useState(""); // the change request being typed
  const [sending, setSending] = useState(false);

  const selRef = useRef(null);
  selRef.current = sel;
  const boxRef = useRef(null);
  const taRef = useRef(null);

  // Track the current text selection. A non-empty range binds the box to it; an
  // empty one hides it. Clicking into the input below (which blurs the editor)
  // doesn't change the ProseMirror selection, so the box stays put while typing.
  const onSel = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      setSel(null);
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n", " ").trim();
    if (!text) {
      setSel(null);
      return;
    }
    setSel((prev) => (prev && prev.from === from && prev.to === to ? prev : { from, to, text }));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", onSel);
    editor.on("transaction", onSel);
    return () => {
      editor.off("selectionUpdate", onSel);
      editor.off("transaction", onSel);
    };
  }, [editor, onSel]);

  // A fresh passage starts a fresh request (dropping any half-typed one that
  // belonged to the previously-selected lines).
  useEffect(() => {
    setValue("");
  }, [sel?.from, sel?.to]);

  // (Re)compute the anchor rect on selection change, and keep it pinned to the
  // passage while the page scrolls or resizes.
  const recompute = useCallback(() => {
    const s = selRef.current;
    if (!editor || !s) {
      setCoords(null);
      return;
    }
    const c = anchorFor(editor, s.from);
    setCoords(c);
    if (!c) setSel(null);
  }, [editor]);

  useEffect(() => {
    recompute();
  }, [sel, recompute]);

  useEffect(() => {
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  // Measure the box and place it above the selection start, flipping below when
  // it would collide with the sticky toolbar at the top of the viewport.
  useLayoutEffect(() => {
    if (!coords || !boxRef.current) return;
    const el = boxRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(coords.left, window.innerWidth - w - 8));
    let top = coords.top - 8 - h;
    if (top < 64) top = coords.bottom + 8; // clear the sticky Script toolbar
    setPos({ left, top });
  }, [coords, value, sending]);

  const close = useCallback(() => {
    setSel(null);
    setValue("");
  }, []);

  const submit = useCallback(async () => {
    const s = selRef.current;
    const instruction = value.trim();
    if (!s || !instruction || busy || sending) return;
    setSending(true);
    try {
      await agent.send({ message: scriptEditRequest(s.text, instruction) });
      setSel(null);
      setValue("");
      editor?.commands.blur?.();
    } catch {
      /* surfaced in the chat panel */
    } finally {
      setSending(false);
    }
  }, [agent, busy, sending, value, editor]);

  if (!editor || !sel || !coords) return null;

  const disabled = busy || sending || !value.trim();

  return (
    <div
      ref={boxRef}
      style={{
        position: "fixed",
        left: pos ? pos.left : coords.left,
        top: pos ? pos.top : -9999,
        zIndex: 50,
      }}
      className="w-80 rounded-xl border bg-popover p-2.5 text-popover-foreground shadow-lg"
    >
      <Textarea
        ref={taRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Describe the change… (e.g. make this line angrier, tighten it, fix the slug)"
        className="min-h-[64px] resize-none text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {busy ? "agent is busy…" : "Enter to send · Shift+Enter for a new line"}
        </span>
        <Button size="sm" className="ml-auto h-8 gap-1.5 text-xs" disabled={disabled} onClick={submit}>
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          Ask agent
        </Button>
      </div>
    </div>
  );
}
