#!/usr/bin/env node
// Dev-only sanity check for the FCPXML generator (worker/src/lib/fcpxml.js).
// Builds a synthetic timeline that exercises the tricky cases, runs the pure
// generator, and asserts the important invariants. Run: `node scripts/check-fcpxml.mjs`.
//
// If `xmllint` is on PATH it also checks XML well-formedness (there is no local
// DTD, so this is a syntax check only). Exits non-zero on any failure.

import { timelineToFcpxml } from "../worker/src/lib/fcpxml.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
const ok = (cond, msg) => {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else { console.error(`  ✗ ${msg}`); failures++; }
};

// Synthetic timeline: two video tracks (track 2 has an internal overlap), a music
// track with a bed gain + fades, a muted clip, a disabled clip, and XML/unicode
// specials in names. Same src reused across two clips to test asset dedupe.
const timeline = {
  fps: 24,
  width: 1280,
  height: 720,
  source: { kind: "scored", v: 7, file: "cut-scored-v7.mp4" },
  tracks: [
    {
      id: "video", name: "Video", type: "video",
      items: [
        { id: "v1", src: "/gen/MS-01.mp4", name: "MS-01 · A & B", from: 0, durationInFrames: 240, sourceDurationInFrames: 240, volume: 1 },
        { id: "v2", src: "/gen/MS-02.mp4", name: "MS-02 <hero>", from: 240, durationInFrames: 120, sourceDurationInFrames: 300, volume: 1 },
        { id: "v3", src: "/gen/MS-01.mp4", name: "MS-01 reused", from: 360, durationInFrames: 120, sourceDurationInFrames: 240, volume: 0.5 },
        // A split's right half: source in-point at 90 frames. No
        // sourceDurationInFrames on purpose — the asset duration must fall
        // back to covering offset + duration (90 + 110 = 200).
        { id: "v4", src: "/gen/SPLIT.mp4", name: "Split right half", from: 480, durationInFrames: 110, offsetFrames: 90, volume: 1 },
      ],
    },
    {
      id: "video2", name: "Video 2", type: "video",
      items: [
        // These two overlap (0-100 and 50-150) → the second must spill to a synthetic lane.
        { id: "vb1", src: "/gen/OVL-A.mp4", name: "Overlap A", from: 0, durationInFrames: 100, sourceDurationInFrames: 100 },
        { id: "vb2", src: "/gen/OVL-B.mp4", name: "Overlap B", from: 50, durationInFrames: 100, sourceDurationInFrames: 100 },
        { id: "vdis", src: "/gen/GONE.mp4", name: "disabled clip", from: 200, durationInFrames: 100, disabled: true },
      ],
    },
    {
      id: "music", name: "Music", type: "audio",
      items: [
        { id: "m1", src: "/sound-media/bed.mp3", name: "bed · loop", from: 0, durationInFrames: 480, volume: 0.08, fadeInFrames: 24, fadeOutFrames: 48 },
        { id: "m2", src: "/sound-media/hit.mp3", name: "muted hit", from: 100, durationInFrames: 60, volume: 1, muted: true },
      ],
    },
  ],
};

const { xml, media } = timelineToFcpxml(timeline, { projectName: "shot-studio scored v7" });

console.log("check-fcpxml:");

// 1. Disabled clip fully excluded (XML + manifest).
ok(!/disabled clip/.test(xml), "disabled clip absent from XML");
ok(!xml.includes("GONE.mp4") && !media.some((m) => m.zipName === "GONE.mp4"), "disabled-only src not in manifest");

// 2. Offsets/durations render as N/24s.
ok(/offset="240\/24s"/.test(xml), "offset 240/24s present (v2 start)");
ok(/duration="120\/24s"/.test(xml), "duration 120/24s present");
ok(/frameDuration="100\/2400s"/.test(xml), "format frameDuration 100/2400s");
ok(/duration="480\/24s"/.test(xml.split("<library>")[0]) || /duration="480\/24s"/.test(xml), "sequence/asset duration 480/24s present");

// 3. Volume 0.08 (music bed) → ~-21.9 dB (assert within ±0.2 of -22 dB). Pull the
//    amount from inside the bed clip specifically (v3 at 0.5 also emits -6dB).
const amts = [...xml.matchAll(/<adjust-volume amount="(-?\d+(?:\.\d+)?)dB"/g)].map((m) => Number(m[1]));
ok(amts.length >= 1, "adjust-volume amount emitted");
ok(amts.some((a) => Math.abs(a - -22) <= 0.2), `bed gain ≈ -22dB present (amounts: ${amts.join(", ")})`);

