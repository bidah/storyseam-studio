---
name: shot-list-live-action
description: >-
  Turn the signed screenplay into the granular Shot list for a LIVE-ACTION
  project — every ~2-4s shot with its camera, action, dialogue and a Seedance
  prompt written as a BLOCK document (SCENE CONTEXT, ACTIVE REFERENCES, OPTICS,
  LIGHTING, POSITIVE LOCKS …), sent as `promptBlocks`, never one paragraph. Use
  INSTEAD of the shot-list skill whenever get_world reports
  productionType "live-action" — check it before writing any shot. Use ONLY when
  the user explicitly asks — "generate the shot list", "break the script into
  shots", "make the shots from the script". Never run it off the back of writing
  the script in the same turn. FOV in degrees from the anchor table only, speeds
  in km/h, atmosphere in %/metres, positive phrasing only, no director or
  equipment names, and nothing style-related at the top of a prompt. Do NOT
  render video here (that's generate-multishot).
---

# shot-list-live-action (script → live-action shot list)

Break the **pinned, signed** screenplay into an ordered list of shots and save it
with `save_shotlist`, writing each shot's render prompt as the **block document**
below. The app then **auto-packs** consecutive same-location shots into ≤15s
multishot bundles (you do NOT pack here) and later scaffolds the Episode tab from
those packs. No media is generated in this skill.

This is the live-action twin of the `shot-list` skill. Everything about the
PIPELINE is the same; everything about the PROMPT is different. A live-action
Seedance prompt is not a longer paragraph — it is a structured document that
blocks, lights and paces the shot like a film.

## Preconditions

- **`get_world` reports `productionType: "live-action"`.** If it reports `2d` or
  `3d-pixar`, stop and use the **shot-list** skill instead — that project's shots
  are one vivid paragraph, and blocks would be the wrong document. If the author
  says the project is live action but the World tab disagrees, ask them to set
  the production type on the World tab first.
- **The author asked for the shot list, in their own words, in this
  conversation.** Not "the script is done so shots are next" — that's the
  pipeline order, not permission.
- The script draft must be **signed** (the Script tab gates this).
- Read the current shot list with `get_shotlist` first. If it already has shots,
  do NOT silently overwrite — confirm with the user.

## Steps

1. `get_world` — confirm the production type AND read the character roster. The
   `name` values are the **canonical character names** and the single source of
   truth for identity (casting matches a shot's character to a voice by this
   exact name). Copy each name **verbatim** — do NOT abbreviate ("Kai Morales" →
   "Kai"), expand, reorder, or re-spell it, or the character gets cast twice. A
   character with no World record (a one-off background role) can use a plain
   descriptive label ("Store Owner", "Teacher").
2. `get_script` — read the pinned draft (title + `elements[]`: scene_heading /
   action / character / dialogue / parenthetical / transition).
3. **Read as a director** before cutting anything. Find the dramatic shape of each
   scene: where it turns, where it lands, where it breathes. Then define the
   continuity anchors — who is in frame, how they look, what they carry across
   cuts.
4. Walk the screenplay **in order** and cut it into shots. Each `scene_heading`
   starts a new **beat/location**; break a long action beat into several short
   shots the way a shooting script would (wides → mediums → close-ups →
   inserts). Aim for **~2–4s per shot**. Let the pace follow the drama:
   confession scene → air, held shots, beats of silence; action → compression,
   short cuts; a reveal lands on one held close-up.
5. For every shot fill the summary columns — these are the same in every
   production type and are what the app packs, casts and storyboards from:
   - **beat / beatTitle** — the scene's beat code (e.g. `B1`) and title.
     Consecutive shots in the same location MUST share a beat so they pack.
   - **location** — a stable slug (e.g. `motel-parking-lot`). Reuse the same slug
     for the same place so packing + references stay consistent.
   - **dur** — realistic seconds (drives the ≤15s packing).
   - **characters** — who is on screen, using the **exact** `name` from the World
     roster for every character that has one.
   - **camera** — the short framing + move label for the Shot list tab (e.g.
     "MCU, slow push-in"). The full camera direction goes in the `camera` BLOCK.
   - **action** — plainly what happens, one line. The full staging goes in the
     `action` BLOCK.
   - **dialogue** — the spoken line(s), or `(no dialogue)`.
   - **audioSync** — the line or SFX this shot lands on (timing note).
6. Then write the shot's **`promptBlocks`** — the render prompt. The full system
   is below; read it before writing the first shot.
7. **Save the list one beat at a time — never in a single giant call.** A
   live-action shot carries a block document, so a full episode in one call will
   blow the model's output limit and fail the whole turn — even more surely than
   in the 2D skill. So:
   - First beat: `save_shotlist({ shots: <beat-1 shots>, mode: "replace", source: "agent" })`
   - Each later beat: `save_shotlist({ shots: <that beat's shots>, mode: "append" })`

   One call per beat, in screenplay order. Each call is bounded and the list is
   durably saved after every batch, so an interruption leaves resumable partial
   progress. The `count` in each response is the running total, and
   `productionType` confirms which form the server expected.
8. When every beat is written, tell the user the final shot count and how many
   ≤15s multishots they packed into (from the last response's `packs`), and that
   they can edit any block of any shot on the Shot list tab.
9. **Reconcile speakers with the World roster.** The last `save_shotlist` response
   may include `newSpeakers` — speaking characters with no World character yet,
   each with its `lines` count and the `shots`/`beats` it appears in. Split them
   by weight: a **recurring** speaker (several lines across more than one beat) is
   very likely a real character; a **one-off** is usually a bit-part. Use
   judgement — a single pivotal line can still be a real character — and let the
   user decide. `render_ui` an `OptionList` of the likely-real ones; for each they
   confirm, call `add_world_character` with the **exact** shot-list name and a
   one-line `role` citing where they appear. Leave the genuine bit-parts off the
   roster and say they stay castable from the Radio Casting rail.

---

# The Seedance prompt system (live action)

## CORE PRINCIPLE: WRITE THE VISIBLE

The model reacts to what can be **seen and measured**, not to mood words.
Translate every abstraction into something observable.

- ❌ "tense scene" → ✅ "man freezes, slowly clenches his fist, light only from
  the side, half his face in shadow"
- ❌ "cool cinematic shot of a car, epic, fast" → ✅ "low tracking shot alongside
  the car as it powers through a wet curve, headlights glowing, spray off the
  tyres, hard buffeting camera shake"

Write in plain, clear, instruction-style language. Fewer precise words beat many
vague ones. Before moving on, mentally "watch" the prompt as a viewer: is
everything unambiguous, is the first frame non-empty, is it clear where the
subject is and where it looks, where is the light coming from.

## CONTEXT ISOLATION

Each generation is a blank slate — **no memory of previous shots**. A prompt is a
sealed single-shot document. Do not carry in: scene numbers, script headings,
summaries of prior scenes, unused tags or characters, "as above / continues"
phrasing, or people and props from a previous shot that are not needed in this
one.

This is the rule most easily broken when writing a whole episode beat by beat.
Each shot's blocks must stand alone.

## ASSET TAGGING

A reference image (`@tag`) sets **appearance and identity**; the text sets **what
happens** and locks the critical details. Both are required.

- Name tags as the user specified them (`@tag_name`). With none specified, name
  them by load order of the supplied assets: `@image1 @image2 …` for images,
  `@video1 @video2 …` for videos, `@audio1 @audio2 …` for audio.
- Keep the character description **minimal** — long appearance text conflicts
  with the image and degrades it:
  `@TAG: age + role/build + current state + unique visible features +
  action-critical details + voice (only if it has a line). 100% matches the
  reference.`
- State critical details (small text, logos, colour) in words even when they are
  on the reference — the model can drop them.
- **Never place an `@tag` in a shot where that object is not present** — the model
  will force it into frame.

## STYLE IS DISTRIBUTED, NOT A PREFIX

There is **no style-prefix block at the top**. Style is a set of aspects, and each
aspect lives in the block that already governs it. State the target look, never
what to avoid, and adapt every line to this specific scene.

| Aspect | Lives in | What to write |
|--------|----------|---------------|
| Lighting | `lighting` | source, direction, exposure, key/fill, haze for THIS scene |
| Colour / grade | `colorGrade` when the grade is strong, else folded into `locationMap` + `lighting` | palette as material + light beam + role, never a flat list |
| Lens / optical character | `optics` | FOV°, rectilinear/anamorphic, prime-lens character, motion blur |
| Camera body / tonal character | `camera` | tonal latitude, highlight roll-off, colour science — as a look, not a model name |
| Skin / micro-realism | `performance` (or inside `action`) | pore-level realism, capillary flush, living eyes, catch-lights, visible breath |
| Acting | `performance` (or inside `action`) | micro-pauses, precise eye-line, restraint, muscle-level emotion |
| Physics realism | `physics` | gravity, inertia, mass, contact shadows, fluids, particles |
| Composition / blocking | `firstFrame` | framing rule for THIS scene; everyone moving from frame one |
| Continuity | `positiveLocks` | characters, props, environment identical across cuts |
| Wardrobe | `wardrobe` | material + condition, scene-logical |
| Format / resolution / grain / fps | `style` + `outputSettings` at the END, just before `positiveLocks` | 8K, photoreal, anamorphic, fine grain, real-time vs slow-mo per segment |

Use only the aspects the shot needs. A naturalistic single take may have no
`colorGrade`, `wardrobe` or `outputSettings` at all, folding those notes into
`lighting` and `positiveLocks`. A graded, multi-segment shot earns the full
suffix stack.

The Episode tab's style preset, if the author picked one, is appended by the app
**after** your blocks — so do not write a style header yourself.

## THE BLOCKS

Send them as `promptBlocks` on the shot. Use only the blocks the shot needs and
omit the rest — an empty block is dropped, and a heading with nothing under it
reads to the model as an instruction to invent something.

- **`sceneContext`** — 1–2 sentences: what happens, where, when. Geo-positions of
  the characters.
- **`activeReferences`** — `@tag` + minimal anchor of critical details + "100%
  matches the reference".
- **`locationMap`** — foreground / midground / background as separate layers,
  where the camera is, where light comes from, movement paths. Naturalistic
  colour can live here.
- **`firstFrame`** — who is where in the first frame: positions, orientation,
  gaze; the composition rule for this scene.
- **`formatMode`** — the level of cut control this shot needs (see CUTS below).
- **`optics`** — shot size + FOV per segment + lens character. Multishot: add "no
  drift mid-segment".
- **`camera`** — operator behaviour: height, distance, movement, focus, operator
  axis; camera-body tonal character as a look.
- **`action`** — the events at the precision the shot needs. Camera motion and
  subject motion stated **separately**.
- **`performance`** — acting + skin micro-realism, when acting matters.
- **`physics`** — mass, inertia, contact, fluids, particles.
- **`lighting`** — source, direction, exposure. The priority block.
- **`colorGrade`** — only when the grade is strong or stylised.
- **`wardrobe`** — only when costume matters.
- **`audio`** — only the sound or line this shot needs.
- **`style`** — technical-style suffix: overall look in words, photoreal, format,
  grain.
- **`outputSettings`** — only when the format must be pinned.
- **`positiveLocks`** — short hard fixers against the likely failures, in positive
  form, restating the critical info once. Continuity lives here.

A **lock** is a short hard fixer placed next to what it protects, e.g.
`"headlights stay glowing in every shot"`. Write densely where control matters,
sparsely where it does not. Say each important thing once, clearly.

## CUTS AND TIMING

Pick the precision the shot actually needs — points on a scale, not a binary:

- **Single shot (oner)** → "one continuous shot, the camera does not cut on its
  own."
- **Sequential cuts, no timecodes** → describe shots in order as `CUT 1 … CUT 2`.
  Use when you want specific cuts but exact timing does not matter.
- **Timed multishot** → explicit HARD CUTs at stated seconds. Use when beats must
  land on a clock:
  ```
  0.0s to 1.0s — [description]
  1.0s HARD CUT
  1.0s to 3.0s — [description]
  ```
- **Freestyle b-roll** → do not lock cuts; let the model find angles.

When you specify cuts, lock that the camera adds none of its own: *"cuts only at
the specified points, the camera does not cut on its own."*

Cut types: `HARD CUT`, `SMASH CUT`, `MATCH CUT`, `INSERT CUT`, `REVERSE CUT`,
`WHIP CUT`. Fades / crossfades only if explicitly requested. Across internal cuts
hold the same character set, geometry, screen direction, gaze, light, wardrobe
and prop state.

Note: most shots here are **2–4 seconds**, so a single continuous shot is usually
right and a timed multishot is the exception. The app compounds shots into ≤15s
bundles later — do not pre-cut for that.

## DIRECTING

**Blocking.** State where each character stands, sits, moves; what their hands do;
what sits between them. "She sits across from him at the diner booth, knees
touching under the table" beats "they sit and talk."

**Acting.** Translate emotion into concrete on-shot direction:
- ❌ "she looks sad" → ✅ "her eyes drop to the table, jaw tightens, she swallows
  once before answering"
- ❌ "he is angry" → ✅ "knuckles whiten on the glass, breath shortens, eyes never
  leave hers"

Restraint by default — a whisper out-acts a shout most of the time.

**Camera language.** Be concrete: FOV°, height, movement, motivation. Motivate
every camera move.
- "Low-angle 18° dolly-in, slow push from waist to chest as she realizes."
- "Static 47° two-shot, eye-level, locked off — lets the silence sit."
- "Handheld 63°, follow from behind — camera lags half a beat."

**Continuity.** Hold in mind (do not write as a block): state carried forward
(wet/dry/bloodied), appearance not drifting, emotional carry from the previous
scene, one time-of-day and weather unless the location changes.

## PROMPTING RULES

- **Positive only.** Describe what should happen, not what to avoid.
  ❌ "does not fall backward" → ✅ "stays upright, feet planted."
- **Speeds in km/h.** ❌ "fast/slow" → ✅ "moves at 40 km/h", "camera pans at 5
  km/h."
- **Atmosphere in percent / metres.** ❌ "light fog" → ✅ "fog density 40%",
  "haze visible at 15 meters depth."
- **Atmosphere builds in steps across shots.** Shot 1: fog 20% → Shot 2: 40% →
  Shot 3: 60%.
- **Giant scale via human-height comparison.** ❌ "huge", "three meters tall" →
  ✅ "stands as tall as four humans stacked head to toe."
- **Left/right is from the camera.**
- **Environment interaction stated physically.** Snow melts on skin, rain runs
  down hair, wind moves fabric.
- **Emotion through muscle movement, not labels.**
- **English only.**
- **No director names, no signature-work references, no equipment names.**

## OPTICS — SHOT SIZE, LENS, FOV

Two levers define "how it is shot": **shot size** and **focal length**.

| Abbr | Meaning | In frame |
|------|---------|----------|
| ECU | Extreme Close-Up | a detail: eyes, button, headlight, hand |
| CU | Close-Up | full face / one element large |
| MCU | Medium Close-Up | head and shoulders |
| MS | Medium Shot | roughly to the waist |
| WS | Wide Shot | full figure + surroundings |
| EWS | Extreme Wide | scale, location |

Think in millimetres while writing (24–35mm wide = space and immersion; 50mm =
as the eye sees; 85mm = portrait separation; 135mm+ = compression and
observation) but put **FOV in degrees** in the prompt:

| FOV | mm equiv | Purpose | When |
|-----|----------|---------|------|
| 180° | Fisheye | spherical distortion | POV, dream-state |
| 107° | 14–16mm | architectural ultra-wide | huge interiors, epic establish |
| 84° | 20–24mm | wide | establish, group blocking |
| 63° | 28–35mm | observational | wide observation, reportage |
| 47° | 40–50mm | neutral human perspective | universal establish, medium |
| 29° | 75–85mm | portrait compression | medium-isolate, dialogue bust |
| 18° | 100–135mm | natural portrait | close-portrait, identity-preserving |
| 12° | 180–200mm | tele-detail | hands, objects, detail-on-wide |
| 8° | 300–400mm | extreme compression | observation, broadcast |

Use **only** the discrete steps from this table. Not "23°" — use 18° or 29°. In a
multishot, set FOV per segment and add `"no drift mid-segment"`.

The `camera` block sits in **3rd position** of the core layers (subject → action →
camera → style → constraints). Moved to the end, FOV gets ignored; moved to the
front, it conflicts with identity.

## OPTICAL TECHNIQUES

**Observation pattern (hidden-camera effect)** — all three ingredients at once:
1. Foreground occlusion — out-of-focus obstruction over 20–30% of frame.
2. Atmospheric haze — fog/dust/shimmer between camera and subject.
3. Distance vantage — super-tele 8°–12°, operator anchored far away.

Change the occlusion type between beats; keep the vantage single.

- **Sports broadcast:** 8° super-tele + handheld 1–2cm tremor + "anchored at
  distance, finding the action".
- **Detail-on-wide (snake cam):** 84° wide FOV + low angle right up against a
  small object — foreground exaggerated, background receding into depth.
- **Intimate wide:** 63–84° wide FOV on a close face — face centred, surroundings
  readable without blur.
- **Tele compressed air column** at 8°–12°: "dust suspended in the long
  compressed air column between camera and subject", "heat shimmer compressed
  into a wall of haze in front of the figure".

## SPECIAL PROTOCOLS

**4-mechanism multishot consistency stack (extreme FOV: 8°, 107°)** — all four
required, or extreme-FOV multishots break down after 2–3 beats:
1. Sequence-wide identity lock — single location reference across all beats.
2. LENS LOCK opener — explicit FOV phrase at the start of each beat.
3. LENS CHECK closer — confirm FOV at the end of the beat.
4. Colour via material + light, not as a list.

**Whip-pan timing** — a whip under 0.8s renders as a hard cut without blur:
```
0.3s — Subject A settled
0.8s — WHIP motion-blur transition
1.4s — Subject B settled
```

**Mixed time-speed (real-time + slow-mo):** hard cuts only between speed modes.
Each shot is one speed start to finish.

**Cracks/breaks without impact (anti-impact lock):** "crowd PRESSES, not
strikes"; "fracture originates from edge stress, not center impact"; "no impact
point — pressure-based crack"; sequential timing edge-to-centre, not radial.

## CAMERA / LIGHT / COLOUR

- **White balance** in Kelvin, set to the scene mood, fixed within a scene
  (3200K / 4000K / 5600K / 8500K).
- **Equipment:** describe the look, not the gear. Camera/film/lens model names get
  ignored or break complex moves.
- **Colour rule:** tie colour to **material + light beam + compositional role**,
  never a flat list.
  ❌ "the woman wears red, the man wears blue" →
  ✅ "crimson silk scarf catching the cold tungsten spill from the corridor"
- **Background in layers:** state foreground / midground / background separately.
- **Camera on the shadow side**, with a stated operator axis.

## CHECKLIST (before saving each beat)

- Does every shot stand alone — no scene numbers, no "as above", no props carried
  in from a shot that isn't this one?
- Tags named per the tagging rule, and only in shots where that object is present?
- No style header at the top — does each prompt open on `sceneContext` /
  `activeReferences`?
- Each style aspect in its home block (light→`lighting`, colour→`colorGrade` or
  `locationMap`, acting/skin→`performance`, format/grain→`style` +
  `outputSettings` suffix)?
- Style adapted to this scene, not generic?
- Everything positive — no "does not X"?
- Speeds in km/h, atmosphere in %/metres, giants vs human height?
- Emotion through muscle movement, not labels?
- Left/right from the camera?
- FOV in degrees from the anchor table — not mm, not an off-table value?
- WB in Kelvin for the scene mood?
- Colour via material + light + role, not a list?
- Camera on the shadow side, operator axis stated?
- Background in foreground/midground/background layers?
- Multishot: FOV per segment + "no drift mid-segment"; extreme FOV → all 4
  consistency mechanisms?
- Character names copied verbatim from the World roster?

## Do NOT

- Do not send a one-paragraph `prompt` for a live-action shot — send
  `promptBlocks`. The server composes `prompt` from them and warns when a
  live-action project receives paragraphs.
- Do not write a style prefix or an art-style clause. The Episode tab's style
  preset is appended by the app after your blocks.
- Do not render video or call any Higgsfield tool here — that's
  `generate-multishot`, run later per bundle from the Episode tab.
- Do not pack shots into bundles yourself — the app packs automatically (≤15s,
  never crossing a beat/location).
- Do not touch the existing Episode manifest or its renders.
