// Pack a flat shot list into <=15s multishot bundles and compose each bundle's
// generate-multishot skill prompt. Ported from episode-multishot/build.mjs so the
// in-app Shot list tab groups shots exactly the way the offline build did.
//
// A bundle NEVER crosses a location: it breaks on beat change, packKey change, or
// overflow past the 15s Seedance-2.0 single-clip cap.

const MAX = 15; // Seedance 2.0 single-clip cap (seconds)

// Locked render style — prepended to every bundle prompt so all clips match.
const STYLE =
  "STYLE: Flat 2D hand-drawn animation, clean confident vector linework, strictly limited muted palette of teal, " +
  "mustard yellow and dusty rose, gouache-textured flat painterly backgrounds with subtle paper grain, Scandinavian " +
  "folklore storybook illustration style, soft diffused morning light, flat ambient shading with no gradients, " +
  "minimalist rounded character design with simple sparse facial features, strong graphic composition with generous " +
  "negative space. Split of panes when needed between front, middle and backgrounds. Slow gentle dolly-in with subtle " +
  "layered parallax on background planes, camera stays flat and 2D-friendly with no orbiting or perspective shifts. " +
  "Cozy, adventurous, slightly melancholic Nordic atmosphere. Smooth hand-drawn 2D animated motion. No hand held camera. " +
  "No 3D rendering, no photorealism, no CGI shading, no volumetric depth, no oversaturation.";

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
function buildBundles(shots) {
  return packShots(shots).map((b, i) => {
    const id = "MS-" + String(i + 1).padStart(2, "0");
    const charKeys = [...new Set(b.shots.flatMap((s) => s.characters || []))].map((c) => CHAR_REF[c]).filter(Boolean);
    const refKeys = [...new Set([...bgOf(b.shots[0].location), ...charKeys])];
    const images = refKeys.map((k) => ({ key: k, role: charKeys.includes(k) ? "character" : "location", available: !!REF[k], url: refUrl(k) }));
    const missing = images.filter((im) => !im.available).map((im) => im.key);
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

    const bibleLines = [...new Set(refKeys.map((k) => LOCATION_BIBLE[k]).filter(Boolean))];
    const bibleNote = bibleLines.length ? `LOCATION NOTES (keep consistent): ${bibleLines.join(" ")}\n` : "";

    const skillPrompt =
      NOFX + "\n" + STYLE + "\n" +
      `Use the generate-multishot skill to render ${id}.\n` +
      `Single location only — do NOT cross locations within this clip.\n` +
      `NO audio reference — set generate_audio: true so Seedance generates its own audio from the prompt.\n` +
      `Pass each image listed under IMAGE REFERENCES above as an image_references entry; apply it to the matching character/location wherever it appears in the shots.\n` +
      bibleNote +
      `Params: model seedance_2_0, resolution 720p, duration ${dur}s (<=15), aspect 16:9.\n` +
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
      images, missing, skillPrompt,
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

export { MAX, packShots, buildBundles, packPreview };
