import { useEffect, useMemo, useRef, useState } from "react";
import { useEveAgent } from "eve/react";
import { Bot, Send, Square, Wrench, AlertCircle, ExternalLink, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Pull the pending human-in-the-loop input request (ask_question / approval)
// off the latest assistant message, if any.
function pendingInputRequest(messages) {
  const last = messages[messages.length - 1];
  if (!last) return null;
  for (const part of last.parts || []) {
    const req = part?.toolMetadata?.eve?.inputRequest;
    if (req && !req.responded) return req;
  }
  return null;
}

function TextParts({ message }) {
  const text = (message.parts || [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
  if (!text) return null;
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</div>;
}

// Compact chips for tool calls + authorization prompts so the user sees the
// agent working through skills/tools.
function ActivityParts({ message }) {
  const chips = [];
  for (const part of message.parts || []) {
    if (part.type === "dynamic-tool" || part.type === "tool" || part.type?.startsWith?.("tool-")) {
      const name = part.toolName || part.name || part.type?.replace?.("tool-", "") || "tool";
      if (part.toolMetadata?.eve?.inputRequest) continue; // rendered separately
      chips.push(
        <span
          key={chips.length}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          <Wrench size={11} /> {name}
        </span>,
      );
    }
    if (part.type === "authorization" && part.authorization?.url) {
      chips.push(
        <a
          key={chips.length}
          href={part.authorization.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
        >
          <ExternalLink size={11} /> Authorize {part.displayName || "connection"}
        </a>,
      );
    }
  }
  if (!chips.length) return null;
  return <div className="mt-1.5 flex flex-wrap gap-1">{chips}</div>;
}

function HitlPrompt({ request, onRespond, disabled }) {
  const options = request.options || [];
  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
      {request.prompt ? (
        <div className="mb-2 text-sm font-medium">{request.prompt}</div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const optionId = opt.optionId ?? opt.id ?? opt.value ?? opt.label;
          return (
            <Button
              key={optionId}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => onRespond(request.requestId, optionId)}
            >
              {opt.label ?? optionId}
            </Button>
          );
        })}
      </div>
      {options.length === 0 ? (
        <div className="text-xs text-muted-foreground">Answer in the box below to continue.</div>
      ) : null}
    </div>
  );
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
  const request = useMemo(() => pendingInputRequest(messages), [messages]);

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

  const respond = async (requestId, optionId) => {
    await agent.send({ inputResponses: [{ requestId, optionId }] });
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
            <div key={m.id} className={cn("flex flex-col", m.role === "user" && "items-end")}>
              <div
                className={cn(
                  "max-w-[92%] rounded-2xl px-3 py-2",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                <TextParts message={m} />
                {m.role !== "user" ? <ActivityParts message={m} /> : null}
              </div>
            </div>
          ))
        )}

        {request ? (
          <HitlPrompt request={request} onRespond={respond} disabled={isBusy} />
        ) : null}

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
            placeholder={request ? "Type your answer…" : "Message the studio agent…"}
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
