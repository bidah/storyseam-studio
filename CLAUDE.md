# shot-studio

Vite + React front-end (`src/`, port 3333) backed by a Cloudflare Worker
(`worker/`, name `shot-studio-uploads` — D1 for ALL per-project JSON state + R2
for media blobs only + KV + a `ProjectEvents`
Durable Object for live-sync SSE) for building the Whistlewood episode: script,
shots, audio/video renders, cuts, and library. A [flue](https://flueframework.com)
chat agent (`flue-agent/`, its own Cloudflare Worker `shot-studio-flue-v2`, proxied
at `/eve`) drives the pipeline via typed tools + render skills. See `README.md` for
architecture and how to run it.

**The root `/` is the product**: the prompt box (a prompt in, a Film back),
with a **Gen mode** of fal H3 Director, Seedance 2.5 or MiniMax H3, and a Film's
page at `/create/:filmId`. **The studio shell lives under a project's url** —
`/p/:projectId/<view>` (`studioPath` in `src/lib/home.js`; RootLayout mounts
there and its loader sets the project on the fetch shim, so the URL is the
state). A finished Film's "Continue working on the video" opens its own
project's studio at the project's root url (`/p/:projectId/`): the Film's project has its `plugins` doc
materialised from the steps that ran (`worker/src/lib/film-plugins.js`) and the
Film seeded onto the Editor timeline. Bare studio paths (`/world`, `/editor`…)
redirect to the current project's `/p/...` url through `StudioRedirect` (hash
kept), or home when no project is known. "New story" in the project switcher
goes home — the prompt box is where projects are made.

## Storage — D1 for state, R2 for bytes

**Per-project JSON state lives in D1, never as objects in R2.** Every doc store
(world, shotlist, sounds, selections, cuts, episode-manifest, visual-world,
radio, stills, script, …) is a row in the `docs` table keyed `(project_id,
name)`, reached ONLY through `worker/src/lib/docs.js`. This is a multi-tenant
app: per-tenant state belongs in the database, where it gets transactional
writes, per-row scoping, and D1 **Time Travel** (30-day point-in-time recovery).
R2 holds media bytes — images, audio, video, uploads — and nothing else. Do not
add a new `*.json` object to R2 for app state.

- **Mutations use `updateDoc`, not `readDoc` + `writeDoc`.** `updateDoc` is a
  compare-and-swap on the row's `version` with jittered retry; a bare
  read-then-write is last-writer-wins and silently drops concurrent edits (a
  burst of parallel roster adds used to lose about half of them). Reserve
  `writeDoc` for a genuine whole-document replace.
  A `writeDoc` call needs a `guard:allow-write-doc — <why>` comment above it or
  the `doc-mutations` guard fails.
- **Every write is versioned AND attributed.** `docs.js` parks the value it
  replaced in `doc_history` (`worker/src/lib/history.js`), surfaced by
  `/api/history/*`, the `<DocHistory>` dialog, and the agent's `list_history` /
  `restore_version`. Time Travel is whole-database and destructive, so it can't
  serve per-document undo — that's what this is for. Each entry also records
  `actor` / `caller` / `chat_id`, read from the request's AsyncLocalStorage store
  (`worker/src/lib/request-context.js`) so no call site has to pass them.
- Schema lives in `worker/schema.sql`; apply with
  `npx wrangler d1 execute shot-studio-uploads --remote --file=schema.sql`.

## Guards — `npm run guards`

The rules in this file that fail SILENTLY are mechanised in `scripts/guards/`
and run by `npm run guards`: a stale vendored copy, an `/api` route the agent
can't reach, a read-then-write mutation, app state written back to R2. Run it
before a commit that touches the worker, the agent, or anything vendored.

Two of them keep a ledger under `scripts/guards/baselines/`. A baseline is debt,
not an exemption: the guard reports entries that no longer fire so they get
deleted. `baselines/agent-parity.txt` in particular is the live list of routes
the GUI can reach and the agent can't — the parity backlog, in one file.

## Auth — everything that reaches `/api` is authenticated

The ownership middleware in `worker/src/index.js` **fails closed**: no identity
means 401, and an identity that doesn't own the project means 403. Two
credentials satisfy it — the Better Auth session cookie, and the flue agent's
signed `x-flue-agent-user` assertion (`worker/src/lib/proxy-token.js` ⇄
`flue-agent/src/lib/agent-identity.ts`), minted from the user id encoded in the
conversation's instance id.

