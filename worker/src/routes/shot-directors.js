// Shot directors (/api/shot-directors) — the author-editable prompt system the
// shot list is written with. See `worker/src/lib/shot-directors.js` for the
// model; this file is the HTTP surface the Settings page and the agent's
// `get_shot_director` / `save_shot_director` tools share.
//
// One POST does everything (activate / edit / new version / reset / delete)
// because they are all one mutation of one small document, and splitting them
// into five routes would mean five tools for one capability. The shape is the
// SHARED contract in `shared/schemas/shot-directors.json`.
import { readDoc, updateDoc } from "../lib/docs.js";
import { validateBody } from "../lib/validate.js";
import shotDirectorsSchema from "../schemas/shot-directors.json";
import { normalizeProductionType } from "../lib/production-type.js";
import {
  listDirectors,
  activeMap,
  normalizePromptForm,
  resolveActiveDirector,
  toStored,
  seedFor,
  isSeedId,
  SEED_DIRECTORS,
} from "../lib/shot-directors.js";

const FALLBACK = { directors: [], active: {} };

// The whole picture one read: every director, which one is active per production
// type, and which one THIS project is writing shots with right now.
export async function buildDirectorsView(env, pid) {
  const world = await readDoc(env, pid, "world", null);
  const productionType = normalizeProductionType(world?.productionType);
  const doc = await readDoc(env, pid, "shot-directors", null);
  const directors = listDirectors(doc);
  const active = activeMap(doc, directors);
  const activeId = active[productionType];
  return {
    productionType,
    directors,
    active,
    activeId,
    director: directors.find((d) => d.id === activeId) || directors[0],
  };
}

// A fresh id for an author-created director: slugged from the name, suffixed
// when it collides so two "handheld doc" versions can coexist.
function mintId(name, taken) {
  const base =
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "director";
  let id = `director-${base}`;
  let k = 2;
  while (taken.has(id)) id = `director-${base}-${k++}`;
  return id;
}

export function registerShotDirectors(app) {
  // Read the directors (built-ins + the author's versions) and what's active.
  app.get("/api/shot-directors", async (c) =>
    c.json(await buildDirectorsView(c.env, c.get("projectId"))));

  // Create / edit / version / activate / reset / delete — see the contract.
  app.post("/api/shot-directors", async (c) => {
    const pid = c.get("projectId");
    const parsed = await validateBody(c, shotDirectorsSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;

    const world = await readDoc(c.env, pid, "world", null);
    const projectType = normalizeProductionType(world?.productionType);
    const productionType = normalizeProductionType(body.productionType || projectType);
    const now = new Date().toISOString();

    const res = await updateDoc(c.env, pid, "shot-directors", FALLBACK, (doc) => {
      const stored = Array.isArray(doc.directors) ? doc.directors.filter((d) => d && d.id) : [];
      const directors = listDirectors(doc);
      const byId = new Map(directors.map((d) => [d.id, d]));
      const target = body.id ? byId.get(String(body.id)) : null;
      if (body.id && !target) {
        return { abort: true, error: `No shot director "${body.id}" — read the list with get_shot_director first.` };
      }

      // DELETE — author-created only. A built-in is reset, never removed.
      if (body.delete) {
        if (!target) return { abort: true, error: "delete needs the `id` of the director to remove." };
        if (isSeedId(target.id)) {
          return { abort: true, error: `"${target.name}" is a built-in director and can't be deleted. Send \`reset: true\` to drop your edits and restore its shipped text instead.` };
        }
        doc.directors = stored.filter((d) => d.id !== target.id);
        // Anything pointing at the deleted director falls back to its seed.
        const active = { ...(doc.active || {}) };
        for (const [pt, id] of Object.entries(active)) {
          if (id === target.id) active[pt] = seedFor(pt).id;
        }
        doc.active = active;
        return { ok: true, deleted: target.id };
      }

      // RESET — drop the stored override so the seed text comes back.
      if (body.reset) {
        if (!target) return { abort: true, error: "reset needs the `id` of the built-in director to restore." };
        if (!isSeedId(target.id)) {
          return { abort: true, error: `"${target.name}" is your own director, not a built-in — there is no shipped text to reset to. Edit its instructions instead.` };
        }
        doc.directors = stored.filter((d) => d.id !== target.id);
        return { ok: true, reset: target.id };
      }

      const taken = new Set([...SEED_DIRECTORS.map((d) => d.id), ...stored.map((d) => d.id)]);

      // NEW VERSION (from an existing director) or a director from scratch.
      if (!target || body.newVersion) {
        const source = target || null;
        const name =
          String(body.name || "").trim() ||
          (source ? `${source.name} v${(source.version || 1) + 1}` : "");
        if (!name) return { abort: true, error: "A new shot director needs a `name`." };
        const instructions = String(body.instructions ?? source?.instructions ?? "").trim();
        if (!instructions) {
          return { abort: true, error: "A new shot director needs `instructions` — the prompt system its shots are written with." };
        }
        const id = mintId(name, taken);
        const next = toStored(
          {
            id,
            name,
            productionType,
            promptForm: normalizePromptForm(body.promptForm || source?.promptForm),
            instructions,
            basedOn: source?.id || null,
            version: (source?.version || 0) + 1,
            createdAt: now,
          },
          now,
        );
        doc.directors = [...stored, next];
        if (body.activate !== false) doc.active = { ...(doc.active || {}), [productionType]: id };
        return { ok: true, saved: id, activated: body.activate !== false };
      }

      // EDIT IN PLACE (a built-in edit is stored as an override under its id) —
      // and/or ACTIVATE. Activating with no other field is the plain "use this
      // director" call the Settings radio makes.
      const touchesText =
        body.name !== undefined || body.instructions !== undefined || body.promptForm !== undefined;
      if (touchesText) {
        const merged = toStored(
          {
            id: target.id,
            name: String(body.name ?? target.name).trim() || target.name,
            productionType: normalizeProductionType(body.productionType || target.productionType),
            promptForm: normalizePromptForm(body.promptForm || target.promptForm),
            instructions: String(body.instructions ?? target.instructions),
            basedOn: target.basedOn,
            version: target.version || 1,
            createdAt: target.createdAt,
          },
          now,
        );
        doc.directors = [...stored.filter((d) => d.id !== target.id), merged];
      }
      const activate = body.activate ?? !touchesText;
      if (activate) doc.active = { ...(doc.active || {}), [productionType]: target.id };
      return { ok: true, saved: target.id, activated: !!activate };
    });

    if (res.error) return c.json({ error: res.error }, 400);
    return c.json({ ...res, ...(await buildDirectorsView(c.env, pid)) });
  });

  // The ONE director this project writes shots with right now — the agent's
  // `get_shot_director` reads this before authoring any shot, so it follows the
  // author's edited prompt system rather than only the skill's generic text.
  app.get("/api/shot-directors/active", async (c) => {
    const pid = c.get("projectId");
    const { productionType, director } = await resolveActiveDirector(c.env, pid);
    return c.json({ productionType, director });
  });
}
