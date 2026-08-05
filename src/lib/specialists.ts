// THE script specialists roster — one definition, every surface.
//
// The agent's script "doctors" (flue-agent/src/subagents/*) are advisors: each
// reads the pinned draft with its own read-only tools, hands findings back, and
// the root applies what the author accepts. Nothing they do touches the script
// directly. What they DO write is one row — their pass in the `script-reviews`
// ledger (worker/src/lib/reviews.js), which is how every surface can tell
// "the plot doctor has never seen this script" from "it cleared it an hour ago".
//
// This file is the single source of truth for WHO the specialists are, in what
// order a script wants them, and how each is named to the author. It is
// deliberately import-free and pure data so it can be vendored verbatim into:
//
//   · worker/src/lib/specialists.ts    — the ledger's whitelist + ordering
//   · mobile-app/src/lib/specialists.ts — the phone's Chat cards
//   · flue-agent/src/lib/specialists.ts — record_script_review's whitelist
//
// Run `npm --prefix mobile-app run sync:suggestions` after editing; the
// `vendored-in-sync` guard fails the build when a copy drifts.
//
// ── Lanes ──────────────────────────────────────────────────────────────────
// `core` specialists are the ordered spine a script always wants, and they are
// the only ones that surface as suggestion cards in the chat's landing deck.
// `ondemand` specialists are just as tracked — a pass is a pass, and the Script
// Agents board shows every one of them — but they are never *offered*
// unprompted. The distinction exists because a roster this size would otherwise
// bury every downstream move under a wall of "hasn't read it yet" cards; the
// deck stays a next-move deck, and the board is where the whole room lives.
//
// ── Stages ─────────────────────────────────────────────────────────────────
// `stage` is the earliest point a pass is worth spending. Sequencing is
// load-bearing craft, not decoration: punching up dialogue before the structure
// is settled polishes lines that are about to be cut, and a producibility pass
// on a draft still being restructured prices a script that no longer exists.
//   outline — there's a premise/beats, maybe no scenes yet
//   draft   — scenes exist and can be read end to end
//   polish  — the shape is settled; the work is now line- and beat-level
//   lock    — the script is what it's going to be; next stop is production
export type SpecialistLane = 'core' | 'ondemand';
export type SpecialistStage = 'outline' | 'draft' | 'polish' | 'lock';

export type Specialist = {
  /** Matches the flue subagent profile name and the ledger key. */
  id: string;
  lane: SpecialistLane;
  stage: SpecialistStage;
  /** One or two words, for the review chips and the board's badges. */
  chip: string;
  /** How prose names it mid-sentence ("re-check with the plot doctor"). */
  label: string;
  /** The card's title when it has never run. */
  title: string;
  /** What it does, for the subtitle and the tooltip. */
  does: string;
  /** The body of the composed brief — what to actually ask it for. */
  brief: string;
  /** lucide-react icon name; surfaces map it to a component. */
  icon: string;
  /**
   * The artifact this specialist can propose writing back to, beyond its
   * findings. Only `voice_designer` has one today (the world bible's per
   * character voice fields) — everything else is advice only.
   */
  writes?: 'world';
};

