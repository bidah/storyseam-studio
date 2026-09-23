// What this project's studio actually HAS — the installed plugins, and the ones
// still on the shelf.
//
// The header is three core surfaces (Bible, Script, Editor) plus
// whatever the author installed. Everything else — the shot list, Radio, the
// sound studio, the cuts — is optional, which means a tool call can now land on
// a surface that does not exist for this project: the document writes, the SSE
// fires, and nobody can see it. So the agent needs a way to read the catalog
// before it starts work.
//
// `get_status` already carries the bare `plugins.enabled` / `plugins.disabled`
// id lists, and that is what the plugin-gate check should use. THIS tool exists
// for the other half: the taglines, categories and highlights needed to DRAW an
// offer (`render_ui` → `Plugin` / `PluginList`) that says what the thing does
// rather than naming an id.

import { defineTool } from "@flue/runtime";
import type { Api, Json } from "../lib/api.js";
import { PLUGINS, pluginById, normalizeEnabled } from "../lib/plugins.js";

interface PluginsResponse {
  enabled?: unknown;
  defaulted?: boolean;
  updatedAt?: string | null;
}

/**
 * Join the worker's id list against the vendored catalog. Shared with
 * `set_plugin`, which returns the same shape so the model can confirm what
 * changed without a second read.
 */
export function shapeCatalog(enabledIds: unknown): {
  installed: Json;
  available: Json;
} {
  const on = normalizeEnabled(enabledIds);
  const isOn: Record<string, boolean> = {};
  for (const id of on) isOn[id] = true;

  const installed = on.map((id) => {
    const p = pluginById(id)!;
    return { id: p.id, name: p.name, tagline: p.tagline, category: p.category };
  });
  // The shelf carries `highlights` too — that is the "what you get" copy a
  // `Plugin` card needs, and it is only interesting for something not yet on.
  const available = PLUGINS.filter((p) => !isOn[p.id]).map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    category: p.category,
    highlights: p.highlights,
  }));

  return { installed: installed as Json, available: available as Json };
}

export const listPlugins = (api: Api) =>
  defineTool({
    name: "list_plugins",
    description:
      "The studio's plugin catalog for THIS project: which capabilities are installed and which are still on the shelf. Shot Studio is four always-present surfaces — Bible, Script, Episodes, Editor — plus installable plugins (Shot list, Radio, Sound studio, Musical, Moodboard, Image generation, Video generation, Visual nodes, Script agents, Animatic, Complete cuts, Library); a project only has the ones its author installed, and a plugin's tools must not be run while it is uninstalled. Returns { installed: [{ id, name, tagline, category }], available: [{ id, name, tagline, category, highlights }], defaulted } — `defaulted: true` means nothing has been installed or removed explicitly yet and the set was inferred from the work the project already contains. For a routine \"am I allowed to do this\" check, DON'T call this: `get_status` already carries `plugins.enabled` / `plugins.disabled`. Call this when you need the taglines and highlights to DRAW an offer — a `render_ui` `PluginList` proposing the plugin a request needs — or when the author asks what plugins exist, what's installed, or what the app can do. Reading it installs nothing; `set_plugin` does that, and only after the author says yes.",
    async run({ signal }) {
      const res = (await api.get("/api/plugins", signal)) as PluginsResponse;
      const { installed, available } = shapeCatalog(res?.enabled);
      return {
        output: { installed, available, defaulted: !!res?.defaulted } as Json,
      };
    },
  });