**A new caller of `/api` must carry one of the two.** Agent tools get it for free
by going through `flue-agent/src/lib/api.ts`; a call path that bypasses that
client needs the header itself. The exempt prefixes (`/api/auth/`,
`/api/projects`, `/api/extract`, `/api/agent/`, `/api/mcp`, `/api/sitting-runner/`)
each carry their own credential — the list is commented at the middleware.
Four Auto Film routes (`POST /api/auto/films`, `GET /api/auto/films/latest`,
`GET /api/auto/films/mine`, `GET /api/auto/films/:id/project`) are USER-scoped rather than project-scoped
(`isUserScopedAuto`): a Film makes its own project, so they still need a signed-in
user and 401 without one, but name no project.

## Shared capability schemas

`shared/schemas/*.json` describes a capability ONCE: the worker route validates
incoming bodies against it (`worker/src/lib/validate.js`) and the flue tool
builds its valibot input from it (`flue-agent/src/lib/schema-to-valibot.ts`),
descriptions included. Edit the file in `shared/schemas/`, then
**`npm run schemas:sync`** to vendor it into both packages (`npm run guards`
fails if a copy drifts).

Before this existed the only schema for a capability lived inside the tool, so
the agent path was strictly typed and the GUI path was unchecked. When you add
validation to a route, put the contract here rather than inline.

**One capability describes itself in code instead**, and the exception is worth
knowing. `src/lib/series.ts` (plus `shot-sheet.ts` and `music-plan.ts`) is
vendored into the worker and the agent by **`npm run series:sync`**, because a
Series' rules are not field shapes — they are relationships between fields that
only code can state: two pinned frames three seconds apart, a reel's first pin
clear of its opening chunk, both counted **per reel** after the sheet has been
cut and rebased. A JSON schema can say a number is a number; it cannot say that
a 17-pin sheet is refused whole and legal cut in two.

## Plugins — three core surfaces, everything else installed

The header used to carry fourteen tabs, which is the shape of a tool that does
everything and the feel of one you can't learn. It now carries **three core
surfaces** — **Bible** (`/world`), **Script**, **Editor** — plus
whatever the project has installed, plus an **Explore plugins** button that
opens the marketplace at `/plugins`.

Three plugins ship **pre-installed** (`defaultInstalled`): **Images**,
**Videos** and **Episodes**. They are ordinary plugins — in the marketplace,
removable — but a brand-new project has them on, because a studio with no way to
make a picture is not a smaller studio, it is a broken one. Episodes was core
until it became removable; projects whose plugin list was saved before that were
migrated to include it, so nobody lost the tab. The header order is `HEADER_ORDER`, a
single list with core and plugins interleaved, so the row reads as the pipeline
(Bible → Images → Videos → Script → …) rather than "built-ins, then extras".

**`src/lib/plugins.ts` is canonical.** It is import-free pure data (id, label,
tagline, blurb, highlights, category, `triggers`, `tools`, `skills`) vendored by
**`npm run plugins:sync`** into `worker/src/lib/plugins.ts` and
`flue-agent/src/lib/plugins.ts`; `npm run guards` fails when a copy drifts. A
plugin's **`id` is also its URL segment, its `TabsTrigger` value, and the `view`
the client reports to `PUT /api/appstate`** — keep them one string or the header,
the route guard, the agent's `navigate` target and the gate check will disagree
about what "the Radio plugin" means.

Adding a plugin therefore means editing ONE file and running the sync. Adding a
new *surface* still means the usual three parts (route, GUI, agent tool).

- **State**: the `plugins` doc in D1, **project-level** (both collaborators see
  the same studio — contrast `appstate:<userId>`, which is deliberately
  per-user). `GET/PUT /api/plugins`; writes go through `updateDoc` like every
  other doc.
- **An absent document seeds from usage, it does not default to empty.**
  A project that predates the marketplace already has a shot list and a radio
  pass, and would otherwise open with its own work missing from the header —
  which reads as data loss even though nothing was lost. `GET` derives the set
  read-only from `status.usage` and reports `defaulted: true`; the first install
  or removal materialises it and the derivation never runs again. It is not an
  auto-installer: nothing new appears later because the project grew content.
- **Uninstalling deletes nothing.** The tab goes, the documents stay. Say so
  wherever the author can uninstall — it is the reassurance the whole model
  rests on.
