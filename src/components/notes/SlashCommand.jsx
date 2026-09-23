// The "/" slash-command menu — the heart of the Notion-page feel. Typing "/"
// pops a floating menu of block types; picking one rewrites the current block.
// Built on @tiptap/suggestion with the menu rendered as a React component
// positioned at the caret (plain fixed positioning — no tippy / floating-ui).
//
// Beyond the generic block types (text, headings, lists, quote, code, divider),
// this menu also offers the SCREENPLAY elements — Scene Heading, Action,
// Character, Dialogue, Parenthetical, Transition — which insert the custom
// `screenplay` node so inline text follows screenplay formatting rules.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  Clapperboard, AlignLeft, User, MessageSquare, Parentheses, ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The screenplay elements offered by the menu. Each `command` first clears the
// "/query" the user typed (deleteRange) then converts the current block into the
// chosen screenplay node so its inline text follows screenplay formatting.
const COMMANDS = [
  {
    title: "Scene Heading",
    description: "INT. LOCATION - DAY (slugline)",
    icon: Clapperboard,
    searchTerms: ["scene", "heading", "slugline", "int", "ext", "location"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setScreenplay("scene_heading").run(),
  },
  {
    title: "Action",
    description: "Descriptive prose",
    icon: AlignLeft,
    searchTerms: ["action", "description", "prose", "scene"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setScreenplay("action").run(),
  },
  {
    title: "Character",
    description: "Name of the speaker (uppercase)",
    icon: User,
    searchTerms: ["character", "cue", "speaker", "name", "who"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setScreenplay("character").run(),
  },
  {
    title: "Dialogue",
    description: "The words spoken",
    icon: MessageSquare,
    searchTerms: ["dialogue", "dialog", "line", "speech", "say"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setScreenplay("dialogue").run(),
  },
  {
    title: "Parenthetical",
    description: "(a beat) — delivery note",
    icon: Parentheses,
    searchTerms: ["parenthetical", "beat", "wryly", "direction"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setScreenplay("parenthetical").run(),
  },
  {
    title: "Transition",
    description: "CUT TO: (right-aligned)",
    icon: ArrowRightLeft,
    searchTerms: ["transition", "cut", "fade", "dissolve"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setScreenplay("transition").run(),
  },
];

function filterCommands(query) {
  const q = query.trim().toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.searchTerms.some((t) => t.includes(q))
  );
}

// The floating list. Owns arrow/enter navigation (the suggestion plugin forwards
// keydowns here via the imperative handle) and keeps the active row in view.
const SlashMenu = forwardRef(function SlashMenu(props, ref) {
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
      if (event.key === "Enter") {
        pick(selected);
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="w-72 rounded-none border bg-popover p-1 text-popover-foreground">
        <div className="px-2 py-1.5 text-sm text-muted-foreground">No results</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="max-h-80 w-72 overflow-y-auto rounded-none border bg-popover p-1 text-popover-foreground"
    >
      <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Screenplay
      </div>
      {props.items.map((item, index) => (
        <button
          key={item.title}
          type="button"
          data-active={index === selected}
          className={cn(
            "flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-sm",
            index === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          )}
          // onMouseDown (not onClick) so the editor selection isn't lost first.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(index);
          }}
          onMouseEnter={() => setSelected(index)}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-none border bg-background">
            <item.icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{item.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
});

// Position a floating element at the caret rect, flipping above the caret if it
// would overflow the viewport bottom. Plain fixed positioning — no tippy.
function place(el, rect) {
  el.style.position = "fixed";
  el.style.zIndex = "50";
  el.style.left = `${rect.left}px`;
  const below = rect.bottom + 8;
  const menuHeight = el.offsetHeight || 320;
  if (below + menuHeight > window.innerHeight && rect.top - menuHeight - 8 > 0) {
    el.style.top = `${rect.top - menuHeight - 8}px`;
  } else {
    el.style.top = `${below}px`;
  }
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }) => filterCommands(query),
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
              component = new ReactRenderer(SlashMenu, {
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
                popup?.remove();
                popup = null;
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
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