export const SPECIALISTS: Specialist[] = [
  // ── Structure ────────────────────────────────────────────────────────────
  {
    id: 'story_architect',
    lane: 'core',
    stage: 'outline',
    chip: 'Structure',
    label: 'the story architect',
    title: 'Shape the arc',
    does: 'maps the episode onto a narrative structure',
    icon: 'Compass',
    brief:
      'take the pinned draft to the story-architect: ask me which arc I want (hero’s journey, story circle, three-act, save the cat, kishōtenketsu), map what I have onto it, and come back with a beat-by-beat outline plus what to cut, move or add',
  },
  {
    id: 'scene_doctor',
    lane: 'core',
    stage: 'draft',
    chip: 'Scenes',
    label: 'the scene doctor',
    title: 'Make every scene turn',
    does: 'checks each scene enters late, leaves early and turns',
    icon: 'Clapperboard',
    brief:
      'run the scene-doctor over the pinned draft: for every scene tell me whose scene it is, what they want, what stands in the way, and how the scene TURNS — then flag the ones that end where they started, enter too early or run past their exit, with the specific trim or reversal that would fix each',
  },

  // ── Cause, coherence and character ───────────────────────────────────────
  {
    id: 'motivation_doctor',
    lane: 'core',
    stage: 'draft',
    chip: 'Whys',
    label: 'the motivation doctor',
    title: 'Find the whys',
    does: 'checks every beat is caused by character, not convenience',
    icon: 'HeartPulse',
    brief:
      'run the motivation-doctor over the pinned draft: find the beats that happen for plot convenience instead of being caused by what someone wants, fears or is wounded by, and prescribe the setup or wound that would justify each one',
  },
  {
    id: 'plot_doctor',
    lane: 'core',
    stage: 'draft',
    chip: 'Plot holes',
    label: 'the plot doctor',
    title: 'Hunt the plot holes',
    does: 'audits continuity, setups and payoffs',
    icon: 'SearchCheck',
    brief:
      'run the plot-doctor over the pinned draft: audit it for plot holes, continuity and timeline slips, unplanted setups and unpaid payoffs, and give me the smallest fix for each — most story-breaking first',
  },
  {
    id: 'character_doctor',
    lane: 'core',
    stage: 'draft',
    chip: 'Character',
    label: 'the character doctor',
    title: 'Make the cast legible',
    does: 'checks each personality reads from behaviour alone',
    icon: 'Users',
    brief:
      'run the character-doctor over the pinned draft: strip the names off and tell me whether I could still tell who is who, find the characters who never make a choice only they would make, the ones who are one adjective all the way through, and everything about a personality that arrives because someone SAYS it instead of because someone does it',
  },
  {
    id: 'theme_doctor',
    lane: 'core',
    stage: 'draft',
    chip: 'Theme',
    label: 'the theme doctor',
    title: 'Say what it’s about',
    does: 'checks the theme is argued, not stated',
    icon: 'Lightbulb',
    brief:
      'run the theme-doctor over the pinned draft: name the controlling idea it is actually arguing, tell me whether the opposing view has a character who can win it, find every place the theme is spoken aloud instead of dramatised, and check the ending answers the question the opening asked',
  },

  // ── Rhythm and the lines ─────────────────────────────────────────────────
  {
    id: 'tension_doctor',
    lane: 'core',
    stage: 'polish',
    chip: 'Tension',
    label: 'the tension doctor',
    title: 'Chart the tension',
    does: 'graphs the pressure scene by scene and finds the sag',
    icon: 'Activity',
    brief:
      'run the tension-doctor over the pinned draft: score the pressure of every scene, show me the curve, find where it sags or flatlines, check the first fifteen seconds actually hook, and tell me which scenes to compress, reorder or cut to keep it climbing',
  },
  {
    id: 'dialogue_doctor',
    lane: 'core',
    stage: 'polish',
    chip: 'Dialogue',
    label: 'the dialogue doctor',
    title: 'Punch up the lines',
    does: 'sharpens voice, subtext and rhythm',
    icon: 'MessagesSquare',
    brief:
      'run the dialogue-doctor over the pinned draft: keep each character’s voice distinct, cut the on-the-nose exposition, put the weight in subtext, and give me before → after rewrites for the flat exchanges',
  },
  {
    id: 'world_continuity',
    lane: 'core',
    stage: 'polish',
    chip: 'World',
    label: 'the continuity checker',
    title: 'Match the world bible',
    does: 'checks the script against the world you wrote',
    icon: 'Globe',
    brief:
      'run the world-continuity checker over the pinned draft: hold it against the world bible and flag every name, place, established fact, rule and piece of geography the script contradicts — and list what the script INVENTS that the bible doesn’t have yet, so I can add it before we board it',
  },

  // ── Ready for production ─────────────────────────────────────────────────
  {
    id: 'producer',
    lane: 'core',
    stage: 'lock',
    chip: 'Producible',
    label: 'the producer',
    title: 'Price the shoot',
    does: 'checks the script can actually be rendered',
    icon: 'Coins',
    brief:
      'run the producer over the pinned draft: count the distinct locations and characters, flag the beats our image and video models reliably fail (crowds, animals, fine hand work, legible on-screen text, three-plus characters in frame, wardrobe continuity across separately generated shots), estimate the shot count and what it costs to render, and rewrite the expensive scenes so they read the same for a fraction of the renders',
  },
  {
    id: 'performance_doctor',
    lane: 'core',
    stage: 'lock',
    chip: 'Speakable',
    label: 'the performance doctor',
    title: 'Make it speakable',
    does: 'checks the lines survive being spoken by a voice model',
    icon: 'AudioLines',
    brief:
      'run the performance-doctor over the pinned draft: find the lines a voice model will mangle — homographs, numerals, abbreviations, unbroken run-ons, names it will mispronounce — mark where a line needs a delivery note to land, and give me the estimated spoken runtime scene by scene',
  },

  // ── On demand — never offered unprompted, always tracked ─────────────────
  {
    id: 'voice_designer',
    lane: 'ondemand',
    stage: 'outline',
    chip: 'Voices',
    label: 'the voice designer',
    title: 'Design the voices',
    does: 'writes each character’s speech DNA into the bible',
    icon: 'Fingerprint',
    writes: 'world',
    brief:
      'run the voice-designer over the cast: for every character give me the speech DNA — the words they reach for and the ones they’d never use, sentence length and whether they finish sentences, their one signature construction, what they do INSTEAD of saying the true thing, how the voice changes under pressure, and one line only they could say — then propose it into each character’s voice field in the world bible',
  },
  {
    id: 'punch_up',
    lane: 'ondemand',
    stage: 'polish',
    chip: 'Punch-up',
    label: 'the punch-up room',
    title: 'Make it sparkle',
    does: 'swings for the memorable line, not the correct one',
    icon: 'Sparkles',
    brief:
      'take the pinned draft to the punch-up room: find every line doing its job in the dullest possible way and make it specific and memorable, land a real button on each scene exit, and take one genuine swing per scene — mark the swings so I can turn them down',
  },
  {
    id: 'table_read',
    lane: 'ondemand',
    stage: 'polish',
    chip: 'Table read',
    label: 'the table read',
    title: 'Hold a table read',
    does: 'casts an actor per character and collects their notes',
    icon: 'Mic',
    brief:
      'hold a table read of the pinned draft: cast one actor per character, give each only their own part, and bring me back what each of them says about it — the lines they can’t say out loud, the beats where they have nothing to play, and the moments the script asks them to do something their character has no reason to do',
  },
  {
    id: 'first_reader',
    lane: 'ondemand',
    stage: 'polish',
    chip: 'Cold read',
    label: 'the first reader',
    title: 'Get a cold read',
    does: 'reads it blind and says where it lost them',
    icon: 'Eye',
    brief:
      'give the pinned draft a cold read: no intent from me, no summary first — read it start to finish and tell me moment by moment what you understood, what confused you, what you predicted, and the exact line where you would have stopped watching',
  },
];

