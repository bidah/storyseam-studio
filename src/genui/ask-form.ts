/**
 * A card that asks SEVERAL questions answers them all in one message.
 *
 * A single-select list sends on tap, and that send ends the agent's turn — so a
 * card carrying two of them (the World interview's "where does it take place?"
 * and "who is the protagonist?", side by side) died on the first tap: one
 * question answered, the rest inert, and nothing on the card saying which. The
 * skill tells the model to use `"one-per-group"` instead, and it still writes
 * the two-list card, because it is the natural way to ask two different things.
 *
 * So the CARD takes over when it holds two or more single-select lists: each
 * tap becomes a radio pick held on the card, one per list, and a "Send answers"
 * button posts them together once every question has one — one line per
 * answer, in the order the questions appear. Each line is the option's own
 * `send` (a whole sentence in single-select), so `matchesAnswer` reads the
 * picks straight back off that message and the answered card marks each one.
 *
 * Pure logic + React context, no DOM and no React Native: CANONICAL here and
 * vendored into `mobile-app/src/genui/` by `npm run genui:sync`. The Card
 * renderers own the button, each in its own pixels.
 */
import { createContext, useContext, useMemo, useState } from "react";
import { AnsweredContext } from "./answered";

/** The lists whose single-select mode sends on tap. */
const ASK_LISTS = new Set(["OptionList", "MediaGrid", "AudioList"]);

type Props = Record<string, unknown> | null | undefined;
type Node = { typeName?: string; props?: Props } | null | undefined;

function itemsOf(props: Props): unknown[] {
  if (Array.isArray(props?.options)) return props.options as unknown[];
  if (Array.isArray(props?.items)) return props.items as unknown[];
  return [];
}

function sendsOf(props: Props): string[] {
  return itemsOf(props)
    .map((item) => (item as Node)?.props?.send)
    .filter((send): send is string => typeof send === "string" && send.trim() !== "");
}

/**
 * Which list this is, from what it offers. The list renderer gets props, not
 * its node, so the card and the list agree on an identity both can compute.
 */
export function askKey(props: Props): string {
  return sendsOf(props).join("␟");
}

/** The single-select lists on a card, in reading order, as `askKey`s. */
export function singleSelectAsks(nodes: unknown[]): string[] {
  const keys: string[] = [];
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      const node = raw as Node;
      if (!node || typeof node !== "object") continue;
      if (node.typeName && ASK_LISTS.has(node.typeName)) {
        const select = node.props?.select;
        if ((!select || select === "one") && sendsOf(node.props).length) keys.push(askKey(node.props));
        continue;
      }
      const kids = node.props?.children;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(nodes);
  return keys;
}

type AskForm = {
  keys: string[];
  picks: Record<string, string>;
  pick: (key: string, send: string) => void;
};

const AskFormContext = createContext<AskForm | null>(null);
export const AskFormProvider = AskFormContext.Provider;

/**
 * The card's side. `form` is null unless the card really asks several things
 * and is still open — an answered card renders its lists exactly as before, so
 * each picked row gets its ordinary check mark. `message` is the composed reply,
 * present only once every question has a pick.
 */
export function useAskForm(children: unknown[]) {
  const answer = useContext(AnsweredContext);
  const keys = useMemo(() => singleSelectAsks(children), [children]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  // Two lists offering the same sends would share a key; that card is a
  // redraw gone wrong, not a form, and is left to send on tap.
  const active = !answer && keys.length >= 2 && new Set(keys).size === keys.length;
  const form = useMemo<AskForm | null>(
    () =>
      active
        ? {
            keys,
            picks,
            pick: (key, send) =>
              setPicks((prev) => {
                const next = { ...prev };
                // A radio per question; re-tapping the pick clears it.
                if (next[key] === send) delete next[key];
                else next[key] = send;
                return next;
              }),
          }
        : null,
    [active, keys, picks],
  );
  const done = keys.filter((key) => picks[key]).length;
  const message = form && done === keys.length ? keys.map((key) => picks[key]).join("\n") : null;
  return { form, done, total: keys.length, message };
}

/**
 * The list's side: a `Selection` (radio mode) when this list is one question
 * of a card-level form, else null and the list behaves as it always has.
 */
export function useAskFormSelection(listProps: Props) {
  const form = useContext(AskFormContext);
  const key = askKey(listProps);
  if (!form || !form.keys.includes(key)) return null;
  return {
    mode: "group" as const,
    has: (send: string) => form.picks[key] === send,
    toggle: (send: string) => form.pick(key, send),
  };
}
