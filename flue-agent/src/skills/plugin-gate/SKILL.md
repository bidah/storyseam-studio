---
name: plugin-gate
description: >-
  The safeguard for a studio whose surfaces are OPTIONAL: four always-present
  tabs — Bible, Script, Episodes, Editor — plus the plugins the author
  installed (Shot list, Radio, Sound studio, Musical, Moodboard, image and
  video generation, Visual nodes, Script agents, Animatic, Complete cuts,
  Library). Load before any pipeline work. Hard rules that
  hold without reading the body: `get_status`'s `plugins.disabled` is what this
  project CANNOT do — never call a plugin's tools or run its skills while it is
  uninstalled, not even to test one, and never quietly do the work on a
  different surface. When a request needs a missing plugin, name the capability
  in prose, draw ONE `render_ui` card (a `Callout` plus a `PluginList` offering
  it) and STOP — no writes, no renders. Only after the author's own yes call
  `set_plugin` with `action: "install"`, then CONTINUE the original request in
  the same turn. Never install or remove a plugin on your own initiative, never
  offer more than three, and never offer a core surface.
---

# Working in a studio that may not have the tab you need

The header used to have fourteen tabs. It now has four — **Bible** (`world`),
**Script**, **Episodes** and **Editor** — plus whatever the author installed from
the marketplace. A project that is a radio play has no Musical tab. A project
that has never rendered has no Complete cuts tab.

This changes one thing for you, and it is not cosmetic: **a tool can succeed on a
surface the author cannot see.** `save_shotlist` on a project with no Shot list
plugin writes a perfectly good document into D1, fires the sync event, returns
`ok`, and lands nowhere. You would then report twenty-two shots to someone
looking at four tabs, none of which is a shot list. That is the failure this
skill exists to prevent — not an error you would notice, a success you would
misreport.

## 1. Know what is installed before you start

`get_status` already carries it:

```jsonc
"plugins": { "enabled": ["shotlist", "radio"], "disabled": ["moodboard", "musical", …], "defaulted": false }
```

That is the cheap check, and it is the one to use — you are almost always calling
`get_status` at the top of a turn anyway. `list_plugins` is the *other* tool: call
it when you need each plugin's tagline and highlights to draw an offer, not to
answer "am I allowed".

`defaulted: true` means the author has never installed or removed anything and
the set was inferred from the work the project already contains. Treat it exactly
like an explicit set — it is what their header shows.

## 2. Who owns what

| Plugin | The author asks for | Tools it owns |
| --- | --- | --- |
| `agents` — Script agents | "notes on my script", "run the writers' room", a named doctor | `get_script_reviews`, `record_script_review` |
| `moodboard` — Moodboard | "moodboard", "pin a reference", "inspiration board" | `get_moodboard`, `add_moodboard_card`, `remove_moodboard_card` |
| `shotlist` — Shot list | "break the script into shots", "the shot list", "add a shot" | `get_shotlist`, `save_shotlist`, `list_shots`, `get_shot_director`, `save_shot_director` |
| `images` — Image generation | "generate an image", "concept art", a character / location / prop sheet | `get_visual_world`, `attach_visual_generation`, `save_visual_prompt`, `save_generation_to_library` |
| `videos` — Video generation | "make a clip", "animate this", "image to video" | `get_visual_world`, `attach_visual_generation` |
| `nodes` — Visual nodes | "node canvas", "wire the pipeline", "lineage" | `get_visual_world` |
| `animatic` — Animatic | "animatic", "storyboard reel", "preview the episode", slates | `attach_still`, `get_timeline` |
| `radio` — Radio | "voice the dialogue", "cast the voices", "table read", "audio pass" | `get_radio`, `cast_radio_voice`, `attach_radio_take`, `casting_sample_prompt`, `commit_pacing` |
| `sounds` — Sound studio | "sound effect", "ambience", "sound design", "generate audio" | `list_sounds`, `create_sound`, `add_sound_version`, `edit_sound_version`, `like_sound_version`, `rename_sound`, `delete_sound_version`, `attach_sound`, `save_audio_prompt` |
| `musical` — Musical | "music video", "split the song", "lyric video" | `get_musical`, `split_song`, `save_musical_segments` |
| `cuts` — Complete cuts | "stitch it", "final cut", "export the episode" | `get_cuts`, `stitch_cuts`, `score_cut`, `load_cut_into_editor` |
| `library` — Library | "my uploads", "saved images", "import from Higgsfield" | `list_library`, `toggle_library`, `attach_character_sheet`, `attach_location_sheet`, `attach_character_miniature` |

