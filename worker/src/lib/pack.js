// Pack a flat shot list into <=15s multishot bundles and compose each bundle's
// generate-multishot skill prompt. Ported from episode-multishot/build.mjs so the
// in-app Shot list tab groups shots exactly the way the offline build did.
//
// A bundle NEVER crosses a location: it breaks on beat change, packKey change, or
// overflow past the 15s Seedance-2.0 single-clip cap.
import { videoParamsText } from "./video-defaults.js";
import { isWideShot } from "./shots.js";
import { normalizeProductionType } from "./production-type.js";

const MAX = 15; // Seedance 2.0 single-clip cap (seconds)

// NOTE: the render STYLE is no longer baked into skillPrompt here. The manifest
// stores a style-free prompt; routes/episode.js prepends the episode/scene style
// selection (a visual-world style preset, or none) at read time, so switching
// styles restyles every bundle without a rebuild.

// Lead line so Seedance doesn't add a music bed / flashy transition VFX that gets
// hard-cut when bundles are spliced together.
const NOFX = "NO VISUAL EFFECTS AND NO BACKGROUND MUSIC.";

// reference registry: key -> file under shot-by-shot (served at /refs/...)
const REF = {
  sara: "character/sara.png",
  helena: "character/helena.png",
  king: "character/king.png",
  forest: "location/forest.png",
  school: "location/school.png",
  "forest-path": null, "forest-path-night": null, "forest-hollow": null,
  "forest-hollow-dusk": null, "forest-boundary-night": null, "forest-night": null,
  "forest-montage": null, mote: null, "elf-kids": null, "boundary-stone": null,
  "kings-house": null, "deep-wood": null, "whistlewood-aerial": null,
};
const CHAR_REF = { Sara: "sara", Helena: "helena", "Forest King": "king", Mote: "mote", "Elf kids": "elf-kids" };

// location -> { group, bg:[refKeys] }. Group = packing/reference boundary.
const LOC = {
  "school-clearing": { group: "school-clearing", bg: ["forest", "school"] },
  "forest-path": { group: "forest-path", bg: ["forest-path"] },
  "deep-wood-edge": { group: "forest-path", bg: ["forest-path", "deep-wood"] },
  "boundary-stone-hollow": { group: "hollow", bg: ["forest-hollow", "boundary-stone"] },
  "whispery-hollow": { group: "hollow", bg: ["forest-hollow", "boundary-stone"] },
  "whispery-hollow-dusk": { group: "hollow-dusk", bg: ["forest-hollow-dusk", "boundary-stone"] },
  "kings-house-entrance": { group: "kings-house", bg: ["kings-house"] },
  "kings-house-window": { group: "kings-house", bg: ["kings-house"] },
  "kings-house-tea-nook": { group: "kings-house", bg: ["kings-house"] },
  "kings-house-door": { group: "kings-house", bg: ["kings-house"] },
  "night-clearing": { group: "night-clearing", bg: ["forest-night"] },
  "boundary-stone-night": { group: "boundary-stone-night", bg: ["forest-boundary-night", "boundary-stone"] },
  "deep-wood-night": { group: "boundary-stone-night", bg: ["deep-wood", "boundary-stone"] },
  "forest-path-night": { group: "forest-path-night", bg: ["forest-path-night"] },
  "whistlewood-aerial": { group: "whistlewood-aerial", bg: ["whistlewood-aerial"] },
};
const groupOf = (loc) => (String(loc).startsWith("montage-") ? "montage" : (LOC[loc]?.group || loc));
const bgOf = (loc) => (String(loc).startsWith("montage-") ? ["forest-montage"] : (LOC[loc]?.bg || []));
const packKey = (loc) => (String(loc).startsWith("montage-") ? loc : groupOf(loc));

