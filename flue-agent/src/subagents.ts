import {
  defineSubagent,
  useSubagent,
  useTool,
  type SubagentDefinition,
} from "@flue/runtime";

import type { ToolDefinition } from "@flue/runtime";

import type { Api } from "./lib/api.js";
import { createReadTools } from "./tools/index.js";
import { recordScriptReview } from "./tools/record_script_review.js";

import dialogueDoctor from "./subagents/dialogue-doctor.md";
import motivationDoctor from "./subagents/motivation-doctor.md";
import plotDoctor from "./subagents/plot-doctor.md";
import storyArchitect from "./subagents/story-architect.md";
import sceneDoctor from "./subagents/scene-doctor.md";
import characterDoctor from "./subagents/character-doctor.md";
import themeDoctor from "./subagents/theme-doctor.md";
import tensionDoctor from "./subagents/tension-doctor.md";
import worldContinuity from "./subagents/world-continuity.md";
import producer from "./subagents/producer.md";
import performanceDoctor from "./subagents/performance-doctor.md";
import voiceDesigner from "./subagents/voice-designer.md";
import punchUp from "./subagents/punch-up.md";
import tableRead from "./subagents/table-read.md";
import firstReader from "./subagents/first-reader.md";
import characterActor from "./subagents/character-actor.md";
import herosJourney from "./subagents/heros-journey.md";
import kishotenketsu from "./subagents/kishotenketsu.md";
import saveTheCat from "./subagents/save-the-cat.md";
import storyCircle from "./subagents/story-circle.md";
import threeAct from "./subagents/three-act.md";

// Script-specialist subagents ported from the eve agent (agent/subagents/*).
// Advisor pattern: they analyze/recommend and the parent (whistlewood) applies
// their output — none can touch the script (the sole exception is
// `record_script_review`, their own log book — see createSubagents). They DO
// carry read-only context
// tools (get_script/get_world/get_shotlist) so each pulls the full pinned draft
// itself instead of relying on the parent to inline the whole script into the
// `task` prompt (long verbatim copies get truncated by the parent model).
// model/thinkingLevel are OMITTED so each delegate inherits the parent's model
// and reasoning effort — which is also the only way to get them, since
// `useModel` throws in a subagent render.
//
// A delegate's INSTRUCTIONS are now its agent function's return value, and its
// tools are `useTool` calls inside that function. The function is re-rendered
// fresh at every delegation, so the closures below read current values.

// --- story-architect's nested arc experts -------------------------------------
//
// No tools: an arc expert is handed the premise in the task prompt and answers
// with an outline. Its whole world is the one string it returns.

const herosJourneySub = defineSubagent({
  name: "heros_journey",
  description:
    "Hero's Journey (Campbell / Vogler, 12 stages) structure expert. Given a premise, maps the monomyth stages — Ordinary World through Return with the Elixir — onto this story and returns a beat-by-beat outline. Best for mythic, adventure-shaped arcs with a transformed protagonist.",
  agent: () => herosJourney,
});

const kishotenketsuSub = defineSubagent({
  name: "kishotenketsu",
  description:
    "Kishōtenketsu structure expert (4 acts: Ki / Shō / Ten / Ketsu). Given a premise, maps this conflict-optional structure — which turns on a surprising third-act twist rather than escalating conflict — onto the story and returns a 4-part outline. Best for gentle, contemplative, or slice-of-life episodes.",
  agent: () => kishotenketsu,
});

const saveTheCatSub = defineSubagent({
  name: "save_the_cat",
  description:
    "Save the Cat! structure expert (Blake Snyder's 15 beats: Opening Image through Final Image). Given a premise, maps the commercial beat sheet onto this story and returns a beat-by-beat outline with rough placement. Best for a precise, page-aware, commercial structure.",
  agent: () => saveTheCat,
});

const storyCircleSub = defineSubagent({
  name: "story_circle",
  description:
    "Story Circle (Dan Harmon, 8 steps: You / Need / Go / Search / Find / Take / Return / Change) structure expert. Given a premise, maps the want-vs-need loop onto this story and returns an 8-beat outline. Best for tight episodic TV and character change in a small space.",
  agent: () => storyCircle,
});

const threeActSub = defineSubagent({
  name: "three_act",
  description:
    "Three-Act structure expert (Setup / Confrontation / Resolution, with inciting incident, two plot points, midpoint, and climax). Given a premise, maps the classic dramatic spine onto this story and returns a beat outline. The safe, general-purpose default when no other structure is requested.",
  agent: () => threeAct,
});

