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
import { Wand2, Loader2, Mic, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgent, agentIsBusy, scriptEditRequest } from "@/components/AgentProvider";
import { useVoiceRecording, transcribeAudio, formatDuration } from "@/lib/useVoiceRecording";

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

export default function ScriptSelectionAsk({ editor, paused = false, onPendingRange, onSent }) {
  const agent = useAgent();
  const busy = agentIsBusy(agent);

  // The selection the box is bound to: { from, to, text } — or null when hidden.
  const [sel, setSel] = useState(null);
  const [coords, setCoords] = useState(null); // recomputed anchor rect, or null
  const [pos, setPos] = useState(null); // measured {left, top} for the box
  const [value, setValue] = useState(""); // the change request being typed
  const [sending, setSending] = useState(false);

  // Whisper dictation — the same voice hook the chat composer uses. Recorded
  // audio is transcribed by the Worker's `/api/transcribe` route and appended to
  // the typed request rather than sent, so the author can dictate then edit.
  const rec = useVoiceRecording();
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");

  const selRef = useRef(null);
  selRef.current = sel;
  const boxRef = useRef(null);
  const taRef = useRef(null);

  // Track the current text selection. A non-empty range binds the box to it; an
  // empty one hides it. Clicking into the input below (which blurs the editor)
  // doesn't change the ProseMirror selection, so the box stays put while typing.
  const onSel = useCallback(() => {
    if (!editor || paused) return; // frozen while the agent works on a passage
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
  }, [editor, paused]);

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
    setVoiceError("");
  }, [sel?.from, sel?.to]);

  // Mirror the live selection up so the parent can paint the persistent
  // highlight (which survives the editor blurring when the box is focused).
  useEffect(() => {
    if (paused) return; // the parent owns the "working" highlight while locked
    onPendingRange?.(sel ? { from: sel.from, to: sel.to } : null);
  }, [sel, paused, onPendingRange]);

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
  }, [coords, value, sending, rec.recording, transcribing, voiceError]);

  const close = useCallback(() => {
    if (rec.recording) rec.cancel();
    setSel(null);
    setValue("");
  }, [rec]);

  const startRecording = useCallback(async () => {
    setVoiceError("");
    try {
      await rec.start();
    } catch (e) {
      setVoiceError(e?.message || "Couldn't start recording.");
    }
  }, [rec]);

  const cancelRecording = useCallback(() => {
    rec.cancel();
  }, [rec]);

  // Stop, transcribe, and append the heard text to whatever's already typed.
  const confirmRecording = useCallback(async () => {
    setVoiceError("");
    setTranscribing(true);
    try {
      const blob = await rec.stop();
      if (!blob || blob.size < 100) return; // nothing usable captured
      const { text } = await transcribeAudio(blob);
      const heard = (text || "").trim();
      if (heard) setValue((v) => (v.trim() ? `${v.trim()} ${heard}` : heard));
      taRef.current?.focus();
    } catch (e) {
      setVoiceError(e?.message || "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  }, [rec]);

  const submit = useCallback(async () => {
    const s = selRef.current;
    const instruction = value.trim();
    if (!s || !instruction || busy || sending) return;
    setSending(true);
    try {
      await agent.send({ message: scriptEditRequest(s.text, instruction) });
      // Hand the passage off to the parent: it locks the doc and keeps the
      // highlight lit (as "working") until the agent comes back. onSent runs
      // FIRST so the pending-highlight clear below is ignored, not the lock.
      onSent?.(s);
      setSel(null);
      setValue("");
      editor?.commands.blur?.();
    } catch {
      /* surfaced in the chat panel */
    } finally {
      setSending(false);
    }
  }, [agent, busy, sending, value, editor, onSent]);

  if (!editor || paused || !sel || !coords) return null;

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
      {rec.recording || transcribing ? (
        // The recording bar replaces the footer while a take is in progress —
        // same cancel / pulse / confirm shape as the chat composer.
        <div className="mt-2 flex items-center gap-2 rounded-lg border bg-background px-2 py-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={cancelRecording}
            disabled={transcribing}
            aria-label="Cancel recording"
            title="Cancel"
          >
            <X size={14} />
          </Button>
          <div className="flex flex-1 items-center gap-2 text-xs">
            {transcribing ? (
              <Loader2 size={13} className="animate-spin text-muted-foreground" />
            ) : (
              <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
            )}
            <span className="text-muted-foreground">
              {transcribing ? "Transcribing…" : "Recording…"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatDuration(rec.duration)}
            </span>
          </div>
          <Button
            size="icon"
            className="size-7"
            onClick={confirmRecording}
            disabled={transcribing}
            aria-label="Stop and transcribe"
            title="Stop and transcribe"
          >
            {transcribing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {voiceError ? voiceError : busy ? "agent is busy…" : "Enter to send · Shift+Enter for a new line"}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-8 shrink-0"
            onClick={startRecording}
            aria-label="Dictate the change"
            title="Dictate the change"
          >
            <Mic size={15} />
          </Button>
          <Button size="sm" className="h-8 shrink-0 gap-1.5 text-xs" disabled={disabled} onClick={submit}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Ask agent
          </Button>
        </div>
      )}
    </div>
  );
}
