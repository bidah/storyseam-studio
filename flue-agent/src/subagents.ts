import { defineAgentProfile, type AgentProfile } from "@flue/runtime";

import type { ToolDefinition } from "@flue/runtime";

import type { Api } from "./lib/api.js";
import { createReadTools } from "./tools/index.js";
import { recordScriptReview } from "./tools/record_script_review.js";

import dialogueDoctor from "./subagents/dialogue-doctor.md" with { type: "markdown" };
import motivationDoctor from "./subagents/motivation-doctor.md" with { type: "markdown" };
import plotDoctor from "./subagents/plot-doctor.md" with { type: "markdown" };
import storyArchitect from "./subagents/story-architect.md" with { type: "markdown" };
import herosJourney from "./subagents/heros-journey.md" with { type: "markdown" };
import kishotenketsu from "./subagents/kishotenketsu.md" with { type: "markdown" };
import saveTheCat from "./subagents/save-the-cat.md" with { type: "markdown" };
import storyCircle from "./subagents/story-circle.md" with { type: "markdown" };
import threeAct from "./subagents/three-act.md" with { type: "markdown" };

// Script-specialist subagents ported from the eve agent (agent/subagents/*).
// Advisor pattern: they analyze/recommend and the parent (whistlewood) applies
// their output — none can touch the script (the sole exception is
// `record_script_review`, their own log book — see createSubagents). They DO
// carry read-only context
// tools (get_script/get_world/get_shotlist) so each pulls the full pinned draft
// itself instead of relying on the parent to inline the whole script into the
// `task` prompt (long verbatim copies get truncated by the parent model).
// model/thinkingLevel are OMITTED so each profile inherits the parent's defaults.

// --- story-architect's nested arc experts -------------------------------------

const herosJourneyProfile = defineAgentProfile({
  name: "heros_journey",
  description:
    "Hero's Journey (Campbell / Vogler, 12 stages) structure expert. Given a premise, maps the monomyth stages — Ordinary World through Return with the Elixir — onto this story and returns a beat-by-beat outline. Best for mythic, adventure-shaped arcs with a transformed protagonist.",
  instructions: herosJourney,
});

const kishotenketsuProfile = defineAgentProfile({
  name: "kishotenketsu",
  description:
    "Kishōtenketsu structure expert (4 acts: Ki / Shō / Ten / Ketsu). Given a premise, maps this conflict-optional structure — which turns on a surprising third-act twist rather than escalating conflict — onto the story and returns a 4-part outline. Best for gentle, contemplative, or slice-of-life episodes.",
  instructions: kishotenketsu,
});

const saveTheCatProfile = defineAgentProfile({
  name: "save_the_cat",
  description:
    "Save the Cat! structure expert (Blake Snyder's 15 beats: Opening Image through Final Image). Given a premise, maps the commercial beat sheet onto this story and returns a beat-by-beat outline with rough placement. Best for a precise, page-aware, commercial structure.",
  instructions: saveTheCat,
});

const storyCircleProfile = defineAgentProfile({
  name: "story_circle",
  description:
    "Story Circle (Dan Harmon, 8 steps: You / Need / Go / Search / Find / Take / Return / Change) structure expert. Given a premise, maps the want-vs-need loop onto this story and returns an 8-beat outline. Best for tight episodic TV and character change in a small space.",
  instructions: storyCircle,
});

const threeActProfile = defineAgentProfile({
  name: "three_act",
  description:
    "Three-Act structure expert (Setup / Confrontation / Resolution, with inciting incident, two plot points, midpoint, and climax). Given a premise, maps the classic dramatic spine onto this story and returns a beat outline. The safe, general-purpose default when no other structure is requested.",
  instructions: threeAct,
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
): AgentProfile[] {
  // `record_script_review` is the ONE non-read tool a specialist carries, and it
  // writes no script content — it stamps this specialist's log book so the app
  // (and the next turn) can tell an unreviewed script from a cleared one, which
  // is what drives the chat's "make the script better with X" suggestions. It
  // belongs to the doctor rather than the parent because the doctor is the one
  // that knows it finished; the parent forgets to log it. The nested ARC experts
  // below don't get it — story_architect records the one pass on their behalf.
  const readTools = [...createReadTools(api), ...searchTools];
  const doctorTools = [...readTools, recordScriptReview(api)];

  const dialogueDoctorProfile = defineAgentProfile({
    name: "dialogue_doctor",
    description:
      "Dialogue doctor for the screenplay. Delegate to it to sharpen spoken lines: keep each character's voice consistent, add subtext (say less, imply more), cut on-the-nose exposition, tune rhythm, and punch up flat exchanges. It calls get_script to read the current pinned draft itself, so you need only name the scene/beats to focus on — no need to paste the script. It returns before/after rewrites with a one-line reason for each. It reviews and rewrites the dialogue — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    instructions: dialogueDoctor,
    tools: doctorTools,
  });

  const motivationDoctorProfile = defineAgentProfile({
    name: "motivation_doctor",
    description:
      "Motivation & causality doctor — the 'why' behind everything that happens. Delegate to it to check that every action, choice, reversal, and event is *caused* — rooted in a character's want, wound/trauma, fear, or need — rather than occurring for plot convenience. It surfaces unmotivated beats and 'and then' coincidences and prescribes the backstory/trauma or causal link that would justify or replace them. A different lane from plot-doctor (logical/continuity coherence) and story-architect (structure). It calls get_script to read the current pinned draft itself — no need to paste the script. It returns the missing 'whys' with fixes. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    instructions: motivationDoctor,
    tools: doctorTools,
  });

  const plotDoctorProfile = defineAgentProfile({
    name: "plot_doctor",
    description:
      "Plot-hole & continuity doctor for the screenplay. Delegate to it to audit the script for logical gaps, plot holes, continuity/timeline errors, unmotivated character behavior, unplanted setups and unpaid payoffs, and to get concrete, coherence-restoring fixes. It calls get_script to read the current pinned draft itself — no need to paste the script; just name any scenes to focus on. It returns a prioritized issue list with a suggested fix for each. It analyzes and recommends — it does not edit the script itself. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    instructions: plotDoctor,
    tools: doctorTools,
  });

  const storyArchitectProfile = defineAgentProfile({
    name: "story_architect",
    description:
      "Story architect for building a new story or restructuring an existing one. Delegate here when the user wants to plot/outline a story, choose a narrative structure, or map the episode to an arc. It asks the user which arc to build (hero's journey, story circle, three-act, save-the-cat, kishotenketsu, or other), then consults the matching in-house arc expert and returns a beat-by-beat outline fitted to the premise. When restructuring an existing episode it calls get_script to read the current pinned draft itself. It outlines — the root writes the outline into the script. It logs its pass with record_script_review when it finishes, so the app stops offering a review that already happened.",
    instructions: storyArchitect,
    tools: doctorTools,
    subagents: [
      herosJourneyProfile,
      storyCircleProfile,
      threeActProfile,
      saveTheCatProfile,
      kishotenketsuProfile,
    ],
  });

  return [
    dialogueDoctorProfile,
    motivationDoctorProfile,
    plotDoctorProfile,
    storyArchitectProfile,
  ];
}