Skills follow their plugin: `shot-list` / `shot-list-live-action` /
`create-new-shots-for-shotlist` are `shotlist`; `radio` + `radio-pacing` are
`radio`; `seed-audio` is `sounds`; `visual-world` + `sheet-generation` are
`images`; `continue-video` + `video-from-audio-vfx` are `videos`;
`generate-storyboard` is `animatic`; `moodboard`, `musical`, `script-agents`,
`complete-cut` and `assign-refs` follow the plugin of the same subject.

**The three core surfaces are always there.** `world` (Bible), `script`,
`editor` — plus Settings, Members and the marketplace itself. Never
offer to install one, and never tell the author one is missing.

**`images`, `videos` and `episode` ship PRE-INSTALLED**, so on almost every project they are
already on and there is nothing to offer. They are still ordinary plugins and an
author can remove them — so read `plugins.disabled` rather than assuming. What
you must not do is offer to install one that is already there.

## 3. When the request needs a plugin that is not installed

Acknowledge first, as always — then:

1. **Say plainly what the request needs and why.** One or two sentences: the
   capability, not the id. "Voicing the dialogue is the Radio pass — casting a
   voice per character and rendering a take per line — and this project doesn't
   have it yet."
2. **Draw ONE card**: a `Callout` explaining the block, and a `PluginList`
   offering the plugin.
3. **STOP.** No writes. No renders. Do not call the plugin's tools "to see if it
   works" — they will succeed and the result will be invisible. Do not do the
   work on a neighbouring surface because it is installed; a shot list written
   into the Script is not a shot list.

```
cal = Callout("info", "Voicing lines needs the Radio plugin", "Radio is the audio-only pass — a cast voice per character and a rendered take per line. It isn't installed on this project yet.")
radio = Plugin("Radio", "Cast every character and voice every line.", "Install the Radio plugin", "Audio", "Needed for this")
list = PluginList([radio], "Add this to your studio")
root = Card([cal, list])
```

Arguments are **positional** — `Plugin(name, tagline, send, category, badge,
meta, highlights, installed)` and `PluginList(plugins, header, footnote)`. Never
`name = value`; a `key:` slides every prop one slot over. `installed: true` is
for CONFIRMING a plugin the project already has — never pass it on an offer.
Load **generative-ui** if you need the rest of the syntax.

## 4. On their yes, finish the job

Their tap posts the `send` string as the next user message. Then:

1. `set_plugin({ pluginId: "radio", action: "install" })`.
2. Confirm it in **one line** — "Radio's installed."
3. **Continue the original request in the same turn.** They asked you to voice
   the dialogue; they did not ask you for a plugin. Making them repeat the
   request after installing is the exact friction this flow exists to remove.

`navigate` to the new tab only *after* the install lands — before that, the app
gates the route and they arrive at an install prompt instead of their work.

## 5. The rules that actually matter

**Never install on your own initiative.** Installing changes someone's app. The
only authority is their own words — a tapped `PluginList`, or "yes, install it"
in chat. Your plan is not a yes, and neither is their opening brief.

**Never remove one unprompted.** Only on an explicit ask. And say what removal
means when you do it: the tab is hidden, nothing is deleted, and reinstalling
brings the work back.

**Never offer more than three.** Offer the plugin the request actually needs. Add
a second only when the same outcome genuinely requires it — "voice the dialogue"
needs `radio`, and needs `shotlist` too if there is no shot list to voice, because
Radio derives its lines from it. A card of eight plugins is a marketplace, and
the author already has one of those.

**One offer, not a running upsell.** If they say no, or ignore it, that is an
answer. Do the part of the request you *can* do on the surfaces they have, say
what is left undone, and move on. Do not re-offer the same plugin later in the
conversation because a new request brushed against it.

**This is not the destructive-approval gate.** No token, no two-call flow.
Installing is reversible in one tap; a token gate here would fire constantly and
train the author to tap through the cards that actually matter.
