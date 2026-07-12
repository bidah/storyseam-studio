import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent, useConversations } from "@/components/AgentProvider";
import {
  Bot,
  Send,
  Square,
  Wrench,
  AlertCircle,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  XCircle,
  KeyRound,
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

// ---------------------------------------------------------------------------
// Chat rendering mirrors eve's canonical approach (its scaffolded web template):
// walk every part of every message in order and render each by `type`, instead
// of scanning only the last message. HITL prompts render inline on their tool
// part and, once answered, collapse to a persistent "Responded: …" line — so
// options are real buttons (not prose) and the answer stays in the history.
//
// Attachments: images picked from the composer are uploaded to Cloudflare R2
// (POST /api/upload) and sent to the agent as `image` message parts pointing at
// their public URL, so the model can actually see them. eve's default message
// projection only keeps text/tool parts, so we remember what each user turn was
// sent with (in `sentAttachmentsRef`, ordinal-aligned to the user messages) and
// render the thumbnails back into that turn's bubble.
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

function Markdown({ text, animating = false, className }) {
  return (
    <Streamdown
      animated={{ animation: "fadeIn", duration: 180, sep: "word" }}
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

function ToolChip({ part }) {
  const name = part.toolName || "tool";
  const errored = part.state === "output-error";
  return (
    <span
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
  );
}

function authTitle(part) {
  if (part.state === "required") return `Connect ${part.displayName}`;
  if (part.outcome === "authorized") return `${part.displayName} connected`;
  return `${part.displayName} authorization ${part.outcome ?? "ended"}`;
}

function AuthorizationCard({ part }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircle2 : isCompleted ? XCircle : KeyRound;
  const instructions = part.authorization?.instructions;
  const showInstructions = instructions && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3",
        isAuthorized
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/30 bg-destructive/5"
            : "border-primary/30 bg-primary/5",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
          )}
        >
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium">{authTitle(part)}</p>
          {part.description ? (
            <p className="text-sm text-muted-foreground">{part.description}</p>
          ) : null}
          {showInstructions ? (
            <p className="text-sm text-muted-foreground">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLink size={14} /> Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InputRequest({ part, canRespond, onRespond }) {
  const req = part.toolMetadata?.eve?.inputRequest;
  if (!req) return null;
  const res = part.toolMetadata?.eve?.inputResponse;
  const selected = req.options?.find((o) => o.id === res?.optionId);

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      {req.prompt ? <Markdown text={req.prompt} className="text-muted-foreground" /> : null}
      {res ? (
        <p className="text-sm font-medium">
          Responded: {selected?.label ?? res.text ?? res.optionId}
        </p>
      ) : req.options?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {req.options.map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              type="button"
              disabled={!canRespond}
              variant={opt.style === "danger" ? "destructive" : "default"}
              onClick={() => onRespond([{ requestId: req.requestId, optionId: opt.id }])}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Type your answer below to continue.</p>
      )}
    </div>
  );
}

function MessagePart({ part, canRespond, onRespond }) {
  switch (part.type) {
    case "step-start":
      return null;
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
    case "authorization":
      return <AuthorizationCard part={part} />;
    case "dynamic-tool":
      if (part.toolMetadata?.eve?.inputRequest) {
        return <InputRequest part={part} canRespond={canRespond} onRespond={onRespond} />;
      }
      return <ToolChip part={part} />;
    default:
      return null;
  }
}

// Thumbnails for the images a user turn was sent with, rendered back into the
// bubble (eve's projection doesn't keep image parts, so `atts` is supplied by
// the composer's ordinal-aligned record).
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

function AgentMessage({ message, atts, canRespond, onRespond }) {
  const isUser = message.role === "user";
  if (isUser) {
    const text = (message.parts || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
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
          canRespond={canRespond}
          onRespond={onRespond}
        />
      ))}
    </div>
  );
}

// A HITL request is pending when some tool part carries an inputRequest with no
// matching inputResponse yet (drives the composer placeholder).
function hasPendingRequest(messages) {
  for (const m of messages) {
    for (const part of m.parts || []) {
      const eve = part?.toolMetadata?.eve;
      if (eve?.inputRequest && !eve.inputResponse) return true;
    }
  }
  return false;
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
      p.type === "dynamic-tool" ||
      p.type === "authorization",
  );
  return !hasContent;
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
function ChatHistorySheet({ conv }) {
  const [open, setOpen] = useState(false);
  const select = (id) => {
    conv.switchChat(id);
    setOpen(false);
  };
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label="Previous chats" title="Previous chats">
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

export default function AgentChat() {
  // Shared session: the same instance the sound-studio Render buttons drive.
  const agent = useAgent();
  const conv = useConversations();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const taRef = useRef(null);
  // One entry per user turn (ordinal-aligned to user messages): the images that
  // turn was sent with, so they can be re-rendered in the bubble.
  const sentAttachmentsRef = useRef([]);

  // Auto-grow the composer with its content, up to a max height (then scroll).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const activeChat = conv.list.find((c) => c.id === conv.activeId);

  // On mount and whenever the active chat changes, re-seed the composer's
  // attachment record from that chat and clear any half-typed message. The
  // agent session itself is swapped in by AgentProvider (context), so messages
  // update on their own — this only resets client-only composer state.
  useEffect(() => {
    const { attachments: saved } = conv.getInitial(conv.activeId);
    sentAttachmentsRef.current = Array.isArray(saved) ? saved : [];
    setText("");
    setAttachments([]);
    setAtBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.activeId]);

  const messages = agent.data?.messages ?? [];
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const pending = useMemo(() => hasPendingRequest(messages), [messages]);
  const thinking = useMemo(() => isThinking(messages, isBusy), [messages, isBusy]);

  const uploading = attachments.some((a) => a.state === "uploading");
  const doneAttachments = attachments.filter((a) => a.state === "done");
  const canSend = (text.trim() || doneAttachments.length > 0) && !isBusy && !uploading;

  // Stick to the bottom while new content streams — but only if the user is
  // already there, so scrolling up to read history isn't yanked back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [messages, agent.status, thinking, attachments, atBottom]);

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
      state: "uploading",
      url: null,
      previewUrl: URL.createObjectURL(f),
      error: null,
    }));
    setAttachments((prev) => [...prev, ...entries]);
    entries.forEach((e, i) => uploadOne(files[i], e.id));
  }

  function removeAttachment(id) {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  const onPick = (e) => {
    addFiles(e.target.files);
    e.target.value = ""; // allow re-picking the same file
  };

  const onPaste = (e) => {
    const imgs = Array.from(e.clipboardData?.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };

  const submit = async () => {
    if (!canSend) return;
    const t = text.trim();
    const sent = doneAttachments.map((a) => ({
      url: a.url,
      name: a.name,
      contentType: a.contentType,
    }));

    // Build the eve message: image parts + optional text, or a plain string.
    let message;
    if (sent.length) {
      message = [
        ...(t ? [{ type: "text", text: t }] : []),
        ...sent.map((a) => ({ type: "image", image: a.url })),
      ];
    } else {
      message = t;
    }

    // Record this turn's attachments (ordinal-aligned) before the optimistic
    // user message renders, persist them to the active chat, then clear the
    // composer. (Turn events + cursor persist via the session's onFinish.)
    sentAttachmentsRef.current.push(sent);
    conv.saveAttachments(conv.activeId, sentAttachmentsRef.current);
    setText("");
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    setAtBottom(true);

    await agent.send({ message });
  };

  const onRespond = async (responses) => {
    await agent.send({ inputResponses: responses });
  };

  return (
    <aside className="flex h-dvh w-[495px] shrink-0 flex-col border-l bg-card">
      <header className="flex h-[61px] shrink-0 items-center gap-2 border-b px-4">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Bot size={16} />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">Studio agent</span>
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                agent.status === "error"
                  ? "bg-destructive"
                  : isBusy
                    ? "animate-pulse bg-emerald-500"
                    : "bg-muted-foreground/40",
              )}
              title={agent.status}
            />
          </div>
          <div className="truncate text-[11px] text-muted-foreground" title={activeChat?.title}>
            {activeChat?.title || "New chat"}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="New chat"
            title="New chat"
            onClick={() => conv.newChat()}
          >
            <SquarePen size={16} />
          </Button>
          <ChatHistorySheet conv={conv} />
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full space-y-4 overflow-y-auto bg-[#0E0E10] px-4 py-4"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Sparkles size={22} />
              <p className="text-sm">Ask me to build the episode.</p>
              <p className="max-w-[16rem] text-xs">
                e.g. “create a rain-ambience sound”, “stitch the complete cut”, or “assign the
                library images to bundles”. Attach a reference image with the paperclip.
              </p>
            </div>
          ) : (
            (() => {
              let userOrdinal = -1;
              return messages.map((m) => {
                if (m.role === "user") userOrdinal += 1;
                const atts = m.role === "user" ? sentAttachmentsRef.current[userOrdinal] : null;
                return (
                  <AgentMessage
                    key={m.id}
                    message={m}
                    atts={atts}
                    canRespond={!isBusy}
                    onRespond={onRespond}
                  />
                );
              });
            })()
          )}

          {thinking ? (
            <Marker>
              <MarkerIcon>
                <Loader2 className="animate-spin" />
              </MarkerIcon>
              <MarkerContent className="shimmer">Thinking…</MarkerContent>
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

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onPick}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach image"
            title="Attach image"
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
            placeholder={pending ? "Type your answer…" : "Message the studio agent…"}
            className="max-h-[180px] min-h-[38px] flex-1 resize-none overflow-y-auto rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {isBusy ? (
            <Button size="icon" variant="secondary" onClick={agent.stop} aria-label="Stop">
              <Square size={15} />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              title={uploading ? "Waiting for upload…" : "Send"}
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