// --- Derived views (pure, no allocation surprises) ---------------------------

export const SPECIALIST_IDS: string[] = SPECIALISTS.map((s) => s.id);

export const SPECIALIST_BY_ID: Map<string, Specialist> = new Map(
  SPECIALISTS.map((s) => [s.id, s]),
);

/** The ones the landing deck is allowed to offer, in canonical order. */
export const CORE_SPECIALISTS: Specialist[] = SPECIALISTS.filter((s) => s.lane === 'core');

export const isSpecialistId = (id: unknown): boolean =>
  typeof id === 'string' && SPECIALIST_BY_ID.has(id);

/** Stage ordering, for "is this pass worth running yet" checks. */
export const STAGE_ORDER: SpecialistStage[] = ['outline', 'draft', 'polish', 'lock'];

export const stageRank = (stage: SpecialistStage): number => {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? 0 : i;
};

/**
 * Where a script is, from its size alone. Deliberately crude — it exists to
 * stop the deck offering a producibility pass on a twelve-line stub, not to be
 * a judgement about the writing. Callers that know better (the author asked for
 * a specific pass) should ignore it.
 */
export function scriptStage(lines: number): SpecialistStage {
  if (lines < 20) return 'outline';
  if (lines < 120) return 'draft';
  return 'polish';
}
