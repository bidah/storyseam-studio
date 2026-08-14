// PUBLIC share view — /share/script/:token. A read-only rendering of the
// pinned script draft for anyone holding a share link.
//
// This route is a TOP-LEVEL SIBLING of RootLayout in src/router.jsx, on
// purpose: RootLayout wraps everything in LoginGate (which demands a session
// AND a render-provider key) plus the whole app shell — none of which a link
// viewer has or needs. The doc renders through the SAME TipTap extensions as
// the editor, just non-editable, so the screenplay formatting can never drift
// from what the author sees; the `.notes-editor` wrapper carries all the
// `sp-*` CSS (src/index.css).
import { useLoaderData } from "react-router";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { ScrollText } from "lucide-react";
import { Screenplay, transformCopiedScreenplay } from "@/components/notes";

export async function loader({ params }) {
  const res = await fetch(`/api/share/script/${params.token}`);
  if (!res.ok) {
    throw new Response("This share link is no longer available.", {
      status: res.status,
      statusText: "Share link unavailable",
    });
  }
  return res.json();
}

export function Component() {
  const { title, doc, updatedAt } = useLoaderData();
  const editor = useEditor({
    editable: false,
    extensions: [Screenplay, StarterKit, TextStyle, Color, TaskList, TaskItem.configure({ nested: true })],
    content: doc || { type: "doc", content: [] },
    editorProps: {
      attributes: { class: "focus:outline-none" },
      // Read-only, but still copyable: a passage lifted off the share page keeps
      // its screenplay elements when pasted into the editor.
      transformCopied: transformCopiedScreenplay,
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:py-14">
        <header className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ScrollText size={13} /> Shared script · read-only
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{title || "Untitled script"}</h1>
          {updatedAt ? (
            <p className="text-xs text-muted-foreground">
              Last updated {new Date(updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          ) : null}
        </header>

        <div className="notes-editor rounded-xl border bg-card px-6 py-8 sm:px-10">
          <EditorContent editor={editor} />
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Shared from StorySeam
        </footer>
      </div>
    </div>
  );
}
