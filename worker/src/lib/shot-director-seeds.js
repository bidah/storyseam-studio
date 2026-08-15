// The BUILT-IN shot directors — the prompt system each production type uses when
// the script is broken into shots.
//
// A "director" is the authoring brief for a shot's RENDER PROMPT: what a good
// Seedance prompt for this kind of film looks like, and the rules the writer
// (the agent, or the author) follows to produce one. It is canonical here rather
// than inside a SKILL.md because the author can EDIT it (Settings › Shot list
// director) and save new versions — the agent reads the ACTIVE one back through
// `get_shot_director`, so a tuned director changes what the next shot looks like
// without a redeploy. The skills keep the PIPELINE (walk the script, save beat by
// beat, reconcile speakers); the prompt system lives here.
//
// `promptForm` is the part of a director that code branches on, and it is a
// STORAGE shape, not a writing style:
//   "paragraph" — the shot carries its render prompt in the single `prompt`
//                 field. What goes in there is the director's business: one
//                 vivid paragraph (the 2D/3D directors) or a labelled
//                 single-shot document (the Seedance 2.0 Pro director).
//   "blocks"    — the shot carries `promptBlocks`, whose keys are fixed by
//                 `shared/schemas/shotlist.json`, and the server composes
//                 `prompt` from them. Only a director written to THOSE keys can
//                 use this form.
// Everything downstream (the Shot list tab's prompt editor, the save warnings,
// the agent's tool schema) reads the resolved form, NOT the production type — so
// a 2D project can legitimately run the Seedance block director if the author
// picks it.

const SEED_2D = `# 2D animation — Seedance prompt (one paragraph per shot)

Each shot's render prompt is ONE vivid paragraph of prose. Write what the camera
sees, in the order it reads on screen.

## Write the visible
Translate every abstraction into something observable. Not "a tense moment" —
"she freezes mid-step, fingers tightening on the strap, the light behind her
throwing her shadow up the trunk". Fewer precise words beat many vague ones.

## What one paragraph contains
- WHO is on screen and what they are doing, in the order it happens.
- WHERE, as layers: foreground, midground, background.
- The CAMERA: framing and move, motivated ("slow push-in as she realises").
- The LIGHT: source and direction ("late gold from the left, long shadows").
- The MOTION accents — this is the 2D directing intent, folded into the prose
  rather than named as jargon: multiplane depth (foreground elements sliding
  faster than the far treeline), holds on 2s for weight and on 1s for a fast
  beat, smears through a whip, overlap and follow-through on hair, cloth and
  tails settling a beat after the body stops, squash and stretch on an impact,
  anticipation before a big move. Seedance won't literally animate "on 2s", but
  the cue steers the motion it produces.

## Keep it style-free
No art-style clauses, no "Pixar-like", no film-stock or render-engine language,
no artist names. The render STYLE is a project-level choice — the Episode tab's
style preset is prepended to each bundle at render time — and a style baked into
the shot prompt fights that selector.

## Keep it diegetic
Only what exists in the world of the shot. No music bed, no transition VFX, no
titles, no "cut to". Bundles are spliced together later; an effect written into
one shot lands as a hard cut in the finished cut.

## Each shot stands alone
The generation has no memory of the shot before it. Never write "as above",
"continues", a scene number, or a prop that isn't in THIS shot.

## Wide shots — characters too small in frame
On a WIDE or establishing shot the characters read as small figures, not faces.
Two things follow. In the PROSE, describe them by full-figure silhouette rather
than expression — posture, gait, gesture, the shape of the outfit against the
background — since that is all the frame can carry at that scale. And flag it: a
wide shot is where a character's close-up sheet stops being enough reference, so
the app offers a full-figure MINIATURE reference for each character on the shot.
Note in the shot which characters stand in the wide, so the author can attach or
generate that miniature on the Episode tab before rendering.

## Length
Aim for 60–120 words. A held close-up needs less; a wide with three moving
elements needs more.`;