- **The GUI gate** is `blockingPlugin(view, enabled)` in RootLayout: a plugin
  route renders `<PluginGate>` (install it, or browse all) instead of its
  content. Core and `UNGATED_VIEWS` are never gated, and the gate never fires
  while the set is still loading — flashing "not installed" over a tab the
  author owns is worse than a beat of nothing.
- **The agent gate** is the `plugin-gate` skill plus `get_status.plugins`. When
  a request needs an uninstalled plugin the agent does NOT run its tools and
  does NOT write a document nobody can see: it draws a `PluginList` card
  offering the install and stops. On the author's yes it calls `set_plugin` and
  then **finishes the original request in the same turn** — they asked for the
  work, not for a plugin.

`Plugin` / `PluginList` are real components in the genui contract, so the offer
card is drawn through the same `render_ui` channel as every other question.

### The Director — four plugins, one recipe

Everywhere else here you render a shot, then the next shot, then cut them
together. The **Director** plugins are the other way: one recipe, and a live
Director that generates the piece **continuously** against it. Ported from the
story-smash-director repo, where every number in it was learned against a real
endpoint's refusals.

- **Director** (`/director`) — the Series: an opening prompt, an exact first
  frame, a cue sheet of timed beats, model sheets, target audio.
- **Stage** (`/stage`) — plays one live, and keeps the sitting.
- **Shot sheet** (`/shotsheet`) — draws the whole cue sheet's pins as ONE clip
  and cuts them back out.
- **Musicalized** (`/musicalized`) — one continuous cue laid under a sitting.

All four are **not `seedable`** — the first plugins that are not. Seeding exists
for a project that predates the marketplace; none predates these, so a usage
counter for them would be an integer that is always zero bought with a document
read on every `/api/status`.

**The endpoint refuses a WHOLE SESSION, not a beat.** A cue sheet that breaks a
ceiling dies at `configure`, before a frame exists, and bills its sixty-second
minimum anyway — naming no beat. That is why `src/lib/series.ts` exists and why
it is vendored: the form checks the ceilings while a sheet is being typed, the
Worker checks them on the way in, and the agent checks them before it spends a
sitting. Every route answers with an `issues` map and every surface shows it.

