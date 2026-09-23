// The "@" reference-image mention — typing "@" in a prompt composer pops a
// picker of the attached reference images (image1, image2, … in tray order);
// picking one inserts an atomic chip node that serializes back to "@imageN"
// text. Built on @tiptap/suggestion with the same caret-anchored plain-fixed
// positioning as the notes SlashCommand (no tippy / floating-ui).

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Node, Extension, mergeAttributes } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

// The chip node. `refId` is the stable identity of the reference image (so the
// composer can renumber labels when the tray reorders); `label` is the current
// "imageN" name, which is also what the node serializes to (`@imageN`).
export const RefMention = Node.create({
  name: "refMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      refId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-ref-id"),
        renderHTML: (attrs) => ({ "data-ref-id": attrs.refId }),
      },
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label"),
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="ref-mention"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "ref-mention", class: "ref-mention" }, HTMLAttributes),
      `@${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

// The floating picker. Same keyboard contract as the notes SlashMenu: the
// suggestion plugin forwards keydowns via the imperative handle.
const RefMentionMenu = forwardRef(function RefMentionMenu(props, ref) {
  const [selected, setSelected] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => setSelected(0), [props.items]);

  useLayoutEffect(() => {
    const el = containerRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (index) => {
    const item = props.items[index];
    if (item) props.command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (props.items.length === 0) return false;
      if (event.key === "ArrowUp") {
        setSelected((s) => (s + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % props.items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        pick(selected);
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="w-64 rounded-lg border bg-popover p-1 text-popover-foreground">
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
          <ImageOff size={14} /> No reference images — attach one first
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="max-h-64 w-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground"
    >
      <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Reference images
      </div>
      {props.items.map((item, index) => (
        <button
          key={item.refId}
          type="button"
          data-active={index === selected}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            index === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
          // onMouseDown (not onClick) so the editor selection isn't lost first.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(index);
          }}
          onMouseEnter={() => setSelected(index)}
        >
          {item.thumb ? (
            <img src={item.thumb} alt={item.name || item.label} className="size-8 shrink-0 rounded border object-cover" />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded border bg-background">
              <ImageOff size={13} className="text-muted-foreground" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium">@{item.label}</span>
            {item.name ? (
              <span className="block truncate text-xs text-muted-foreground">{item.name}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
});

// Position at the caret rect, flipping above if it would overflow the bottom.
function place(el, rect) {
  el.style.position = "fixed";
  el.style.zIndex = "50";
  el.style.left = `${rect.left}px`;
  const below = rect.bottom + 8;
  const menuHeight = el.offsetHeight || 260;
  if (below + menuHeight > window.innerHeight && rect.top - menuHeight - 8 > 0) {
    el.style.top = `${rect.top - menuHeight - 8}px`;
  } else {
    el.style.top = `${below}px`;
  }
}

// The "@" trigger. `getItems` is read live on every keystroke so the menu
// always reflects the current reference tray. `storage.active` flags the open
// popup so the host editor's Enter-to-submit can stand down while picking.
export const RefMentionSuggestion = Extension.create({
  name: "refMentionSuggestion",

  addOptions() {
    return { getItems: () => [] };
  },

  addStorage() {
    return { active: false };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      Suggestion({
        editor: this.editor,
        char: "@",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => {
          const items = this.options.getItems() || [];
          const q = query.trim().toLowerCase();
          if (!q) return items;
          return items.filter(
            (it) =>
              it.label.toLowerCase().includes(q) ||
              (it.name || "").toLowerCase().includes(q),
          );
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "refMention", attrs: { refId: props.refId, label: props.label } },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: () => {
          let component = null;
          let popup = null;

          const reposition = (clientRect) => {
            if (!popup || !clientRect) return;
            const rect = clientRect();
            if (rect) place(popup, rect);
          };

          return {
            onStart: (props) => {
              storage.active = true;
              component = new ReactRenderer(RefMentionMenu, {
                props,
                editor: props.editor,
              });
              popup = document.createElement("div");
              popup.appendChild(component.element);
              document.body.appendChild(popup);
              reposition(props.clientRect);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              reposition(props.clientRect);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                storage.active = false;
                popup?.remove();
                popup = null;
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              storage.active = false;
              popup?.remove();
              popup = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
