/**
 * The web host for a `render_ui` tool part — the bridge between flue's
 * transcript and the OpenUI Lang renderer.
 *
 * `buildStudioLibrary()` runs EXACTLY ONCE per bundle (module scope here):
 * `defineComponent` registers every schema in zod's global registry by name, so
 * a second call in the same bundle collides on the ids and crashes JSON-schema
 * conversion.
 *
 * Answering works the way the old `ask_question` card did, because flue can't
 * suspend a turn: tapping anything fires `onAction`, and we post its
 * `humanFriendlyMessage` (the component's `send` string) as the next user
 * message. `deriveQA` in AgentChat.jsx then resolves which card is still
 * pending — only that one stays live.
 */
import { useCallback, useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { AlertTriangle } from "lucide-react";
import { buildStudioLibrary } from "./contract";
import { AnsweredContext } from "./answered";
import { webRenderers } from "./renderers";

export const studioLibrary = buildStudioLibrary(webRenderers);

/** Stable identity for "no errors", so the success pass can't cause a render. */
const EMPTY_ERRORS = [];

/** One parser error, as a line the author (and we) can read. */
export function errorText(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  const where = e.statementId ? ` (in \`${e.statementId} = …\`)` : "";
  return `${e.message || e.code || "invalid"}${where}`;
}

/** Whether two error lists say the same thing — see `handleErrors` below. */
function sameErrors(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((e, i) => errorText(e) === errorText(b[i]));
}

/**
 * Strip a ``` fence the model wrapped the program in. Models add one about a
 * third of the time however firmly the prompt says not to — cheaper to tolerate
 * than to round-trip a correction. (Same helper as appless's `cleanLang`.)
 */
export function cleanLang(text) {
  if (!text) return "";
  const opened = /^\s*```/.test(text);
  let t = text.replace(/^\s*```[\w-]*[^\S\n]*\n?/, "");
  if (opened) {
    const end = t.indexOf("\n```");
    if (end !== -1) t = t.slice(0, end);
  } else {
    t = t.replace(/\n```\s*$/, "");
  }
  return t.trim();
}

/**
 * The one message the host intercepts instead of posting: an "upload / attach a
 * reference image" choice opens the app's MediaPicker (asset gallery, Visual
 * World generations, or a PC upload) and the picked images are auto-sent as the
 * reply. This replaces the old `isUploadOption` label-sniffing on the
 * `ask_question` card — same heuristic, but now matched against the `send`
 * string the contract already defines as "what the author would say", which is
 * a far more stable thing to pattern-match than a button label.
 */
export function isReferenceUpload(message) {
  if (!message) return false;
  return (
    /\b(upload|attach)\b/i.test(message) && /\b(image|images|reference|ref|photo)\b/i.test(message)
  );
}

/**
 * Render one `render_ui` program.
 *
 * `answerable` gates interaction — false once the card has been answered, while
 * the agent is working, or when the chat is otherwise busy. It rides in on the
 * renderer's `isStreaming` prop, which is what disables the library's
 * interactive elements (see `useSend` in renderers.jsx); a stale card therefore
 * renders identically but inert, rather than vanishing.
 *
 * `answer` is the reply that answered this card, if any — it marks the row the
 * author actually chose (see answered.ts). Inert and answered look nothing
 * alike: one is a card waiting its turn, the other is a decision already made.
 */
export function StudioUI({ lang, answerable, answer, onRespond }) {
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const program = cleanLang(lang);

  // `onError` fires on EVERY parse pass, and — per its contract — is "called
  // with [] when all errors are resolved". So the argument has to be inspected:
  // a handler that ignores it and flips a `failed` flag treats the SUCCESS
  // callback as a failure and every card dies. (It did. That was the bug.)
  //
  // It also fires during the renderer's own render pass, so this must be a
  // no-op when nothing changed — an unconditional setState here is a render
  // loop.
  const handleErrors = useCallback((next) => {
    const list = Array.isArray(next) ? next : next ? [next] : EMPTY_ERRORS;
    setErrors((prev) => (sameErrors(prev, list) ? prev : list));
  }, []);

  if (!program) return null;

  // A malformed program is a model bug, not a user-facing crash: show what was
  // wrong plus the program itself, so the author can still act on it and the
  // failure is diagnosable. (The agent gets the correction on its next turn.)
  if (errors.length) {
    return (
      <div className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
          <AlertTriangle size={13} /> This card didn't render
        </p>
        <ul className="space-y-0.5">
          {errors.map((e, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">
              {errorText(e)}
            </li>
          ))}
        </ul>
        <pre className="overflow-x-auto text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
          {program}
        </pre>
      </div>
    );
  }

  return (
    <AnsweredContext.Provider value={answer ?? null}>
      <Renderer
        response={program}
        library={studioLibrary}
        isStreaming={!answerable}
        onAction={(event) => {
          const message = event?.humanFriendlyMessage;
          if (message) onRespond?.(message);
        }}
        onError={handleErrors}
      />
    </AnsweredContext.Provider>
  );
}
