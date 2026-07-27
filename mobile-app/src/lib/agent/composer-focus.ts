// "Open the composer and put the caret in it" — handed from the tab bar's
// bottom accessory to the chat landing screen.
//
// The accessory (see components/chat/agent-accessory.tsx) is a PILL, not a text
// field: a UITabAccessory lives inside the tab bar's frame and neither UIKit nor
// react-native-screens lifts it for the keyboard, so a real <TextInput> there
// would type underneath it. Tapping the pill therefore navigates to the chat
// tab, and the landing screen's real <Composer> takes the focus.
//
// Read-and-clear, exactly like ./pending-draft.ts: the request is consumed by
// whichever screen gains focus first, so returning to the chat tab later (a back
// swipe, a tab switch) doesn't pop the keyboard again.

let requested = false;

export function requestComposerFocus() {
  requested = true;
}

export function takeComposerFocus(): boolean {
  const was = requested;
  requested = false;
  return was;
}
