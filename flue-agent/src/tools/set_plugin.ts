// Install or remove one plugin — the author's decision, executed by you.
//
// The gate this tool sits behind is social, not technical. Installing a plugin
// adds a tab to someone's app; removing one takes a tab away. Neither is yours
// to decide, so the rule lives in the description (which the model reliably
// reads) as well as in the plugin-gate skill: call this only after the author
// has said yes — a tapped `PluginList` card, or a plain "yes, install it".
//
// It is deliberately NOT wired into the destructive-approval two-call token
// flow. That gate is for writes the author cannot take back (a shrinking
// `save_shotlist`, `stitch_cuts`, `restore_version`); installing a plugin is
// reversible in one tap, and CLAUDE.md is explicit that a gate which fires often
// trains the author to tap through without reading. The approval here is the
// author's yes, not a token.
//
// A removal deletes nothing: the plugin document only lists which surfaces the
// header shows. The shot list, the takes and the cuts all stay in D1, and
// re-installing brings the tab back with its work intact.

import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";
import { PLUGIN_IDS, pluginById } from "../lib/plugins.js";
import { shapeCatalog } from "./list_plugins.js";

interface PluginsResponse {
  enabled?: unknown;
  defaulted?: boolean;
  updatedAt?: string | null;
}

export const setPlugin = (api: Api) =>
  defineTool({
    name: "set_plugin",
    description:
      "Install a plugin into this project's studio, or remove one. ONLY call this after the AUTHOR has said yes to this specific plugin — a `PluginList` card they tapped, or a plain \"yes, install it\" in chat. Never install one on your own initiative to unblock yourself: when a request needs a plugin that is not installed, you say so and offer it (see the plugin-gate skill), you do not help yourself to it. Removing is even more clearly theirs — only ever on an explicit ask; it hides the tab and DELETES NOTHING (the shot list, takes and cuts stay in the database and come back if it is reinstalled). Valid `pluginId`s are exactly: " + PLUGIN_IDS.join(", ") + " — the three core surfaces (world/Bible, script, editor) are always present and cannot be installed or removed. Returns the fresh { installed, available } so you can confirm what changed in one line — then continue the work the author originally asked for, in the same turn.",
    input: v.object({
      pluginId: d(
        v.pipe(v.string(), v.minLength(1)),
        'Which plugin, by its catalog id: "agents", "moodboard", "shotlist", "images", "videos", "nodes", "animatic", "radio", "sounds", "musical", "cuts" or "library".',
      ),
      action: d(
        v.picklist(["install", "remove"]),
        '"install" adds the tab, "remove" hides it (nothing is deleted).',
      ),
    }),
    async run({ data: input, signal }) {
      const { pluginId, action } = input as {
        pluginId: string;
        action: "install" | "remove";
      };

      // Reject a hallucinated id here rather than letting the route 400: a
      // named-alternatives message comes back to the model as something it can
      // correct, an HTTP error comes back as a wall.
      const spec = pluginById(pluginId);
      if (!spec) {
        return {
          output: {
            ok: false,
            error: `"${pluginId}" is not a plugin. Valid ids: ${PLUGIN_IDS.join(", ")}. The core surfaces (world, script, editor) are always present and are not installable.`,
          } as Json,
        };
      }

      const body =
        action === "install" ? { enable: [spec.id] } : { disable: [spec.id] };
      const res = (await api.req(
        "/api/plugins",
        "PUT",
        body,
        signal,
      )) as PluginsResponse;

      const { installed, available } = shapeCatalog(res?.enabled);
      return {
        output: {
          ok: true,
          action,
          plugin: { id: spec.id, name: spec.name, tagline: spec.tagline },
          installed,
          available,
        } as Json,
      };
    },
  });