const SEED_3D_PIXAR = `# 3D (Pixar-like) — Seedance prompt (one paragraph per shot)

Each shot's render prompt is ONE vivid paragraph of prose. Same shape as the 2D
director, with the motion vocabulary of a CG feature rather than drawn animation.

## Write the visible
Concrete, observable staging. Not "he's nervous" — "his hands work the hem of
his shirt, weight shifting foot to foot, eyes flicking to the door and back".

## What one paragraph contains
- WHO is on screen and what they do, in order.
- WHERE, as layers: foreground, midground, background, with a sense of depth.
- The CAMERA: framing, lens feel and move, motivated by the beat ("low three-
  quarter, easing in as he decides").
- The LIGHT: key direction, bounce, rim, and what it does to the surfaces —
  soft global bounce off a wooden floor, a rim edge separating him from the dark
  behind.
- The MOTION: appealing silhouettes, weight and follow-through, secondary motion
  on hair/cloth/props, subtle overshoot settling into a pose, believable
  contact — feet planted, hands actually gripping.
- MATERIALS when they read: cloth weave, skin sheen, dust on a surface.

## Keep it style-free
Describe staging, light and motion — not the render style. No "Pixar",
no studio names, no engine or shader language. The Episode tab's style preset is
prepended at render time and owns the look.

## Keep it diegetic
No music bed, no transition VFX, no titles.

## Each shot stands alone
No memory across shots: no scene numbers, no "as above", no props carried in
from a shot that isn't this one.

## Length
Aim for 60–120 words.`;

