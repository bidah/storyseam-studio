// GET/PUT /api/plugins — WHICH SURFACES THIS PROJECT HAS INSTALLED.
//
// The header used to carry fourteen tabs. That is the shape of a tool that does
// everything and the feel of a tool you can't learn: a new author met a wall of
// surfaces with no way to tell which ones their project would ever need. So the
// shell is now FOUR always-present surfaces — the Bible, the Script, the
// Episodes and the Editor — and every other capability is a PLUGIN installed on
// purpose from the marketplace. A radio play never grows a Musical tab; a
// project that never renders never grows a Cuts tab.
//
// This route owns the one bit of state that makes that real: the set of
// installed plugin ids. The catalog itself — what exists, what each one does,
// which tools and skills it owns — is `lib/plugins.ts`, vendored from
// `src/lib/plugins.ts` and edited only there.
//
// ── Why the document is PROJECT-level, not per-user ──────────────────────────
// `appstate:<userId>` is deliberately per-user: "which tab am I on" is a
// property of the PERSON, and two collaborators looking at one episode are
// looking at different screens. Installed plugins are the opposite. They
// describe what KIND of thing this project is — whether it has a shot list,
// whether it has a radio pass — and that is a property of the work, not of who
// happens to be logged in. Two people on one project must see the same studio,
// or a director says "it's on the Radio tab" to an editor who doesn't have one.
// So this is a plain project-level row (`docs` keyed `(project_id, "plugins")`)
// and is NOT in EPISODE_SCOPED_DOCS: installing Radio installs it for the
// series, not for episode 4.
//
// ── Why an ABSENT document seeds from usage instead of defaulting to empty ───
// Every project that predates the marketplace already has a shot list, a radio
// pass and a sound library. Shipping "no document ⇒ nothing installed" would
// open all of them, on the day this lands, with their own work missing from the
// header. Nothing would be lost, and it would read exactly like data loss.
//
// So `enabled === null` ("never written") does not mean "empty": it means
// DERIVE, and the answer comes from `status.usage` — the per-surface counters
// buildStatus reports. The derivation is strictly READ-ONLY and happens only
// while the document is absent, which is what keeps it from being an
// auto-installer: the first explicit install or removal materialises the set,
// and nothing new ever appears in the header afterwards just because the
// project grew some content. A genuinely blank project seeds to `[]` — a new
// author meets four tabs and a marketplace, which is the whole point.
//
// ── The status ⇄ plugins call graph ─────────────────────────────────────────
// buildStatus reports a `plugins` block, and the seed reads buildStatus's
// `usage` — which looks like mutual recursion and isn't. `readEnabledPlugins`
// takes the usage map as an ARGUMENT: buildStatus passes the one it just built
// (so it never re-enters itself), and only a caller that has no status in hand
// — this route's GET — pays for one. The call graph terminates in one hop from
// either direction.
import { readDoc, updateDoc } from "../lib/docs.js";
import { FIXED_PLUGINS, PLUGIN_IDS, isCore, normalizeEnabled, pluginById, seedEnabled } from "../lib/plugins.ts";
import { buildStatus } from "./status.js";

// `enabled: null` is load-bearing — it distinguishes "never written" (seed from
// usage) from "written, and the author installed nothing" (an empty header is
// what they asked for). `source` is the provenance field every doc store
// carries; history.js throttles snapshots per writer.
const FALLBACK = { source: "plugins", enabled: null, updatedAt: null };

const DELTA_FIELDS = ["enable", "disable", "enabled"];

// Name what a caller may install, so a 400 is actionable rather than a scolding.
const installable = () => PLUGIN_IDS.join(", ");

// Validate one id list. A core id and an unknown id are both 400s, with
// different messages: "world isn't installable" and "wrld doesn't exist" are
// different mistakes and a caller fixes them differently.
function validateIds(raw, field) {
  if (!Array.isArray(raw)) {
    return { error: `"${field}" must be an array of plugin ids. Installable: ${installable()}.` };
  }
  const ids = [];
  for (const entry of raw) {
    const id = String(entry ?? "").trim();
    if (!id) return { error: `"${field}" contains an empty plugin id.` };
    if (isCore(id)) {
      return {
        error:
          `"${id}" is a core surface — it is always in the header and cannot be installed or ` +
          `removed. Installable plugins: ${installable()}.`,
      };
    }
    if (!pluginById(id)) {
      return { error: `Unknown plugin "${id}". Installable: ${installable()}.` };
    }
    ids.push(id);
  }
  return { ids };
}

/**
 * The installed set for a project, and whether it was derived rather than
 * stored. `usage` is the `status.usage` counter map; pass the one you already
 * have (buildStatus does) and this stays a single indexed row read. Omit it and
 * this builds a status of its own — only worth doing when you don't have one.
 *
 * READ-ONLY in both directions: a derived answer is never written back. The
 * document is materialised by an explicit PUT and by nothing else.
 */
