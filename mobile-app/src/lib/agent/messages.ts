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

// Build the chat turn that kicks off the VISUAL world exploration — the "Let the
// agent explore" button on the World tab's Visual world surface. Verbatim port of
// the web AgentProvider's createVisualWorldMessage.
export function createVisualWorldMessage(hint?: string) {
  return [
    `Let's explore the VISUAL world for this series — how the characters and places`,
    `actually look. Load the visual-world skill and follow it.`,
    ``,
    hint
      ? `Focus: ${hint}`
      : `Start from the written world (get_world) and the visual world so far` +
        ` (get_visual_world). Propose a few characters/places to visualize, then generate`,
    `concept images with Nano Banana Pro (Higgsfield MCP generate_image), using the 2D`,
    `prompt preset for the house style. Generate a small batch, and when the user likes a`,
    `direction, iterate by passing a chosen image back as an image reference.`,
    ``,
    `Attach every result with attach_visual_generation so it appears on the World › Visual`,
    `tab immediately. Keep the chat concise; the images do the talking.`,
  ].join('\n');
}

// Inline "change this passage" request from the Script tab's edit sheet (Ask
// agent tab): the user tapped a block of the screenplay and typed the change
// they want. Verbatim port of the web AgentProvider's scriptEditRequest — routed
// through the agent (the script-writing skill) so it proposes the edit as a diff
// scoped to that passage — propose → confirm → apply, like every other change.
export function scriptEditRequest(selectedText: string, instruction: string) {
  return [
    `The user is on the Script tab and has selected these lines of the screenplay that need to change:`,
    ``,
    `"""`,
    selectedText,
    `"""`,
    ``,
    `The specific request is: ${instruction}`,
    ``,
    `Load the script-writing skill and follow it: call get_script to read the current pinned` +
      ` draft, locate this exact passage, and propose an edit that applies the request to just` +
      ` these lines while leaving the rest of the script untouched. Propose it as a diff` +
      ` (save_script / append_script) and confirm before applying — don't commit it until the` +
      ` user says so.`,
  ].join('\n');
}

