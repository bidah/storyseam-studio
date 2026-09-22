// "Explore plugins" — the marketplace.
//
// The header used to carry fourteen tabs, which is the shape of a tool that
// does everything and the feel of a tool you can't learn. It now carries four
// (Bible, Script, Episodes, Editor) and a door to this screen, where every
// other surface is installed on purpose. So this page has one job that isn't
// listing: it has to make "install" feel like a decision an author makes about
// THIS project, not a settings checkbox they'll never find again.
//
// Hence the poster treatment. Each plugin wears a seeded mesh band — the same
// visual language as the chat landing deck (src/components/AgentChat.jsx) —
// keyed off the plugin id, so Radio looks like Radio every time you open the
// page, on this machine and the next one. Plugins have no art files, so the
// band IS the picture rather than a placeholder under one.
//
// The other job is reassurance, and it is worth more than the art: removing a
// plugin deletes nothing. It hides a tab. That sentence appears under the grid
// and again in the detail dialog, because an author who suspects otherwise will
// simply never uninstall anything and the header stays fourteen tabs long.
import { useMemo, useState } from "react";
import { Check, Package, Plus, Trash2 } from "lucide-react";
import { PLUGINS } from "@/lib/plugins";
import { meshSeed } from "@/lib/card-art";
import { meshBackground } from "@/lib/mesh";
import { usePlugins } from "@/components/PluginsProvider";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Chip, ErrorNote, Eyebrow, Spinner } from "@/components/shared";

const CATEGORIES = ["Story", "Visuals", "Audio", "Post"];

// What the agent gains, in the author's terms. Counts rather than a dump of
// tool names — a list of nine identifiers answers a question nobody asked. The
// playbook gets named when there is exactly one, because "the radio playbook"
// is a thing an author can picture and "2 playbooks" is not.
function capabilityLine(plugin, t) {
  const tools = plugin.tools.length;
  const skills = plugin.skills.length;
  if (!tools && !skills) return null;
  const toolPart = tools === 1
    ? t("one tool")
    : t("{n} tools", { n: tools });
  if (!skills) return t("Gives the chat agent {tools}.", { tools: toolPart });
  const skillPart = skills === 1
    ? t("the {skill} playbook", { skill: plugin.skills[0] })
    : t("{n} playbooks", { n: skills });
  if (!tools) return t("Gives the chat agent {skills}.", { skills: skillPart });
  return t("Gives the chat agent {tools} and {skills}.", { tools: toolPart, skills: skillPart });
}

// The card's picture slot. Fixed 16:9 so a row of cards is a row of rectangles
// whatever their copy does.
function MeshBand({ id, className }) {
  return (
    <div
      aria-hidden="true"
      className={cn("w-full shrink-0", className)}
      style={meshBackground(meshSeed(id))}
    />
  );
}

// One marketplace card. The card is a DIV, not a button: the Install control
// lives in the footer as a SIBLING of the details button, because a button
// inside a button is invalid markup and the stopPropagation version of this
// only looks like it works.
function PluginCard({ plugin, installed, busy, onOpen, onToggle }) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-none border bg-card transition-colors",
        installed ? "border-primary/40" : "hover:border-primary/30",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("About {name}", { name: plugin.name })}
      >
        <MeshBand id={plugin.id} className="aspect-video" />
        <div className="flex flex-1 flex-col p-3">
          <div className="flex items-center gap-2">
            <Eyebrow>{t(plugin.category)}</Eyebrow>
            {installed ? (
              <Badge variant="success" className="ml-auto gap-1">
                <Check size={11} /> {t("Installed")}
              </Badge>
            ) : null}
          </div>
          <span className="mt-1 text-[0.9375rem] font-semibold leading-snug text-foreground">
            {t(plugin.name)}
          </span>
          <span className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {t(plugin.tagline)}
          </span>
        </div>
      </button>
      <div className="flex items-center gap-2 border-t px-3 py-2">
        <Button
          size="sm"
          variant={installed ? "ghost" : "default"}
          disabled={busy}
          className={cn("gap-1.5", installed && "text-muted-foreground hover:text-destructive")}
          onClick={onToggle}
        >
          {installed ? <Trash2 size={14} /> : <Plus size={14} />}
          {installed ? t("Remove") : t("Install")}
        </Button>
      </div>
    </div>
  );
}