Two things are the BROWSER's, and each is in `scripts/guards/baselines/
agent-parity.txt` with its reason: the WebRTC session itself, and cutting frames
off a decoded take. Muxing the scored film was the third; it now also runs
server-side (`score_sitting` and the Auto Film job's Score stage — ffmpeg in a
Daytona sandbox, `worker/src/lib/film-score.js`). Either way the picture's
packets are copied rather than re-encoded, so a scored sitting is bit-for-bit
the one that was kept.

**What connects to what** — this is a plugin of *this* studio, not a second app
sharing its header. The Shot list derives the cue sheet (`derive_cue_sheet`);
the Bible, Images and Library supply model sheets; Sound Studio and Radio supply
the target audio; a kept sitting is an ordinary project file the Editor and
Cuts can use.

### The story — a Script stage, and a Deep Film's writers' room

Both Film pipelines share two STORY stages after the World (`film-job.js`
`stagesFor`). **Script** (`film-stages/script-flow.js`; shared prompts in
`script.js`) is written in PASSES on the Film's own writer (`job.writer` — Qwen
3.8 on Workers AI (the default), Kimi K2.6, or Claude; never swapped for another): an outline (a plan per scene —
place, driver, the value it turns on), a draft from it ("First draft"), and a
revision against the specialists' rules (`SCREENWRITER_CRAFT`) and what code
measures (`scriptIssues`: scene count, one scene per take, dialogue against the
budget, World names, the author's lines) → "Revised draft", plus a second
revision only when a measured problem survived. The sequence is the flue
worker's `FilmScriptWorkflow` (each pass a checkpointed step calling back
`/api/auto/films/:id/script/pass`, state in the `film-script:<filmId>` doc) —
one call used to write it in a second, and thin. The last draft is pinned; both Shot list stages
cut the screenplay from there rather than inventing the story from the World. A
Film whose `depth` is `deep` adds the **Writers' room** (`film-stages/room.js`):
the chosen `specialists` (the same fifteen as the chat's, `src/lib/specialists.ts`,
in roster order; default `DEFAULT_DEEP_SPECIALISTS` in `film-plan.ts`) read the
draft in ROUNDS by roster stage, each pass a real subagent profile with its read
tools (`flue-agent/src/agents/writers-room.ts`), sequenced by the flue worker's
`WritersRoomWorkflow`; each round's rewrite is a worker route, pinned as a new
draft; state in the `film-room:<filmId>` doc. **Every writing step of a Film —
Script passes, room passes and rewrites included — runs on the writer picked in
the prompt box (`job.writer`: `qwen` — Qwen 3.8 on plain Workers AI, the default —
`kimi` — Kimi K2.6 on Workers AI — or `claude`). Never hardcode a model for
a step**: the room gets the writer as a flue specifier (`agentWriterModel` in
`worker/src/lib/writer.js` ⇄ `ROOM_MODELS` in `flue-agent/src/lib/models.ts`). The input's
Writer button (Fast · Deep, the room dialog with `roomEstimate`) and `make_film`'s
`depth` / `specialists` are the two surfaces. An Auto-off Film now confirms after
the last story stage (`confirmAfterFor`), so the script is on the table before
anything is paid for.

### The story flow — the same Film on Seedance 2.5

`/` offers every pipeline on one page (`components/DirectorStory.jsx`
`FLOWS`): the input's **Gen mode** picker (fal H3 Director / Seedance 2.5 /
MiniMax H3, remembered per browser) is the choice. Seedance sends `engine: "seedance"` with
the prompt; every Film's page is `/create/:id` and follows the Film's engine.
`/director-story`, `/story-flow` and their `/create/:id` only redirect there
(`/story-flow` with Seedance chosen). A Seedance Film runs `STORY_FLOW_STAGES`
instead of `FILM_STAGES` (`worker/src/lib/film-job.js` `stagesFor`). Look and World
are shared; from there it is its own recipe (`worker/src/lib/film-stages/story-flow/`):
character sheets as a turnaround + a face, empty location plates → a shot list of
**segments** of up to 30s written as staged narrative (no pinned frame every few
seconds; `film-plan.ts` `segmentDurations` — the ceiling is the ENGINE's:
Seedance 2.5 takes 30, H3 15, and the Script stage writes one scene per take so
the shot list cuts the screenplay onto that grid) → the prompts compiled from the Seedance 2.5 skill
(`seedance-skill.js`, vendored from promptsama) → the video run, one segment at a
time, segment k an `extension` of the **last 3s of segment k−1** (cut on the box) plus
its sheets → one final cut → the Score. Everything at **480p**. Seedance writes the
dialogue and effects (never music — see the score below). Every engine takes the
same lengths — **0:30–5:00** in 30s steps, **2:00** by default. The agent reaches it through `make_film`'s `engine`.

### The H3 flow — the same story on MiniMax H3

The third engine, `engine: "h3"` (Gen mode **MiniMax H3**), is the story flow
on fal's `minimax/h3/reference-to-video`, which is not live either. It runs
`H3_STAGES` (`film-job.js`): the story flow's Look, World, Script, sheets, Shot
list and final cut, with its own prompts and video run in
`worker/src/lib/film-stages/h3/`. Three things differ, all in `film-plan.ts`
› The H3 FLOW: H3 has no `extension` task and re-enacts a reference VIDEO as
a performance, so segment k is handed the **last frame** of segment k−1 as one
more reference image (cut on the box beside the tail) and told to open on it
exactly — Video 1 is only the fallback for a job in flight whose previous
segment has a tail and no frame; H3 cites references by order ("Image 1,
Image 2", not `@Image1`) and takes at most 9 images; and the prompt is H3's
own six-field brief (`h3/prompts.js`; the Shot list writer still reads the
promptsama skill `h3/h3-skill.js` whole, the way the Seedance one reads
`seedance-skill.js`; `STORY_ENGINES` in `story-flow/shotlist.js` is where an
engine's skill and continuation wording are named). 480p/720p map onto H3's
native 480P/768P.

**What a video model can read as speech, it speaks** (film-1fd51691: a stage
name, "segment two of Concrete King", the audition's words, a line said
twice). So both compilers share `story-flow/lines.js` (who has a line in a
segment: a voice reference is bound ONLY for them) and
`story-flow/direction.js` (each segment carries its own `environment` and
`sound`; a film-wide direction field that names another World place is
dropped rather than pasted, because a narrated journey played the whole
journey in one segment), no title or stage name reaches a prompt, and every
segment carries a scope lock (only its own stages, in its own place).

### The score — every engine's last stage

Every Film ends with the Director's **Score** stage (`film-stages/score.js`):
the finished film measured, one continuous cue written to it and laid under
the picture. For the two story engines it is `STORY_SCORE_STAGE`, which hands
the final cut's `stitch` result to the score under the name `sitting`. The
story-flow Shot list now writes the same **music cues** the Director's does, so
the score is paced from the story rather than from the picture alone. The
prompt box's settings gear has a **Score** switch (on by default; only `score:
false` is sent, and `stagesFor` drops the stage), and `make_film` takes
`score`. The score renders on **MiniMax Music 3** by default (`music:
"minimax"`, billed per second) or ElevenLabs Music (`"elevenlabs"`, billed per
STARTED minute of every piece — a three-piece score paid for three minutes):
the gear's **Score model** and `make_film`'s `music` (`film-plan.ts`
`FILM_MUSIC`). A job stored without `music` predates the choice and keeps
ElevenLabs; each render records its `model` so it is polled on its own queue. Because the score is laid under afterwards, every video prompt
carries the sound lock (`film-sound.js` `filmSoundLock`: **NO MUSIC, no
subtitles**), on Seedance, H3 and the Director alike — music a model bakes in
cannot be ducked or cut out.

### Voices — one voice per character, auditioned once

A story engine writes its own sound, so a character's voice is whatever the
model gave them in THAT segment, and the next segment, prompted afresh, gives
them another. Seedance 2.5 and MiniMax H3 both take **audio references** (a
clip that "defines <Name>'s voice timbre, accent and delivery"), which is the
only way one voice reaches every segment. So a story-engine Film runs a
**Voices** stage right after its sheets (`film-stages/story-flow/voices.js`):
every character in the World is **auditioned** — the same `AUDITION_LINES`
for everyone, read in their own voice as the World's `voice` note describes
it, as a voice-only recording (no ambient sound, no room tone, no music, no
effects) — and the take is filed as an mp3 in R2 and on the World roster's
`voiceRef`. Every segment a character speaks in then binds it: `@AudioN` on
Seedance, `Audio N` on H3 (at most 3 audio files and 15s of audio per H3
request, counted in its 12 files — `MAX_H3_REFERENCE_AUDIO`). Three ways to
run the audition, all on fal, chosen by the prompt box's **Voices** setting
and `make_film`'s `voices` (`film-plan.ts` `FILM_VOICES`): `video` — the
Film's own video model generates a 5s audition to camera and the box cuts its
audio track (the voice that model gives that face, so it persists best;
default); `seedaudio` — ByteDance Seed Audio reads the lines from the voice
note; `elevenlabs` — a voice designed from the note reads them. The Director
takes no voice reference, but it takes **target audio** (a beat's `audioUrl`
is what the stream acts to and carries). So a Director Film auditions too
(`video` on MiniMax H3) and then runs a **Dialogue** stage after its Stills
(`film-stages/dialogue.js`): each spoken beat's lines are read by Seed Audio
against the speakers' auditions (`@Audio1…3`) and set as that beat's audio,
merged to fit the 8-audio-beats-per-reel ceiling; lines it can't voice stay
text with the speaker's voice note. A job without `voices` (one from before)
runs neither stage — steps map onto stages by position, so a running job's
list must never change under it.

## Feature parity — GUI AND agent, always

Every feature must work **both** ways: through the GUI **and** through the flue
agent, which must be able to run the whole pipeline by itself. A new `/api/...`
capability therefore ships with three parts, and a feature is not done until all
three exist:

1. the worker route (`worker/src/routes/`),
2. the GUI surface (`src/routes/`),
3. the agent surface — a typed tool (`flue-agent/src/tools/` + registration in
   `tools/index.ts`) and, when the flow has more than one step, a skill playbook
   (`flue-agent/src/skills/<name>/SKILL.md` + registration in `src/skills.ts`)
   that wires the tools together the same way the GUI does.

When touching an existing feature, check the agent side didn't fall behind
(e.g. a GUI button calling a route no tool exposes = a parity gap — close it).
The `agent-parity` guard now catches this for you. Skill descriptions carry the
behavioral rules (the agent model leans on them), so put hard constraints in the
SKILL.md `description:` too, not just the body.

### Context awareness — the agent can see the screen, and move it

The client reports its current tab and selection to `PUT /api/appstate` on every
route change (`src/lib/appState.js`, wired in `RootLayout`). The agent reads it
back through the **`view_screen`** tool, which re-fetches the LIVE records those
ids point at rather than trusting the stored copy — so "make this shot wider"
resolves without a round-trip. What's stored is ids and short labels only; the
route enforces that with a size cap.

State is keyed **per user** (doc name `appstate:<userId>`), because two
collaborators on one project are looking at different screens.

The return leg is **`navigate`** → `POST /api/navigate` → the `nav` SSE channel
→ `RootLayout` moves the tab. It's a one-shot command, deliberately not stored:
replaying "go to Radio" on a reconnect would yank the author out of whatever
they moved on to.

### Destructive tools are gated

`save_shotlist` (a shrinking `replace` only), `stitch_cuts`, `restore_version`
and `delete_sound_version` don't execute on the first call. They register a
pending op (`POST /api/approvals`) and return an `approvalToken`; the agent draws
a `render_ui` confirm card, and only a second call carrying that token executes —
replaying the STORED params, not what the model re-typed. See the
`destructive-approval` skill. flue can't suspend a turn, so the transcript
round-trip is the suspend mechanism.

Keep this list short. A gate that fires often trains the author to tap through
without reading, which is worse than no gate.

### The pipeline is also an MCP server

`POST /api/mcp` exposes the read tools plus `save_shotlist` / `restore_version`
to Claude Desktop, Claude Code and Cursor. It authenticates with its own bearer
(`MCP_TOKEN`) and requires an explicit `?projectId=` — it never falls back to a
default project. Details in `docs/mcp.md`. The tools reuse the same route
helpers the HTTP surface does (`buildStatus`, `buildShotlistView`, `saveShotlist`,
…), so there is no second implementation to drift.

## Deploying — ship BOTH workers

A feature usually spans **both** Cloudflare Workers: the API/UI in `worker/` **and**
the agent skill/tools in `flue-agent/`. **Deploy both, or the feature is
half-broken** — e.g. a new `/api/...` route deploys but the agent can't call it
(the `attach_*` tool lives in the stale flue worker), or vice versa. When a change
touches only one, deploy only that one — but check.

- **API + SPA worker** (`shot-studio-uploads`): `npm run worker:deploy` (builds
  Vite, then `wrangler deploy` in `worker/`). Worker-only route changes tested via
  local web don't strictly need the rebuild — `cd worker && npx wrangler deploy`
  suffices — but a full `worker:deploy` keeps prod's SPA in sync too.
- **The Remotion render bundle** (R2 `remotion-bundle/editor.tar.gz`):
  `worker/build-remotion-bundle.sh`, then commit `worker/remotion-bundle.stamp`.
  The Deliver render does NOT run `src/editor/` — it runs this prebuilt webpack
  bundle, so a composition change reaches the preview instantly and the render
  never. Nothing errors; the mp4 is just built from the old composition. Required
  after any change to `src/editor/{RemotionRoot,Composition,timeline}.*`; the
  `remotion-bundle` guard fails when the stamp and the sources disagree.
- **Flue agent worker** (`shot-studio-flue-v2`): `npm run flue:deploy` (`vite build`
  then `wrangler deploy`). Required whenever you add/change a skill (`src/skills/`),
  a tool (`src/tools/`), or `agents/*.md`. Flue owns the build through Vite now —
  `flue build` / `flue dev` are gone; `vite build` writes the finalized wrangler
  config into `dist/`, so deploy with a plain `wrangler deploy`, no `--config`.
- **The OLD agent worker** (`shot-studio-flue`, flue 1) is still deployed and
  still holds every pre-migration transcript. It is FROZEN: flue 2's persisted
  schema rejects a flue-1 database outright, so a conversation can never move
  between them. The `/eve` proxy pins each chat to its engine by the chat id's
  `f2-` prefix (`worker/src/index.js`), and `FLUE_V2_NEW_CHATS` decides which
  engine NEW chats are minted on. No feature lands on v1 — if you touch the
  agent, you are touching v2.
- **Local-dev caveat:** `npm run dev` / `npm run stack` proxies `/api` to the
  **deployed prod** worker by default (`WORKER` unset in `vite.config.js`), so a new
  worker route won't appear locally until it's deployed (symptom: existing routes
  return JSON, the new one returns `text/html` SPA fallback). Deploy the worker, or
  run a local one with `WORKER=http://localhost:8787 npm run dev` + `cd worker &&
  npx wrangler dev`.

### Mobile — verify on the simulator

A mobile UI change is checked by LOOKING at it: drive the booted simulator with
**`agent-device`** (press by accessibility label, screenshot), falling back to
`axe` for gestures that have to reach React Native. Full recipe, including the
deep link that points a dev client at Metro: `mobile-app/AGENTS.md`.

### Mobile OTA after a commit

After **any commit that touches `mobile-app/`**, **ask** whether to publish an EAS
**preview** OTA update — do NOT publish on your own. A `PostToolUse` hook in
`.claude/settings.json` fires on exactly those commits and is what raises the
question, so the prompt comes from the hook rather than from remembering this
rule. On a yes, run `cd mobile-app && npm run update:preview` (i.e. `eas update
--channel preview --platform ios --environment preview`) and tell the user it
shipped. (Renderer/JS-only changes ship over-the-air; a native/config change
instead needs a fresh build, not an OTA — in that case say so instead of offering
the OTA.)

## Desktop app (macOS, `desktop/`)

Electron shell hosting the SAME Vite build on a privileged `app://` origin; an
origin bridge forwards backend paths to the deployed Worker. The proxy path
list is **`src/lib/routeTable.js`** — the single source of truth shared by
`vite.config.js` and the bridge (vendored into `desktop/main/` by
`npm --prefix desktop run sync`, auto-run by desktop scripts; parity test in
`test/web/routeTable.test.js`). Add a new backend prefix ONLY there.
`npm run desktop:dev` (HMR) / `desktop:start` (prod mode) / `desktop:dist`
(signed build) / `desktop:publish` (upload update feed to R2). Details:
`desktop/README.md`. Desktop-only renderer behavior hangs off `window.desktop`
(`src/lib/desktop.js` seam) — the web build must stay unaffected.

## Routing & data

URL routing is **React Router v7 in data mode** (`src/router.jsx` → `RootLayout` +
one lazy-loaded route per tab in `src/routes/*.jsx`, each exporting `{ Component,
loader }`). Tabs fetch through their route **`loader`** (stale-while-revalidate via
`src/lib/swr.js`), **not** `useEffect`; components read data with `useLoaderData()`,
and load errors render through the route's `ErrorBoundary` (`RouteError`).

**After any mutation: `invalidateTabCache(key); revalidate()`** — the canonical
pair. `RootLayout` wires that same pair to the three "data changed" signals (the
`/api/data/events` SSE firehose, the Refresh button, and project switch). `reloadKey`
survives **only** as a media cache-bust nonce (`?v=` on `<video>`/`<img>`/`<audio>`),
not for data. Do NOT loaderize the Script (TipTap) or Editor (Remotion) surfaces —
they own their document state. Full route tree, gotchas, and the Worker
`run_worker_first` caveat: **`docs/routing.md`**.

## Timeline model (Editor / animatic)

`src/editor/timeline.js` is the canonical shape and is **vendored** into
`render-fn/` — after editing anything in `src/editor/*`, run
`cd render-fn && npm run sync`, or the Vercel render path silently renders the old
composition.

**Media kind belongs to the ITEM, not the track.** A `type:"video"` track is the
*picture* lane; `item.kind` decides what each item is (absent ⇒ `"video"`):

- `kind:"image"` — a storyboard still held on screen (the animatic's picture).
  It has **no source timeline**: `offsetFrames` is always 0 and
  `sourceDurationInFrames` is always absent (so resize is uncapped). Any code
  doing in-point math (head-trim, split) **must** branch on it — `isImageItem()`
  in `src/editor/timeline.js`, `isImage()` in `worker/src/routes/timeline.js`.
- `kind:"image"` with `src:null` — a **slate**: a shot whose still isn't
  generated yet. An ordinary item that renders as a labelled placeholder.
- Stills and videos are peers on one picture lane on purpose: a still is a
  placeholder for that shot's video, so the upgrade must not cross tracks.

Two unrelated things are called "still": **storyboard stills**
(`db.stills[bundle][shot]`, `/storyboard-media/`, per shot, has takes — this is
the animatic's picture) and **grabbed stills** (the `stills` doc,
`/stills/`, frames captured from the preview). Don't mix them up.

**Shot ids are a public key space.** `shot.id` keys `db.stills`; rewriting it
orphans generated media. `POST /api/shotlist` preserves stored ids and warns
when it has to invent one — never "fix" that by renumbering.

## Generative chat UI (`render_ui`)

The agent asks the author things by calling **`render_ui`**, whose input is an
**OpenUI Lang** program rendered client-side through one shared component
contract. Tapping a component posts its `send` string as the next user message —
flue can't suspend a turn, so that transcript round-trip *is* the answer channel
(`deriveQA` decides which card is still live). `ask_question` is gone; its parts
still render in old transcripts.

**`src/genui/contract.ts` is canonical** — component names, zod schemas, prop
types, descriptions. Two renderer sets implement it: `src/genui/renderers.jsx`
(shadcn) and `mobile-app/src/genui/renderers.tsx` (React Native, Galeria
previews, `SemiPillButton` CTA). Same names, same props, different pixels.

A client-side companion renders through the same `<StudioUI>`, so it is
indistinguishable from a card the agent drew:

- **`detect-options.ts`** rescues a trailing `A)`/`1.` choice list the model
  wrote as prose into a real `OptionList`. Heuristics are deliberately strict
  (trailing position, sequential markers, 2–6 short items, a cue word or `?`
  above, newest settled turn only, no card already drawn) — a false positive
  turns a recap into buttons that post nonsense.

There was a second one — "where to go next" follow-up chips under a finished
turn (`next-questions.ts` + `POST /api/next-questions`, a small Workers AI model
grounded on `buildStatus`). **Removed**, and don't rebuild it: the pattern comes
from AI search engines, where every answer is a dead end. Here a turn usually
ISN'T the end of anything — the agent is mid-pipeline and the author already
knows the next move — so the chips offered detours from work in progress, and a
turn that ended with a render still running got them at the worst moment.
`buildSuggestions` survives on its own for the Home landing deck, where a cold
start really does need somewhere to go.

**After ANY contract edit, run `npm run genui:sync`** — it vendors the contract
into `mobile-app/src/genui/`, regenerates the agent's `generative-ui` SKILL.md
from `SKILL.template.md`, and re-emits `flue-agent/src/lib/genui-schema.json`
(which `render_ui` parses against, so a malformed program comes back to the
model as a correctable error instead of a broken card). Skip the sync and the
agent gets prompted with components the renderers don't have — the same silent
drift the `render-fn` sync rule exists to prevent. Edit
`src/genui/contract.ts` and `SKILL.template.md`, never the generated copies.

## UI stack

The front-end is built on **Tailwind CSS v4** + **shadcn/ui** (New York style, zinc base,
emerald accent). Key files:

- `src/index.css` — Tailwind entry + the theme tokens (`:root` = light, `.dark` = dark,
  which is the default via `class="dark"` on `<html>`). Colors are OKLCH CSS variables
  mapped through `@theme inline`.
- `src/components/ui/*` — shadcn primitives (`button`, `card`, `dialog`, `tabs`, `badge`,
  `input`, `textarea`, `label`, `checkbox`, `slider`, `tooltip`, `separator`, …). Add more
  with `npx shadcn@latest add <name>`. `Badge` is extended with `success` / `warning` /
  `info` / `muted` variants for status pills.
- `@/` is aliased to `src/` (see `vite.config.js` + `jsconfig.json`), `cn()` lives in
  `src/lib/utils.js`.

**Prefer shadcn components + Tailwind utility classes** over bespoke CSS. Reuse the small
in-file helpers in `App.jsx` (`Empty`, `Eyebrow`, `Chip`, `Panel`, `Spinner`, `ErrorNote`)
for consistency. All modals are shadcn `Dialog` (Esc / overlay-click close for free).

## UI conventions

- **Always use [lucide-react](https://lucide.dev) icons — never emojis or Unicode glyphs**
  (no 🔊 ✕ ✓ ＋ ▾ ★ ↺ ⧉, etc.) in JSX. Import the named icon from `lucide-react` and
  render it as a component, e.g. `import { Volume2 } from "lucide-react"` →
  `<Volume2 size={14} />`. Size icons in px to match the surrounding text, and give
  icon-only buttons an `aria-label`.
- Typographic characters that are punctuation, not icons (e.g. `→`, `·`, `–` inside
  text like "MS-01 → MS-22"), are fine to keep as text.