// --- top-level script specialists ---------------------------------------------

// Every specialist gets the full read-only ingestion tool set (script, world,
// shotlist, episode, sounds, radio, cuts, timeline, library, characters, …), so
// it can pull the current content of any app section itself rather than depend
// on the parent to paste it into the delegation prompt (long pastes get
// truncated by the model). These are reads only — the advisors still never
// write; the parent applies their recommendations.
//
// The web-search tools (web_search / fetch_url, whichever backend the root
// resolved) ride along for the same reason: a subagent's tools are
// self-contained — nothing inherits from the parent — so without them a
// specialist researching a period, place, or real-world detail would have to
// bounce back through the root. Also read-only.
export function createSubagents(
  api: Api,
  searchTools: ToolDefinition[] = [],
  // The Film's writers' room (agents/writers-room.ts) records each pass itself,
  // with the round it belongs to, so its specialists don't also log one.
  { recordReviews = true }: { recordReviews?: boolean } = {},
): SubagentDefinition[] {
  // `record_script_review` is the ONE non-read tool a specialist carries, and it
  // writes no script content — it stamps this specialist's log book so the app
  // (and the next turn) can tell an unreviewed script from a cleared one, which
  // is what drives the chat's "make the script better with X" suggestions. It
  // belongs to the doctor rather than the parent because the doctor is the one
  // that knows it finished; the parent forgets to log it. The nested ARC experts
  // above don't get it — story_architect records the one pass on their behalf,
  // and neither does the nested `character_actor` — table_read records the one
  // pass for the whole room.
  //
  // `render_ui` is deliberately absent from every roster here: a subagent can't
  // pause for the author (only its final text comes back), so a card drawn from
  // inside a delegation would never get an answer.
  const readTools = [...createReadTools(api), ...searchTools];
  const doctorTools = recordReviews ? [...readTools, recordScriptReview(api)] : readTools;
  const mountDoctorTools = () => {
    for (const tool of doctorTools) useTool(tool);
  };

  const dialogueDoctorSub = defineSubagent({
    name: "dialogue_doctor",
    description:
      "Dialogue doctor for the screenplay — the CORRECTIVE pass on the spoken lines. Delegate to it to keep each character's voice consistent and distinct, put the weight in subtext (say less, imply more), cut on-the-nose exposition, and fix rhythm. Lane boundary: it makes the lines RIGHT. It is NOT punch_up, which assumes the lines are already right and swings for the memorable one; run this first and punch_up after. It is not performance_doctor (whether a voice model can physically say the line) and not voice_designer (inventing a character's speech DNA in the world bible). 'Helena doesn't sound like Helena' and 'this line explains the plot out loud' are here; 'these lines are correct but dull' is punch_up. It calls get_script to read the current pinned draft itself, so you need only name the scene/beats to focus on — no need to paste the script. It returns before/after rewrites with a one-line reason for each. It reviews and rewrites the dialogue — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return dialogueDoctor;
    },
  });

  const motivationDoctorSub = defineSubagent({
    name: "motivation_doctor",
    description:
      "Motivation & causality doctor — the 'why' behind everything that happens. Delegate to it to check that every action, choice, reversal, and event is *caused* — rooted in a character's want, wound/trauma, fear, or need — rather than occurring for plot convenience. It surfaces unmotivated beats and 'and then' coincidences and prescribes the backstory/trauma or causal link that would justify or replace them. Lane boundary: it asks WHY a beat happens, one beat at a time. It is NOT character_doctor, which asks WHO these people are (are they distinguishable, does each make choices only they would make); not plot_doctor, which owns logical/continuity coherence; and not story_architect, which owns structure. 'This happens for no reason' is here; 'I can't tell these two apart' is character_doctor. It calls get_script to read the current pinned draft itself — no need to paste the script. It returns the missing 'whys' with fixes. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return motivationDoctor;
    },
  });

  const plotDoctorSub = defineSubagent({
    name: "plot_doctor",
    description:
      "Plot-hole & continuity doctor for the screenplay. Delegate to it to audit the script for logical gaps, plot holes, continuity/timeline errors, unmotivated character behavior, unplanted setups and unpaid payoffs, and to get concrete, coherence-restoring fixes. It calls get_script to read the current pinned draft itself — no need to paste the script; just name any scenes to focus on. It returns a prioritized issue list with a suggested fix for each. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return plotDoctor;
    },
  });

  const storyArchitectSub = defineSubagent({
    name: "story_architect",
    description:
      "Story architect for building a new story or restructuring an existing one. Delegate here when the user wants to plot/outline a story, choose a narrative structure, or map the episode to an arc. It asks the user which arc to build (hero's journey, story circle, three-act, save-the-cat, kishotenketsu, or other), then consults the matching in-house arc expert and returns a beat-by-beat outline fitted to the premise. When restructuring an existing episode it calls get_script to read the current pinned draft itself. It outlines — the root writes the outline into the script. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    // Nesting is now a `useSubagent` call inside the parent's own render: the
    // arc experts are on story_architect's roster and nobody else's.
    agent: () => {
      mountDoctorTools();
      for (const sub of [
        herosJourneySub,
        storyCircleSub,
        threeActSub,
        saveTheCatSub,
        kishotenketsuSub,
      ]) {
        useSubagent(sub);
      }
      return storyArchitect;
    },
  });

  const sceneDoctorSub = defineSubagent({
    name: "scene_doctor",
    description:
      "Scene doctor — the craft pass INSIDE each scene. Delegate to it to check every scene enters late, leaves early, and TURNS: for each one it names whose scene it is, what they want, what stands in the way, and what changes by the end, then flags the scenes that end where they started, open before anything is happening, or run past their real exit — with the specific trim, reversal or merge that fixes each. Lane boundary: it works scene by scene. It is NOT story_architect, which owns the shape of the whole episode, and NOT tension_doctor, which measures the pressure curve ACROSS scenes and where it sags; a scene that turns beautifully can still sit in the wrong place, and that is tension_doctor's call, not this one's. It calls get_script to read the current pinned draft itself — no need to paste the script; just name any scenes to focus on. It returns a per-scene verdict plus a prioritized list of the scenes that don't work. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return sceneDoctor;
    },
  });

  const characterDoctorSub = defineSubagent({
    name: "character_doctor",
    description:
      "Character doctor — are these people legible from behaviour alone? Delegate to it to strip the names off the cues and ask whether you could still tell who is speaking; to find the characters who never make a choice only they would make, the ones who are one adjective from first page to last, and every trait that arrives because someone SAYS it rather than because someone does it. Lane boundary: it asks WHO these people are. It is NOT motivation_doctor, which asks why an individual beat happens (want / wound / fear) — 'she'd never do that' is here, 'nothing made her do that' is motivation_doctor. It is not voice_designer, which INVENTS speech DNA and writes it into the world bible, and not dialogue_doctor, which fixes the lines themselves. It calls get_script (and get_world for the roster) itself — no need to paste anything. It returns a per-character read plus the specific behaviours that would make each one distinguishable. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return characterDoctor;
    },
  });

  const themeDoctorSub = defineSubagent({
    name: "theme_doctor",
    description:
      "Theme doctor — is the episode arguing something, or just stating it? Delegate to it to name the controlling idea the draft is ACTUALLY arguing (which is often not the one intended), check the opposing view has a character strong enough to win it, find every place the theme is spoken aloud instead of dramatised, and verify the ending answers the question the opening asked. Lane boundary: it owns what the story MEANS. It is NOT plot_doctor (does the story hold together logically), NOT motivation_doctor (is each beat caused), and NOT story_architect (does the arc have the right shape) — a perfectly coherent, perfectly structured episode can still be about nothing, and that is the only thing this one is looking for. It calls get_script to read the current pinned draft itself — no need to paste the script. It returns the controlling idea in one sentence, where the argument is being asserted rather than earned, and what to dramatise instead. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return themeDoctor;
    },
  });

  const tensionDoctorSub = defineSubagent({
    name: "tension_doctor",
    description:
      "Tension doctor — the pressure curve across the whole episode. Delegate to it to score the pressure of every scene, show the curve scene by scene, find where it sags, flatlines or peaks too early, check the first fifteen seconds actually hook, and say which scenes to compress, reorder or cut to keep it climbing. Lane boundary: it reads the SEQUENCE. It is NOT scene_doctor, which judges whether a scene works on its own terms — this one judges whether it earns its position — and NOT story_architect, which decides the arc's shape in the abstract rather than measuring the draft that exists. Two scenes at identical pressure back to back is this one's finding, not theirs. It calls get_script to read the current pinned draft itself — no need to paste the script. It returns the scored curve plus the specific compress / reorder / cut moves. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return tensionDoctor;
    },
  });

  const worldContinuitySub = defineSubagent({
    name: "world_continuity",
    description:
      "World-continuity checker — the script held against the world bible. Delegate to it to flag every name, place, established fact, rule and piece of geography the draft contradicts, and to list what the script INVENTS that the bible doesn't have yet, so the author can add it before anything gets boarded. Lane boundary: it compares the script to the WORLD, an external document. It is NOT plot_doctor, which checks the script against ITSELF (internal logic, timeline, setups and payoffs) — 'he's in two places in one afternoon' is plot_doctor, 'the bible says the bridge is stone and the script says rope' is here. It reads both sides itself with get_script and get_world (plus get_visual_world for what has been drawn) — no need to paste either. It returns contradictions first, then the unregistered inventions as a to-add list. It analyzes and recommends — it does not edit the script or the world bible itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return worldContinuity;
    },
  });

  const producerSub = defineSubagent({
    name: "producer",
    description:
      "The producer — can this script actually be rendered, and what does it cost? Delegate to it once the script is settled to count the distinct locations and characters, flag the beats our image and video models reliably fail (crowds, animals, fine hand work, legible on-screen text, three-plus characters in frame, wardrobe continuity across separately generated shots), estimate the shot count and the render spend, and rewrite the expensive scenes so they read the same for a fraction of the renders. Lane boundary: it prices and de-risks the PRODUCTION of the text as written — it never argues with the story. It is NOT the shot-list skill (which actually breaks the script into shots and writes them) and NOT performance_doctor, which owns the audio side, whether a voice model can say the lines. Never delegate here on a stub or a draft still being restructured: it would price a script that is about to stop existing. It calls get_script, get_world and get_shotlist itself — no need to paste anything. It returns the counts, the risk list and the cheaper rewrites. It analyzes and recommends — it does not edit the script or touch the shot list. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return producer;
    },
  });

  const performanceDoctorSub = defineSubagent({
    name: "performance_doctor",
    description:
      "Performance doctor — will these lines survive being SPOKEN by a voice model? Delegate to it once the script is settled to find the lines a TTS engine will mangle: homographs (read/read, lead/lead), bare numerals and dates, abbreviations and initialisms, unbroken run-ons with nowhere to breathe, and names it will mispronounce. It marks where a line needs a delivery note (a parenthetical) to land, and gives the estimated spoken runtime scene by scene. Lane boundary: it judges SAYABILITY, never quality — whether a machine can pronounce the line, not whether the line is any good. That is dialogue_doctor (is it right) and punch_up (is it memorable). It does not cast or render voices either; casting and rendering belong to the radio skill. It calls get_script to read the current pinned draft itself — no need to paste the script. It returns the risky lines with respellings or rewrites, the delivery notes, and the runtime. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return performanceDoctor;
    },
  });

  const voiceDesignerSub = defineSubagent({
    name: "voice_designer",
    description:
      "Voice designer — the speech DNA of the cast, written down before or alongside the lines. Delegate to it for every character to get the words they reach for and the ones they'd never use, sentence length and whether they finish sentences, their one signature construction, what they do INSTEAD of saying the true thing, how the voice changes under pressure, and one line only they could say — then proposes each as that character's `voice` field in the world bible. Lane boundary: it DESIGNS the instrument; it does not play it. It is NOT dialogue_doctor, which audits and rewrites the lines actually on the page, and NOT character_doctor, which diagnoses whether the existing draft makes the cast distinguishable. It is also not voice CASTING — picking or rendering an audio voice is the radio skill's job, and this is about prose. On-demand: run it when the author asks, or when the cast keeps sounding alike. It calls get_world and get_script itself — no need to paste anything. It returns the per-character voice profiles and the proposed bible text; the root writes them with save_world. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return voiceDesigner;
    },
  });

  const punchUpSub = defineSubagent({
    name: "punch_up",
    description:
      "The punch-up room — the swing for the MEMORABLE line, not the correct one. Delegate to it on a draft whose lines already work but read flat: it finds every line doing its job in the dullest possible way and makes it specific and surprising, lands a real button on each scene exit, and takes one genuine swing per scene, marked so the author can turn each one down. Lane boundary: it is ADDITIVE and takes risks. dialogue_doctor is the CORRECTIVE pass — voice consistency, subtext, cutting exposition, making the lines right — and it must go first: punching up a line that is about to be rewritten for voice, or cut for structure, is wasted. Never delegate here on a stub or a draft still being restructured. It calls get_script to read the current pinned draft itself — no need to paste the script. It returns before → after alternatives with the swings flagged as swings. It proposes lines — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return punchUp;
    },
  });

  // The table read's room. `character_actor` is mounted ONLY on table_read's
  // roster (never top level): the whole point is that each actor sees just its
  // own part, which only holds if the room is convened by the one agent that
  // hands out the parts.
  //
  // It has NO TOOLS — the one place in this file where withholding `get_script`
  // is the feature rather than a limitation. An actor who can read the whole
  // script can explain away everything its own part fails to justify, and the
  // technique collapses into a second dialogue_doctor. Working blind, it is in
  // the audience's position: what it can't account for from its sides is what
  // the audience won't be able to account for either. So table_read extracts
  // each actor's SIDES (its scenes, its lines, its bible entry) into the
  // delegation prompt, exactly as a real read hands out parts — which is also
  // why this doesn't hit the truncation that inlining a whole script does: one
  // character's sides are a fraction of the draft.
  //
  // It does not get `record_script_review` either: table_read logs the single
  // pass for the whole room, and a cast of six each stamping the ledger would
  // read as six passes.
  const characterActorSub = defineSubagent({
    name: "character_actor",
    description:
      "One actor in a table read, cast as a single named character. It has no tools and cannot read the script: hand it, in the task prompt, its character's name, that character's world-bible entry, and its SIDES — its own scenes and lines in order. It then reports ONLY from inside that part: the lines it can't say out loud, the beats where it has nothing to play, the moments the script asks it to do something its character has no reason to do, and what it thinks its character wants. The blindness is deliberate and must not be worked around — what it cannot account for from its sides is what an audience cannot account for either. It never comments on the episode as a whole or on anyone else's part; that is the table_read's job once every actor has reported.",
    agent: () => characterActor,
  });

  const tableReadSub = defineSubagent({
    name: "table_read",
    description:
      "The table read — the cast's view of the script, one part at a time. Delegate to it to hold a read of the pinned draft: it casts one character_actor per speaking character, gives each only its own part, and brings back what each of them says — the lines they can't get out of their mouth, the beats where they have nothing to play, and the moments the script asks them to do something their character has no reason to do — then synthesises the room's notes. Lane boundary: this is the PERFORMERS' read, and its value is precisely that no actor can see the whole script. It is NOT dialogue_doctor, which reads every line as the writer with full context, and NOT first_reader, which is the audience meeting the story cold. On-demand: run it when the author asks, or when the cast feels underwritten. It returns the per-character notes plus what they agree on. It analyzes and recommends — it does not edit the script itself. It logs ONE pass with record_script_review for the whole room when it finishes, so the app stops offering a review that already happened.",
    // Same nesting shape as story_architect's arc experts: the room exists on
    // this roster and nobody else's.
    agent: () => {
      mountDoctorTools();
      useSubagent(characterActorSub);
      return tableRead;
    },
  });

  const firstReaderSub = defineSubagent({
    name: "first_reader",
    description:
      "The first reader — a cold, blind read with no intent supplied. Delegate to it to get the audience's experience of the pinned draft: no summary first, no author's explanation, just a moment-by-moment account of what it understood, what confused it, what it predicted and whether it was right, and the exact line at which it would have stopped watching. Lane boundary: it is an AUDIENCE, not a doctor — it reports what happened to it, and deliberately does NOT prescribe fixes; take the confusion it names to plot_doctor or the flat stretch to tension_doctor for those. It is not table_read either: that is the cast reading from inside their parts, this is a stranger meeting the story for the first time. Do not brief it — every hint you add is one it can no longer be surprised by, so the delegation prompt should say nothing but which draft to read. On-demand: run it when the author wants to know whether the thing actually plays. It calls get_script itself, and deliberately skips get_world so it sees only what the script tells it. It reacts and reports — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    agent: () => {
      mountDoctorTools();
      return firstReader;
    },
  });

  // Canonical roster order — the same order as lib/specialists.ts, which is the
  // order a script wants them in (structure → scene/cause/coherence/character/
  // theme → rhythm and lines → production-readiness → the on-demand room).
  return [
    storyArchitectSub,
    sceneDoctorSub,
    motivationDoctorSub,
    plotDoctorSub,
    characterDoctorSub,
    themeDoctorSub,
    tensionDoctorSub,
    dialogueDoctorSub,
    worldContinuitySub,
    producerSub,
    performanceDoctorSub,
    voiceDesignerSub,
    punchUpSub,
    tableReadSub,
    firstReaderSub,
  ];
}