// The detail dialog. Same band at full width, then the honest part: what the
// tab is called, what the highlights are, and what the agent can suddenly do.
function PluginDialog({ plugin, installed, busy, onOpenChange, onToggle }) {
  const t = useT();
  const capability = plugin ? capabilityLine(plugin, t) : null;
  return (
    <Dialog open={!!plugin} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        {plugin ? (
          <>
            <MeshBand id={plugin.id} className="h-32" />
            <div className="max-h-[60vh] overflow-y-auto p-5">
              <DialogHeader className="space-y-2 text-left">
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{t(plugin.category)}</Badge>
                  {installed ? (
                    <Badge variant="success" className="gap-1">
                      <Check size={11} /> {t("Installed")}
                    </Badge>
                  ) : null}
                </div>
                <DialogTitle className="text-lg">{t(plugin.name)}</DialogTitle>
              </DialogHeader>

              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t(plugin.blurb)}
              </p>

              <ul className="mt-4 space-y-1.5">
                {plugin.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-sm">
                    <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                    <span>{t(h)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded-lg border bg-muted/40 p-3">
                <Eyebrow>{t("What installing does")}</Eyebrow>
                <p className="mt-1.5 text-sm">
                  {t("Adds a ")}
                  <b>{t(plugin.label)}</b>
                  {t(" tab to the header.")}
                </p>
                {capability ? (
                  <p className="mt-1 text-xs text-muted-foreground">{capability}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("Removing it hides the tab. Nothing you made is deleted.")}
                </p>
              </div>
            </div>
            <DialogFooter className="border-t px-5 py-3">
              <Button
                variant={installed ? "outline" : "default"}
                disabled={busy}
                className="gap-1.5"
                onClick={onToggle}
              >
                {installed ? <Trash2 size={14} /> : <Plus size={14} />}
                {installed ? t("Remove plugin") : t("Install plugin")}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function Component() {
  const t = useT();
  const { loading, error, defaulted, isEnabled, install, remove } = usePlugins();
  const [category, setCategory] = useState("all");
  const [openId, setOpenId] = useState(null);

  const shown = useMemo(
    () => (category === "all" ? PLUGINS : PLUGINS.filter((p) => p.category === category)),
    [category],
  );
  // What the project has sits on top, what it could have below — each keeps
  // the catalogue's order, so a card that moves lands in a predictable place.
  const installedShown = shown.filter((p) => isEnabled(p.id));
  const availableShown = shown.filter((p) => !isEnabled(p.id));
  const open = openId ? PLUGINS.find((p) => p.id === openId) || null : null;

  // Deliberately NOT awaited: usePlugins already applies the change optimistically
  // and rolls back on failure, and a browsing surface that spins for a tap
  // stops being a browsing surface. The rejection is swallowed here because the
  // provider surfaces it as `error` — an unhandled rejection would be the only
  // other outcome.
  const toggle = (plugin) => {
    const p = isEnabled(plugin.id) ? remove(plugin.id) : install(plugin.id);
    p?.catch?.(() => {});
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Package size={18} className="text-primary" />
          {t("Explore plugins")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("Shot Studio ships four surfaces. Everything else is a plugin you install when the project needs it.")}
        </p>
      </div>

      {/* The provider FAILS OPEN — a set it couldn't read comes back as
          "everything installed" — so the error has to say that, or the grid
          silently lies about what this project has. */}
      {error ? (
        <ErrorNote>
          {t("Couldn't read this project's plugins: {error}. Everything is shown as installed until it loads.", {
            error: String(error?.message || error),
          })}
        </ErrorNote>
      ) : null}

      {/* Seeded, not chosen: say so once, quietly, so an author doesn't think
          the app installed things behind their back. */}
      {defaulted ? (
        <p className="text-xs text-muted-foreground">
          {t("Nothing has been installed or removed on this project yet, so the tabs you see were derived from the work it already contains. Your first install or removal makes the set explicit.")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Chip on={category === "all"} onClick={() => setCategory("all")}>{t("All")}</Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} on={category === c} onClick={() => setCategory(c)}>{t(c)}</Chip>
        ))}
      </div>

      {/* The first read only ever happens once per session (the provider sits
          at the app root), so a spinner here is a one-time beat rather than a
          per-visit one — and it beats painting twelve cards as "not installed"
          and then flipping half of them. */}
      {loading ? <Spinner label={t("Reading this project's plugins…")} /> : (
      <div className="space-y-6">
        {[
          { key: "installed", label: t("Installed"), items: installedShown },
          { key: "available", label: t("Available"), items: availableShown },
        ].filter((s) => s.items.length).map((section) => (
          <section key={section.key} className="space-y-2">
            <Eyebrow>{section.label} · {section.items.length}</Eyebrow>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((p) => (
                <PluginCard
                  key={p.id}
                  plugin={p}
                  installed={section.key === "installed"}
                  busy={loading}
                  onOpen={() => setOpenId(p.id)}
                  onToggle={() => toggle(p)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      )}

      <p className="pt-1 text-xs text-muted-foreground">
        {t("Removing a plugin never deletes anything — the shots, takes and renders it made stay in the project, and installing it again brings the tab back exactly as you left it.")}
      </p>

      <PluginDialog
        plugin={open}
        installed={!!open && isEnabled(open.id)}
        busy={loading}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        onToggle={() => {
          if (!open) return;
          // An install from the dialog closes it, so the author sees the card
          // land in the Installed section rather than a badge flip behind a modal.
          const installing = !isEnabled(open.id);
          toggle(open);
          if (installing) setOpenId(null);
        }}
      />
    </div>
  );
}
