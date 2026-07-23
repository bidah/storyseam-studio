import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent, useConversations } from "@/components/AgentProvider";
import {
  Send,
  Square,
  Wrench,
  AlertCircle,
  FileText,
  Sparkles,
  Paperclip,
  Loader2,
  X,
  ArrowDown,
  Image as ImageIcon,
  SquarePen,
  History,
  MessageSquare,
  Trash2,
  Check,
  ChevronDown,
  Cpu,
  Mic,
} from "lucide-react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
} from "@/components/ui/attachment";
import { Marker, MarkerIcon, MarkerContent } from "@/components/ui/marker";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  AGENT_MODELS,
  DEFAULT_AGENT_MODEL,
  useAgentModel,
  useAvailableAgentModels,
  setAgentModel,
} from "@/lib/agentModel";
import {
  useVoiceRecording,
  transcribeAudio,
  formatDuration,
} from "@/lib/useVoiceRecording";
import MediaPicker from "@/components/MediaPicker";

// ---------------------------------------------------------------------------
// Chat rendering walks every part of every flue message in order and renders
// each by `type` (`text`, `reasoning`, `dynamic-tool`, `file`), instead of
// scanning only the last message.
//
// Interactive questions: flue has no BLOCKING HITL (a tool can't suspend a turn),
// so the `ask_question` tool is a non-blocking recreation — its `dynamic-tool`
// part renders as a `QuestionCard` with clickable options (see `QuestionCard` /
// `deriveQA`). Because there is no server-side `inputResponse`, the answer is
// just the next ordinary user message: clicking an option sends its label, and a
// typed reply works the same way. No `inputResponses` resume path.
//
// Attachments: images picked from the composer are uploaded to Cloudflare R2
// (POST /api/upload) for a durable thumbnail URL, and sent to flue as base64
// `images` (its `sendMessage` takes `{ images: [{ data, mimeType }] }`) so the
// model can actually see them. flue's `file` parts don't serve historical bytes,
// so we remember what each user turn was sent with (in `attByMsgId`, keyed by the
// flue message id) and render the thumbnails back into that turn's bubble from the
// R2 URL. Clicking any transcript image opens a full-size lightbox.
// ---------------------------------------------------------------------------

// Where attachment uploads go. Defaults to the Cloudflare Worker
// (VITE_UPLOAD_URL) — an R2-backed endpoint that also records each upload in
// D1 — and falls back to the local Express endpoint when it isn't configured.
const UPLOAD_ENDPOINT = import.meta.env.VITE_UPLOAD_URL || "/api/upload";

// Shared markdown renderer for anything the agent authors (text parts *and* the
// prompt of an inline input-request card). eve emits paragraphs and numbered
// questions separated by single newlines; plain Markdown treats those as soft
// breaks and collapses them onto one line, so we add `remark-breaks` to render
// each newline as a visual line break. Keeping one component means the card and
// the chat body always format identically.
const MARKDOWN_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkBreaks];
const MARKDOWN_CLASS =
  "space-y-2 break-words text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5";
// Hoisted to a stable reference: Streamdown keys an internal animation effect on
// this object, so a fresh `{…}` literal per render makes that effect re-fire
// every render while `isAnimating` (i.e. during streaming) — a setState loop
// that trips React's "Maximum update depth exceeded" guard.
const MARKDOWN_ANIMATION = { animation: "fadeIn", duration: 180, sep: "word" };

function Markdown({ text, animating = false, className }) {
  return (
    <Streamdown
      animated={MARKDOWN_ANIMATION}
      isAnimating={animating}
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      className={cn(MARKDOWN_CLASS, className)}
    >
      {text}
    </Streamdown>
  );
}

function prettySize(n) {
  if (typeof n !== "number") return "";
  const kb = n / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

// A compact chip for a flue `dynamic-tool` part. `state` is one of
// input-available / output-available / output-error; the input is surfaced as a
// hover title and an error surfaces its `errorText` inline.
function ToolChip({ part }) {
  const name = part.toolName || "tool";
  const errored = part.state === "output-error";
  let inputHint = "";
  try {
    if (part.input !== undefined) inputHint = JSON.stringify(part.input);
  } catch {
    /* non-serializable input — skip the hover hint */
  }
  return (
    <span className="flex w-fit max-w-full flex-col gap-0.5">
      <span
        title={inputHint || undefined}
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
          errored
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : "border-border bg-muted/50 text-muted-foreground",
        )}
      >
        <Wrench size={11} /> {name}
        {errored ? " · failed" : null}
      </span>
      {errored && part.errorText ? (
        <span className="max-w-full break-words text-[11px] text-destructive">{part.errorText}</span>
      ) : null}
    </span>
  );
}

