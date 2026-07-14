// Pure timeline JSON → FCPXML 1.9 generator for the "Export for Resolve" flow.
//
// The editor timeline (see src/editor/timeline.js) is a tiny model — hard cuts,
// multiple video/audio tracks, per-clip linear gain, linear audio fades, and a
// per-clip source in-point (`offsetFrames` — set by splits and head trims), all
// measured in integer frames at 24 fps. This maps cleanly onto FCPXML, which
// DaVinci Resolve imports natively (File → Import → Timeline).
//
// This module is a PURE function: no I/O, no env, no fetch. It turns a timeline
// into an FCPXML string plus a deduped media manifest (src → flat zip filename).
// The export endpoint (worker/src/routes/export.js) resolves the manifest srcs to
// R2 objects and streams a ZIP so Resolve relinks the media by relative path.
//
// Design notes baked in here (see docs/davinci-resolve-export.md):
//  • Gap-backbone spine: one <gap> spans the whole timeline and every clip is a
//    CONNECTED asset-clip child with a `lane`, so every `offset` is an absolute
//    timeline position — no parent-relative offset math (the classic exporter bug).
//  • Video track i → lane i+1; audio track j → lane -(j+1). Overlapping clips in
//    one lane spill to a synthetic extra lane (Resolve can't stack them otherwise).
//  • No transitions/titles/effects. A clip's `start` attribute carries its
//    source in-point (`offsetFrames`) — 0s for untrimmed heads.

// --- small helpers ---------------------------------------------------------

const XML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
// Escape the five XML specials in any interpolated attribute value. UTF-8 (·, etc.)
// is fine as-is; only these five must become entities.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => XML_ESC[ch]);

