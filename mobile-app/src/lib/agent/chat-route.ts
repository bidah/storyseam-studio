import { useCallback } from 'react';
import { router } from 'expo-router';

// WHERE a conversation opens. One answer, everywhere: the chat MODAL
// (src/app/session/), presented over whatever the user was doing.
//
// The reason is the tab bar's accessory pill. It has to reach the running session
// from every tab, and the conversation's other route lives inside the Home tab's
// stack — going there from Episode or Cuts would switch tabs, throwing away where
// the user was standing, which is the one thing the pill exists to prevent.
// Dismissing the modal puts them back exactly where they were, so that is the
// presentation the Home tab's cards use too rather than being the one surface that
// behaves differently.
//
// `openChatModal` is the single decision point — the pill, the Home cards, the
// history sheet and useSendToAgent's Render/Stitch/Score buttons all go through it,
// so the rule can be changed in this one file (e.g. branching on `usePathname()`
// to push `/(tabs)/chat/[id]` in-stack while Home is the visible tab, which is what
// buys the native header morph).
//
// `focus=1` is a route param rather than a store flag so the intent belongs to that
// one navigation: the conversation turns it into the composer's `focusTick` (which
// remounts the input with autoFocus), and it can't leak into a later, unrelated
// open of the same chat.

/**
 * Open a chat as the modal. One screen, one dispatch: the conversation IS the
 * modal's root, and CLOSE (or the sheet's swipe-down) is the way out.
 *
 * There was an attempt to sit the Home hub underneath it so the header could carry
 * a back chevron as well. It doesn't come free: declaring the hub as the stack's
 * anchor (`unstable_settings`) does NOT put it in the state, because navigating
 * into a not-yet-mounted nested navigator builds that navigator with only the
 * screen asked for — the modal came up with no chevron and no back gesture
 * (verified on an iOS 26 simulator). Presenting `/session` first and pushing the
 * conversation in the same tick loses the push instead (the navigator isn't
 * mounted yet for it to resolve against), leaving the modal sitting on a second
 * copy of the Home screen. expo-router's `withAnchor` navigation option is the
 * supported way in, if a chat list inside the modal is ever wanted again.
 *
 * `focus` opens the keyboard on arrival (the pill's "I tapped the input" hand-off);
 * leave it off when the agent is mid-turn, where the transcript matters more than
 * the caret.
 *
 * `draft` seeds the composer without sending — the tab bar's dictation hand-off
 * (lib/agent/voice-capture.tsx): the pill records, this opens the conversation,
 * and the transcribed words are sitting in the field for the author to send.
 */
export function openChatModal(
  chatId: string | null,
  opts?: { focus?: boolean; draft?: string },
) {
  // Nothing to open. Can't normally happen — <AgentProvider> renders its children
  // only once a session is published, and every project carries an active chat
  // (`withActiveForProject`), blank if it has never been used.
  if (!chatId) return;
  const params: { id: string; focus?: string; draft?: string; dk?: string } = { id: chatId };
  if (opts?.focus) params.focus = '1';
  if (opts?.draft) {
    params.draft = opts.draft;
    // The draft's NONCE. `navigate` updates the params of a screen that's already
    // in the stack, and the composer applies a draft once per key — so dictating
    // the same sentence twice has to look like two hand-offs, not a no-op.
    params.dk = String(++draftSeq);
  }
  router.navigate({ pathname: '/session/[id]', params });
}

let draftSeq = 0;

/**
 * The hook form, for callers that want a stable callback in a dependency list.
 * `navigate` semantics: driving the agent twice must not stack two copies of the
 * same conversation.
 */
export function useOpenChat() {
  return useCallback(
    (chatId: string | null, opts?: { focus?: boolean; draft?: string }) =>
      openChatModal(chatId, opts),
    [],
  );
}