// The Script tab edit sheet's other mode (Edit tab): the user rewrote the block's
// text directly rather than describing a change. Same propose → confirm → apply
// contract, but the agent is handed the exact new text to swap in.
export function scriptRewriteRequest(original: string, edited: string) {
  return [
    `The user is on the Script tab and tapped this passage of the screenplay to edit it inline:`,
    ``,
    `Original:`,
    `"""`,
    original,
    `"""`,
    ``,
    `They rewrote it to read:`,
    `"""`,
    edited,
    `"""`,
    ``,
    `Load the script-writing skill and follow it: call get_script to read the current pinned` +
      ` draft, locate this exact passage, and propose replacing it with the rewritten version` +
      ` while leaving the rest of the script untouched. Propose it as a diff (save_script /` +
      ` append_script) and confirm before applying — don't commit it until I say so.`,
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

// Render every line of one radio scene — the Radio screen's "Render scene".
// Verbatim port of the web AgentProvider's renderRadioSceneMessage. Each line's
// reference clip is the ABSOLUTE /files/ url (voiceRef.refUrl): the project-
// scoped /sound-media/ one 404s for the agent's sandbox, which sends no project
// header.
export function renderRadioSceneMessage(scene: any, lines: any[]) {
  const rows = lines.map((l) => {
    const clip = l.voiceRef?.refUrl || l.voiceRef?.url;
    const voice = clip
      ? `voiced by ${l.voiceRef.name || 'their voice'} (reference clip: ${clip})`
      : `NO VOICE CAST — skip or ask me to cast a voice first`;
    return `- line ${l.id} — ${l.character || '?'} ${voice}: "${l.text}"`;
  });
  return [
    `Render the radio dialogue for scene "${scene.beatTitle || scene.beat}" now.`,
    `Load the radio skill and follow it. For EACH line below, voice it with Seed Audio` +
      ` using that character's reference voice clip so the character sounds consistent,` +
      ` then attach it and call attach_radio_take with the line id so it shows up under` +
      ` the line on the Radio tab. Confirm the first Higgsfield submit with me, then` +
      ` proceed through the rest of the scene.`,
    '',
    'Lines (in order):',
    ...rows,
    '',
    `Each line's reference clip is an absolute public URL — download it directly (curl/web_fetch)` +
      ` and upload it as the Seed Audio audio_references clip (@Audio1) so the voice matches.` +
      ` Keep each take to just the spoken line, clean (no music, no SFX).`,
  ].join('\n');
}

// Re-voice ONE radio line — the line's "Recreate take". The worker APPENDS the
// new take as another version and auto-selects it, so the prior take stays
// available behind the version pills. Same skill/flow as a full scene render,
// scoped to a single line. Verbatim port of the web AgentProvider's
// recreateRadioLineMessage.
export function recreateRadioLineMessage(scene: any, line: any) {
  const clip = line.voiceRef?.refUrl || line.voiceRef?.url;
  const voice = clip
    ? `voiced by ${line.voiceRef.name || 'their voice'} (reference clip: ${clip})`
    : `NO VOICE CAST — ask me to cast a voice first`;
  return [
    `Re-render ONLY this one radio line (a fresh take) — everything else stays as is.`,
    `Load the radio skill and follow it for this single line: voice it with Seed Audio` +
      ` using the character's reference voice clip so it stays consistent, attach it, and` +
      ` call attach_radio_take with the line id. The new take is added as another version` +
      ` under the line and becomes the selected one automatically.`,
    '',
    `- line ${line.id} — ${line.character || '?'} ${voice}: "${line.text}"`,
    '',
    `The reference clip is an absolute public URL — download it directly (curl/web_fetch)` +
      ` and upload it as the Seed Audio audio_references clip (@Audio1). Keep the take to just` +
      ` the spoken line, clean (no music, no SFX).`,
  ].join('\n');
}

// The editorial second pass behind "Agent pacing". The gapless first pass was
// JUST sent to the Editor (POST /api/radio/to-editor); this asks the agent to
// re-time the space between takes from the Shot list so the audio-only cut
// plays like a story. Mirrors the radio-pacing skill (move ops only — never
// resize or reorder). Verbatim port of the web builder.
export function paceRadioTimelineMessage() {
  return [
    `I just sent the radio version to the Editor — the gapless first pass, every voiced` +
      ` line back-to-back on the Dialogue track. Do the editorial pacing pass now.`,
    ``,
    `Load the radio-pacing skill and follow it: read the timeline (get_timeline) and the` +
      ` Shot list (get_shotlist), then re-time the Dialogue track with edit_timeline move` +
      ` ops. Keep every take and their order — only shape the SPACE between lines: quick` +
      ` exchanges stay tight, beat changes get a breath, and silent shots between spoken` +
      ` lines become real pauses sized from their planned durations. If two lines should` +
      ` genuinely overlap (an interruption, a reaction over a line), put the overlapping` +
      ` take on a second dialogue lane — never overlap items on one track.`,
    ``,
    `When you're done, tell me the runtime before → after and where the big pauses landed and why.`,
  ].join('\n');
}

// Delegate CASTING to the agent — the "Voice with agent" buttons on the Radio
// casting rail. One or many speaker names. The agent designs a fitting voice,
// renders a short in-character sample, and casts it with the RIGHT tool per
// name: a World-roster character → attach_character_voice (by id); a background
// speaker with no World record → cast_radio_voice (by name). Verbatim port.
export function castVoiceMessage(characters: string | string[]) {
  const list = Array.isArray(characters) ? characters : [characters];
  const names = list.map((c) => `"${c}"`).join(', ');
  const many = list.length > 1;
  return [
    `Cast a voice for ${many ? 'each of these Radio speakers' : 'the Radio speaker'} ${names} on the Casting rail.`,
    ``,
    `First call get_world and get_radio. Then for EACH name, in order:`,
    `- If the name is on the World roster, read their voice / traits / appearance and design a voice that fits.` +
      ` Otherwise it's a background / one-off speaker with no World record — pick a voice that suits the role.`,
    `- Load the seed-audio skill and generate a SHORT, clean in-character voice sample (use one of that character's` +
      ` own dialogue lines if they have one, else a neutral line — no music, no SFX). Then create_sound(kind:"voice"),` +
      ` attach_sound so it flips to "ready", and like_sound_version so the take is castable.`,
    `- Cast it with the RIGHT tool: a World character → attach_character_voice with that character's id;` +
      ` a background speaker with no World record → cast_radio_voice by name.`,
    ``,
    `Confirm the first Higgsfield submit with me, then proceed through the rest without re-confirming.` +
      ` When done, tell me which voices are cast — they'll show on the Casting rail (and, for World characters, the World tab).`,
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