// Basename of a root-relative media URL, URL-decoded (drops any ?query/#hash).
function basename(src) {
  const clean = String(src || "").split(/[?#]/)[0];
  const last = clean.split("/").pop() || "";
  try { return decodeURIComponent(last); } catch { return last; }
}

// "/gen/MS-01.mp4" → "gen". null-ish for odd shapes.
const prefixOf = (src) => (/^\/([^/]+)\//.exec(src || "") || [])[1] || null;

// Music/audio media lives under /sound-media/; everything else (/gen/, /media/…)
// is a generated video clip that carries baked-in audio.
const isAudioSrc = (src) => /^\/sound-media\//.test(src || "");

const round1 = (n) => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Greedy first-fit lane packing for one track's items. Items keep the track's
// primary lane where they can; anything that would overlap an already-placed clip
// in the same lane spills to a fresh lane from `allocFresh()`. Never overlaps.
function packLanes(items, primaryLane, allocFresh) {
  const sorted = [...items].sort((a, b) => (a.from || 0) - (b.from || 0));
  const lanes = [{ lane: primaryLane, end: -Infinity }];
  const out = [];
  for (const it of sorted) {
    const start = it.from || 0;
    const end = start + (it.durationInFrames || 0);
    let slot = lanes.find((L) => start >= L.end);
    if (!slot) { slot = { lane: allocFresh(), end: -Infinity }; lanes.push(slot); }
    slot.end = end;
    out.push({ item: it, lane: slot.lane });
  }
  return out;
}

// --- main ------------------------------------------------------------------

// timeline: the editor timeline JSON (see src/editor/timeline.js §Shape)
// opts: { projectName: string }
// returns { xml: string, media: [ { src, zipName } ] }
//   media = deduped list of every referenced item.src that made it into the XML,
//   with the flat filename used inside the zip's media/ folder.
export function timelineToFcpxml(timeline, opts = {}) {
  const fps = timeline?.fps || 24;
  const width = timeline?.width || 1280;
  const height = timeline?.height || 720;
  const projectName = opts.projectName || "shot-studio timeline";

  const rt = (frames) => `${Math.round(frames || 0)}/${fps}s`; // frames → rational seconds
  const frameDuration = `100/${fps * 100}s`; // Apple's ×100 convention (e.g. 100/2400s)

  // 1. Collect kept items per track, split by type, in timeline order. Drop
  //    disabled items (matches the player/render) and any item without a src
  //    (can't be exported — nothing to relink).
  const videoTracks = [];
  const audioTracks = [];
  for (const track of timeline?.tracks || []) {
    if (track?.type !== "video" && track?.type !== "audio") continue;
    const items = (track.items || []).filter((it) => it && it.disabled !== true && it.src);
    (track.type === "video" ? videoTracks : audioTracks).push(items);
  }
  const allKept = [...videoTracks.flat(), ...audioTracks.flat()];

  // 2. Timeline duration = furthest clip end (same logic as timelineDuration);
  //    minimum 1 frame.
  let totalFrames = 0;
  for (const it of allKept) totalFrames = Math.max(totalFrames, (it.from || 0) + (it.durationInFrames || 0));
  totalFrames = Math.max(1, Math.round(totalFrames));

  // 3. Lane layout. Base lanes are the track indices; overlap spill uses fresh
  //    lanes beyond the base range so synthetic lanes never collide with a base
  //    lane of another track.
  let nextPos = videoTracks.length + 1;
  let nextNeg = -(audioTracks.length + 1);
  const allocPos = () => nextPos++;
  const allocNeg = () => nextNeg--;
  const clips = []; // { item, lane, isAudio }
  videoTracks.forEach((items, i) => {
    for (const p of packLanes(items, i + 1, allocPos)) clips.push({ item: p.item, lane: p.lane, isAudio: false });
  });
  audioTracks.forEach((items, j) => {
    for (const p of packLanes(items, -(j + 1), allocNeg)) clips.push({ item: p.item, lane: p.lane, isAudio: true });
  });

  // 4. Assets — one per unique src. Dedup preserves first-seen order for stable
  //    a1/a2 ids. Asset duration = the longest usage (source length preferred).
  const uniqueSrcs = [];
  const seen = new Set();
  for (const it of allKept) if (!seen.has(it.src)) { seen.add(it.src); uniqueSrcs.push(it.src); }

  const assetDur = new Map();
  for (const it of allKept) {
    // The declared asset length must cover the deepest usage — with a source
    // in-point that's offset + duration, or Resolve sees a clip reading past
    // the end of its asset.
    const d = it.sourceDurationInFrames || (it.offsetFrames || 0) + (it.durationInFrames || 1);
    assetDur.set(it.src, Math.max(assetDur.get(it.src) || 0, d));
  }

  // zipName: basename, URL-decoded. On a basename collision between two different
  // srcs, disambiguate by prefixing the kind (e.g. sound-media__foo.mp3).
  const zipNameBySrc = new Map();
  const takenZip = new Set();
  for (const src of uniqueSrcs) {
    let name = basename(src) || "clip";
    if (takenZip.has(name)) {
      const kind = prefixOf(src) || "media";
      name = `${kind}__${basename(src) || "clip"}`;
      let n = 2;
      while (takenZip.has(name)) name = `${kind}__${n++}__${basename(src) || "clip"}`;
    }
    takenZip.add(name);
    zipNameBySrc.set(src, name);
  }

  const assetIdBySrc = new Map();
  uniqueSrcs.forEach((src, i) => assetIdBySrc.set(src, `a${i + 1}`));

  // --- resources ---
  const STD_HEIGHTS = new Set([360, 480, 576, 720, 1080, 1440, 2160]);
  const STD_FPS = new Set([24, 25, 30, 50, 60]);
  const fmtName = STD_HEIGHTS.has(height) && STD_FPS.has(fps) ? ` name="FFVideoFormat${height}p${fps}"` : "";

  const formatXml =
    `    <format id="r1"${fmtName} frameDuration="${frameDuration}" width="${width}" height="${height}"/>`;

  const assetsXml = uniqueSrcs.map((src) => {
    const id = assetIdBySrc.get(src);
    const zipName = zipNameBySrc.get(src);
    const dur = rt(assetDur.get(src));
    const flags = isAudioSrc(src)
      ? `hasVideo="0" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"`
      : `hasVideo="1" hasAudio="1"`;
    return (
      `    <asset id="${id}" name="${esc(zipName)}" start="0s" duration="${dur}" ${flags} format="r1">\n` +
      `      <media-rep kind="original-media" src="./media/${esc(zipName)}"/>\n` +
      `    </asset>`
    );
  }).join("\n");

  const resourcesXml = [formatXml, assetsXml].filter(Boolean).join("\n");

  // --- volume / mute / fades → <adjust-volume> ---
  const adjustVolume = (item, isAudio) => {
    const muted = item.muted === true;
    const vol = item.volume;
    const fi = isAudio ? (item.fadeInFrames || 0) : 0;
    const fo = isAudio ? (item.fadeOutFrames || 0) : 0;
    const hasVol = muted || (vol != null && vol !== 1);
    const hasFade = fi > 0 || fo > 0;
    if (!hasVol && !hasFade) return "";

    let amount;
    if (muted || (vol != null && vol <= 0)) amount = -96;
    else if (vol == null) amount = 0; // fades only, unity gain
    else amount = clamp(20 * Math.log10(vol), -96, 12);

    const inner = [];
    if (fi > 0) inner.push(`          <fadeIn type="linear" duration="${rt(fi)}"/>`);
    if (fo > 0) inner.push(`          <fadeOut type="linear" duration="${rt(fo)}"/>`);
    const open = `        <adjust-volume amount="${round1(amount)}dB"`;
    return inner.length ? `${open}>\n${inner.join("\n")}\n        </adjust-volume>` : `${open}/>`;
  };

  // --- spine (gap-backbone) ---
  const clipsXml = clips.map(({ item, lane, isAudio }) => {
    const ref = assetIdBySrc.get(item.src);
    const name = item.name || zipNameBySrc.get(item.src);
    const av = adjustVolume(item, isAudio);
    // `start` = source in-point: FCPXML's clip-local start of the used media
    // range. rt(0) renders "0/24s", which Resolve accepts like "0s".
    const head =
      `        <asset-clip ref="${ref}" lane="${lane}" offset="${rt(item.from || 0)}" ` +
      `name="${esc(name)}" start="${rt(item.offsetFrames || 0)}" duration="${rt(item.durationInFrames || 1)}" format="r1" tcFormat="NDF"`;
    return av ? `${head}>\n${av}\n        </asset-clip>` : `${head}/>`;
  }).join("\n");

  const total = rt(totalFrames);
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE fcpxml>\n` +
    `<fcpxml version="1.9">\n` +
    `  <resources>\n${resourcesXml}\n  </resources>\n` +
    `  <library>\n` +
    `    <event name="shot-studio">\n` +
    `      <project name="${esc(projectName)}">\n` +
    `        <sequence format="r1" duration="${total}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n` +
    `          <spine>\n` +
    `            <gap name="Timeline" offset="0s" start="0s" duration="${total}">\n` +
    (clipsXml ? clipsXml + "\n" : "") +
    `            </gap>\n` +
    `          </spine>\n` +
    `        </sequence>\n` +
    `      </project>\n` +
    `    </event>\n` +
    `  </library>\n` +
    `</fcpxml>\n`;

  const media = uniqueSrcs.map((src) => ({ src, zipName: zipNameBySrc.get(src) }));
  return { xml, media };
}
