#!/usr/bin/env node
/**
 * Save a "Seed Audio prompt" record for every rendered sound version.
 *
 * For each track version that has an attached media file, this writes a
 * `<file>.seed.txt` sidecar into sound-studio/media/ containing the full
 * prompt + config + reference + Higgsfield job + post-processing, and bakes
 * `seedText` / `seedFile` / `seedUrl` onto the version in sounds.json so the
 * Sound Studio UI can show and download it.
 *
 * Re-run after every audio generation:  node shot-studio/scripts/seed-sidecars.cjs
 */
const fs = require("fs");
const path = require("path");

// sound-studio/ now lives inside shot-studio/ (co-located with the app it
// belongs to); __dirname is shot-studio/scripts, so the app root is one up.
const ROOT = path.resolve(__dirname, "..");
const DB = path.join(ROOT, "sound-studio/sounds.json");
const MEDIA = path.join(ROOT, "sound-studio/media");

function seedText(track, v) {
  const p = v.params || {};
  const cfg = [
    `model: ${p.model || "seed_audio"}`,
    `format: ${p.format || "wav"}`,
    `sample_rate: ${p.sample_rate ?? 48000}`,
    `speech_rate: ${p.speech_rate ?? 0}`,
    `loudness_rate: ${p.loudness_rate ?? 0}`,
    `pitch_rate: ${p.pitch_rate ?? 0}`,
  ];
  if (v.ref) cfg.push(`voice_reference: ${v.ref.name || ""} (${v.ref.file || ""})`);
  return (
    [
      `SEED AUDIO PROMPT`,
      `track: ${track.name}  (${track.id})`,
      `version: v${v.v}${v.name ? ` — ${v.name}` : ""}`,
      `status: ${v.status || ""}${v.duration ? `   duration: ${v.duration}s` : ""}`,
      v.ts ? `generated: ${v.ts}` : null,
      ``,
      `── PROMPT ─────────────────────────────────────────`,
      (v.prompt || "").replace(/\\n/g, "\n"),
      ``,
      `── CONFIG ─────────────────────────────────────────`,
      ...cfg,
      ``,
      `── SOURCE / POST-PROCESSING ───────────────────────`,
      v.source || "(n/a)",
    ]
      .filter((x) => x !== null)
      .join("\n") + "\n"
  );
}

const db = JSON.parse(fs.readFileSync(DB, "utf8"));
let n = 0;
for (const t of db.tracks || []) {
  for (const v of t.versions || []) {
    if (!v.file) continue; // only rendered generations
    const sidecar = v.file.replace(/\.[^.]+$/, "") + ".seed.txt";
    fs.writeFileSync(path.join(MEDIA, sidecar), seedText(t, v));
    v.seedText = seedText(t, v);
    v.seedFile = sidecar;
    v.seedUrl = "/sound-media/" + sidecar;
    n++;
  }
}
fs.writeFileSync(DB, JSON.stringify(db, null, 2));
console.log(`seed-sidecars: wrote ${n} .seed.txt files across ${db.tracks.length} tracks`);