// An `ask_question` tool call, rendered as an interactive card (flue's
// non-blocking recreation of eve's HITL question). The tool's `input` carries
// `{ question, options: [{ id, label, style }] }`. flue can't suspend a turn, so
// there is no `inputResponse` on the part: a card is answerable only while it's
// the pending question (the last one with no user message after it), and once
// answered it collapses to "Responded: …" using that following user message
// (`answer`). Clicking an option sends its `label` as the next message; a typed
// reply in the composer works too (it's just the next user message).
// An option that asks the user to supply an image (the sheet-generation skill's
// "I'll attach a reference image" choice) is rendered as an UPLOAD button: it
// opens a file picker instead of just echoing its label, and the picked images
// are auto-sent as a "here is the reference — continue" message (see
// `onRespondFiles` in the chat component).
function isUploadOption(opt) {
  if (opt?.id === "upload") return true;
  return /\b(upload|attach)\b/i.test(opt?.label || "") && /\b(image|reference|ref)\b/i.test(opt?.label || "");
}

function QuestionCard({ part, pending, answer, canRespond, onRespond, onRespondFiles }) {
  const fileRef = useRef(null);
  const input = part.input || {};
  const question = typeof input.question === "string" ? input.question : "";
  const options = Array.isArray(input.options) ? input.options : [];
  const variantFor = (style) =>
    style === "danger" ? "destructive" : style === "primary" ? "default" : "secondary";
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      {question ? <Markdown text={question} className="text-muted-foreground" /> : null}
      {answer ? (
        <p className="text-sm font-medium">Responded: {answer}</p>
      ) : options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) =>
            isUploadOption(opt) ? (
              <Button
                key={opt.id ?? opt.label}
                size="sm"
                type="button"
                disabled={!pending || !canRespond}
                variant={variantFor(opt.style ?? "primary")}
                onClick={() => fileRef.current?.click()}
                className="h-auto max-w-full min-w-0 justify-start whitespace-normal py-1.5 text-left leading-snug"
              >
                <Paperclip size={13} /> {opt.label}
              </Button>
            ) : (
              <Button
                key={opt.id ?? opt.label}
                size="sm"
                type="button"
                disabled={!pending || !canRespond}
                variant={variantFor(opt.style)}
                onClick={() => onRespond?.(opt.label)}
                className="h-auto max-w-full min-w-0 justify-start whitespace-normal py-1.5 text-left leading-snug"
              >
                {opt.label}
              </Button>
            ),
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (files.length) onRespondFiles?.(files);
            }}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Type your answer below to continue.</p>
      )}
    </div>
  );
}

// A flue `file` part — an attachment carried on a message. Historical bytes
// aren't served, but a durably-recorded attachment (or an optimistic local echo)
// carries a `url` we can render; images inline, everything else as a chip.
function FilePart({ part }) {
  const isImage = part.mediaType?.startsWith("image/");
  if (part.url && isImage) {
    return (
      <img
        src={part.url}
        alt={part.filename || "attachment"}
        className="max-h-48 w-fit rounded-md border object-contain"
      />
    );
  }
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <FileText size={11} /> {part.filename || part.mediaType || "attachment"}
    </span>
  );
}

function MessagePart({ part, qa, canRespond, onRespond, onRespondFiles }) {
  switch (part.type) {
    case "text":
      return part.text ? (
        <Markdown text={part.text} animating={part.state === "streaming"} />
      ) : null;
    case "reasoning":
      return part.text ? (
        <details className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Reasoning</summary>
          <div className="mt-1 whitespace-pre-wrap break-words">{part.text}</div>
        </details>
      ) : null;
    case "dynamic-tool":
      return part.toolName === "ask_question" ? (
        <QuestionCard
          part={part}
          pending={qa?.pendingId === part.toolCallId}
          answer={qa?.answered.get(part.toolCallId)}
          canRespond={canRespond}
          onRespond={onRespond}
          onRespondFiles={onRespondFiles}
        />
      ) : (
        <ToolChip part={part} />
      );
    case "file":
      return <FilePart part={part} />;
    default:
      return null;
  }
}

