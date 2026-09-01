// "Use MCP" — the remote-MCP connector explainer, in two wrappers.
//
// This started life inside the Settings page, where it read as one more
// preference row. It isn't: pointing Claude Desktop / Claude Code / Cursor at
// StorySeam is how an author drives the whole pipeline from the editor they
// already live in, and it deserves a door of its own. The header now carries a
// USE MCP button that opens <UseMcpDialog>, so the same content has to work as
// a first-class standalone explainer AND as a panel body in Settings.
//
// Hence the split: <McpSetup> owns NO card chrome — no border, no title, no
// padding of its own — so Settings can wrap it in <Panel> and the dialog can
// wrap it in <DialogContent> without either fighting the other. The single
// implementation is the point; a second copy in the header would drift the
// moment a client's setup command changes.
//
// Server side: the OAuth-fronted McpAgent in worker/src/mcp-agent.js. See
// docs/mcp.md.
import { useState } from "react";
import { Check, Copy, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

// One entry per client we can give an exact instruction for, plus a catch-all.
// `snippet` is what the author copies; `hint` is where it goes.
export const MCP_CLIENTS = [
  {
    id: "claude-code",
    label: "Claude Code",
    snippet: (url) => `claude mcp add --transport http storyseam ${url}`,
    hint: "Run this in your terminal, then open Claude Code — it prompts you to sign in on first use.",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    snippet: (url) => url,
    hint: "Settings › Connectors › Add custom connector — paste this URL, name it StorySeam, then Connect.",
  },
  {
    id: "cursor",
    label: "Cursor",
    snippet: (url) => JSON.stringify({ mcpServers: { storyseam: { url } } }, null, 2),
    hint: "Add to ~/.cursor/mcp.json (or Settings › MCP › Add new server), then click the sign-in prompt.",
  },
  {
    id: "other",
    label: "Other client",
    snippet: (url) => url,
    hint: "Add it as a remote (HTTP) MCP server with OAuth. Most clients need nothing but the URL.",
  },
];

function CopyButton({ text, label }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const fallback = label || t("Copy");
  return (
    <Button
      size="sm" variant="outline" className="gap-1.5 shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch { /* clipboard blocked — the text is on screen either way */ }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? t("Copied") : fallback}
    </Button>
  );
}

/**
 * The connector body: what it is, the server URL, the per-client snippet, and
 * the sign-in note. Chrome-free on purpose — see the file header.
 */
export function McpSetup() {
  const t = useT();
  const [clientId, setClientId] = useState("claude-code");
  // Origin-derived so it is right on storyseam.app, in the desktop shell, and
  // in local dev without a build-time constant to keep in sync.
  const mcpUrl = (typeof window !== "undefined" ? window.location.origin : "https://storyseam.app") + "/mcp";
  const client = MCP_CLIENTS.find((c) => c.id === clientId) || MCP_CLIENTS[0];
  const snippet = client.snippet(mcpUrl);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("Point any AI client that speaks remote MCP — Claude Desktop, Claude Code, Cursor — at StorySeam and it drives this whole pipeline ")}
        <b>{t("as you")}</b>
        {t(": read and edit the script, the shot list, the episodes, the bible, the sounds and the cuts, and run renders on your own connected account. It works across every project you own, not just this one.")}
      </p>

      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("Server URL")}</span>
          <Badge variant="info">OAuth</Badge>
          <code className="ml-auto rounded bg-muted px-2 py-1 text-xs">{mcpUrl}</code>
          <CopyButton text={mcpUrl} label={t("Copy URL")} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("Set up in")}</span>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="h-8 w-[180px]" aria-label={t("MCP client")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {MCP_CLIENTS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-2 rounded-md border bg-muted/40 p-2">
          <div className="flex items-start justify-between gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed">{snippet}</pre>
            <CopyButton text={snippet} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t(client.hint)}</p>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("The first connection opens a StorySeam page: sign in with Google, then click ")}
        <b>{t("Allow access")}</b>
        {t(". Renders bill to the provider account you linked in Settings. You can revoke the connection from your MCP client at any time.")}
      </p>
    </div>
  );
}

/**
 * The standalone door, opened by the header's USE MCP button. Controlled — the
 * header owns `open` — because the same dialog may later be opened from more
 * than one place.
 */
export function UseMcpDialog({ open, onOpenChange }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug size={16} className="text-primary" />
            {t("Use StorySeam over MCP")}
          </DialogTitle>
          <DialogDescription>
            {t("Connect your own AI client and let it run the pipeline for you.")}
          </DialogDescription>
        </DialogHeader>
        <McpSetup />
      </DialogContent>
    </Dialog>
  );
}
