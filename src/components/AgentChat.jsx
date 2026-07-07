import { useEffect, useMemo, useRef, useState } from "react";
import { useEveAgent } from "eve/react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Chat rendering mirrors eve's canonical approach (its scaffolded web template):
// walk every part of every message in order and render each by `type`, instead
// of scanning only the last message. HITL prompts render inline on their tool
// part and, once answered, collapse to a persistent "Responded: …" line — so
// options are real buttons (not prose) and the answer stays in the history.
// ---------------------------------------------------------------------------

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
      {req.prompt ? <p className="text-sm text-muted-foreground">{req.prompt}</p> : null}
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
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{part.text}</div>
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

function AgentMessage({ message, canRespond, onRespond }) {
  const isUser = message.role === "user";
  if (isUser) {
    const text = (message.parts || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          {text}
        </div>
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

export default function AgentChat({ view }) {
  const agent = useEveAgent({
    // Tell the agent which screen the user is on, every turn.
    prepareSend: (input) => ({ ...input, clientContext: { screen: view } }),
  });
  const [text, setText] = useState("");
  const scrollRef = useRef(null);

  const messages = agent.data?.messages ?? [];
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const pending = useMemo(() => hasPendingRequest(messages), [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, agent.status]);

  const submit = async () => {
    const t = text.trim();
    if (!t || isBusy) return;
    setText("");
    await agent.send({ message: t });
  };

  const onRespond = async (responses) => {
    await agent.send({ inputResponses: responses });
  };

  return (
    <aside className="flex h-dvh w-[380px] shrink-0 flex-col border-l bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Bot size={16} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Studio agent</div>
          <div className="text-[11px] text-muted-foreground">drives the pipeline via skills</div>
        </div>
        <span
          className={cn(
            "ml-auto size-2 rounded-full",
            agent.status === "error"
              ? "bg-destructive"
              : isBusy
                ? "animate-pulse bg-emerald-500"
                : "bg-muted-foreground/40",
          )}
          title={agent.status}
        />
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Sparkles size={22} />
            <p className="text-sm">Ask me to build the episode.</p>
            <p className="max-w-[16rem] text-xs">
              e.g. “create a rain-ambience sound”, “stitch the complete cut”, or “assign the
              library images to bundles”.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <AgentMessage key={m.id} message={m} canRespond={!isBusy} onRespond={onRespond} />
          ))
        )}

        {agent.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <div className="font-medium">Agent error</div>
              <div className="break-words text-xs text-muted-foreground">{agent.error.message}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={pending ? "Type your answer…" : "Message the studio agent…"}
            className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {isBusy ? (
            <Button size="icon" variant="secondary" onClick={agent.stop} aria-label="Stop">
              <Square size={15} />
            </Button>
          ) : (
            <Button size="icon" onClick={submit} disabled={!text.trim()} aria-label="Send">
              <Send size={15} />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