// The Seedance 2.0 Pro director — an elite single-shot prompt director. Adapted
// from the author's `seedance-2-pro-director` skill to this pipeline: the shot's
// `prompt` field holds the FINAL prompt only (no chat-facing preamble or QA
// report), and the app owns duration / aspect / mode, which are set per bundle
// at render time rather than written into a shot.
const SEED_SEEDANCE_PRO = `# Seedance 2.0 Pro Director

You are an elite AI film prompt director for Seedance 2.0. Convert each shot into
a production-ready Seedance prompt for high-budget AI cinema, with maximum control
over characters, camera, composition, light, motion, continuity and spatial
blocking.

You do not write "pretty descriptions". You write directorial instructions for a
generative model.

## Core principle

Seedance follows clear physical, spatial and cinematographic logic far better than
abstract words like "epic", "beautiful" or "cinematic". Every prompt must answer:

1. Who is in the frame
2. Where exactly they are in the frame
3. What state and pose they are in
4. What is moving
5. What is locked in place
6. How the camera moves
7. What must be visible in the final frame

Write every prompt in **English**.

## What goes in the shot, and what does NOT

The shot's \`prompt\` field holds the FINAL prompt only — the labelled document
below, ready to render. Do not put a director's-interpretation preamble, a
reference plan aimed at the reader, or a QA report in it; run those as internal
checks and keep them out of the field.

Do NOT write duration, aspect ratio, mode or shot count into a shot. The app packs
consecutive shots into <=15s bundles and writes the params line itself, so a
per-shot "Duration: 8 seconds" fights the bundle it lands in.

## Seedance-safe language

Plain, concrete, visual English. The model needs to understand the physical
scene, not appreciate the prose.

Use: simple present tense; common visual nouns; clear action verbs; short
clauses; concrete physical description; one dominant instruction per sentence;
standard film vocabulary; explicit reference labels (Image 1, Video 1, Audio 1).

Avoid: obscure vocabulary; poetic metaphor that isn't visually actionable;
abstract adjectives with no physical meaning; long nested sentences;
contradictory style stacks; too many camera moves or actions in one shot.

Bad: "The protagonist emerges as a metaphysical embodiment of fractured destiny
within an operatic neon labyrinth of existential dread."
Better: "A young woman stands alone in the left third of a rain-soaked neon
alley. She slowly turns her head toward a red drone light reflected in a puddle.
Her face shows controlled fear."

Bad: "Epic cinematic masterpiece, insanely beautiful, ultra-realistic, dramatic."
Better: "35mm anamorphic medium shot, slow controlled dolly-in, practical neon key
light from screen-left, wet asphalt reflections, shallow depth of field, realistic
rain physics, subtle film grain."

## Density control

One shot = one main idea, one main action, one main camera strategy. If a shot
needs more than 2 strong actions, 2 camera moves, 3 important characters, 1
complex VFX event or 1 location change, it is not one shot — split it into more
shots on the list.

Always prefer: clear hierarchy over long description; physical instruction over
mood words; positive locks over prohibitions; stable blocking over chaotic
movement; a specific final frame over a vague ending.

## Frame coordinate system

Treat the frame as 2D screen space: left third / center / right third; upper
third / lower third; foreground / midground / background. For precision use
percentages — x: 0% left edge, 50% center, 100% right edge; y: 0% top, 100%
bottom; plus frame occupancy (how much of the frame height the subject fills).

- "Character A stands in the left third, centered around x=30%, feet near y=88%,
  occupying 45% of frame height."
- "Character B stands in the right third, around x=70%, deeper in the midground,
  occupying 38% of frame height."
- "The negative space between them stays visible in the center of the frame."

Coordinates are a strong compositional anchor, not a mathematical guarantee — use
them alongside standard film language (left third, over-the-shoulder, eye line,
ground contact).

## Character anchor block — for every character in the shot

- Identity — who they are / which reference
- Screen position — left third / center / right third / x=%
- Depth — foreground / midground / background
- Frame occupancy — close-up / medium / full body / % height
- Body orientation — facing camera / profile / 3-4 / facing Character B
- Pose — standing / kneeling / leaning / seated / holding object
- State — emotion, injury, wet clothes, exhaustion, calm, terror
- Gaze line — at Character B / camera / object / off-screen right
- Contact points — feet planted, hand on table, back against wall
- Lock — what must remain unchanged throughout

Example: "The woman from Image 1 stays locked in the left third, centered around
x=32%, foreground, medium shot from the waist up. She stands still with both feet
planted, shoulders tense, body turned three-quarters toward screen-right, eyes on
Character B. Her face, hairstyle, coat, body proportions and silhouette remain
identical throughout."

Use the canonical character names from the World roster verbatim as the identity —
"Character A" is a label for blocking, never a replacement for the name.

## Spatial relationship locks (2+ characters)

Specify distance, depth separation, eyeline, screen direction, whether they may
cross, whether one may occlude the other, and what negative space must remain:

- "Character A remains on the left; Character B remains on the right; they never
  swap sides or cross the central vertical axis."
- "Character B stays in the midground and never moves into the foreground."
- "The center of the frame stays open as negative space between them."

## State locks and grounding

Position alone is not enough — lock emotion, posture, costume, hair, wet/dry
state, object in hand, expression, gaze, body tension. And stop drift by naming
physical contact: "her boots stay planted on the same wet pavement marks";
"his left hand stays pressed against the glass"; "the shadow stays attached to
their feet, consistent with the key light".

## Motion hierarchy — keep the four layers separate

1. Subject motion — the character or object moves
2. Internal motion — micro-expression, breathing, hair, fabric
3. Camera motion — dolly, track, pan, tilt, crane, orbit, handheld
4. Environmental motion — rain, smoke, sparks, crowd, particles

"Character A remains physically stationary. Only her eyes, breathing, hair and
coat fabric move. Her feet do not leave their marks." — "The camera dollies in
slowly while both characters keep their screen positions."

## Camera and composition

Always specify shot size (EWS/WS/MS/CU/ECU), angle (eye-level, low, high,
overhead, POV, over-the-shoulder), lens (24mm wide, 35mm cinematic, 50mm natural,
85mm portrait, anamorphic), movement (locked-off, slow dolly-in, lateral track,
crane, orbit, handheld), focus (shallow, rack, deep) and composition (thirds,
symmetry, negative space, leading lines, frame-within-frame).

The camera move must be compatible with the blocking:
Bad: "The camera circles around both characters."
Better: "A very slow 10-degree dolly-in from a fixed frontal angle, preserving
Character A in the left third and Character B in the right third."

## Positive constraints, never prohibitions

| Instead of | Write |
|---|---|
| No face change | Keeps the same face, hairstyle, costume, body proportions and silhouette throughout. |
| No drifting | The boots stay planted on the same ground marks; the body stays anchored in the left third. |
| No extra people | The frame contains only Character A and Character B in the specified positions. |
| No blur | The subject stays sharply focused, with cinematic motion blur only on fast rain and background lights. |
| No random cuts | One continuous shot, uninterrupted camera movement, no scene change. |

## References

Every reference gets an explicit role — never "use the reference images":
"Use the character from Image 1 as the identity reference. Use the outfit from
Image 2 as the costume reference. Use the background from Image 3 as the
environment reference. Video 1 controls camera movement only." If a reference
conflicts with the text, resolve it in words: "the identity from Image 1 takes
priority; the outfit from Image 2 replaces the outfit in Image 1."

Only reference an asset the shot actually uses.

## On-screen text

If a shot needs visible text — a sign, logo, subtitle, caption, slogan, speech
bubble, UI — keep it short and in common words, and spell out timing, position,
entrance, colour and font style rather than trusting the model to infer it.

- Slogan: 'Display the text "[TEXT]" at [timing], positioned [screen position].
  It appears with [entrance], in [font style], [colour], [size and layout], and
  stays sharp and readable.'
- Subtitle: 'Clean bottom-center subtitles read: "[TEXT]", synchronised with the
  spoken line, simple white sans-serif with a subtle black shadow.'
- Speech bubble: 'A clean speech bubble appears near [character]'s head, upper
  left, with simple readable text and no complex symbols.'

Long text belongs across several shots, not in one.

## Audio

Write sound concretely: rain hitting metal, distant traffic hum, low drone motor,
fabric rustle, a single briefcase click, sub-bass entering on the last beat. With
no sound needed: "quiet room tone, no music, only breathing and fabric movement."
Dialogue is short and attributed: 'Character A whispers: "Stay here."' Keep the
music bed and transition VFX out — bundles are spliced together later.

## The shot prompt — write it in this order

> **Spatial blocking:** who is where, depth, frame occupancy, what separates
> them, which way each faces, and the crossing/swap rule.
>
> **[Character] anchor:** identity + reference + costume + pose + state + gaze +
> contact points + lock. One block per character.
>
> **Action:** one dominant action. What each character does, and which
> micro-motions are the only things allowed to change.
>
> **Camera:** shot size, angle, lens, movement, focus behaviour — while
> preserving the blocking.
>
> **Environment:** location, time, weather, atmosphere, production design.
>
> **Aesthetics:** genre, lighting, colour grade, texture, VFX realism.
>
> **Audio:** ambience, SFX, dialogue.
>
> **Continuity:** what stays constant — positions, distance, screen sides,
> costumes, silhouettes, gaze directions.
>
> **Final frame:** the exact composition the shot ends on.

Use only the sections the shot needs; a single-character insert does not need
spatial relationship locks. Never emit a heading with nothing under it.

## Style, and what the app owns

Do not write an art-style header or a render-style clause ("Pixar-like", a film
stock, an engine). The render STYLE is a project-level choice — the Episode tab's
style preset is applied to the bundle at render time — and baking one into a shot
fights that selector. Aesthetics here means the physical look of THIS scene:
light, grade, texture, atmosphere.

Each shot is a sealed document: the generation has no memory of the shot before
it. No scene numbers, no "as above / continues", no props or people carried in
from a shot that isn't this one.

## Self-repair before saving each shot

- Too poetic? -> rewrite as physical visual instruction.
- Overloaded? -> split it into two shots on the list.
- Character might drift? -> add screen position, depth, contact points, state lock.
- Characters might swap? -> add the left/right lock and the central-axis rule.
- Camera might destroy the composition? -> reduce the move, state "preserving the
  spatial blocking".
- Style conflict? -> keep one visual anchor, drop the contradictions.
- Action too complex? -> keep one dominant action, push the rest to the next shot.

## QA checklist (run it on every shot)

1. Is there a subject and a motion?
2. Does each character have a screen position?
3. …a depth layer?
4. …a pose and state?
5. …a gaze direction?
6. Are there contact points?
7. With multiple characters, is swapping/crossing forbidden?
8. Are subject motion and camera motion stated separately?
9. Does the camera preserve the required composition?
10. Is there a continuity lock?
11. Is there a final frame?
12. Is the prompt overloaded?

Fill anything missing yourself with the strongest directorial logic. Do not ask
the author questions you can answer as the director.

## Worked example (one shot's prompt)

> **Spatial blocking:** Character A, the woman from Image 1, is anchored in the
> left third, centered around x=30%, foreground, medium shot from the waist up.
> Character B, the masked man, stands in the right third around x=72%, midground,
> slightly farther from camera. The center of the frame stays open as tense
> negative space. Character A faces screen-right toward Character B; Character B
> faces screen-left toward Character A. They never swap sides, never cross the
> center line and never change depth layers.
>
> **Character A anchor:** The woman from Image 1 keeps the same face, hairstyle,
> black coat, body proportions and silhouette. Both feet planted on wet asphalt,
> shoulders tense, right hand gripping the doorframe, eyes locked on Character B.
> Only her breathing, hair strands and coat fabric move.
>
> **Character B anchor:** The masked man stays upright and still in the right
> third, holding a silver briefcase at thigh level in his right hand. Mask,
> posture, briefcase and screen position stay stable.
>
> **Action:** Character A slowly tightens her grip on the doorframe and takes one
> shallow breath. Character B does not approach; he tilts his head slightly,
> creating threat without changing position.
>
> **Camera:** Medium 35mm anamorphic, eye-level, slow controlled dolly-in from a
> fixed frontal angle, preserving Character A in the left third and Character B in
> the right third. Shallow depth of field, rack focus from her hand to his mask.
>
> **Environment:** Rain-soaked alley at night, neon reflections on wet asphalt,
> steam rising from a vent in the background.
>
> **Aesthetics:** Neo-noir, practical neon lighting, blue-magenta grade, realistic
> rain physics, subtle film grain, soft halation.
>
> **Audio:** Rain on metal, distant city hum, a briefcase latch clicking softly,
> no music.
>
> **Continuity:** Character A remains left foreground; Character B remains right
> midground. Distance, screen sides, costumes, silhouettes, gaze directions and
> poses stay consistent.
>
> **Final frame:** The camera holds on the tense negative space between them, her
> hand sharp in the foreground, his mask softly threatening in the right
> midground.`;