// Canonical look of recurring locations, injected into the skill prompt of any
// bundle that uses them so the same place reads consistently across scenes.
const LOCATION_BIBLE = {
  "boundary-stone":
    "BOUNDARY STONE = forest trees around a single BIG mossy grey stone/boulder, with a weathered WOODEN SIGN on a post STUCK IN THE GROUND beside it reading \"VILLAGE LIMIT\". This same big stone + wooden 'VILLAGE LIMIT' sign appears in every boundary scene — keep it identical.",
  "deep-wood": "DEEP WOOD = the darker, denser forest BEYOND the village-limit stone; same palette, cooler and more shadowed, trees closer together.",
  "kings-house": "KING'S HOUSE = vast cozy interior of a house grown from a living tree: curving bark walls, firefly-light lanterns, a stair spiralling into leaves, an impossibly high ceiling; warm amber interior.",
  "forest-path": "FOREST PATH = the mossy walking path through the village forest; same palette, its own arrangement of trees and plants (distinct from the opening clearing).",
  "forest-hollow": "HOLLOW = the clearing right at the village-limit stone where the hidey-bushes grow; same palette, its own trees/plant layout.",
  "forest-montage": "MONTAGE FOREST = the wider night woods; same palette in deep indigo, its own trees/plants per montage spot.",
};

const beatTitleOf = (shots) => shots.find((s) => s.beatTitle)?.beatTitle || "";
const refUrl = (key) => (REF[key] ? "/refs/" + REF[key] : null);

// Case-insensitive character identity, shared with routes/episode.js.
const charKey = (s) => String(s || "").trim().toUpperCase();