// Resolve the answer state of every `ask_question` card in the thread. flue has
// no `inputResponse` channel, so "answered" is derived from the transcript: a
// question is answered by the first user message after it (its text is the
// answer); the one unanswered question — the last with no user message following
// — is `pendingId` (the only card whose buttons stay live).
function deriveQA(messages) {
  const answered = new Map();
  let pendingId = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (const p of m.parts || []) {
      if (p.type !== "dynamic-tool" || p.toolName !== "ask_question") continue;
      let ans = null;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "user") {
          ans = (messages[j].parts || [])
            .filter((x) => x.type === "text")
            .map((x) => x.text)
            .join("")
            .trim();
          break;
        }
      }
      if (ans) answered.set(p.toolCallId, ans);
      else pendingId = p.toolCallId;
    }
  }
  return { answered, pendingId };
}

// The concatenated text of a (user) message's text parts — the join key that
// maps a sent attachment batch to the flue message echoing it back.
function userMessageText(message) {
  return (message.parts || [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Thumbnails for the images a user turn was sent with, rendered back into the
// bubble (flue's projection doesn't keep servable image parts, so `atts` is
// supplied by the composer's id-keyed record).
function SentAttachments({ atts }) {
  if (!atts?.length) return null;
  return (
    <AttachmentGroup className="mt-1.5 max-w-[92%] justify-end">
      {atts.map((a, i) => (
        <Attachment key={i} size="sm" orientation="vertical" className="w-20">
          <AttachmentMedia variant="image">
            <img src={a.url} alt={a.name || "attachment"} />
          </AttachmentMedia>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

function AgentMessage({ message, atts, qa, canRespond, onRespond, onRespondFiles }) {
  const isUser = message.role === "user";
  if (isUser) {
    const text = userMessageText(message);
    return (
      <div className="flex flex-col items-end">
        {text ? (
          <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-2 text-sm text-foreground">
            {text}
          </div>
        ) : null}
        <SentAttachments atts={atts} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {(message.parts || []).map((part, i) => (
        <MessagePart
          key={part.toolCallId ?? `${part.type}:${i}`}
          part={part}
          qa={qa}
          canRespond={canRespond}
          onRespond={onRespond}
          onRespondFiles={onRespondFiles}
        />
      ))}
    </div>
  );
}

// The agent is "thinking" while a turn is in flight and the current assistant
// message hasn't produced any renderable content yet (no text/reasoning/tool).
function isThinking(messages, busy) {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role === "user") return true;
  const hasContent = (last.parts || []).some(
    (p) =>
      (p.type === "text" && p.text?.trim()) ||
      (p.type === "reasoning" && p.text?.trim()) ||
      p.type === "dynamic-tool",
  );
  return !hasContent;
}

// The agent is "working" while a turn is in flight and the current assistant
// message's most recent visible content is a tool call (a badge) with no text
// after it — the model has fired tools and is now silently deciding what to do
// next. Without this, the last card is just a stack of tool badges with no sign
// the turn is still live. Returns the trailing tool's name (for the label), or
// null. Distinct from `isThinking` (nothing rendered yet).
function workingTool(messages, busy) {
  if (!busy) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role === "user") return null;
  let trailing = null;
  for (const p of last.parts || []) {
    if (
      (p.type === "text" && p.text?.trim()) ||
      (p.type === "reasoning" && p.text?.trim()) ||
      p.type === "dynamic-tool"
    ) {
      trailing = p;
    }
  }
  return trailing?.type === "dynamic-tool" ? trailing.toolName || "tool" : null;
}

// The agent is "reasoning" while a turn is in flight and the current assistant
// message's trailing visible content is a reasoning block. The reasoning panel
// is collapsed and static (it doesn't animate like streaming text), so a
// prolonged chain-of-thought looks like the agent has stalled unless a shimmer
// marker sits below it. Distinct from `isThinking` (nothing rendered yet) and
// `workingTool` (trailing part is a tool call).
function isReasoning(messages, busy) {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role === "user") return false;
  let trailing = null;
  for (const p of last.parts || []) {
    if (
      (p.type === "text" && p.text?.trim()) ||
      (p.type === "reasoning" && p.text?.trim()) ||
      p.type === "dynamic-tool"
    ) {
      trailing = p;
    }
  }
  return trailing?.type === "reasoning";
}

// Read a File's bytes as raw base64 (no `data:` URL prefix) for flue's
// `sendMessage({ images: [{ data, mimeType }] })`.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Compact "2m" / "3h" / "5d" relative time for the chat list.
function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// Chat history as a right-side slide-in panel, sized to match the chat panel.
// Rows are plain buttons (not menu items), so a mouse click reliably switches
// conversations; the trash button is a sibling, not a nested button.
function ChatHistorySheet({ conv, triggerClassName }) {
  const [open, setOpen] = useState(false);
  const select = (id) => {
    conv.switchChat(id);
    setOpen(false);
  };
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-8", triggerClassName)}
          aria-label="Previous chats"
          title="Previous chats"
        >
          <History size={16} />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[495px] max-w-none gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b pr-14">
          <SheetTitle>Chats</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {conv.list.length === 0 ? (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">No chats yet</div>
          ) : (
            <ul className="space-y-1">
              {conv.list.map((c) => {
                const active = c.id === conv.activeId;
                return (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => select(c.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 pr-9 text-left transition-colors",
                        active
                          ? "border-primary/40 bg-primary/10"
                          : "border-transparent hover:bg-accent",
                      )}
                    >
                      {active ? (
                        <Check size={15} className="shrink-0 text-primary" />
                      ) : (
                        <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{c.title || "New chat"}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {relTime(c.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete chat: ${c.title || "New chat"}`}
                      onClick={() => conv.deleteChat(c.id)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Compact model picker for the composer. Reflects the localStorage-backed
// selection and writes it back. Disabled mid-turn so a switch can't land halfway
// through a reply.
// TODO(flue): per-turn model needs a server route (Phase 2). flue's client can't
// attach a per-message model, so this picker is currently a no-op — the agent
// runs on its single server-side default model regardless of the selection.
function ModelPicker({ disabled }) {
  const modelId = useAgentModel();
  // Only models whose provider key is actually configured on the flue worker
  // (Cloudflare models are always available; Claude only when a key is present).
  const models = useAvailableAgentModels();
  const active =
    models.find((m) => m.id === modelId) ??
    models.find((m) => m.id === DEFAULT_AGENT_MODEL) ??
    models[0] ??
    AGENT_MODELS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`Model: ${active.label}`}
        >
          <Cpu size={13} />
          <span className="font-medium">{active.label}</span>
          <ChevronDown size={13} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup value={active.id} onValueChange={setAgentModel}>
          {models.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id} className="flex-col items-start gap-0">
              <span className="text-sm font-medium">{m.label}</span>
              <span className="text-[11px] text-muted-foreground">{m.hint}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AgentChat() {
  // Shared session: the same instance the sound-studio Render buttons drive.
  const agent = useAgent();
  const conv = useConversations();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [atBottom, setAtBottom] = useState(true);
  // Voice message capture (mic button → Cloudflare Whisper → composer text).
  const rec = useVoiceRecording();
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Click-to-zoom lightbox for any image in the transcript — sent reference
  // thumbnails, `file` parts, and images the agent renders inline via markdown.
  // A delegated click handler on the scroll container (below) catches them all.
  const [lightbox, setLightbox] = useState(null); // { src, alt } | null
  const onTranscriptClick = (e) => {
    const img = e.target.closest?.("img");
    if (img && (img.currentSrc || img.getAttribute("src"))) {
      setLightbox({ src: img.currentSrc || img.src, alt: img.alt || "image" });
    }
  };
  // The reference images each user turn was sent with, so they re-render in the
  // bubble (flue's projection doesn't keep servable image bytes). Keyed by the
  // flue message id — NOT by ordinal — because plenty of user messages reach flue
  // outside this composer (e.g. "Let's create the world", render buttons across
  // tabs, script edits), and any of those would drift an ordinal alignment and
  // strand the thumbnail on the wrong bubble. We learn each id by matching the
  // sent text to the message flue echoes back (see the correlation effect).
  const [attByMsgId, setAttByMsgId] = useState({});
  const attByMsgIdRef = useRef(attByMsgId);
  attByMsgIdRef.current = attByMsgId;
  // Sent attachment batches awaiting the flue message that carries their text.
  const pendingAttsRef = useRef([]); // [{ text, atts }]

  // Auto-grow the composer with its content, up to a max height (then scroll).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  // On mount and whenever the active chat changes, re-seed the composer's
  // attachment record from that chat and clear any half-typed message. The
  // agent session itself is swapped in by AgentProvider (context), so messages
  // update on their own — this only resets client-only composer state.
  useEffect(() => {
    const { attachments: saved } = conv.getInitial(conv.activeId);
    // New shape: an object keyed by message id. Ignore the legacy ordinal array
    // (its alignment was unreliable) — thumbnails re-map from the transcript.
    const map = saved && !Array.isArray(saved) && typeof saved === "object" ? saved : {};
    setAttByMsgId(map);
    attByMsgIdRef.current = map;
    pendingAttsRef.current = [];
    setText("");
    setAttachments([]);
    setAtBottom(true);
    rec.cancel();
    setTranscribing(false);
    setVoiceError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.activeId]);

  const messages = agent.messages ?? [];

  // Correlate pending sent-attachment batches to the flue message that echoes
  // their text, then persist the id→atts map. Text is the join key because flue
  // returns no id from `send`, and matching on text is immune to ordinal drift
  // from out-of-composer sends. Runs whenever the transcript changes.
  useEffect(() => {
    if (!pendingAttsRef.current.length) return;
    const additions = {};
    for (const m of messages) {
      if (m.role !== "user" || attByMsgIdRef.current[m.id] || additions[m.id]) continue;
      const text = userMessageText(m);
      const idx = pendingAttsRef.current.findIndex((p) => p.text === text);
      if (idx >= 0) {
        additions[m.id] = pendingAttsRef.current[idx].atts;
        pendingAttsRef.current.splice(idx, 1);
      }
    }
    if (Object.keys(additions).length) {
      const next = { ...attByMsgIdRef.current, ...additions };
      attByMsgIdRef.current = next;
      setAttByMsgId(next);
      conv.saveAttachments(conv.activeId, next);
    }
  }, [messages, conv]);
  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  // On reload the flue conversation reloads its durable transcript, so `messages`
  // is briefly empty before history settles (`agent.historyReady`). Showing the
  // "Ask me to build the episode" empty state during that window and then popping
  // the history in is jarring — so while an EXISTING chat is still loading, show a
  // "loading your latest chat" spinner instead. A brand-new chat has no server
  // transcript to wait for (default title, never titled, no attachments), so we
  // skip the spinner for it and show the empty state right away.
  const activeChat = conv.list.find((c) => c.id === conv.activeId);
  const looksNew =
    !activeChat ||
    (activeChat.title === "New chat" && !activeChat.titled && !activeChat.attachments?.length);
  const loadingHistory = !agent.historyReady && messages.length === 0 && !looksNew;

  const thinking = useMemo(() => isThinking(messages, isBusy), [messages, isBusy]);
  const working = useMemo(() => workingTool(messages, isBusy), [messages, isBusy]);
  const reasoning = useMemo(() => isReasoning(messages, isBusy), [messages, isBusy]);
  // Interactive `ask_question` cards: which one is pending vs already answered.
  const qa = useMemo(() => deriveQA(messages), [messages]);

  const uploading = attachments.some((a) => a.state === "uploading");
  const doneAttachments = attachments.filter((a) => a.state === "done");
  // A draft = something to send (typed text or a finished attachment). Drives the
  // composer's trailing button: draft ⇒ Send, empty ⇒ mic (record), like mobile.
  const hasDraft = !!(text.trim() || doneAttachments.length > 0);
  const canSend = hasDraft && !isBusy && !uploading;

  // Stick to the bottom while new content streams — but only if the user is
  // already there, so scrolling up to read history isn't yanked back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [messages, agent.status, thinking, working, reasoning, attachments, atBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  async function uploadOne(file, id) {
    try {
      const resp = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Upload failed (${resp.status})`);
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, state: "done", url: data.url, size: data.size ?? a.size } : a,
        ),
      );
    } catch (e) {
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, state: "error", error: String(e.message || e) } : a)),
      );
    }
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const entries = files.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      contentType: f.type,
      // Retain the raw File so send can convert it to base64 for flue's
      // `images` (the R2 URL is only for the persisted thumbnail in the bubble).
      file: f,
      state: "uploading",
      url: null,
      previewUrl: URL.createObjectURL(f),
      error: null,
    }));
    setAttachments((prev) => [...prev, ...entries]);
    entries.forEach((e, i) => uploadOne(files[i], e.id));
  }

  // Items picked from the MediaPicker (asset gallery, Visual World generations,
  // or a fresh PC upload). Each becomes a "done" attachment: uploads already
  // carry the raw File + durable url; library/generation picks are fetched
  // in-app (same-origin, authenticated) so submit() can base64 their bytes for
  // flue, and reuse their ungated `refUrl` as the persisted bubble thumbnail.
  async function addPickedItems(items) {
    const entries = await Promise.all(
      (items || []).map(async (it) => {
        try {
          let file = it.file;
          if (!file) {
            const res = await fetch(it.url);
            if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
            const blob = await res.blob();
            file = new File([blob], it.name || "image", { type: blob.type || "image/png" });
          }
          return {
            id: crypto.randomUUID(),
            name: it.name || "image",
            size: file.size,
            contentType: file.type || "image/png",
            file,
            state: "done",
            url: it.refUrl || it.url,
            previewUrl: it.thumb || it.url,
            error: null,
          };
        } catch (e) {
          return {
            id: crypto.randomUUID(),
            name: it.name || "image",
            size: 0,
            contentType: "image/png",
            file: null,
            state: "error",
            url: null,
            previewUrl: it.thumb || it.url || null,
            error: String(e.message || e),
          };
        }
      }),
    );
    setAttachments((prev) => [...prev, ...entries]);
  }

  function removeAttachment(id) {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  const onPaste = (e) => {
    const imgs = Array.from(e.clipboardData?.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };

  const clearComposer = () => {
    setText("");
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    setAtBottom(true);
  };

  const startRecording = async () => {
    setVoiceError(null);
    try {
      await rec.start();
    } catch (e) {
      setVoiceError(e?.message || "Couldn't start recording.");
    }
  };

  // Discard the take without transcribing.
  const cancelRecording = () => {
    rec.cancel();
    setTranscribing(false);
  };

  // Stop, transcribe, and drop the text into the composer (appended when the
  // user already has a draft). Does NOT auto-send — the user still hits Send.
  const confirmRecording = async () => {
    setTranscribing(true);
    setVoiceError(null);
    try {
      const blob = await rec.stop();
      if (!blob || blob.size < 100) throw new Error("No audio captured — try again.");
      const { text: heard } = await transcribeAudio(blob);
      if (!heard) {
        setVoiceError("Didn't catch that — try again.");
        return;
      }
      setText((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard));
    } catch (e) {
      setVoiceError(e?.message || "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  };

  const submit = async () => {
    if (!canSend) return;
    const t = text.trim();
    // Capture the done attachments (with their retained `file`) before clearing.
    const done = doneAttachments;
    const sent = done.map((a) => ({
      url: a.url,
      name: a.name,
      contentType: a.contentType,
    }));

    // Build the message body first — it doubles as the join key that maps this
    // attachment batch to the flue message once it echoes back.
    //
    // The base64 images (below) only let a *vision* model SEE the attachment. To
    // let the agent USE it as a Higgsfield generation reference (media_import_url
    // → image_references) it needs the image's absolute HTTPS URL — so surface
    // each attachment's public url in the message text. PC uploads carry a
    // `/files/…` url; gallery / Visual-world picks carry their ungated `refUrl`
    // (both Higgsfield-fetchable). The whistlewood agent instructions describe
    // this trailing block. See docs: attach_visual_generation / visual-world skill.
    const refUrls = sent
      .map((a) => a.url)
      .filter(Boolean)
      .map((u) => (/^https?:\/\//.test(u) ? u : new URL(u, window.location.origin).href));
    const body = refUrls.length
      ? `${t ? `${t}\n\n` : ""}Attached reference image${refUrls.length > 1 ? "s" : ""} ` +
        `(absolute URL${refUrls.length > 1 ? "s" : ""}, usable directly as a Higgsfield ` +
        `generation reference via media_import_url):\n${refUrls.map((u) => `- ${u}`).join("\n")}`
      : t;

    // Remember this batch until the correlation effect sees the flue user message
    // carrying `body` and keys the thumbnails to its id (survives reload; immune
    // to ordinal drift from out-of-composer sends). Then clear the composer.
    if (sent.length) pendingAttsRef.current.push({ text: body, atts: sent });
    clearComposer();

    // flue takes images out-of-band as base64 `{ data, mimeType }`, not as
    // message parts — convert the retained Files and hand them alongside the text.
    let images;
    if (done.length) {
      images = await Promise.all(
        done.map(async (a) => ({
          type: "image",
          data: await fileToBase64(a.file),
          mimeType: a.contentType || "image/png",
        })),
      );
    }

    await agent.send({ message: body, images });
  };

  // Answer a pending `ask_question` card by clicking an option: send its label as
  // the next user message. (Attachments are keyed by message id now, so button
  // answers need no bookkeeping.)
  const onRespond = async (label) => {
    if (isBusy || !label) return;
    setAtBottom(true);
    await agent.send({ message: label });
  };

  // Answer a pending `ask_question` card with IMAGES: the card's upload option
  // ("I'll attach a reference image") opens a file picker, and the picked files
  // are sent immediately as a "here is the reference — continue" message. Same
  // pipeline as `submit`: R2 upload for the durable thumbnail + the absolute-URL
  // block (Higgsfield-fetchable via media_import_url), base64 `images` so the
  // model can see them.
  const onRespondFiles = async (files) => {
    const imgs = (files || []).filter((f) => f.type.startsWith("image/"));
    if (isBusy || !imgs.length) return;
    setAtBottom(true);
    const sent = [];
    const images = [];
    for (const f of imgs) {
      let url = null;
      try {
        const resp = await fetch(UPLOAD_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": f.type || "application/octet-stream",
            "x-filename": encodeURIComponent(f.name),
          },
          body: f,
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) url = data.url;
      } catch {
        // Thumbnail/URL upload failed — still send the base64 so the model sees it.
      }
      sent.push({ url, name: f.name, contentType: f.type || "image/png" });
      images.push({
        type: "image",
        data: await fileToBase64(f),
        mimeType: f.type || "image/png",
      });
    }
    const refUrls = sent
      .map((a) => a.url)
      .filter(Boolean)
      .map((u) => (/^https?:\/\//.test(u) ? u : new URL(u, window.location.origin).href));
    const plural = imgs.length > 1 ? "s" : "";
    const body = refUrls.length
      ? `Here is the reference image${plural} — use ${plural ? "them" : "it"} and continue.\n\n` +
        `Attached reference image${plural} (absolute URL${plural}, usable directly as a ` +
        `Higgsfield generation reference via media_import_url):\n` +
        refUrls.map((u) => `- ${u}`).join("\n")
      : `Here is the reference image${plural} — use ${plural ? "them" : "it"} and continue.`;
    const withUrl = sent.filter((a) => a.url);
    if (withUrl.length) pendingAttsRef.current.push({ text: body, atts: withUrl });
    await agent.send({ message: body, images });
  };

  return (
    <aside className="flex h-full w-[495px] shrink-0 flex-col border-l bg-card">
      <div className="relative min-h-0 flex-1">
        {/* New chat + previous-chats controls, floating over the top-right of the
            transcript, each in its own rounded wrapper so they read over the
            messages. */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-8 rounded-full border bg-card/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-foreground"
            aria-label="New chat"
            title="New chat"
            onClick={() => conv.newChat()}
          >
            <SquarePen size={16} />
          </Button>
          <ChatHistorySheet
            conv={conv}
            triggerClassName="rounded-full border bg-card/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-foreground"
          />
        </div>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onClick={onTranscriptClick}
          className="h-full space-y-4 overflow-y-auto bg-muted/30 px-4 pb-4 pt-14 dark:bg-[#0E0E10] [&_img]:cursor-zoom-in"
        >
          {loadingHistory ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Loader2 size={22} className="animate-spin" />
              <p className="text-sm">Loading up your latest chat…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Sparkles size={22} />
              <p className="text-sm">Ask me to build the episode.</p>
              <p className="max-w-[16rem] text-xs">
                e.g. “create a rain-ambience sound”, “stitch the complete cut”, or “assign the
                library images to bundles”. Attach a reference image with the paperclip.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <AgentMessage
                key={m.id}
                message={m}
                atts={m.role === "user" ? attByMsgId[m.id] : null}
                qa={qa}
                canRespond={!isBusy}
                onRespond={onRespond}
                onRespondFiles={onRespondFiles}
              />
            ))
          )}

          {thinking ? (
            <Marker>
              <MarkerIcon>
                <Loader2 className="animate-spin" />
              </MarkerIcon>
              <MarkerContent className="shimmer">Thinking…</MarkerContent>
            </Marker>
          ) : working ? (
            <Marker>
              <MarkerIcon>
                <Loader2 className="animate-spin" />
              </MarkerIcon>
              <MarkerContent className="shimmer">Agent is working…</MarkerContent>
            </Marker>
          ) : reasoning ? (
            <Marker>
              <MarkerIcon>
                <Loader2 className="animate-spin" />
              </MarkerIcon>
              <MarkerContent className="shimmer">Reasoning…</MarkerContent>
            </Marker>
          ) : null}

          {agent.error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-destructive" />
              <div className="min-w-0">
                <div className="font-medium">Agent error</div>
                <div className="break-words text-xs text-muted-foreground">
                  {agent.error.message}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {!atBottom && messages.length > 0 ? (
          <Button
            size="icon"
            variant="secondary"
            onClick={jumpToLatest}
            aria-label="Jump to latest"
            className="absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full border shadow-md"
          >
            <ArrowDown size={15} />
          </Button>
        ) : null}
      </div>

      <div className="shrink-0 border-t p-3">
        {attachments.length > 0 ? (
          <AttachmentGroup className="mb-2">
            {attachments.map((a) => (
              <Attachment key={a.id} state={a.state} size="sm">
                <AttachmentMedia variant="image">
                  {a.previewUrl || a.url ? (
                    <img src={a.previewUrl || a.url} alt={a.name} />
                  ) : (
                    <ImageIcon />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{a.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {a.state === "uploading"
                      ? "Uploading…"
                      : a.state === "error"
                        ? a.error || "Upload failed"
                        : prettySize(a.size)}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Remove ${a.name}`}
                    onClick={() => removeAttachment(a.id)}
                  >
                    <X size={14} />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}

        {voiceError ? (
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle size={13} />
            {voiceError}
          </p>
        ) : null}

        {rec.recording || transcribing ? (
          <div className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5">
            <Button
              size="icon"
              variant="ghost"
              onClick={cancelRecording}
              disabled={transcribing}
              aria-label="Cancel recording"
              title="Cancel"
            >
              <X size={16} />
            </Button>
            <div className="flex flex-1 items-center gap-2 text-sm">
              {transcribing ? (
                <Loader2 size={14} className="animate-spin text-muted-foreground" />
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
              onClick={confirmRecording}
              disabled={transcribing}
              aria-label="Stop and transcribe"
              title="Stop and transcribe"
            >
              {transcribing ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setPickerOpen(true)}
              aria-label="Attach image"
              title="Attach a reference — gallery, Visual world, or your computer"
            >
              <Paperclip size={16} />
            </Button>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Message the studio agent…"
              className="max-h-[180px] min-h-[38px] flex-1 resize-none overflow-y-auto rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {/* Trailing action mirrors the mobile composer: while the agent is
                working it's a Stop button; with a draft (text or attachments) it's
                Send; and when empty it's the mic — start recording a voice message. */}
            {isBusy ? (
              <Button size="icon" variant="secondary" onClick={agent.stop} aria-label="Stop">
                <Square size={15} />
              </Button>
            ) : hasDraft ? (
              <Button
                size="icon"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send"
                title={uploading ? "Waiting for upload…" : "Send"}
              >
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                onClick={startRecording}
                aria-label="Record voice message"
                title="Record voice message"
              >
                <Mic size={16} />
              </Button>
            )}
          </div>
        )}

        <div className="mt-1.5 flex items-center">
          <ModelPicker disabled={isBusy} />
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onAdd={addPickedItems}
        title="Attach reference images"
      />

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent
          showCloseButton
          className="w-fit max-w-[92vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[92vw]"
        >
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {lightbox ? (
            <img
              src={lightbox.src}
              alt={lightbox.alt}
              className="max-h-[86vh] max-w-[92vw] rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
