import { defineAgentProfile } from "@flue/runtime";

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
// Advisor pattern: none carry script tools — they analyze/recommend and the
// parent (whistlewood) applies their output. model/thinkingLevel are OMITTED so
// each profile inherits the parent's defaults.

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

const dialogueDoctorProfile = defineAgentProfile({
  name: "dialogue_doctor",
  description:
    "Dialogue doctor for the screenplay. Delegate to it to sharpen spoken lines: keep each character's voice consistent, add subtext (say less, imply more), cut on-the-nose exposition, tune rhythm, and punch up flat exchanges. Pass the lines or scene in the message; it returns before/after rewrites with a one-line reason for each. It reviews and rewrites the dialogue it is given — it does not edit the script itself.",
  instructions: dialogueDoctor,
});

const motivationDoctorProfile = defineAgentProfile({
  name: "motivation_doctor",
  description:
    "Motivation & causality doctor — the 'why' behind everything that happens. Delegate to it to check that every action, choice, reversal, and event is *caused* — rooted in a character's want, wound/trauma, fear, or need — rather than occurring for plot convenience. It surfaces unmotivated beats and 'and then' coincidences and prescribes the backstory/trauma or causal link that would justify or replace them. A different lane from plot-doctor (logical/continuity coherence) and story-architect (structure). Pass the script or scene in the message; it returns the missing 'whys' with fixes. It analyzes and recommends — it does not edit the script itself.",
  instructions: motivationDoctor,
});

const plotDoctorProfile = defineAgentProfile({
  name: "plot_doctor",
  description:
    "Plot-hole & continuity doctor for the screenplay. Delegate to it to audit the script for logical gaps, plot holes, continuity/timeline errors, unmotivated character behavior, unplanted setups and unpaid payoffs, and to get concrete, coherence-restoring fixes. Pass the current script (or the scenes in question) in the message; it returns a prioritized issue list with a suggested fix for each. It analyzes and recommends — it does not edit the script itself.",
  instructions: plotDoctor,
});

const storyArchitectProfile = defineAgentProfile({
  name: "story_architect",
  description:
    "Story architect for building a new story or restructuring an existing one. Delegate here when the user wants to plot/outline a story, choose a narrative structure, or map the episode to an arc. It asks the user which arc to build (hero's journey, story circle, three-act, save-the-cat, kishotenketsu, or other), then consults the matching in-house arc expert and returns a beat-by-beat outline fitted to the premise. It outlines — the root writes the outline into the script.",
  instructions: storyArchitect,
  subagents: [
    herosJourneyProfile,
    storyCircleProfile,
    threeActProfile,
    saveTheCatProfile,
    kishotenketsuProfile,
  ],
});

export const subagents = [
  dialogueDoctorProfile,
  motivationDoctorProfile,
  plotDoctorProfile,
  storyArchitectProfile,
];