// Speakers of a bundle, following the radio convention (routes/radio.js
// deriveLine): a "NAME:" dialogue prefix names the speaker, else the shot's
// first on-screen character speaks. A silent background character needs a
// sheet but not a voice.
const NO_DIALOGUE = /^\(?\s*no dialogue\s*\)?\.?$/i;
function bundleSpeakers(b) {
  const out = new Map(); // charKey -> display name
  for (const s of b.shots || []) {
    const raw = String(s.dialogue || "").trim();
    if (!raw || NO_DIALOGUE.test(raw)) continue;
    const chars = (s.characters || []).filter(Boolean);
    let speaker = chars[0] || "";
    const m = /^\s*([A-Za-z][A-Za-z0-9 .'’-]{0,30}?):\s*/.exec(raw);
    if (m) {
      const named = m[1].trim();
      speaker = chars.find((c) => charKey(c) === charKey(named)) || named;
    }
    if (speaker && !out.has(charKey(speaker))) out.set(charKey(speaker), speaker);
  }
  return out;
}

// Index the World bible's rosters for lookups: characters by charKey(name),
// locations by slug (the shot-list `location` string).
function rosterOf(world) {
  const characters = new Map();
  for (const ch of world?.characters || []) {
    const k = charKey(ch.name);
    if (k && !characters.has(k)) characters.set(k, ch);
  }
  const locations = new Map();
  for (const l of world?.locations || []) {
    const slug = String(l.slug || "").trim();
    if (slug && !locations.has(slug)) locations.set(slug, l);
  }
  return { characters, locations };
}

// A bundle's reference needs sourced from the World roster: one location entry
// per distinct shot location (keyed by slug), one character entry per distinct
// on-screen character (keyed by display name). `available` = a sheet image is
// linked in the World; missing entries surface on the episode tab so the user
// knows to generate/link the sheet before rendering.
function rosterImages(b, roster, { miniatures = false } = {}) {
  const images = [];
  const seenLoc = new Set();
  const seenChar = new Set();
  for (const s of b.shots) {
    const slug = String(s.location || "").trim();
    if (slug && !seenLoc.has(slug)) {
      seenLoc.add(slug);
      const loc = roster.locations.get(slug);
      images.push({
        key: slug, role: "location",
        available: !!loc?.sheetImage?.rel,
        url: loc?.sheetImage?.url || null,
      });
    }
  }
  for (const s of b.shots) {
    for (const name of s.characters || []) {
      const k = charKey(name);
      if (!k || seenChar.has(k)) continue;
      seenChar.add(k);
      const ch = roster.characters.get(k);
      images.push({
        key: ch?.name || name, role: "character",
        available: !!ch?.sheetImage?.rel,
        url: ch?.sheetImage?.url || null,
      });
    }
  }
  // MINIATURE needs (2D projects only): a character standing on a WIDE /
  // establishing shot is too small in frame for the portrait-heavy character
  // sheet to read, so a full-figure MINIATURE reference is offered for them. One
  // entry per distinct character that appears on any wide shot in the bundle,
  // keyed the same as the character need but with role "miniature". Marked
  // `optional` — it surfaces on the Episode needs checklist and prompts the
  // author, but (unlike a sheet) never blocks signing or render.
  if (miniatures) {
    const seenMini = new Set();
    for (const s of b.shots) {
      if (!isWideShot(s)) continue;
      for (const name of s.characters || []) {
        const k = charKey(name);
        if (!k || seenMini.has(k)) continue;
        seenMini.add(k);
        const ch = roster.characters.get(k);
        images.push({
          key: ch?.name || name, role: "miniature", optional: true,
          available: !!ch?.miniatureImage?.rel,
          url: ch?.miniatureImage?.url || null,
        });
      }
    }
  }
  return images;
}

// Group an ordered flat shot list into <=15s bundles.
function packShots(shots) {
  const bundles = [];
  let cur = null;
  for (const s of shots) {
    const dur = Number(s.dur) || 0;
    const key = packKey(s.location);
    const fits = cur && cur.beat === s.beat && cur.key === key && cur.total + dur <= MAX;
    if (!fits) {
      cur = { beat: s.beat, group: groupOf(s.location), key, total: 0, shots: [] };
      bundles.push(cur);
    }
    cur.shots.push(s);
    cur.total = +(cur.total + dur).toFixed(1);
  }
  return bundles;
}

// Build full bundle manifest objects (id, refs, ready-to-paste skillPrompt) from
// the packed bundles — the same shape as multishot_bundles.json `bundles[]`.
// `world` is the project's World bible doc; when its roster has any characters
// or locations, each bundle's reference needs (`images`) come from the roster
// (location sheets by slug, character sheets by name). The hardcoded
// Whistlewood REF/LOC/CHAR_REF maps survive ONLY as the fallback for projects
// with an empty World roster (the original offline-built episode).
// `genSettings` is the `visual-world` doc's `settings` — only its Seedance
// videoModel/videoResolution are read, to write the bundle's `Params:` line.
// Omit it and the line falls back to the Seedance 2.0 / 720p defaults.
function buildBundles(shots, world, genSettings) {
  const roster = rosterOf(world);
  const videoParams = videoParamsText(genSettings);
  const hasRoster = roster.characters.size > 0 || roster.locations.size > 0;
  // Miniature references are a 2D-animation affordance: on a wide shot the
  // character is too small for the sheet to read (see rosterImages).
  const is2d = normalizeProductionType(world?.productionType) === "2d";
  return packShots(shots).map((b, i) => {
    const id = "MS-" + String(i + 1).padStart(2, "0");
    let images;
    if (hasRoster) {
      images = rosterImages(b, roster, { miniatures: is2d });
    } else {
      const charKeys = [...new Set(b.shots.flatMap((s) => s.characters || []))].map((c) => CHAR_REF[c]).filter(Boolean);
      const refKeys = [...new Set([...bgOf(b.shots[0].location), ...charKeys])];
      images = refKeys.map((k) => ({ key: k, role: charKeys.includes(k) ? "character" : "location", available: !!REF[k], url: refUrl(k) }));
    }
    // Optional needs (miniatures) never count as "missing" — a character with a
    // sheet but no miniature must not read as an unfulfilled reference.
    const missing = images.filter((im) => !im.available && !im.optional).map((im) => im.key);
    const hasMiniature = images.some((im) => im.role === "miniature");
    const speakers = [...bundleSpeakers(b).values()];
    const dur = Math.min(MAX, Math.ceil(b.total));
    const title = `${id} · ${beatTitleOf(b.shots)} (shots ${b.shots[0].id}–${b.shots[b.shots.length - 1].id})`;

    const shotScript = b.shots
      .map((s, j) => {
        const noDialogue = /\(?no dialogue\)?/i.test(s.dialogue || "") || !s.dialogue;
        return (
          `SHOT ${j + 1} (${s.dur}s) — ${s.camera}\n` +
          `  ${s.action}\n` +
          (noDialogue ? `  Dialogue: none\n` : `  Dialogue: ${s.dialogue}\n`) +
          `  Seedance: ${s.prompt}`
        );
      })
      .join("\n\n");

    // Canonical-look notes: the World location descriptions (roster path) or the
    // hardcoded Whistlewood LOCATION_BIBLE (fallback path).
    const bibleLines = hasRoster
      ? [...new Set(
          images
            .filter((im) => im.role === "location")
            .map((im) => {
              const l = roster.locations.get(im.key);
              const desc = String(l?.description || "").trim();
              return desc ? `${String(l?.name || im.key).toUpperCase()} = ${desc}` : null;
            })
            .filter(Boolean),
        )]
      : [...new Set(images.map((im) => LOCATION_BIBLE[im.key]).filter(Boolean))];
    const bibleNote = bibleLines.length ? `LOCATION NOTES (keep consistent): ${bibleLines.join(" ")}\n` : "";

    const skillPrompt =
      NOFX + "\n" +
      `Use the generate-multishot skill to render ${id}.\n` +
      `Single location only — do NOT cross locations within this clip.\n` +
      `Audio: pass each VOICE / SOUND REFERENCE listed above as the matching character's voice — encode the clip to a black-screen MP4 and send it as a video_references entry (the generate-multishot skill's voice path), generate_audio: true, dialogue from the SHOT lines below. With no voice references listed, set generate_audio: true so Seedance generates its own audio from the prompt.\n` +
      `Pass each image listed under IMAGE REFERENCES above as an image_references entry; apply it to the matching character/location wherever it appears in the shots.\n` +
      (hasMiniature
        ? `Wide/establishing shots: where a character's MINIATURE (full-figure) reference is provided, pass it too as an image_references entry — it keeps a small-in-frame character's silhouette, proportions and outfit reading correctly when they are too small for the close-up sheet.\n`
        : "") +
      bibleNote +
      `Params: ${videoParams}, duration ${dur}s (<=15), aspect 16:9.\n` +
      `Compose ONE continuous multishot clip from these ${b.shots.length} ordered shots, lip-syncing any dialogue:\n\n` +
      shotScript;

    return {
      id, title, beat: b.beat, beatTitle: beatTitleOf(b.shots), group: b.group,
      durationEst: b.total, duration: dur,
      shots: b.shots.map((s) => ({
        id: s.id, src: s.src, dur: s.dur, location: s.location, camera: s.camera,
        characters: s.characters || [], summary: s.action,
        dialogue: s.dialogue, audioSync: s.audioSync || "", prompt: s.prompt,
      })),
      images, missing, speakers, skillPrompt,
    };
  });
}

// Lightweight preview: just which shots land in each <=15s pack (+ its duration).
function packPreview(shots) {
  return packShots(shots).map((b, i) => ({
    id: "MS-" + String(i + 1).padStart(2, "0"),
    beat: b.beat,
    beatTitle: beatTitleOf(b.shots),
    group: b.group,
    durationEst: b.total,
    duration: Math.min(MAX, Math.ceil(b.total)),
    shotIds: b.shots.map((s) => s.id),
    from: b.shots[0].id,
    to: b.shots[b.shots.length - 1].id,
    count: b.shots.length,
  }));
}

export { MAX, packShots, buildBundles, packPreview, charKey, bundleSpeakers };
