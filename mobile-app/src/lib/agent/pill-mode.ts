import { router } from 'expo-router';
import { create } from 'zustand';
import { openChatModal } from './chat-route';
import { getActiveChatId } from './provider';

// WHAT THE TAB BAR'S PILL IS POINTED AT — the agent (words) or the image
// generator (pictures). One flag, two destinations:
//
//   text  → the chat modal      src/app/session/[id]  — the studio agent
//   image → the visual modal    src/app/image/        — visual world's generator
//
// It exists because Visual world stopped being a segment inside the Story tab.
// It used to be `World › Visual world`, one native segmented control away from
// the written bible, which put an image-generation composer inside a tab whose
// other two thirds are prose — and made "generate a concept image" a three-tap
// journey from wherever you happened to be. Now it's a modal presented over any
// tab, exactly like the chat, and the pill's two-icon toggle is the ONE control
// that chooses between them (components/chat/agent-mode-toggle.tsx).
//
// A MODULE STORE, not component state, for the same reason everything else the
// pill reads is: react-native-screens renders the accessory once per placement
// (`regular` and `inline`) and switches between them by toggling layer opacity,
// so useState in that component is not shared between the two copies and the
// hidden one still hit-tests. Both copies read this.
//
// NOT persisted. Chat is what the app opens into — an image pass is a thing you
// are doing right now, not a preference — and a cold start that came up in image
// mode would hide the agent behind a toggle the author never asked for.

export type AgentMode = 'text' | 'image';

type ModeState = { mode: AgentMode };

const useModeStore = create<ModeState>(() => ({ mode: 'text' }));

/** The live mode, for the pill and both modal headers. */
export function useAgentMode(): AgentMode {
  return useModeStore((s) => s.mode);
}

/** The same, read imperatively (the dictation hand-off, which isn't a component). */
export function getAgentMode(): AgentMode {
  return useModeStore.getState().mode;
}

/**
 * Point the pill WITHOUT navigating. Two callers:
 *
 *   · the pill's own toggle, whose whole job is aiming — the body tap next to it
 *     is what travels (components/chat/agent-mode-toggle.tsx);
 *   · a surface already on screen saying so. BOTH modals do it on mount, because
 *     most ways into either one don't come through `openForMode`: the agent's
 *     `navigate` command (lib/screen-report.ts) and deep links land on the routes
 *     directly, and every "open this chat" in the app — Home's recap cards, the
 *     history sheet, the Render/Stitch buttons — goes straight to `openChatModal`.
 *     A toggle showing Write over the image composer, or Image over a transcript,
 *     would be lying.
 */
export function setAgentMode(mode: AgentMode) {
  useModeStore.setState({ mode });
}

// The draft's NONCE — see openChatModal, which carries one for the same reason:
// `navigate` updates the params of a screen already in the stack, and the
// composer applies a draft once per key, so dictating the same sentence twice
// has to look like two hand-offs rather than a no-op.
let draftSeq = 0;

export type OpenModeOptions = {
  /** Open the keyboard on arrival — "I tapped the input" hand-off. */
  focus?: boolean;
  /** Seed the composer WITHOUT sending (the pill's dictation hand-off). */
  draft?: string;
  /**
   * SWAP the modal that's already presented instead of presenting over the tabs.
   *
   * Set by the toggle drawn INSIDE a modal header, and only there. `replace`
   * resolves against the navigator where the two hrefs diverge — for `/session`
   * vs `/image`, that's the ROOT stack, so it takes the presented modal away and
   * puts the other one up in its place. Called with a modal NOT presented it
   * would replace `(tabs)` instead, tearing down the whole tab tree, which is why
   * the pill never passes it.
   */
  replace?: boolean;
};

/**
 * Point the pill at `mode` and open that mode's surface. The single entry point
 * for everything that TRAVELS — the pill's body, both modal headers' toggles and
 * the dictation hand-off — so the two destinations can never disagree about which
 * one is showing. (The pill's own toggle only aims: `setAgentMode`.)
 */
export function openForMode(mode: AgentMode, opts: OpenModeOptions = {}) {
  useModeStore.setState({ mode });

  if (mode === 'image') {
    const params: { focus?: string; draft?: string; dk?: string } = {};
    if (opts.focus) params.focus = '1';
    if (opts.draft) {
      params.draft = opts.draft;
      params.dk = String(++draftSeq);
    }
    const href = { pathname: '/image' as const, params };
    if (opts.replace) router.replace(href);
    else router.navigate(href);
    return;
  }

  // The CURRENT session, opened whole — `openChatModal` owns the rest of that
  // rule (and returns quietly when there is no chat to open).
  openChatModal(getActiveChatId(), opts);
}
