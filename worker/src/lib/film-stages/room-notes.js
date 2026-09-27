// What each script specialist READS FOR, distilled from its subagent profile
// (flue-agent/src/subagents/<id>.md) for the Film job's writers' room
// (./room.js). The chat's specialists are flue subagents with tools and a
// conversation to ask into; here a pass is ONE model call with the draft in its
// message and nobody to ask, so each profile is cut to its lane, its tests and
// what it must not do — the parts that make one specialist's findings differ
// from the next one's. The roster itself (ids, labels, briefs) is
// lib/specialists.ts; this file only says what a pass looks at.
//
// `worldless` marks the one reader that must NOT see the World: the cold read
// has information in it only because the reader knows nothing the audience
// does not.

export const ROOM_NOTES = Object.freeze({
  story_architect: {
    lane: "the SHAPE of the story — which arc it is on and whether every beat of that arc lands.",
    reads: [
      "Name the arc the draft is actually on (three-act, story circle, hero's journey, save the cat, kishōtenketsu) and map its beats onto the scenes; a beat the arc needs and the draft skips is a finding.",
      "Check the turn arrives where the arc wants it — a midpoint that lands in the last scene, an ending that resolves what the opening never asked.",
      "Say what to cut, move or add, as beats — not lines. Scene craft, motive and dialogue are other passes.",
    ],
  },
  scene_doctor: {
    lane: "the scene as a dramatic unit: whose scene it is, what they want, what opposes, how it TURNS, where it starts and stops.",
    reads: [
      "For every scene: whose scene, the want, the obstacle, and the value charge at the top and the bottom. A scene that ends on the charge it opened on is a deleted scene — find the turn already in it, give it one, or fold it into a neighbour.",
      "Enter late: cut to the first line that can't be predicted. Leave early: the last necessary line is the one right after the turn lands.",
      "Exactly one character drives each scene; a scene doing only one job (plot alone) is thin.",
      "Do not redesign the arc, audit continuity or rewrite lines for voice — quote a line only to locate a beat.",
    ],
  },
  motivation_doctor: {
    lane: "causal and psychological coherence — nothing happens without a why.",
    reads: [
      "Run the but/therefore test between every pair of beats; every 'and then' seam is a finding, with the causal link that would replace it.",
      "Trace every choice, reversal and change of heart to a want, a fear or a wound the audience has seen. A beat with no cause is hollow — prescribe the plant (an earlier line) that earns it.",
      "Luck may create problems, never solve them. A rescue, reveal or change of heart that arrives unmotivated is a debt.",
      "Fact contradictions belong to the plot doctor; legibility to the character doctor.",
    ],
  },
  plot_doctor: {
    lane: "the script against ITSELF — logic, continuity, timeline, setups and payoffs.",
    reads: [
      "Logical gaps: an event that can't follow from what came before; a character knowing what they were never told; a problem solved by a capability never established.",
      "Continuity: an object, injury, place, time of day or emotional state contradicting an earlier or later line. Timeline: events out of order, impossible travel, a consequence before its cause.",
      "Setup without payoff and payoff without setup. Stakes or knowledge drifting silently between scenes.",
      "Prefer a few story-breaking issues over nitpicks; the smallest coherent fix for each, usually one added or changed line.",
    ],
  },
  character_doctor: {
    lane: "legibility — can the audience tell who each person is from what they DO?",
    reads: [
      "The attribution test: strip the names off and try to reassign the lines; quote the most anonymous ones.",
      "The defining choice: each character who matters chooses under pressure in a way only they would — name it, or name the scene to install it.",
      "Trait plus ONE contradiction: flag anyone who is one adjective all the way through and propose the contradiction that costs them.",
      "Everything about a personality that arrives because someone SAYS it instead of because someone does it.",
      "Why they act is the motivation doctor's; the sound of the lines is the dialogue doctor's.",
    ],
  },
  theme_doctor: {
    lane: "the controlling idea and whether it is argued or announced.",
    reads: [
      "Derive the controlling idea from the ENDING, as 'X leads to Y' — whatever the climax rewards and punishes is what the script argues, whatever anyone in it says. Show the gap when the dialogue claims a different theme.",
      "The other side needs a champion who is not a fool, gets its best case in their own voice, and looks like winning for a stretch.",
      "Every place the theme is spoken aloud instead of dramatised is a finding. Two unrelated ideas at equal weight means neither lands.",
    ],
  },
  tension_doctor: {
    lane: "pressure over time — the audience's need to know what happens next, scene by scene.",
    reads: [
      "Score every scene 0–10 on stakes, uncertainty, proximity and time, with the scores in `where` so the curve can be read (0–2 atmosphere, 3–4 a want without risk, 5–6 active opposition, 7–8 unpredictable and cared about, 9–10 the climax).",
      "Hunt the sag (a middle that drops and stays down), the flatline (three scenes at one score), the plateau at the top, the premature peak, and the missing rest beat.",
      "Check the first fifteen seconds hook: a want and a risk on screen, not discussed.",
      "Name which scenes to compress, reorder or cut so the curve climbs. Inside-the-scene fixes are the scene doctor's.",
    ],
  },
  dialogue_doctor: {
    lane: "the words characters speak — voice, subtext, rhythm.",
    reads: [
      "Voice drift: a line that doesn't sound like who says it; two characters interchangeable in a swap test.",
      "On-the-nose exposition and narrated feelings: convert to subtext or action. Say less, imply more.",
      "Rhythm: break up speeches, vary length, cut filler, land the button line last.",
      "Give before → after rewrites for the flat exchanges, as `fix`. Do not touch plot, continuity or structure.",
    ],
  },
  world_continuity: {
    lane: "the script against the WORLD bible — names, places, facts, rules — and what the script invents that the bible lacks.",
    reads: [
      "Every proper noun character by character: a name is a key the pipeline files sheets, voices and stills under. A character or place named differently from the World, even once, is a high finding.",
      "Places and geography, established facts and rules, relationships, the timeline as the bible states it.",
      "List what the script INVENTS that the bible does not have (a new place, a prop that matters, a rule) so it can be added before it is boarded.",
      "Do not adjudicate: report both versions and say which to keep. Internal contradictions are the plot doctor's.",
    ],
  },
  producer: {
    lane: "what it takes to RENDER this — shot by shot, by image and video models, not a crew.",
    reads: [
      "Count distinct places (each needs a reference sheet; day/night and clean/wrecked count separately) and distinct characters (each needs a sheet and a voice); flag anyone or anywhere not in the World.",
      "Flag the beats generation reliably fails: crowds, animals, fine hand work, legible on-screen text, three or more characters in one frame, wardrobe or prop continuity across separately generated shots, a place changing state.",
      "Estimate the shot count per scene and rewrite the expensive scenes so they read the same for a fraction of the renders — a compression must not change what the scene does; if it would, say so and offer it as a trade.",
    ],
  },
  performance_doctor: {
    lane: "speakability — will each line survive a text-to-speech model that gets one pass and no context?",
    reads: [
      "Homographs (read, lead, live, wound, tear, bow, close, minute, wind, desert, present, refuse, object, content, produce): rewrite around them or respell.",
      "Numerals, dates, times, money, ordinals, abbreviations, acronyms: write what is SAID. Unbroken run-ons: break them. Names it will mispronounce: respell.",
      "Mark the lines that need a parenthetical to land, and give the spoken runtime scene by scene in `where`.",
      "A fix that flattens a voice is not a fix — offer it as a trade.",
    ],
  },
  voice_designer: {
    lane: "the speech DNA of each character — the rules that make a line sound like them and nobody else.",
    reads: [
      "For every character: the words they reach for and the ones they'd never use; sentence length and whether they finish sentences; one signature construction; what they do INSTEAD of saying the true thing; how the voice changes under pressure; one line only they could say.",
      "Hold the draft's lines to that DNA and quote the ones that break it, with the rewrite. Put each character's spec in `fix` — the rewrite carries it into the lines.",
    ],
  },
  punch_up: {
    lane: "memorable, not correct — the writers' room at eleven at night.",
    reads: [
      "Find every line doing its job in the dullest available words and make it specific: a concrete noun beats an abstraction, the detail only this character would notice beats the accurate one.",
      "Land a real button on each scene exit. Take one genuine swing per scene and mark it as a swing.",
      "Timidity is the failure mode: a pass of slightly tightened lines is a wasted pass. Consistency is the dialogue doctor's job, not yours.",
    ],
  },
  table_read: {
    lane: "one actor per character, each reading ONLY their own part — what they can't say and where they have nothing to play.",
    reads: [
      "Cast the significant characters and read each part from the inside, knowing only that character's lines and bible entry. Report per actor: the lines they can't say out loud, the beats where they have nothing to play, the moments the script asks them to do something their character has no reason to do.",
      "Collate; resolve conflicts between actors with your own note only where needed. Playability, not legibility — the character doctor audits from the outside.",
    ],
  },
  first_reader: {
    lane: "the cold read — what happened to a reader who knew nothing, in order.",
    worldless: true,
    reads: [
      "Report as you go, scene by scene, so what you say at scene 3 was written by someone who has not seen scene 7: what you understood, what confused you, what you predicted.",
      "Leave each confusion where it happened even when a later scene answers it ('answered at Sc.6'). Confusion is a fault in WHEN information lands, not a plot hole — do not diagnose, report.",
      "Name the exact line where you would have stopped watching, if there is one.",
    ],
  },
});

/** The notes for one specialist, or a generic lane when the roster has grown past this file. */
export const roomNotesFor = (id) => ROOM_NOTES[id] || { lane: "your specialty, as your brief states it.", reads: [] };