export async function readEnabledPlugins(env, pid, usage) {
  // Launch flag: every project shows the same fixed set (src/lib/plugins.ts).
  if (FIXED_PLUGINS) return { enabled: normalizeEnabled(FIXED_PLUGINS), defaulted: false, updatedAt: null };
  const doc = await readDoc(env, pid, "plugins", FALLBACK);
  if (Array.isArray(doc?.enabled)) {
    return {
      enabled: normalizeEnabled(doc.enabled),
      defaulted: false,
      updatedAt: doc.updatedAt ?? null,
    };
  }
  const counts = usage || (await buildStatus(env, pid)).usage;
  return { enabled: seedEnabled({ usage: counts }), defaulted: true, updatedAt: null };
}

/**
 * REPLACE the installed set — the whole document, not a delta. What a Film's
 * job writes when it ends (lib/film-plugins.js): the surfaces its steps used,
 * exactly, so its project's studio opens on the Film decomposed into its
 * layers. Materialises the document like a PUT does. → the stored set.
 */
export async function setEnabledPlugins(env, pid, ids) {
  const at = new Date().toISOString();
  const { state } = await updateDoc(env, pid, "plugins", FALLBACK, (doc) => {
    doc.enabled = normalizeEnabled(ids);
    doc.source = "plugins";
    doc.updatedAt = at;
    return { state: { enabled: doc.enabled, defaulted: false, updatedAt: doc.updatedAt } };
  });
  return state;
}

export function registerPlugins(app) {
  // What's installed. `defaulted: true` means nobody has ever chosen — the set
  // came from what the project already uses, and the first PUT will freeze it.
  app.get("/api/plugins", async (c) => {
    try {
      const { enabled, defaulted, updatedAt } = await readEnabledPlugins(c.env, c.get("projectId"));
      return c.json({ enabled, defaulted, updatedAt });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Install, remove, or replace the set. Exactly one of `enable` / `disable` /
  // `enabled` — a body carrying two of them is ambiguous about precedence, and
  // guessing an order is how "disable radio, enable radio" ends up depending on
  // which key the client happened to serialise first.
  //
  // Live sync is the generic firehose in index.js: a successful non-GET on
  // `/api/*` broadcasts on the project's `data` channel, and `/api/plugins` is
  // not in its skip list. The routes that broadcast by hand (script, timeline,
  // mcp) do so precisely BECAUSE they are skipped there — adding a second
  // announce here would only make every open tab revalidate twice.
  app.put("/api/plugins", async (c) => {
    const env = c.env;
    const pid = c.get("projectId");

    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json(
        { error: "Body must be an object — one of { enable: [...] }, { disable: [...] }, { enabled: [...] }" },
        400,
      );
    }
    const fields = DELTA_FIELDS.filter((f) => f in body);
    if (fields.length !== 1) {
      return c.json(
        {
          error:
            `Send exactly one of "enable", "disable" or "enabled" (got ` +
            `${fields.length ? fields.map((f) => `"${f}"`).join(", ") : "none"}).`,
        },
        400,
      );
    }
    const field = fields[0];
    const { ids, error } = validateIds(body[field], field);
    if (error) return c.json({ error }, 400);

    try {
      // A DELTA on a never-written document has to start from the derived set,
      // or "install Musical" on a pre-marketplace project would silently
      // uninstall its shot list, its radio pass and everything else that was in
      // the header a second earlier. The seed is computed HERE, before the CAS,
      // because building a status inside `updateDoc`'s mutator would re-run it
      // on every retry — and the mutator is documented as side-effect free.
      // A full replace needs no base, so it never pays for a status.
      let seed = null;
      if (field !== "enabled") {
        const current = await readDoc(env, pid, "plugins", FALLBACK);
        if (!Array.isArray(current?.enabled)) {
          seed = seedEnabled({ usage: (await buildStatus(env, pid)).usage });
        }
      }

      const at = new Date().toISOString();
      const { state } = await updateDoc(env, pid, "plugins", FALLBACK, (doc) => {
        const base = Array.isArray(doc.enabled) ? doc.enabled : seed || [];
        const next =
          field === "enabled"
            ? ids
            : field === "enable"
              ? base.concat(ids)
              : base.filter((id) => !ids.includes(id));
        // Stored in CATALOG order, always, so the header is stable however the
        // set was written and two clients that installed the same plugins in a
        // different order produce the same document.
        doc.enabled = normalizeEnabled(next);
        doc.source = "plugins";
        doc.updatedAt = at;
        return { state: { enabled: doc.enabled, defaulted: false, updatedAt: doc.updatedAt } };
      });
      return c.json(state);
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