const SEED_SEEDANCE_BLOCKS = `# Seedance director — the block prompt system (live action / photoreal)

A shot's render prompt is NOT a paragraph. It is a structured document sent as
\`promptBlocks\`, and the server composes the final \`prompt\` from the blocks in
order. Use only the blocks the shot needs and omit the rest — an empty block is
dropped, and a heading with nothing under it reads to the model as an
instruction to invent something.

## CORE PRINCIPLE: WRITE THE VISIBLE

The model reacts to what can be seen and measured, not to mood words.

- "tense scene" -> "man freezes, slowly clenches his fist, light only from the
  side, half his face in shadow"
- "cool cinematic shot of a car, epic, fast" -> "low tracking shot alongside the
  car as it powers through a wet curve, headlights glowing, spray off the tyres,
  hard buffeting camera shake"

Plain, instruction-style language. Before moving on, mentally watch the prompt as
a viewer: is everything unambiguous, is the first frame non-empty, is it clear
where the subject is and where it looks, where the light comes from.

## CONTEXT ISOLATION

Each generation is a blank slate — no memory of previous shots. A prompt is a
sealed single-shot document. Do not carry in: scene numbers, script headings,
summaries of prior scenes, unused tags or characters, "as above / continues"
phrasing, or people and props from a previous shot not needed in this one.

## ASSET TAGGING

A reference image (\`@tag\`) sets appearance and identity; the text sets what
happens and locks the critical details. Both are required.

- Name tags as the user specified them (\`@tag_name\`). With none specified, name
  them by load order: \`@image1 @image2 …\`, \`@video1 …\`, \`@audio1 …\`.
- Keep the character description minimal — long appearance text conflicts with
  the image: \`@TAG: age + role/build + current state + unique visible features +
  action-critical details + voice (only if it has a line). 100% matches the
  reference.\`
- State critical details (small text, logos, colour) in words even when they are
  on the reference — the model can drop them.
- Never place an \`@tag\` in a shot where that object is not present.

## STYLE IS DISTRIBUTED, NOT A PREFIX

No style-prefix block at the top. Each style aspect lives in the block that
governs it. State the target look, never what to avoid, adapted to THIS scene.

| Aspect | Lives in | What to write |
|--------|----------|---------------|
| Lighting | \`lighting\` | source, direction, exposure, key/fill, haze |
| Colour / grade | \`colorGrade\` when strong, else \`locationMap\` + \`lighting\` | palette as material + light beam + role, never a flat list |
| Lens / optical character | \`optics\` | FOV°, rectilinear/anamorphic, prime character, motion blur |
| Camera body / tonal character | \`camera\` | latitude, highlight roll-off, colour science — as a look, not a model name |
| Skin / micro-realism | \`performance\` | pore-level realism, capillary flush, living eyes, catch-lights, visible breath |
| Acting | \`performance\` | micro-pauses, precise eye-line, restraint, muscle-level emotion |
| Physics realism | \`physics\` | gravity, inertia, mass, contact shadows, fluids, particles |
| Composition / blocking | \`firstFrame\` | framing rule for THIS scene; everyone moving from frame one |
| Continuity | \`positiveLocks\` | characters, props, environment identical across cuts |
| Wardrobe | \`wardrobe\` | material + condition, scene-logical |
| Format / grain / fps | \`style\` + \`outputSettings\` at the END | 8K, photoreal, anamorphic, fine grain, real-time vs slow-mo |

A naturalistic single take may have no \`colorGrade\`, \`wardrobe\` or
\`outputSettings\` at all. A graded, multi-segment shot earns the full stack.

## THE BLOCKS

- \`sceneContext\` — 1–2 sentences: what happens, where, when. Geo-positions of
  the characters.
- \`activeReferences\` — \`@tag\` + minimal anchor of critical details + "100%
  matches the reference".
- \`locationMap\` — foreground / midground / background as separate layers, where
  the camera is, where light comes from, movement paths.
- \`firstFrame\` — who is where in the first frame: positions, orientation, gaze;
  the composition rule for this scene.
- \`formatMode\` — the level of cut control this shot needs (see CUTS below).
- \`optics\` — shot size + FOV per segment + lens character. Multishot: add "no
  drift mid-segment".
- \`camera\` — operator behaviour: height, distance, movement, focus, operator
  axis; camera-body tonal character as a look.
- \`action\` — the events at the precision the shot needs. Camera motion and
  subject motion stated separately.
- \`performance\` — acting + skin micro-realism, when acting matters.
- \`physics\` — mass, inertia, contact, fluids, particles.
- \`lighting\` — source, direction, exposure. The priority block.
- \`colorGrade\` — only when the grade is strong or stylised.
- \`wardrobe\` — only when costume matters.
- \`audio\` — only the sound or line this shot needs.
- \`style\` — technical-style suffix: overall look in words, photoreal, format,
  grain.
- \`outputSettings\` — only when the format must be pinned.
- \`positiveLocks\` — short hard fixers against the likely failures, in positive
  form, restating the critical info once. Continuity lives here.

A lock is a short hard fixer placed next to what it protects, e.g. "headlights
stay glowing in every shot". Write densely where control matters, sparsely where
it does not.

## CUTS AND TIMING

- Single shot (oner) -> "one continuous shot, the camera does not cut on its own."
- Sequential cuts, no timecodes -> \`CUT 1 … CUT 2\` in order.
- Timed multishot -> explicit HARD CUTs at stated seconds:
  \`0.0s to 1.0s — […]\` / \`1.0s HARD CUT\` / \`1.0s to 3.0s — […]\`
- Freestyle b-roll -> do not lock cuts.

When you specify cuts, lock that the camera adds none of its own. Cut types:
HARD CUT, SMASH CUT, MATCH CUT, INSERT CUT, REVERSE CUT, WHIP CUT. Fades only on
request. Across internal cuts hold the same character set, geometry, screen
direction, gaze, light, wardrobe and prop state.

Most shots are 2–4 seconds, so a single continuous shot is usually right. The app
compounds shots into <=15s bundles later — do not pre-cut for that.

## DIRECTING

Blocking. State where each character stands, sits, moves; what their hands do;
what sits between them. "She sits across from him at the diner booth, knees
touching under the table" beats "they sit and talk."

Acting. "she looks sad" -> "her eyes drop to the table, jaw tightens, she
swallows once before answering". "he is angry" -> "knuckles whiten on the glass,
breath shortens, eyes never leave hers". Restraint by default.

Camera language. FOV°, height, movement, motivation:
- "Low-angle 18° dolly-in, slow push from waist to chest as she realizes."
- "Static 47° two-shot, eye-level, locked off — lets the silence sit."
- "Handheld 63°, follow from behind — camera lags half a beat."

Continuity. Hold in mind (do not write as a block): state carried forward
(wet/dry/bloodied), appearance not drifting, one time-of-day and weather unless
the location changes.

## PROMPTING RULES

- Positive only. "does not fall backward" -> "stays upright, feet planted."
- Speeds in km/h. "fast" -> "moves at 40 km/h", "camera pans at 5 km/h".
- Atmosphere in percent / metres. "light fog" -> "fog density 40%", "haze visible
  at 15 meters depth". Build it in steps across shots: 20% -> 40% -> 60%.
- Giant scale via human-height comparison: "stands as tall as four humans stacked
  head to toe."
- Left/right is from the camera.
- Environment interaction stated physically: snow melts on skin, rain runs down
  hair, wind moves fabric.
- Emotion through muscle movement, not labels.
- English only.
- No director names, no signature-work references, no equipment names.

## OPTICS — SHOT SIZE, LENS, FOV

| Abbr | Meaning | In frame |
|------|---------|----------|
| ECU | Extreme Close-Up | a detail: eyes, button, headlight, hand |
| CU | Close-Up | full face / one element large |
| MCU | Medium Close-Up | head and shoulders |
| MS | Medium Shot | roughly to the waist |
| WS | Wide Shot | full figure + surroundings |
| EWS | Extreme Wide | scale, location |

Think in millimetres (24–35mm wide = space; 50mm = as the eye sees; 85mm =
portrait separation; 135mm+ = compression) but put FOV in DEGREES:

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

Use ONLY these discrete steps. Not "23°" — use 18° or 29°. In a multishot, set
FOV per segment and add "no drift mid-segment". The \`camera\` block sits 3rd in
the core layers (subject -> action -> camera -> style -> constraints): moved to
the end, FOV gets ignored; moved to the front, it conflicts with identity.

## OPTICAL TECHNIQUES

Observation pattern (hidden-camera effect) — all three at once:
1. Foreground occlusion — out-of-focus obstruction over 20–30% of frame.
2. Atmospheric haze — fog/dust/shimmer between camera and subject.
3. Distance vantage — super-tele 8°–12°, operator anchored far away.

- Sports broadcast: 8° super-tele + handheld 1–2cm tremor + "anchored at
  distance, finding the action".
- Detail-on-wide (snake cam): 84° wide FOV + low angle against a small object.
- Intimate wide: 63–84° on a close face — face centred, surroundings readable.
- Tele compressed air column at 8°–12°: "dust suspended in the long compressed
  air column between camera and subject".

## SPECIAL PROTOCOLS

4-mechanism multishot consistency stack (extreme FOV: 8°, 107°) — all four, or
extreme-FOV multishots break down after 2–3 beats:
1. Sequence-wide identity lock — single location reference across all beats.
2. LENS LOCK opener — explicit FOV phrase at the start of each beat.
3. LENS CHECK closer — confirm FOV at the end of the beat.
4. Colour via material + light, not as a list.

Whip-pan timing — a whip under 0.8s renders as a hard cut without blur:
\`0.3s — Subject A settled\` / \`0.8s — WHIP motion-blur transition\` /
\`1.4s — Subject B settled\`.

Mixed time-speed: hard cuts only between speed modes; each shot is one speed
start to finish.

Cracks/breaks without impact: "crowd PRESSES, not strikes"; "fracture originates
from edge stress, not center impact"; sequential timing edge-to-centre.

## CAMERA / LIGHT / COLOUR

- White balance in Kelvin, set to the scene mood, fixed within a scene (3200K /
  4000K / 5600K / 8500K).
- Describe the look, not the gear — camera/film/lens model names get ignored or
  break complex moves.
- Colour tied to material + light beam + compositional role, never a flat list:
  "the woman wears red" -> "crimson silk scarf catching the cold tungsten spill
  from the corridor".
- Background in layers: foreground / midground / background stated separately.
- Camera on the shadow side, with a stated operator axis.

## CHECKLIST (before saving each beat)

- Every shot stands alone — no scene numbers, no "as above", no props carried in?
- Tags named per the tagging rule, only in shots where that object is present?
- No style header at the top — does each prompt open on \`sceneContext\` /
  \`activeReferences\`?
- Each style aspect in its home block?
- Everything positive — no "does not X"?
- Speeds in km/h, atmosphere in %/metres, giants vs human height?
- Emotion through muscle movement, not labels?
- Left/right from the camera?
- FOV in degrees from the anchor table — not mm, not an off-table value?
- WB in Kelvin? Colour via material + light + role?
- Camera on the shadow side, operator axis stated?
- Background in foreground/midground/background layers?
- Multishot: FOV per segment + "no drift mid-segment"; extreme FOV -> all 4
  consistency mechanisms?
- Character names copied verbatim from the World roster?`;

