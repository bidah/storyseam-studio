import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent, useConversations } from "@/components/AgentProvider";
import {
  Send,
  Square,
  Wrench,
  AlertCircle,
  FileText,
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
  Images,
  Upload,
  Globe,
  ExternalLink,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import { buildSuggestions, FALLBACK_SUGGESTIONS } from "@/lib/suggestions";
import { cardArtPath, meshPalette, meshSeed, meshShape } from "@/lib/card-art";
import { startSuggestion, sweepSuggestions } from "@/lib/suggestionProgress";
import { Eyebrow } from "@/components/shared";
import { useShell } from "@/lib/shellContext";
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
  DropdownMenuItem,
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
import { StudioUI, isReferenceUpload } from "@/genui/StudioUI";
import { detectOptions } from "@/genui/detect-options";
import PromptEditor from "@/components/mention/PromptEditor";
import { refTagLabel, splitRefTags } from "@/lib/refTags";
import {
  ATTACH_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  buildDocumentBlock,
  classifyFile,
  extractDocument,
  uploadAttachment,
} from "@/lib/attachments";

// ---------------------------------------------------------------------------
// Chat rendering walks every part of every flue message in order and renders
// each by `type` (`text`, `reasoning`, `dynamic-tool`, `file`), instead of
// scanning only the last message.
//
// Interactive questions: flue has no BLOCKING HITL (a tool can't suspend a turn),
// so the `render_ui` tool is a non-blocking recreation — its `dynamic-tool` part
// carries an openui-lang program that renders through the shared component
// contract (src/genui/) as an interactive card: option rows, thumbnail grids,
// recommendations, confirmations. Because there is no server-side
// `inputResponse`, the answer is just the next ordinary user message: tapping a
// component sends its `send` string, and a typed reply works the same way. No
// `inputResponses` resume path. `deriveQA` decides which card is still live.
//
// `ask_question` was the predecessor and still appears in older transcripts, so
// `QuestionCard` stays for those — new turns only ever produce `render_ui`.
//
// Attachments: everything the user attaches — dropped on the composer, pasted
// with Cmd/Ctrl+V, picked from the gallery, or chosen from disk — is uploaded to
// Cloudflare R2 (POST /api/upload) for a durable URL. From there the two kinds
// diverge (see src/lib/attachments.js):
//
//   image — sent to flue as base64 `images` (its `sendMessage` takes
//           `{ images: [{ data, mimeType }] }`) so the model can actually SEE
//           it, plus its absolute URL in the text so the agent can re-import it
//           as a generation reference.
//   doc   — a PDF / .txt / .md / .docx …, extracted to text by POST /api/extract
//           and inlined into the message body, so the agent ingests the document
//           with the turn. Long documents are inlined up to a budget and the
//           agent reads the remainder with its `read_document` tool.
//
// flue's `file` parts don't serve historical bytes, so we remember what each
// user turn was sent with (in `attByMsgId`, keyed by the flue message id) and
// render the thumbnails back into that turn's bubble from the R2 URL. Clicking
// any transcript image opens a full-size lightbox.
// ---------------------------------------------------------------------------

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

// --- Smooth streaming -------------------------------------------------------
// Agent text does NOT reach the browser token by token. `@flue/runtime` writes
// every assistant text delta through a batched canonical-record writer whose
// pending batch flushes on a 1s timer (`CANONICAL_FLUSH_DELAY_MS`), and a delta
// is only published to the client once its batch is durably appended. So the UI
// receives roughly one second's worth of generated text — 250-300 characters,
// often a whole paragraph and the start of the next — in a SINGLE React commit.
// Streamdown then starts its per-word fadeIn on every one of those words at the
// same instant, which is why two paragraphs look like they stream side by side
// instead of one following the other. (Measured on both the local and deployed
// workers; a fast model can land an entire six-paragraph answer in one commit.)
//
// The transport isn't ours to re-pace, so smooth it at the render edge: hold the
// text that has arrived and reveal it forward at a steady rate, one word at a
// time. Bursts become a continuous type-out in document order, and Streamdown
// animates each word as it appears. Reveal never runs ahead of what arrived, and
// the moment the part stops streaming we snap to the full text so nothing can be
// left hidden behind the buffer.
const REVEAL_WINDOW_MS = 900; // drain whatever is buffered over ~one flush interval
const REVEAL_MIN_CPS = 45; // never crawl on a thin trickle
const REVEAL_MAX_CPS = 1200; // never dump a huge backlog in one frame
// A part that MOUNTS already long was joined mid-flight (reload, or reopening a
// chat whose turn is still running) — that text is history, not new output, so
// show it as-is rather than re-typing it. A genuine stream start mounts tiny (a
// few characters), well under this, so it still animates.
const REVEAL_JOIN_CHARS = 400;

// Extend `to` to the end of the word it landed inside, so a partially revealed
// word never renders (and markdown syntax like `**bold**` is never split
// mid-token). Always advances past `to`, so progress can't stall.
function wordEnd(s, to, target) {
  if (to >= target) return target;
  let i = to;
  while (i < target && !/\s/.test(s[i])) i += 1;
  return i;
}

function useSmoothText(text, streaming) {
  const full = text ?? "";
  const [count, setCount] = useState(
    streaming && full.length <= REVEAL_JOIN_CHARS ? 0 : full.length,
  );
  // Refs are only ever touched from effects/callbacks, never mutated during
  // render — the mobile port runs under React Compiler and the two must stay
  // structurally identical (mobile-app/src/components/chat/use-smooth-text.ts).
  const fullRef = useRef(full);
  const countRef = useRef(count);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  // Publish the latest arrived text to the rAF loop. Settled parts (history, or
  // the turn just ended) skip the buffer entirely and show everything at once.
  useEffect(() => {
    fullRef.current = full;
    if (!streaming) {
      lastRef.current = 0;
      countRef.current = full.length;
      setCount(full.length);
    }
  }, [full, streaming]);

  useEffect(() => {
    if (!streaming) return undefined;
    const step = (now) => {
      rafRef.current = requestAnimationFrame(step);
      const target = fullRef.current.length;
      const pending = target - countRef.current;
      if (pending <= 0) {
        lastRef.current = now;
        return;
      }
      // Clamp dt so a dropped frame (or a tab that just came back) doesn't
      // teleport the reveal to the end.
      const dt = lastRef.current ? Math.min(now - lastRef.current, 100) : 16;
      lastRef.current = now;
      const cps = Math.min(Math.max((pending / REVEAL_WINDOW_MS) * 1000, REVEAL_MIN_CPS), REVEAL_MAX_CPS);
      const stride = Math.max(1, Math.round((cps * dt) / 1000));
      const next = wordEnd(fullRef.current, Math.min(target, countRef.current + stride), target);
      if (next === countRef.current) return;
      countRef.current = next;
      setCount(next);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      lastRef.current = 0;
    };
  }, [streaming]);

  // rAF is frozen in a background tab. Catch up on both edges: going hidden so
  // nothing is stranded behind the buffer, and coming back so a whole minute of
  // buffered output doesn't replay as a type-out the user already waited for.
  // Deliberately does NOT stop the loop — killing it here would freeze a
  // still-streaming part at whatever had arrived.
  useEffect(() => {
    const catchUp = () => {
      lastRef.current = 0;
      countRef.current = fullRef.current.length;
      setCount(countRef.current);
    };
    document.addEventListener("visibilitychange", catchUp);
    return () => document.removeEventListener("visibilitychange", catchUp);
  }, []);

  return count >= full.length ? full : full.slice(0, count);
}

// A streaming `text` part, revealed at a steady rate rather than in transport
// bursts. Split out so the reveal state lives on a component keyed to that part.
function StreamedText({ text, streaming }) {
  const shown = useSmoothText(text, streaming);
  return <Markdown text={shown} animating={streaming} />;
}

function prettySize(n) {
  if (typeof n !== "number") return "";
  const kb = n / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

// A compact chip for a flue `dynamic-tool` part. `state` is one of
// input-available / output-available / output-error; the input is surfaced as a
// hover title and an error surfaces its `errorText` inline.
//
// `tail` is whether the part's message is the transcript's LAST message. flue
// only ever runs tools at the transcript tail, so an unfinished part (no output,
// no error) on any EARLIER message is provably dead — the turn moved past it
// without a result (e.g. the model's tool-call JSON got truncated at the output
// cap and the run failed). Rendering that as still-pending is a lie that reads
// as "saving…" forever; call it interrupted and say how to recover.
function ToolChip({ part, tail }) {
  const name = part.toolName || "tool";
  const errored = part.state === "output-error";
  const finished = part.state === "output-available";
  const interrupted = !tail && !errored && !finished;
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
        {errored ? " · failed" : interrupted ? " · interrupted" : null}
      </span>
      {errored && part.errorText ? (
        <span className="max-w-full break-words text-[11px] text-destructive">{part.errorText}</span>
      ) : interrupted ? (
        <span className="max-w-full text-[11px] text-muted-foreground">
          The turn ended before this tool finished — nothing was saved. Ask again to retry.
        </span>
      ) : null}
    </span>
  );
}

// The two web tools (`web_search` / `fetch_url`) share one result shape across
// both backends — see flue-agent/src/lib/search-util.ts's `result()`:
//   { provider, query?, count, results: [{ title, url, publishedDate, author,
//     excerpts?, summary?, text? }] }
const SOURCE_TOOLS = new Set(["web_search", "fetch_url"]);

// Pull that payload off a finished tool part. The output arrives as the raw
// object in the normal case, but tolerate a JSON string and the
// `{ content: [{ type: "text", text }] }` envelope so a transport change
// degrades to the plain ToolChip instead of throwing mid-render.
function parseSourcesOutput(part) {
  if (part.state !== "output-available") return null;
  const candidates = [];
  const out = part.output;
  if (out && typeof out === "object" && !Array.isArray(out)) {
    candidates.push(out);
    if (Array.isArray(out.content)) {
      for (const c of out.content) if (typeof c?.text === "string") candidates.push(c.text);
    }
  } else if (typeof out === "string") {
    candidates.push(out);
  }
  for (const c of candidates) {
    let obj = c;
    if (typeof obj === "string") {
      try {
        obj = JSON.parse(obj);
      } catch {
        continue;
      }
    }
    const results = obj?.results;
    if (!Array.isArray(results)) continue;
    const sources = results
      .filter((r) => typeof r?.url === "string" && r.url)
      .map((r) => ({
        url: r.url,
        title: typeof r.title === "string" && r.title ? r.title : r.url,
        publishedDate: typeof r.publishedDate === "string" ? r.publishedDate : null,
        snippet:
          (Array.isArray(r.excerpts) && typeof r.excerpts[0] === "string" && r.excerpts[0]) ||
          (typeof r.summary === "string" && r.summary) ||
          "",
      }));
    if (sources.length) {
      return { sources, query: typeof obj.query === "string" ? obj.query : "" };
    }
  }
  return null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// A `web_search` / `fetch_url` result, rendered as a collapsed "Sources · N"
// card that expands into one sub-card per reference. Each sub-card is a real
// link, so it opens in a new tab (and middle-click / cmd-click work) rather than
// being a div with an onClick.
function SourcesCard({ data }) {
  const [open, setOpen] = useState(false);
  const { sources, query } = data;
  return (
    <div className="w-fit max-w-full overflow-hidden rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/60"
      >
        <Globe size={12} className="text-primary" />
        <span className="font-medium text-foreground">Sources</span>
        <span>· {sources.length}</span>
        {query ? <span className="truncate italic">“{query}”</span> : null}
        <ChevronDown
          size={12}
          className={cn("ml-1 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="space-y-1.5 border-t p-1.5">
          {sources.map((s, i) => (
            <a
              key={`${s.url}:${i}`}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border bg-background/60 p-2 hover:border-primary/40 hover:bg-background"
            >
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.title}</span>
                <ExternalLink size={11} className="shrink-0 text-muted-foreground" />
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="truncate">{hostOf(s.url)}</span>
                {s.publishedDate ? (
                  <span className="shrink-0">· {s.publishedDate.slice(0, 10)}</span>
                ) : null}
              </span>
              {s.snippet ? (
                <span className="mt-1 line-clamp-2 block text-[11px] text-muted-foreground">
                  {s.snippet}
                </span>
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
    </div>
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
// "I'll attach a reference image" choice) is rendered as a PICK button: it opens
// the app's standard MediaPicker modal (asset gallery, Visual World generations,
// or a PC upload) and the picked images are auto-sent as a "here is the
// reference — continue" reply (see `respondWithPicked` in the chat component).
function isUploadOption(opt) {
  if (opt?.id === "upload") return true;
  return /\b(upload|attach)\b/i.test(opt?.label || "") && /\b(image|reference|ref)\b/i.test(opt?.label || "");
}

function QuestionCard({ part, pending, answer, canRespond, onRespond, onRequestReference }) {
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
                onClick={() => onRequestReference?.()}
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

function MessagePart({ part, qa, canRespond, onRespond, onRequestReference, offerOptions, tail }) {
  switch (part.type) {
    case "text": {
      if (!part.text) return null;
      const streaming = part.state === "streaming";
      // Models keep writing choices as "A) … B) …" prose however firmly the
      // generative-ui skill says to draw them. `offerOptions` is set only on the
      // last assistant message of a settled turn that produced no card of its
      // own, so a rescued list is answerable exactly when a real one would be —
      // and older messages keep their plain markdown.
      const rescued = !streaming && offerOptions ? detectOptions(part.text) : null;
      if (!rescued) return <StreamedText text={part.text} streaming={streaming} />;
      return (
        <>
          {rescued.body ? <StreamedText text={rescued.body} /> : null}
          <StudioUI lang={rescued.program} answerable={canRespond} onRespond={onRespond} />
        </>
      );
    }
    case "reasoning":
      return part.text ? (
        <details className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Reasoning</summary>
          <div className="mt-1 whitespace-pre-wrap break-words">{part.text}</div>
        </details>
      ) : null;
    case "dynamic-tool": {
      // A question card redrawn later in the same turn is a discarded draft of
      // the same ask — only the turn's last card renders. See deriveQA.
      if (QUESTION_TOOLS.has(part.toolName) && qa?.superseded?.has(part.toolCallId)) return null;
      if (part.toolName === "render_ui") {
        const pending = qa?.pendingId === part.toolCallId;
        return (
          <StudioUI
            lang={part.input?.lang}
            answerable={pending && canRespond}
            // What the author replied, so the card can show WHICH option they
            // took rather than just going inert. See genui/answered.ts.
            answer={qa?.answered.get(part.toolCallId)}
            onRespond={(message) =>
              // The reference-upload choice opens the MediaPicker rather than
              // posting its text; everything else is an ordinary reply.
              isReferenceUpload(message) ? onRequestReference?.() : onRespond?.(message)
            }
          />
        );
      }
      if (part.toolName === "ask_question") {
        return (
          <QuestionCard
            part={part}
            pending={qa?.pendingId === part.toolCallId}
            answer={qa?.answered.get(part.toolCallId)}
            canRespond={canRespond}
            onRespond={onRespond}
            onRequestReference={onRequestReference}
          />
        );
      }
      // A finished web search shows its references instead of a bare chip; an
      // in-flight or failed one still falls through to ToolChip.
      if (SOURCE_TOOLS.has(part.toolName)) {
        const sources = parseSourcesOutput(part);
        if (sources) return <SourcesCard data={sources} />;
      }
      return <ToolChip part={part} tail={tail} />;
    }
    case "file":
      return <FilePart part={part} />;
    default:
      return null;
  }
}

// The tools whose parts render as an answerable card. `render_ui` is the live
// one; `ask_question` only ever turns up replaying an older conversation.
const QUESTION_TOOLS = new Set(["render_ui", "ask_question"]);

// A card ENDS the turn, visually. The agent is told so in three places — the
// `render_ui` description, the generative-ui skill, and whistlewood.md's "then
// STOP" — and still trails a reasoning block and a paragraph narrating the card
// it just drew ("I've presented the three options — tap one…"). flue exposes no
// way to stop the loop from inside a tool (`AgentRuntimeConfig` has no step hook
// and a tool's `run` can't end the turn), so the last word belongs to whoever
// renders it: everything the model says AFTER the card is dropped here.
//
// Only prose goes — `text` and `reasoning`. A tool part landing after a card
// stays visible, because hiding real work the agent did would be a lie, not a
// tidy-up. Twin of `visibleParts` in mobile-app/src/components/chat/helpers.ts.
//
// `sealed` extends that across the MESSAGE boundary. A turn is not one message:
// flue opens a new assistant message per step (`message-started`), so the
// paragraph narrating the card usually lands in the NEXT message and a
// per-message filter never sees it — which is why the trailing "The card is up
// — tap whichever arc you want" survived the first fix. `deriveQA` marks every
// assistant message that follows a card (until the user speaks again), and
// those drop their prose whole.
function visibleParts(parts, sealed = false) {
  const list = parts || [];
  let card = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].type === "dynamic-tool" && QUESTION_TOOLS.has(list[i].toolName)) card = i;
  }
  if (sealed) return list.filter((p) => !isNarration(p));
  if (card < 0) return list;
  return list.filter((p, i) => i <= card || !isNarration(p));
}

// Prose the card made redundant. A text part carrying a markdown IMAGE is not
// narration whatever else it says — that's a picture the agent generated, and
// dropping it would lose real output, the same way dropping a tool part would.
function isNarration(p) {
  if (p.type === "reasoning") return true;
  return p.type === "text" && !(p.text || "").includes("![");
}

// Resolve the answer state of every question card in the thread. flue has
// no `inputResponse` channel, so "answered" is derived from the transcript: a
// question is answered by the first user message after it (its text is the
// answer); the one unanswered question — the last with no user message following
// — is `pendingId` (the only card whose buttons stay live).
//
// It also collects `sealed`: the ids of the assistant messages drawn AFTER a
// card and before the user's reply. A card is the last word of the turn, and
// the model keeps writing past it into a fresh message — see `visibleParts`.
//
// And `superseded`: cards REPLACED by a later card in the same turn. The model
// sometimes redraws the same question (a card, more reasoning, then a refined
// duplicate of that card in its next step) — two identical asks on screen. The
// LAST card of a turn is the ask; every earlier card with no user message
// between it and the next card is a discarded draft, dropped from rendering.
function deriveQA(messages) {
  const answered = new Map();
  const sealed = new Set();
  const superseded = new Set();
  let pendingId = null;
  let afterCard = false;
  let lastCardId = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      afterCard = false;
      lastCardId = null;
      continue;
    }
    if (m.role !== "assistant") continue;
    if (afterCard && m.id) sealed.add(m.id);
    for (const p of m.parts || []) {
      if (p.type !== "dynamic-tool" || !QUESTION_TOOLS.has(p.toolName)) continue;
      if (lastCardId) superseded.add(lastCardId);
      lastCardId = p.toolCallId;
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
      afterCard = true;
    }
  }
  return { answered, pendingId, sealed, superseded };
}

// The concatenated text of a (user) message's text parts — the join key that
// maps a sent attachment batch to the flue message echoing it back.
function userMessageText(message) {
  return (message.parts || [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// What a user turn was sent with, rendered back into the bubble (flue's
// projection doesn't keep servable image parts, so `atts` is supplied by the
// composer's id-keyed record). Images get a thumbnail; documents get a named
// chip — there's nothing to look at, but the turn should still show what it
// carried.
function SentAttachments({ atts }) {
  if (!atts?.length) return null;
  return (
    <AttachmentGroup className="mt-1.5 max-w-[92%] justify-end">
      {atts.map((a, i) =>
        a.kind === "doc" ? (
          <Attachment key={i} size="sm" className="min-w-0 max-w-52">
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{a.name || "document"}</AttachmentTitle>
              {a.chars ? (
                <AttachmentDescription>
                  {a.chars.toLocaleString()} chars
                </AttachmentDescription>
              ) : null}
            </AttachmentContent>
          </Attachment>
        ) : (
          <Attachment key={i} size="sm" orientation="vertical" className="w-20">
            <AttachmentMedia variant="image">
              <img src={a.url} alt={a.name || "attachment"} />
            </AttachmentMedia>
          </Attachment>
        ),
      )}
    </AttachmentGroup>
  );
}

// The typed text of a user bubble, with "@imageN" tags rendered as inline
// chips (tiny thumbnail + label) when the message's attachment record carries
// matching labels. Unmatched tags stay plain text.
function UserText({ text, atts }) {
  const byLabel = new Map((atts || []).filter((a) => a.label).map((a) => [a.label, a]));
  if (!byLabel.size) return text;
  return splitRefTags(text).map((p, i) =>
    p.type === "tag" && byLabel.has(p.label) ? (
      <span
        key={i}
        className="mx-0.5 inline-flex items-center gap-1 rounded border border-primary/35 bg-primary/10 px-1 py-px align-[-3px] text-[0.85em] font-medium text-primary"
      >
        {byLabel.get(p.label).url ? (
          <img
            src={byLabel.get(p.label).url}
            alt={p.label}
            className="size-3.5 rounded-[3px] object-cover"
          />
        ) : null}
        @{p.label}
      </span>
    ) : (
      <span key={i}>{p.type === "tag" ? `@${p.label}` : p.text}</span>
    ),
  );
}

function AgentMessage({
  message,
  attEntry,
  qa,
  canRespond,
  onRespond,
  onRequestReference,
  isLast,
  tail,
}) {
  const isUser = message.role === "user";
  if (isUser) {
    // Legacy entries are a plain atts array; newer ones are { atts, displayText }
    // where displayText is what the user actually typed (tags intact, without
    // the appended reference-URL block sent to the agent).
    const atts = Array.isArray(attEntry) ? attEntry : attEntry?.atts;
    const displayText = Array.isArray(attEntry) ? null : (attEntry?.displayText ?? null);
    const text = displayText ?? userMessageText(message);
    return (
      <div className="flex flex-col items-end">
        {text ? (
          <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-2 text-sm text-foreground">
            <UserText text={text} atts={atts} />
          </div>
        ) : null}
        <SentAttachments atts={atts} />
      </div>
    );
  }
  // A prose choice list is only worth rescuing on the newest assistant turn,
  // and only when the agent didn't already draw a card — otherwise the message
  // would carry two competing sets of buttons.
  const drewCard = (message.parts || []).some(
    (p) => p.type === "dynamic-tool" && QUESTION_TOOLS.has(p.toolName),
  );
  // Anything the model wrote AFTER its card is dropped — the card is the last
  // word of the turn — including a whole message written past it, which is the
  // usual shape (one flue message per step). See visibleParts. A message that
  // was nothing BUT that trailing prose renders nothing, not an empty gap.
  const parts = visibleParts(message.parts, !!message.id && qa?.sealed?.has(message.id));
  if (!parts.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, i) => (
        <MessagePart
          key={part.toolCallId ?? `${part.type}:${i}`}
          part={part}
          qa={qa}
          canRespond={canRespond}
          onRespond={onRespond}
          onRequestReference={onRequestReference}
          offerOptions={isLast && !drewCard}
          tail={tail}
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
  // Stale-while-revalidate: the cached list renders instantly; opening the
  // sheet re-pulls the server registry so chats started on another device
  // (the phone, another browser) fold in as the fetch lands.
  useEffect(() => {
    if (open) conv.refreshChats();
  }, [open, conv]);
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

/* ------------------------------------------------------------------------ *
 * The landing screen of an empty chat: Recaps + Continue building your story *
 * ------------------------------------------------------------------------ */

// CARD_H is fixed rather than content-sized, and the text block is pushed to the
// bottom edge, so every card in the grid is the same rectangle no matter whether
// its title runs to one line or two. It's the worst case of both clamps (a
// two-line title over a two-line subtitle) plus the icon tile, so nothing clips.
const CARD_H = "h-[8.25rem]";

/* --- The suggestion poster ------------------------------------------------ *
 *
 * The suggestion deck used to be a wrapped 2×2 of small icon tiles here while
 * the phone showed posters — same cards, same composed prompts, two entirely
 * different objects. They're one object now: a picture slot with a looping
 * video in it, a headline under that, and the paragraph the phone shows. The
 * artwork map is shared (src/lib/card-art.ts, vendored to the app), so a card
 * wears the same loop on both surfaces and a card with no loop falls back to
 * the same seeded band.
 *
 * A SNAPPING ROW, not a grid — also matching the phone. That looks like the
 * wrong instinct for a mouse, and the reason it isn't is the poster itself:
 * at 240px a card can hold real art and four lines of copy, and three of those
 * across a 416px column is not a layout. The row rests with a card's left edge
 * exactly at the column's margin (scroll-snap-align: start on every card), so a
 * flick can't stop halfway through one; the last card gets scroll-padding so it
 * can reach the same margin instead of jamming against the right edge.
 */

// Card geometry. The band is 16:9 of the width, and the height is the band plus
// the text budget — a two-line headline over four lines of paragraph plus the
// padding — so the copy is never what gets squeezed when the art grows.
const POSTER_W = 240;
const POSTER_BAND = 135;
const POSTER_H = 272;
const POSTER_GAP = 10;

// The seeded band under the artwork: nine colours (meshPalette) laid out as a
// stack of radial gradients. The phone renders the same nine as a real 3×3 mesh
// with expo-mesh-gradient; CSS has no mesh, and overlapping soft radials at the
// same nine vertex positions is what gets closest — the colours bleed into each
// other rather than banding, which is the whole point of the treatment.
function meshBackground(seed) {
  const palette = meshPalette(seed);
  const points = meshShape(seed);
  const stops = points
    .map(([x, y], i) => {
      const c = palette[i % palette.length];
      // Generous radius so neighbouring vertices overlap heavily; without the
      // overlap this reads as nine dots, not a gradient.
      return `radial-gradient(circle at ${(x * 100).toFixed(0)}% ${(y * 100).toFixed(0)}%, ${c} 0%, transparent 62%)`;
    })
    .reverse()
    .join(", ");
  // The flat base is what shows through where the radials have faded out, so a
  // corner is never the page's background peeking through the picture slot.
  return { backgroundImage: stops, backgroundColor: palette[4] };
}

// The looping artwork, over the band. DECORATION, so it behaves like it: muted,
// looping, no controls, and `pointer-events-none` so a click on the picture is
// a click on the card — the whole card is one button and the video must not eat
// the press.
//
// Playback is gated on VISIBILITY rather than left running: the deck runs to
// six or seven cards and most have art, and the row shows two at a time, so
// autoplaying the lot means decoding five videos nobody has scrolled to yet.
// The band stays painted underneath rather than being swapped out, so the slot
// is the card's colour from the first frame; the loop fades up over it when the
// pixels arrive, and a card whose file 404s simply keeps the band it had.
function PosterArt({ src }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (old browser, jsdom in a test): just play. The
    // fallback must be a working card, not a blank slot.
    if (typeof IntersectionObserver === "undefined") {
      el.play?.().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play?.().catch(() => {});
        else el.pause?.();
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      // `preload="metadata"` rather than auto: the observer starts playback
      // (which fetches the rest) only for a card actually on screen.
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      onCanPlay={() => setReady(true)}
      className={cn(
        "pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-500",
        ready ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

// One poster. `done` renders the finished state: the artwork stays at full
// strength under a dark scrim with a Completed badge, and the button is
// genuinely disabled rather than merely styled that way.
function LandingPoster({ suggestion: s, onClick }) {
  const seed = meshSeed(s.id);
  const art = cardArtPath(s.id);
  const done = !!s.done;
  return (
    <button
      type="button"
      onClick={done ? undefined : onClick}
      disabled={done}
      aria-label={done ? `${s.title} — completed` : s.subtitle ? `${s.title} — ${s.subtitle}` : s.title}
      style={{ width: POSTER_W, height: POSTER_H }}
      className={cn(
        "group relative flex shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-colors",
        done
          ? "cursor-default"
          : "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div
        className="relative shrink-0 overflow-hidden"
        style={{ height: POSTER_BAND, ...meshBackground(seed) }}
      >
        {art ? <PosterArt src={art} /> : null}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <span className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug text-foreground">
          {s.title}
        </span>
        <span className="mt-1.5 line-clamp-4 text-xs leading-[1.35rem] text-muted-foreground">
          {s.blurb || s.subtitle}
        </span>
      </div>

      {/* FINISHED. Over the whole card, artwork and text alike, so it reads as
          one settled object rather than a live picture with a dead caption. It
          keeps its picture at full strength underneath — that's what makes it
          recognisable as the thing you did, where a greyed-out rectangle would
          not be. */}
      {done ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[0.8125rem] font-semibold text-white">
            {/* Its own colours, not the theme's: this sits on a black wash in
                both light and dark mode, so a token that flips with the theme
                would vanish in one of them. */}
            <Check size={12} strokeWidth={3} />
            Completed
          </span>
        </span>
      ) : null}
    </button>
  );
}

// The row the posters sit in. `scroll-padding-inline` is what lets the LAST
// card snap to the same left margin as the first instead of stopping short.
function PosterRow({ children }) {
  return (
    <div
      className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ scrollPaddingInline: "0.25rem", gap: POSTER_GAP }}
    >
      {children}
    </div>
  );
}

function PosterSkeleton() {
  return (
    <PosterRow>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{ width: POSTER_W, height: POSTER_H }}
          className="flex shrink-0 animate-pulse flex-col overflow-hidden rounded-xl border bg-card"
        >
          <div className="shrink-0 bg-muted" style={{ height: POSTER_BAND }} />
          {/* Two bars for the headline, three for the paragraph — the real
              card's proportions, so nothing shifts when the deck lands. */}
          <div className="flex flex-1 flex-col p-3">
            <div className="h-4 w-4/5 rounded bg-muted" />
            <div className="mt-1.5 h-4 w-1/2 rounded bg-muted" />
            <div className="mt-3 h-3 w-full rounded bg-muted" />
            <div className="mt-2 h-3 w-11/12 rounded bg-muted" />
            <div className="mt-2 h-3 w-2/3 rounded bg-muted" />
          </div>
        </div>
      ))}
    </PosterRow>
  );
}

function LandingCard({ icon: Icon, eyebrow, title, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        CARD_H,
        "group flex flex-col items-start rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        <Icon size={15} />
      </span>
      <span className="mt-auto line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {title}
      </span>
      {eyebrow ? (
        <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {eyebrow}
        </span>
      ) : null}
    </button>
  );
}

function LandingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(CARD_H, "flex animate-pulse flex-col rounded-xl border bg-card p-3")}
        >
          <div className="size-7 rounded-lg bg-muted" />
          <div className="mt-auto h-3.5 w-4/5 rounded bg-muted" />
          <div className="mt-1.5 h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// A landing section: an eyebrow heading over a wrapped two-up grid. Recaps only
// now — the suggestion deck outgrew this and moved to PosterRow above. Two
// small tiles side by side is still right here: a recap is a chat title and a
// timestamp, and there is no artwork for "the conversation you had on Tuesday".
function LandingSection({ title, loading, children }) {
  return (
    <section className="space-y-2">
      <Eyebrow>{title}</Eyebrow>
      {loading ? (
        <LandingSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-2">{children}</div>
      )}
    </section>
  );
}

// "12m ago", but "just now" for the last minute — relTime's own answer there is
// "now", and "now ago" reads like a typo.
function recapWhen(ts) {
  const t = relTime(ts);
  if (!t) return null;
  return t === "now" ? "just now" : `${t} ago`;
}

// The empty chat. Two sections, centered in the transcript: Recaps (the chats you
// already have — click one to pick it back up) and Continue building your story
// (the derived deck). `reloadKey` re-reads the digest, so finishing a stage in
// another tab retires its card here without a manual refresh.
//
// The block centers when it fits and scrolls when it doesn't (min-h-full + auto
// margins), so a day-one project gets a calm centered pair of cards and a
// mid-pipeline one just grows downward instead of being clipped.
function ChatLanding({ conv, onSuggest, reloadKey }) {
  // undefined = still reading, null = we couldn't read it. Those are different
  // decks: unknown state must NOT render the day-one "build your story world"
  // card at someone whose episode is finished.
  const [status, setStatus] = useState(undefined);

  // Writes stop at UNMOUNT — not on every re-run of the effect below. The
  // difference matters: `reloadKey` bumps once within a second of mount (the
  // shell's readiness ping), so the usual per-effect `let alive` flag would
  // invalidate the very first request every time, and if the replacement request
  // then hung, a response we already had in hand was thrown away and the skeleton
  // never resolved. That was a permanent-loading bug on every page load.
  // Re-armed on mount, not just initialized: StrictMode double-invokes effects in
  // dev (mount → cleanup → mount on the SAME instance, so the same refs), and a
  // flag that's only ever cleared stays cleared through that second mount —
  // discarding every response for the life of the screen.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Instead of cancelling, order the responses: apply any outcome that isn't
  // older than the one already showing. A slow refetch can then never un-render
  // the deck, and whichever request answers first wins until a newer one does.
  const seqRef = useRef(0);
  const appliedRef = useRef(0);

  useEffect(() => {
    const seq = (seqRef.current += 1);
    const apply = (value) => {
      if (!mountedRef.current || seq < appliedRef.current) return;
      appliedRef.current = seq;
      setStatus(value);
    };
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(apply)
      // null (not undefined) ends the loading state: we tried and couldn't tell,
      // which renders the stage-agnostic fallback deck rather than skeletons.
      .catch(() => apply(null));
  }, [reloadKey]);

  // Five live cards. The row scrolls, so this isn't the "what fits" number the
  // old 2×2 grid needed — it's how far into the pipeline it's worth offering
  // before the tail stops being the next move and starts being a list. The
  // finished cards trail behind them and are counted separately.
  const suggestions = useMemo(
    () => (status ? buildSuggestions(status, { max: 5 }) : FALLBACK_SUGGESTIONS),
    [status],
  );

  // Retire any started card whose gap has closed since we last looked. This is
  // what catches work done in the GUI — the agent sweeps at the end of each run
  // (flue-agent/src/app.ts), which covers everything it did itself. Keyed on
  // `reloadKey` so switching projects re-sweeps for the one now open. Costs a
  // single row read when nothing is outstanding, and only writes — and so only
  // invalidates anything — when a card actually flipped, so this can't loop.
  useEffect(() => {
    void sweepSuggestions();
  }, [reloadKey]);

  // Sending a card: tell the worker it was STARTED (carrying the copy it is
  // wearing right now — that sentence is composed from a gap about to close and
  // can't be reconstructed afterwards), then send its composed brief.
  // Fire-and-forget: a failed write costs a Completed badge later, and holding
  // the turn up for it would be a far worse trade.
  const pickSuggestion = useCallback(
    (s) => {
      void startSuggestion(s);
      onSuggest(s.prompt);
    },
    [onSuggest],
  );

  // This empty chat isn't a recap of itself, and neither is an untouched one.
  // Two, not the mobile row's ten: this is a shortcut back into the last thing
  // you were doing, and the full list is one click away in the Chats sheet.
  const recaps = useMemo(
    () =>
      conv.list
        .filter((c) => c.id !== conv.activeId && c.title && c.title !== "New chat")
        .slice(0, 2),
    [conv.list, conv.activeId],
  );

  return (
    <div className="flex min-h-full flex-col justify-center py-6">
      <div className="mx-auto w-full max-w-[26rem] space-y-5">
        {/* Left-aligned, like the section headings under it — a centered line
            over left-aligned eyebrows reads as a misalignment, not a flourish.
            The BLOCK is what's centered in the panel. */}
        <p className="text-sm text-muted-foreground">
          Ask me anything to create or talk about your story
        </p>

        {recaps.length ? (
          <LandingSection title="Recaps">
            {recaps.map((c) => (
              <LandingCard
                key={c.id}
                icon={MessageSquare}
                title={c.title}
                eyebrow={recapWhen(c.updatedAt)}
                label={`Open chat: ${c.title}`}
                onClick={() => conv.switchChat(c.id)}
              />
            ))}
          </LandingSection>
        ) : null}

        <section className="space-y-2">
          <Eyebrow>Continue building your story</Eyebrow>
          {status === undefined ? (
            <PosterSkeleton />
          ) : (
            <PosterRow>
              {suggestions.map((s) => (
                <LandingPoster key={s.id} suggestion={s} onClick={() => pickSuggestion(s)} />
              ))}
            </PosterRow>
          )}
        </section>
      </div>
    </div>
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
  // The shell's data-change nonce (bumped by the /api/data/events firehose, a
  // project switch, and the Refresh button). The landing screen re-reads the
  // pipeline digest on it, so finishing a stage anywhere retires its card here.
  const { reloadKey } = useShell();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [atBottom, setAtBottom] = useState(true);
  // Voice message capture (mic button → Cloudflare Whisper → composer text).
  const rec = useVoiceRecording();
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const scrollRef = useRef(null);
  const promptEd = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // What the MediaPicker feeds when it closes: the composer's attachment strip
  // ("composer", via the paperclip) or an auto-sent reply to the pending
  // ask_question card ("question", via the card's upload/attach option).
  const [pickerFor, setPickerFor] = useState("composer");
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
    promptEd.current?.clear();
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
        // Newer batches carry { atts, displayText } (the typed text with its
        // @imageN tags, minus the appended URL block); legacy is a bare array.
        const { atts, displayText } = pendingAttsRef.current[idx];
        additions[m.id] = displayText != null ? { atts, displayText } : atts;
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

  // Still in flight: bytes going up, or a document being read on the server.
  const uploading = attachments.some((a) => a.state === "uploading" || a.state === "processing");
  const doneAttachments = attachments.filter((a) => a.state === "done");
  // "@" mention targets and their imageN labels — numbered over the non-error
  // IMAGES in tray order (errored uploads drop out of the numbering, and the
  // PromptEditor prunes chips whose attachment disappears). Documents are never
  // @-taggable: the tags name a reference image the agent can re-import, and a
  // PDF's content is inlined into the message instead.
  const mentionRefs = useMemo(
    () =>
      attachments
        .filter((a) => a.state !== "error" && a.kind !== "doc")
        .map((a) => ({ id: a.id, thumb: a.previewUrl || a.url, url: a.url, name: a.name })),
    [attachments],
  );
  const attLabels = new Map(mentionRefs.map((r, i) => [r.id, refTagLabel(i)]));
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

  const patchAttachment = (id, patch) =>
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  // Upload to R2, then — for a document — extract its text so submit() can
  // inline it. The tray shows "uploading" → "processing" (reading the file) →
  // "done"; `canSend` waits on both so a message never ships with an
  // attachment the agent can't see yet.
  async function uploadOne(file, id, kind) {
    try {
      const data = await uploadAttachment(file);
      if (kind !== "doc") {
        patchAttachment(id, { state: "done", url: data.url, size: data.size ?? file.size });
        return;
      }
      patchAttachment(id, { state: "processing", url: data.url, size: data.size ?? file.size });
      const doc = await extractDocument({ key: data.key, url: data.url });
      patchAttachment(id, {
        state: "done",
        text: doc.text || "",
        chars: doc.chars ?? (doc.text || "").length,
        truncated: !!doc.truncated,
      });
    } catch (e) {
      patchAttachment(id, { state: "error", error: String(e.message || e) });
    }
  }

  // The single entry point for every way a file arrives: drop, paste, or the
  // file dialog. Images and documents are both welcome; anything else (audio,
  // video, archives) is refused here with a reason rather than silently
  // vanishing, which is what the old `image/`-only filter did.
  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const rejected = [];
    const accepted = [];
    for (const f of incoming) {
      const kind = classifyFile(f);
      if (!kind) {
        rejected.push(`${f.name} isn't a supported type`);
      } else if (f.size > MAX_ATTACHMENT_BYTES) {
        rejected.push(`${f.name} is over ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB`);
      } else {
        accepted.push({ file: f, kind });
      }
    }
    if (rejected.length) {
      toast.error(rejected.length === 1 ? rejected[0] : `${rejected.length} files skipped`, {
        description: rejected.length > 1 ? rejected.join(" · ") : undefined,
      });
    }
    if (!accepted.length) return;

    const entries = accepted.map(({ file, kind }) => ({
      id: crypto.randomUUID(),
      kind,
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      // Retain the raw File so send can convert an image to base64 for flue's
      // `images` (the R2 URL is only for the persisted thumbnail in the bubble).
      // Documents don't need it — their text comes back from /api/extract.
      file,
      state: "uploading",
      url: null,
      previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
      text: null,
      chars: 0,
      truncated: false,
      error: null,
    }));
    setAttachments((prev) => [...prev, ...entries]);
    entries.forEach((e, i) => uploadOne(accepted[i].file, e.id, e.kind));
  }

  // Drag-and-drop over the whole composer footer — the attachment tray, the
  // input row and the buttons — plus the file dialog behind the paperclip's
  // "Upload a file…" item. `noClick`/`noKeyboard` because the composer is a
  // text field, not a click-to-browse drop box; the dialog opens from the menu.
  // Rejections are folded back into `addFiles` so `classifyFile` owns the one
  // definition of what's allowed and can say WHY a file was refused.
  const {
    getRootProps: getDropRootProps,
    getInputProps: getDropInputProps,
    open: openFileDialog,
    isDragActive,
  } = useDropzone({
    onDrop: (acceptedFiles, rejections) =>
      addFiles([...acceptedFiles, ...(rejections || []).map((r) => r.file)]),
    accept: ATTACH_ACCEPT,
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

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
            kind: "image",
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
            kind: "image",
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

  const clearComposer = () => {
    setText("");
    promptEd.current?.clear();
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
      promptEd.current?.appendText(heard);
      // Put the caret back in the composer, but only after the recording bar
      // has yielded the row again — the editor can't take focus while hidden.
      setTimeout(() => promptEd.current?.focus(), 0);
    } catch (e) {
      setVoiceError(e?.message || "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  };

  const submit = async () => {
    if (!canSend) return;
    // Serialize the editor: the typed text with its "@imageN" tags, plus which
    // tags were used (the `text` state mirror only gates the draft buttons).
    const { text: typed, mentions } = promptEd.current?.getValue() ?? {
      text,
      mentions: [],
    };
    const t = typed.trim();
    // Capture the done attachments (with their retained `file`) before
    // clearing, each stamped with the imageN label the composer numbered it
    // with — the history renderer maps @imageN chips back through these.
    // Images and documents part ways here: an image is something the model
    // LOOKS at (base64 + a re-importable URL), a document is something it READS
    // (extracted text inlined below).
    const done = doneAttachments.filter((a) => a.kind !== "doc");
    const docs = doneAttachments.filter((a) => a.kind === "doc");
    const sent = done.map((a) => ({
      url: a.url,
      name: a.name,
      contentType: a.contentType,
      label: attLabels.get(a.id),
    }));

    // Build the message body first — it doubles as the join key that maps this
    // attachment batch to the flue message once it echoes back.
    //
    // The base64 images (below) only let a *vision* model SEE the attachment. To
    // let the agent USE it as a Higgsfield generation reference (media_import_url
    // → image_references) it needs the image's absolute HTTPS URL — so surface
    // each attachment's public url in the message text, named by its imageN tag.
    // When the typed text uses @imageN tags, a note explains the naming so the
    // agent can resolve each tag to its URL. PC uploads carry a `/files/…` url;
    // gallery / Visual-world picks carry their ungated `refUrl` (both
    // Higgsfield-fetchable). The whistlewood agent instructions describe this
    // trailing block. See docs: attach_visual_generation / visual-world skill.
    const refLines = sent
      .filter((a) => a.url)
      .map(
        (a) =>
          `- ${a.label}: ${/^https?:\/\//.test(a.url) ? a.url : new URL(a.url, window.location.origin).href}`,
      );
    const tagNote = mentions.length
      ? "; tags like @image1 in the message above refer to these attached images by number"
      : "";
    const imageBlock = refLines.length
      ? `Attached reference image${refLines.length > 1 ? "s" : ""} ` +
        `(absolute URL${refLines.length > 1 ? "s" : ""}, usable directly as a Higgsfield ` +
        `generation reference via media_import_url)${tagNote}:\n${refLines.join("\n")}`
      : "";
    // Documents ride as extracted TEXT — a PDF can't go in an image slot, and
    // handing the agent a bare URL would leave it unable to open the thing.
    // buildDocumentBlock inlines up to its budget and points read_document at
    // the rest. See src/lib/attachments.js.
    const docBlock = buildDocumentBlock(
      docs.map((a) => ({
        name: a.name,
        url: /^https?:\/\//.test(a.url || "")
          ? a.url
          : a.url
            ? new URL(a.url, window.location.origin).href
            : null,
        contentType: a.contentType,
        chars: a.chars,
        text: a.text,
      })),
    );
    const body = [t, imageBlock, docBlock].filter(Boolean).join("\n\n");

    // Remember this batch until the correlation effect sees the flue user message
    // carrying `body` and keys the thumbnails to its id (survives reload; immune
    // to ordinal drift from out-of-composer sends). `displayText` is what the
    // bubble re-renders — the typed text with tags, not the URL block. Then
    // clear the composer.
    const record = [
      ...sent,
      ...docs.map((a) => ({
        kind: "doc",
        url: a.url,
        name: a.name,
        contentType: a.contentType,
        chars: a.chars,
      })),
    ];
    if (record.length) pendingAttsRef.current.push({ text: body, atts: record, displayText: t });
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

  // Send a UI-composed turn (a landing card's brief) as-is. No attachment
  // bookkeeping: these are always plain text.
  const sendQuick = (text) => {
    if (isBusy || !text) return;
    setAtBottom(true);
    agent.send({ message: text }).catch(() => {});
  };

  // Answer a pending `ask_question` card by clicking an option: send its label as
  // the next user message. (Attachments are keyed by message id now, so button
  // answers need no bookkeeping.)
  const onRespond = async (label) => {
    if (isBusy || !label) return;
    setAtBottom(true);
    await agent.send({ message: label });
  };

  // Answer a pending `ask_question` card with IMAGES: the card's upload/attach
  // option opens the standard MediaPicker (asset gallery, Visual World
  // generations, or a PC upload — the same modal the composer paperclip uses),
  // and the picked items are sent immediately as a "here is the reference —
  // continue" reply. Same shape as `submit`: durable absolute URLs in the text
  // (Higgsfield-fetchable via media_import_url) + base64 `images` so the model
  // can see them. MediaPicker items: uploads carry a raw `file` + durable url;
  // gallery/generation picks carry `refUrl` (absolute) and an in-app `url`.
  const respondWithPicked = async (items) => {
    if (isBusy || !items?.length) return;
    setAtBottom(true);
    const entries = [];
    for (const it of items) {
      try {
        let file = it.file;
        if (!file) {
          // Library / Visual-world pick: fetch in-app (same-origin, authed) so
          // we can base64 the bytes for flue.
          const res = await fetch(it.url);
          if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
          const blob = await res.blob();
          file = new File([blob], it.name || "image", { type: blob.type || "image/png" });
        }
        entries.push({
          file,
          url: it.refUrl || it.url || null,
          name: it.name || "image",
          contentType: file.type || "image/png",
        });
      } catch {
        // Skip an item whose bytes can't be loaded — better a partial reply
        // than a stuck question card.
      }
    }
    if (!entries.length) return;
    const refUrls = entries
      .map((a) => a.url)
      .filter(Boolean)
      .map((u) => (/^https?:\/\//.test(u) ? u : new URL(u, window.location.origin).href));
    const plural = entries.length > 1 ? "s" : "";
    const body = refUrls.length
      ? `Here is the reference image${plural} — use ${plural ? "them" : "it"} and continue.\n\n` +
        `Attached reference image${plural} (absolute URL${plural}, usable directly as a ` +
        `Higgsfield generation reference via media_import_url):\n` +
        refUrls.map((u) => `- ${u}`).join("\n")
      : `Here is the reference image${plural} — use ${plural ? "them" : "it"} and continue.`;
    const withUrl = entries
      .filter((a) => a.url)
      .map((a) => ({
        url: /^https?:\/\//.test(a.url) ? a.url : new URL(a.url, window.location.origin).href,
        name: a.name,
        contentType: a.contentType,
      }));
    if (withUrl.length) pendingAttsRef.current.push({ text: body, atts: withUrl });
    const images = await Promise.all(
      entries.map(async (a) => ({
        type: "image",
        data: await fileToBase64(a.file),
        mimeType: a.contentType,
      })),
    );
    await agent.send({ message: body, images });
  };

  // The question card's upload/attach option → open the shared MediaPicker in
  // "question" mode (picked items auto-send instead of landing in the composer).
  const onRequestReference = () => {
    setPickerFor("question");
    setPickerOpen(true);
  };

  return (
    <aside
      {...getDropRootProps({
        className: "relative flex h-full w-[495px] shrink-0 flex-col border-l bg-card",
      })}
    >
      {/* The file dialog's input, opened by the attach menu. `noClick` keeps it
          from firing on a stray click anywhere in the panel. */}
      <input {...getDropInputProps()} />
      {/* Files can be dropped anywhere on the chat panel, not just the composer
          strip — so the whole aside is the drop target and this covers it. */}
      {isDragActive ? (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-primary">
          <span className="flex items-center gap-2">
            <Upload size={16} />
            Drop images or documents to attach
          </span>
        </div>
      ) : null}
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
            <ChatLanding conv={conv} onSuggest={sendQuick} reloadKey={reloadKey} />
          ) : (
            messages.map((m, i) => (
              <AgentMessage
                key={m.id}
                message={m}
                attEntry={m.role === "user" ? attByMsgId[m.id] : null}
                qa={qa}
                canRespond={!isBusy}
                onRespond={onRespond}
                onRequestReference={onRequestReference}
                isLast={i === messages.length - 1 && !isBusy}
                // Raw tail position (no busy gate): an unfinished tool part on a
                // non-tail message is dead — see ToolChip.
                tail={i === messages.length - 1}
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
          ) : isBusy ? (
            // Catch-all: the turn is still in flight but its trailing content is
            // settled (a finished narration line, a completed tool) — none of the
            // specific states above match. Without a marker here the transcript
            // looks finished mid-turn (see the agent narrating "…now." then
            // silently working). The indicator's presence must map exactly to
            // "not done", so any busy turn always shows a shimmer.
            <Marker>
              <MarkerIcon>
                <Loader2 className="animate-spin" />
              </MarkerIcon>
              <MarkerContent className="shimmer">Working…</MarkerContent>
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
                <AttachmentMedia variant={a.kind === "doc" ? "icon" : "image"}>
                  {a.kind === "doc" ? (
                    <FileText />
                  ) : a.previewUrl || a.url ? (
                    <img src={a.previewUrl || a.url} alt={a.name} />
                  ) : (
                    <ImageIcon />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  {/* Lead with the @tag the composer numbers this image with. */}
                  <AttachmentTitle>
                    {attLabels.has(a.id) ? `${attLabels.get(a.id)} · ${a.name}` : a.name}
                  </AttachmentTitle>
                  <AttachmentDescription>
                    {a.state === "uploading"
                      ? "Uploading…"
                      : a.state === "processing"
                        ? "Reading…"
                        : a.state === "error"
                          ? a.error || "Upload failed"
                          : a.kind === "doc"
                            ? `${(a.chars || 0).toLocaleString()} chars · ${prettySize(a.size)}`
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

        {/* The recording bar REPLACES the composer visually, but the composer row
            below stays MOUNTED (just hidden) — `promptEd` is where the transcript
            lands, and unmounting it for the duration of the take meant the ref was
            already null when Whisper answered, so every dictation was silently
            dropped on the floor. */}
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
        ) : null}

        <div className={cn("flex items-end gap-2", (rec.recording || transcribing) && "hidden")}>
          {/* Two ways in, one button: the media picker for reference IMAGES
              already in the project (gallery / Visual world / a PC upload), and
              the plain file dialog for anything from disk — including the PDFs
              and text files the agent reads rather than looks at. Dropping or
              pasting a file skips the menu entirely. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Attach a file"
                title="Attach — reference images, or a PDF / text file to read"
              >
                <Paperclip size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuItem
                onSelect={() => { setPickerFor("composer"); setPickerOpen(true); }}
              >
                <Images size={15} />
                <div className="flex flex-col">
                  <span>Reference images…</span>
                  <span className="text-[11px] text-muted-foreground">
                    Gallery, Visual world, or your computer
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openFileDialog()}>
                <Upload size={15} />
                <div className="flex flex-col">
                  <span>Upload a file…</span>
                  <span className="text-[11px] text-muted-foreground">
                    PDF, text, Markdown, Word, or an image
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* TipTap composer — Enter sends, Shift+Enter breaks the line, and
              "@" pops the attached-reference picker (chips send as @imageN). */}
          <PromptEditor
            ref={promptEd}
            refs={mentionRefs}
            placeholder="Message the studio agent…"
            onChange={setText}
            onSubmit={submit}
            submitOnEnter
            onPasteFiles={addFiles}
            className="max-h-[180px] min-h-[38px] flex-1 overflow-y-auto rounded-lg border bg-background px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring"
          />
          {/* Trailing actions mirror the mobile composer: while the agent is
              working it's a Stop button; otherwise the mic stays available next
              to Send so you can dictate into an empty draft OR keep appending
              more voice to what's already typed. */}
          {isBusy ? (
            <Button size="icon" variant="secondary" onClick={agent.stop} aria-label="Stop">
              <Square size={15} />
            </Button>
          ) : (
            <>
              <Button
                size="icon"
                variant={hasDraft ? "ghost" : "default"}
                onClick={startRecording}
                aria-label="Record voice message"
                title={hasDraft ? "Add more with voice" : "Record voice message"}
              >
                <Mic size={16} />
              </Button>
              {hasDraft ? (
                <Button
                  size="icon"
                  onClick={submit}
                  disabled={!canSend}
                  aria-label="Send"
                  title={uploading ? "Waiting for upload…" : "Send"}
                >
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </Button>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-1.5 flex items-center">
          <ModelPicker disabled={isBusy} />
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onAdd={pickerFor === "question" ? respondWithPicked : addPickedItems}
        title={pickerFor === "question" ? "Pick the reference image" : "Attach reference images"}
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
