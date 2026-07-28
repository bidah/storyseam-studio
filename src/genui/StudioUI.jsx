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
import { useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { AlertTriangle } from "lucide-react";
import { buildStudioLibrary } from "./contract";
import { webRenderers } from "./renderers";

export const studioLibrary = buildStudioLibrary(webRenderers);

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
 */
export function StudioUI({ lang, answerable, onRespond }) {
  const [failed, setFailed] = useState(false);
  const program = cleanLang(lang);

  if (!program) return null;

  // A malformed program is a model bug, not a user-facing crash: show the
  // program as text so the author can still act on it, and keep the thread
  // usable. (The agent gets the correction on its next turn from the user.)
  if (failed) {
    return (
      <div className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
          <AlertTriangle size={13} /> This card didn't render
        </p>
        <pre className="overflow-x-auto text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
          {program}
        </pre>
      </div>
    );
  }

  return (
    <Renderer
      response={program}
      library={studioLibrary}
      isStreaming={!answerable}
      onAction={(event) => {
        const message = event?.humanFriendlyMessage;
        if (message) onRespond?.(message);
      }}
      onError={() => setFailed(true)}
    />
  );
}