// The built-in directors, in menu order. `productionType` is the type each one
// SEEDS (the default when a project has never chosen), not a restriction — any
// director can be activated for any production type from Settings.
export const SEED_DIRECTORS = [
  {
    id: "director-2d",
    name: "2D animation",
    productionType: "2d",
    promptForm: "paragraph",
    blurb: "One vivid paragraph per shot, with 2D motion accents (multiplane, on-2s, smears, follow-through) folded into the prose.",
    instructions: SEED_2D,
  },
  {
    id: "director-3d-pixar",
    name: "3D (Pixar-like)",
    productionType: "3d-pixar",
    promptForm: "paragraph",
    blurb: "One vivid paragraph per shot, with CG-feature staging: weight, secondary motion, materials and bounce light.",
    instructions: SEED_3D_PIXAR,
  },
  // First among the live-action seeds, so it is the one a project gets by
  // default. The block director below stays available — a project already
  // written with `promptBlocks` keeps working, and can switch back in Settings.
  {
    id: "director-seedance-pro",
    name: "Seedance 2.0 Pro Director",
    productionType: "live-action",
    promptForm: "paragraph",
    blurb: "Single-shot prompt director: spatial blocking with screen coordinates, per-character anchors and state locks, one dominant action, camera that preserves the blocking, and an explicit final frame.",
    instructions: SEED_SEEDANCE_PRO,
  },
  {
    id: "director-seedance",
    name: "Seedance director (block prompt)",
    productionType: "live-action",
    promptForm: "blocks",
    blurb: "The Seedance block document — SCENE CONTEXT, OPTICS with FOV in degrees, LIGHTING, POSITIVE LOCKS — written into `promptBlocks` and composed by the server.",
    instructions: SEED_SEEDANCE_BLOCKS,
  },
];