// 4. Fades emitted for the music bed.
ok(/<fadeIn type="linear" duration="24\/24s"\/>/.test(xml), "fadeIn 24/24s emitted");
ok(/<fadeOut type="linear" duration="48\/24s"\/>/.test(xml), "fadeOut 48/24s emitted");

// 5. Muted clip → -96 dB.
ok(/amount="-96dB"/.test(xml), "muted clip → -96dB");

// 6. Asset dedupe: MS-01.mp4 used by two clips → one <asset>, its duration is the
//    longest usage (240 source frames).
const ms01Assets = (xml.match(/<asset [^>]*name="MS-01\.mp4"/g) || []).length;
ok(ms01Assets === 1, `MS-01.mp4 deduped to a single <asset> (found ${ms01Assets})`);
const ms01Clips = (xml.replace(/\s+/g, " ").match(/<asset-clip [^>]*name="MS-01[^"]*"/g) || []).length;
ok(ms01Clips === 2, `MS-01 referenced by 2 asset-clips (found ${ms01Clips})`);

// 7. Overlap guard: the two overlapping clips land on different lanes.
// asset-clip attrs are ordered ref, lane, offset… — pull lane for each overlap clip.
const laneOf = (name) => {
  const flat = xml.replace(/\s+/g, " ");
  const re = new RegExp(`<asset-clip [^>]*lane="(-?\\d+)"[^>]*name="${name}"`);
  const m = re.exec(flat);
  return m ? m[1] : null;
};
ok(laneOf("Overlap A") !== null && laneOf("Overlap B") !== null && laneOf("Overlap A") !== laneOf("Overlap B"),
  `overlapping clips on distinct lanes (A=${laneOf("Overlap A")}, B=${laneOf("Overlap B")})`);

// 8. XML escaping of & < > and unicode passthrough.
ok(xml.includes("MS-01 · A &amp; B"), "& escaped in clip name (· passes through)");
ok(xml.includes("MS-02 &lt;hero&gt;"), "< > escaped in clip name");

// 9. Manifest deduped (7 unique kept srcs).
const expectSrcs = ["/gen/MS-01.mp4", "/gen/MS-02.mp4", "/gen/SPLIT.mp4", "/gen/OVL-A.mp4", "/gen/OVL-B.mp4", "/sound-media/bed.mp3", "/sound-media/hit.mp3"];
ok(media.length === expectSrcs.length && expectSrcs.every((s) => media.some((m) => m.src === s)),
  `manifest has ${expectSrcs.length} deduped srcs (got ${media.length})`);

// 10. Audio asset flags.
ok(/name="bed\.mp3"[^>]*hasVideo="0" hasAudio="1" audioSources="1"/.test(xml.replace(/\s+/g, " ")),
  "sound-media asset flagged audio-only");

// 11. Source in-point (offsetFrames): the split clip's asset-clip carries
//     start="90/24s", and its asset's duration covers offset + duration (200).
{
  const flat = xml.replace(/\s+/g, " ");
  const m = /<asset-clip [^>]*name="Split right half"[^>]*/.exec(flat);
  ok(m && / start="90\/24s"/.test(m[0]), `split clip start="90/24s" (${m ? m[0].match(/start="[^"]*"/)?.[0] : "clip missing"})`);
  const a = /<asset [^>]*name="SPLIT\.mp4"[^>]*/.exec(flat);
  ok(a && /duration="200\/24s"/.test(a[0]), `SPLIT.mp4 asset duration covers offset+duration (${a ? a[0].match(/duration="[^"]*"/)?.[0] : "asset missing"})`);
  // Untrimmed clips keep a zero start.
  const v2 = /<asset-clip [^>]*name="MS-02 &lt;hero&gt;"[^>]*/.exec(flat);
  ok(v2 && / start="0\/24s"/.test(v2[0]), "untrimmed clip start stays 0/24s");
}

// Optional: xmllint well-formedness (no DTD available, syntax only).
try {
  const dir = mkdtempSync(join(tmpdir(), "fcpxml-"));
  const f = join(dir, "project.fcpxml");
  writeFileSync(f, xml);
  execFileSync("xmllint", ["--noout", "--nonet", f], { stdio: "pipe" });
  ok(true, "xmllint --noout passed (well-formed XML)");
} catch (e) {
  if (e.code === "ENOENT") console.log("  · xmllint not on PATH — skipping well-formedness check");
  else { console.error(`  ✗ xmllint reported malformed XML:\n${e.stderr || e.message}`); failures++; }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
