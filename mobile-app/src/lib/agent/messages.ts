// UI-driven agent turns — verbatim port of the message builders in the web
// app's AgentProvider.jsx. Every "Render / Stitch / Trim / Create" button
// builds one of these natural-language turns and sends it through the shared
// eve session; the agent loads the matching skill, generates via Higgsfield,
// and attaches the result (the SSE firehose then refreshes the screen).

export function renderSoundMessage(track: any, ver: any) {
  const label = `${track.id} v${ver.v}${ver.name ? ` (${ver.name})` : ''}`;
  return [
    `Render the pending sound version ${label} now.`,
    `Load the seed-audio skill, generate the audio from this version's exact prompt` +
      ` and params, then call attach_sound for ${track.id} v${ver.v} so it flips to` +
      ` "ready" and plays in the UI. Confirm the Higgsfield submit with me first, as usual.`,
    '',
    `Track: ${track.name || track.id}`,
    ver.duration ? `Target duration: ~${ver.duration}s` : null,
    '',
    'Prompt:',
    ver.prompt,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function renderEpisodeMessage(bundle: any, prompt: string) {
  const label = `${bundle.id}${bundle.beatTitle ? ` — ${bundle.beatTitle}` : ''}`;
  return [
    `Render episode bundle ${label} now — its revision is signed off.`,
    `Load the generate-multishot skill, render this bundle's multi-shot Seedance` +
      ` video from the exact prompt below (image + audio references included), then` +
      ` call attach_episode_video for ${bundle.id} with the resulting mp4 URL so the` +
      ` take shows up in the UI. Confirm the Higgsfield submit with me first, as usual.`,
    '',
    bundle.duration ? `Target duration: ~${bundle.duration}s` : null,
    '',
    'Prompt:',
    prompt,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function renderStoryboardMessage(bundle: any, shot: any, refBlock: string, angle?: string) {
  const label = `${bundle.id} / ${shot.id}`;
  const dlg = shot.dialogue && !/\(no dialogue\)/i.test(shot.dialogue) ? shot.dialogue : null;
  return [
    `Render a storyboard still for shot ${label}${angle ? ` — angle: ${angle}` : ''} now.`,
    `Load the generate-storyboard skill and generate ONE still image with Nano Banana` +
      ` Pro (the Higgsfield MCP generate_image tool) for this shot, using the character` +
      ` and location reference images below to lock identity and setting. Then call` +
      ` attach_still for bundle="${bundle.id}", shot="${shot.id}"${angle ? `, angle="${angle}"` : ''}` +
      ` with the resulting image URL so the still shows up in the Episode tab's Images` +
      ` mode. Confirm the Higgsfield submit with me first, as usual.`,
    '',
    `Shot ${shot.id} — ${shot.location || ''}${shot.camera ? ` · ${shot.camera}` : ''}${shot.dur ? ` (${shot.dur}s)` : ''}`,
    shot.summary ? `Action: ${shot.summary}` : null,
    dlg ? `Dialogue (for expression/pose only — it's a still): ${dlg}` : null,
    angle ? `Camera angle / variation for this take: ${angle}` : null,
    '',
    refBlock,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function renderStoryboardAllMessage(bundle: any, refBlock: string) {
  const shots = bundle.shots
    .map(
      (s: any) =>
        `- ${s.id}${s.dur ? ` (${s.dur}s)` : ''}${s.location ? `, ${s.location}` : ''}` +
        `${s.camera ? `, ${s.camera}` : ''}: ${s.summary || ''}`,
    )
    .join('\n');
  return [
    `Render a storyboard still for EVERY shot in bundle ${bundle.id}${bundle.beatTitle ? ` — ${bundle.beatTitle}` : ''} now, one at a time.`,
    `Load the generate-storyboard skill. For each shot below, generate ONE still with` +
      ` Nano Banana Pro (Higgsfield MCP generate_image), using the reference images to` +
      ` lock the characters and location, then call attach_still for that bundle + shot` +
      ` with the resulting image URL. Confirm the first Higgsfield submit with me, then` +
      ` proceed through the rest.`,
    '',
    'Shots:',
    shots,
    '',
    refBlock,
  ].join('\n');
}

export function createWorldMessage() {
  return [
    `Let's build the world for this series. Load the world-creation skill and follow it.`,
    ``,
    `Interview me with ask_question (a few focused questions at a time, building on my`,
    `answers) across all of it: the world / where it takes place, the protagonist and`,
    `their main goal, the antagonist, the stakes if they fail, and the theme; then the`,
    `deeper story — the premise (what it's really about beneath the plot), each main`,
    `character's want vs. need, the central conflict and why the audience should care,`,
    `the obstacles the protagonist faces and the consequences of failure, and the story`,
    `structure. Also build the character roster with type breakdowns.`,
    ``,
    `When you have enough, call save_world to write it into the World tab (call get_world`,
    `first if a world already exists so you don't clobber it). Then tell me to review it`,
    `on the World tab and that I can edit any field directly.`,
  ].join('\n');
}

export function generateShotListMessage() {
  return [
    `Generate the shot list from the script now — the pinned draft is signed.`,
    `Load the shot-list skill and follow it: call get_script, break the screenplay into an` +
      ` ordered list of short (~2-4s) shots, each with beat/location, camera, action,` +
      ` dialogue, an audio-sync note, and a Seedance prompt, then` +
      ` call save_shotlist. Do NOT render any video and do NOT pack the bundles yourself —` +
      ` the app auto-packs into <=15s multishots. When done, tell me how many shots you wrote` +
      ` and how many <=15s multishots they pack into.`,
  ].join('\n');
}

export function stitchCutMessage(range: any, count?: number) {
  const span = range?.from ? ` (${range.from} → ${range.to})` : '';
  return [
    `Re-stitch the complete cut${span} now.`,
    `Load the complete-cut skill, call get_cuts to confirm the current stitch plan,` +
      ` then stitch_cuts to concatenate the selected take of every bundle (in order).` +
      ` Pick up whatever takes are selected right now — I just changed a selection on` +
      ` the Episodes tab, so the new cut must reflect it. This mints a NEW version` +
      ` (the previous ones are kept in history) and, if background music was already` +
      ` added, the fresh cut is automatically re-scored so the newest version keeps` +
      ` the music. Tell me the new version number when it's done.`,
    count ? `\nExpecting ~${count} scenes in the cut.` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function scoreCutMessage(range: any) {
  const span = range?.from ? ` (${range.from} → ${range.to})` : '';
  return [
    `Add the background music to the complete cut${span} now — mint a new scored version.`,
    `Load the complete-cut skill and call score_cut to overlay the Sound Studio` +
      ` background-music cues UNDER the stitched cut at a low bed level so the baked-in` +
      ` dialogue and SFX stay dominant. Keep the previous versions for A/B.`,
  ].join('\n');
}

export function trimMessage(
  bundleId: string,
  sourceFile: string,
  from: number,
  to: number,
  sourceName?: string,
) {
  const s = (n: number) => Number(n).toFixed(2);
  const label = sourceName ? `${sourceName} (${sourceFile})` : sourceFile;
  return [
    `Trim the ${label} take of bundle ${bundleId} to ${s(from)}s → ${s(to)}s now.`,
    `Load the trim-video skill and call trim_video with bundle="${bundleId}",` +
      ` sourceFile="${sourceFile}", from=${s(from)}, to=${s(to)}. This runs ffmpeg` +
      ` to cut that sub-range and saves it as a NEW "trim" version next to the` +
      ` original (the original stays in history). It appears as an extra selectable` +
      ` card in this bundle's carousel with a TRIM VERSION badge. It's a local cut,` +
      ` not a Higgsfield render, so no confirmation is needed — just do it and tell` +
      ` me when the trim is ready.`,
  ].join('\n');
}

export function renderAllPendingMessage(tracks: any[]) {
  const pending: string[] = [];
  for (const t of tracks) {
    for (const v of t.versions) {
      if (v.status !== 'ready') {
        pending.push(`- ${t.id} v${v.v}${v.name ? ` (${v.name})` : ''} — ${t.name || t.id}`);
      }
    }
  }
  return [
    `Render all pending sound versions now, one at a time:`,
    ...pending,
    '',
    `For each: load the seed-audio skill, generate from that version's saved prompt` +
      ` and params, then attach_sound so it flips to "ready". Confirm each Higgsfield` +
      ` submit with me before generating, as usual.`,
  ].join('\n');
}
