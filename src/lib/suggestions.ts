// The empty chat's "Continue building your story" cards — composed from where
// the project actually stands. THE source of truth for both surfaces: the web
// AgentChat landing and, vendored, the mobile Chat tab
// (mobile-app/src/lib/suggestions.ts, refreshed by
// `npm --prefix mobile-app run sync:suggestions`). Edit this file, not the copy.
//
// These used to be four fixed strings sent verbatim ("Let's create the world"),
// which had two problems. The card was the whole prompt, so the agent got a
// four-word brief and had to interview its way to what the user obviously
// wanted; and the same four cards showed on day one and on the day the episode
// was finished, three of them dead the whole time.
//
// So a card now carries TWO texts: the short `title`/`subtitle` the user reads,
// and the composed `prompt` — a full brief, naming the specific gaps by field,
// character or shot number — that the click actually sends. And the deck is
// derived from `GET /api/status` (the pipeline digest), so it moves with the
// project: the world card is replaced by the script card once the bible fills
// in, the doctors appear once there's a script for them to read, and each one
// retires when its work is done.
//
// This file is PURE — status in, cards out. No fetching, no React, no platform
// imports (which is what makes vendoring a straight copy), so the whole deck can
// be reasoned about, and tested, by feeding it a status shape.

/**
 * What a card is ABOUT, for the icon each platform draws (lucide-react on web,
 * lucide-react-native on mobile). The deck can't name components itself — it has
 * to stay import-free to be vendorable — so it names the subject and each UI maps
 * that to its own icon set.
 */
export type SuggestionKind =
  | 'world'
  | 'script'
  | 'review'
  | 'visual'
  | 'sheets'
  | 'shots'
  | 'board'
  | 'voice'
  | 'render'
  | 'cut'
  | 'status';

/** One card. `id` is stable per card KIND, which is what keeps its artwork stable. */
export type Suggestion = {
  id: string;
  kind: SuggestionKind;
  /** What the card says. Short — two lines at the card's width. */
  title: string;
  /** One line of context under the title, or null. */
  subtitle: string | null;
  /**
   * The same context as `subtitle`, written as a short paragraph — what the card
   * would actually do, not just the number that makes it due. Three texts rather
   * than two because the two surfaces have very different room: the web panel's
   * 2×2 grid of ~200px cards can only carry the one-line `subtitle`, while the
   * mobile row's 270×280 cards are big enough that a single clause under a large
   * headline reads as unfinished. Both are derived from the same status, so a
   * card never says one thing on the phone and another on the desktop.
   */
  blurb: string;
  /** The composed brief the click sends to the agent. Never just the title. */
  prompt: string;
};

// --- The status digest (worker/src/routes/status.js) -------------------------
// Every field optional: an older worker, an in-flight fetch, or a 500 must
// degrade to "we don't know yet", never crash the landing screen.

type Section = { filled?: number; total?: number; missing?: string[] };
type Roster = {
  count?: number;
  withSheet?: number;
  withVoice?: number;
  missingSheet?: string[];
  missingVoice?: string[];
};

export type Reviews = {
  latest?: Record<string, { at?: string; summary?: string; findings?: number | null } | null>;
  pending?: string[];
  stale?: string[];
  fresh?: string[];
};

export type Status = {
  stage?: string;
  world?: {
    exists?: boolean;
    title?: string;
    hasLogline?: boolean;
    map?: Section;
    depth?: Section;
    characters?: Roster;
    locations?: Roster;
  };
  script?: {
    exists?: boolean;
    lines?: number;
    title?: string;
    draftName?: string;
    signed?: boolean;
    hasProposal?: boolean;
    reviews?: Reviews;
  };
  visualWorld?: { exists?: boolean; generations?: number; ready?: number; promptRevisions?: number };
  shotlist?: { shots?: number; withDialogue?: number; locations?: number };
  storyboard?: { shots?: number; withStill?: number; missing?: number[] };
  radio?: { lines?: number; voiced?: number; cast?: number };
  sounds?: { tracks?: number; rendered?: number };
  episode?: { bundles?: number; rendered?: number };
  cuts?: { count?: number };
};

// --- The specialists --------------------------------------------------------
// Ids match the flue agent's subagent profile names and the worker's whitelist
// (worker/src/lib/reviews.js SPECIALISTS), in the order a script wants them.

type Doctor = {
  id: string;
  /** How the prose names it, mid-sentence ("re-check with the plot doctor"). */
  label: string;
  /** One or two words, for the Script tab's review chips. */
  chip: string;
  /** The card's title when it has never run. */
  title: string;
  /** What it does, for the subtitle and the tooltip. */
  does: string;
  /** The body of the composed brief — what to actually ask it for. */
  brief: string;
};

export const DOCTORS: Doctor[] = [
  {
    id: 'story_architect',
    chip: 'Structure',
    label: 'the story architect',
    title: 'Shape the arc',
    does: 'maps the episode onto a narrative structure',
    brief:
      'take the pinned draft to the story-architect: ask me which arc I want (hero’s journey, story circle, three-act, save the cat, kishōtenketsu), map what I have onto it, and come back with a beat-by-beat outline plus what to cut, move or add',
  },
  {
    id: 'motivation_doctor',
    chip: 'Whys',
    label: 'the motivation doctor',
    title: 'Find the whys',
    does: 'checks every beat is caused by character, not convenience',
    brief:
      'run the motivation-doctor over the pinned draft: find the beats that happen for plot convenience instead of being caused by what someone wants, fears or is wounded by, and prescribe the setup or wound that would justify each one',
  },
  {
    id: 'plot_doctor',
    chip: 'Plot holes',
    label: 'the plot doctor',
    title: 'Hunt the plot holes',
    does: 'audits continuity, setups and payoffs',
    brief:
      'run the plot-doctor over the pinned draft: audit it for plot holes, continuity and timeline slips, unplanted setups and unpaid payoffs, and give me the smallest fix for each — most story-breaking first',
  },
  {
    id: 'dialogue_doctor',
    chip: 'Dialogue',
    label: 'the dialogue doctor',
    title: 'Punch up the lines',
    does: 'sharpens voice, subtext and rhythm',
    brief:
      'run the dialogue-doctor over the pinned draft: keep each character’s voice distinct, cut the on-the-nose exposition, put the weight in subtext, and give me before → after rewrites for the flat exchanges',
  },
];

const DOCTOR_BY_ID = new Map(DOCTORS.map((d) => [d.id, d]));

/**
 * The turn that sends the script to one specialist. Shared by the suggestion
 * cards and the Script tab's review chips, so both ask for the same thing.
 * `stale` (the doctor read an older revision) asks it to reconcile its own
 * previous notes instead of repeating them.
 */
export function reviewMessage(
  id: string,
  { stale = false, lines = 0 }: { stale?: boolean; lines?: number } = {},
): string {
  const d = DOCTOR_BY_ID.get(id);
  if (!d) {
    return "Let's make the script better — pick the specialist that fits and run it over the pinned draft.";
  }
  if (stale) {
    return `The script has changed since ${d.label} last read it, so let’s do another pass: ${d.brief}. Read the pinned draft fresh — its previous notes were against text that may no longer be there. Give me the findings first, and say which of its earlier notes the rewrite already resolved.`;
  }
  const scale = lines ? ` It’s about ${plural(lines, 'line')} long.` : '';
  return `Let’s make the script better: ${d.brief}. Read the pinned draft yourself rather than asking me to paste it.${scale} Give me the findings first — don’t change the script until I say which fixes to apply.`;
}

// --- Copy helpers -----------------------------------------------------------

// World-bible field ids → the words the user (and the agent) call them by.
const FIELD_LABELS: Record<string, string> = {
  world: 'the world',
  protagonist: 'the protagonist',
  antagonist: 'the antagonist',
  stakes: 'the stakes',
  theme: 'the theme',
  premise: 'the premise',
  wantVsNeed: 'want vs need',
  conflict: 'the central conflict',
  obstacles: 'the obstacles',
  structure: 'the structure',
};

const label = (f: string) => FIELD_LABELS[f] ?? f;

// "a, b and c" — the prompts read as sentences, so they need real conjunctions.
export function joinList(items: string[], conjunction = 'and'): string {
  const list = items.filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} ${conjunction} ${list[list.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- The deck ---------------------------------------------------------------

// The default deck size. Surfaces override it: the mobile row can swipe through
// six, the web panel's wrapped 2×2 grid shows four. More than a handful and the
// tail is never reached; fewer and a mid-pipeline project loses moves worth
// offering.
export const MAX_SUGGESTIONS = 6;

// How many script-doctor cards can be in the deck at once. Four specialists all
// come up "never run" the moment a script exists, and offering all four buries
// every downstream move under a wall of reviews — of which nobody runs four in a
// row anyway. So the deck shows the next couple in the canonical order (structure
// → causality → coherence → lines) and the rest surface as those are done.
const MAX_PENDING_REVIEWS = 2;
const MAX_STALE_REVIEWS = 1;

// The one card that fits every stage, so it can serve as both the deck's tail and
// the floor when nothing else can be derived.
const STATUS_CARD: Suggestion = {
  id: 'status',
      kind: 'status',
  title: 'Where does it stand?',
  subtitle: 'A read on the whole episode',
  blurb:
    'A read on the whole episode — what’s finished, what’s half-done, and what’s actually blocking progress. Then the single next thing worth doing, and why that one before the others.',
  prompt:
    'Give me a status read on this episode: what’s finished, what’s half-done, and what’s blocking progress. Then recommend the single next thing to do and why that one before the others.',
};

// What to show when the digest can't be read at all (offline, a 500, a worker
// that predates /api/status). Deliberately NOT the day-one deck: telling someone
// with a finished episode to "build your story world" is worse than offering
// nothing, so these are the two prompts that make sense at any stage.
export const FALLBACK_SUGGESTIONS: Suggestion[] = [
  STATUS_CARD,
  {
    id: 'next-move',
      kind: 'status',
    title: 'What should I do next?',
    subtitle: 'Pick up where we left off',
    blurb:
      'Pick up where we left off. I’ll look at where the project actually stands, choose the one move most worth making now, tell you why it comes before the alternatives, and start on it with you.',
    prompt:
      'Look at where this project actually is and pick the one thing most worth doing next. Tell me why it comes before the alternatives, then start on it with me.',
  },
];

/**
 * The ordered deck for this project state. Rules are listed in pipeline order
 * and each yields a card only when its own gap is real, so the head of the list
 * is always the most upstream unfinished thing — the move most likely to be what
 * the user opened the chat to do. Callers take the first MAX_SUGGESTIONS.
 *
 * `max` caps the deck (default MAX_SUGGESTIONS); the status card always takes the
 * last slot, so a cap of 4 means three derived cards plus it.
 *
 * `null` or `{}` (a project with nothing in it) yields the day-one deck. That is
 * NOT the same as "the digest couldn't be read" — telling someone with a finished
 * episode to build a story world is worse than saying nothing, so a FAILED read
 * must render FALLBACK_SUGGESTIONS instead of calling this.
 */
export function buildSuggestions(
  status: Status | null,
  { max = MAX_SUGGESTIONS }: { max?: number } = {},
): Suggestion[] {
  const cards: Suggestion[] = [];
  const w = status?.world ?? {};
  const s = status?.script ?? {};
  const vw = status?.visualWorld ?? {};
  const sl = status?.shotlist ?? {};
  const sb = status?.storyboard ?? {};
  const radio = status?.radio ?? {};
  const ep = status?.episode ?? {};
  const cuts = status?.cuts ?? {};

  const mapMissing = w.map?.missing ?? [];
  const depthMissing = w.depth?.missing ?? [];
  const worldStarted = !!w.exists;
  const mapDone = worldStarted && mapMissing.length === 0;
  const scriptExists = !!s.exists;
  const shots = sl.shots ?? 0;

  // --- World -----------------------------------------------------------------

  if (!worldStarted) {
    // Day one. The one card that matters, and it opens the interview rather than
    // asking the agent to guess a world out of nothing.
    cards.push({
      id: 'world-create',
      kind: 'world',
      title: 'Build your story world',
      subtitle: 'The bible everything else is made from',
      blurb:
        'Everything downstream is made from the bible — the world and its rules, who wants what, and what it costs them. We’ll build it one question at a time, with options whenever you’re stuck.',
      prompt:
        'Let’s create the story world and bible for this project. Interview me one question at a time — the world and its rules, the protagonist and what they want, the antagonist or opposing force, what’s at stake, and the theme — and offer me two or three concrete options whenever I’m stuck instead of leaving the question open. Then write it into the world bible, and add the cast and the places we named to the roster.',
    });
  } else if (mapMissing.length) {
    // Partly filled: name the actual holes, so the agent asks about those and
    // nothing else.
    cards.push({
      id: 'world-finish',
      kind: 'world',
      title: 'Finish the world bible',
      subtitle: `${joinList(mapMissing.map(label))} still empty`,
      blurb: `The bible is started, but ${joinList(mapMissing.map(label))} ${mapMissing.length === 1 ? 'is' : 'are'} still blank. I’ll read what’s already there and ask you about each hole one at a time, with options that fit the world you have.`,
      prompt: `The world bible is started but ${joinList(mapMissing.map(label))} ${mapMissing.length === 1 ? 'is' : 'are'} still empty. Read the world first so you build on what’s there, then ask me about each missing piece one at a time — with two or three options that fit the world we already have — and save the answers into the bible.`,
    });
  }

  if (mapDone && depthMissing.length) {
    cards.push({
      id: 'world-depth',
      kind: 'world',
      title: 'Deepen the story',
      subtitle: `${joinList(depthMissing.map(label))} still empty`,
      blurb: `The map is filled in, so the layer under it is what’s left: ${joinList(depthMissing.map(label))}. I’ll propose a version of each that follows from what’s already established, say why it makes the story stronger, and save what you approve.`,
      prompt: `The story map is filled in, so let’s do the story depth: ${joinList(depthMissing.map(label))}. Read the world bible, propose a version of each that follows from what’s already established, tell me why each choice makes the story stronger, and save what I approve.`,
    });
  }

  // A filled-in map with a thin roster is a premise, not a world yet — an episode
  // needs people to put in scenes and places to put them in. Retires once the
  // roster can carry one, so a series bible with a real cast isn't nagged.
  const charCount = w.characters?.count ?? 0;
  const locCount = w.locations?.count ?? 0;
  if (mapDone && (charCount < 4 || locCount < 3)) {
    cards.push({
      id: 'world-extend',
      kind: 'world',
      title: 'Extend your world',
      subtitle:
        charCount || locCount
          ? `${plural(charCount, 'character')}, ${plural(locCount, 'place')} so far`
          : 'No cast or places yet',
      blurb: `An episode needs people to put in scenes and places to put them in — ${
        charCount || locCount
          ? `${plural(charCount, 'character')} and ${plural(locCount, 'place')} so far`
          : 'and there are none on the roster yet'
      }. I’ll propose a few more that belong in this world and would earn a scene.`,
      prompt: `Let’s extend the world. Read the bible, then propose three or four more characters — each with an archetype, what they want, what they need, their arc and how they speak — plus two or three locations that belong in this world and would earn a scene. Show them to me as a list I can pick from, and add the ones I approve to the roster.`,
    });
  }

  // --- Script ----------------------------------------------------------------

  if (mapDone && !scriptExists) {
    cards.push({
      id: 'script-start',
      kind: 'script',
      title: 'Write your script',
      subtitle: 'The bible is ready to become an episode',
      blurb:
        'The bible is ready to become an episode. We’ll pick the arc to build on and map the premise onto it first — then, once the beats feel right, I’ll draft the opening scenes for you to react to.',
      prompt:
        'The world bible is filled in, so let’s write the script. Start with the story-architect: ask me which arc to build on, map the premise onto it, and show me the beat outline. Once I’m happy with the beats, write the opening scenes into the script as a proposal I can review — proper sluglines, action and dialogue in the voices from the bible — and stop after the first two or three scenes so I can react before you keep going.',
    });
  }

  // --- Script doctors (which specialists haven't read this draft) -------------

  if (scriptExists) {
    const reviews = s.reviews ?? {};
    const pending = reviews.pending ?? [];
    const stale = reviews.stale ?? [];
    const lines = s.lines ?? 0;

    // `pending`/`stale` arrive in the canonical specialist order (the worker
    // iterates SPECIALISTS), so taking the head takes the ones a script wants
    // first — structure before dialogue polish.
    for (const id of pending.slice(0, MAX_PENDING_REVIEWS)) {
      const d = DOCTOR_BY_ID.get(id);
      if (!d) continue;
      cards.push({
        id: `review-${id}`,
        kind: 'review',
        title: d.title,
        subtitle: `${d.label[0].toUpperCase()}${d.label.slice(1)} hasn’t read it yet`,
        blurb: `${d.label[0].toUpperCase()}${d.label.slice(1)} ${d.does}, and hasn’t read this draft yet. It reads the pinned draft itself and comes back with findings first — nothing in the script changes until you say which fixes to apply.`,
        prompt: reviewMessage(id, { lines }),
      });
    }
    // Re-runs come after every never-run doctor: a stale pass is still a pass.
    for (const id of stale.slice(0, MAX_STALE_REVIEWS)) {
      const d = DOCTOR_BY_ID.get(id);
      if (!d) continue;
      const last = reviews.latest?.[id];
      cards.push({
        id: `rereview-${id}`,
        kind: 'review',
        title: `Re-check with ${d.label}`,
        subtitle: last?.summary ? `Last pass: ${last.summary}` : 'The script changed since its last pass',
        blurb: `The script has changed since ${d.label} last read it${last?.summary ? ` — last pass: ${last.summary}` : ''}. A fresh pass reads the current draft and says which of its earlier notes the rewrite already resolved.`,
        prompt: reviewMessage(id, { stale: true }),
      });
    }
  }

  // --- Visual world ----------------------------------------------------------

  if (worldStarted && !vw.exists) {
    cards.push({
      id: 'visual-create',
      kind: 'visual',
      title: 'Create the visual world',
      subtitle: 'Decide what this story looks like',
      blurb:
        'Decide what this story looks like — palette, light, lens, texture, how stylized it goes. I’ll offer a couple of directions, then generate concept frames of the key locations so you can see one before locking it.',
      prompt: `Let’s create the visual world for this story. Read the world bible, then propose a look — palette, light, lens, texture, the level of stylization — in a couple of options I can choose between, and say which one fits the tone. Once I pick, generate concept frames for the key locations so we can see the style and lock it in.`,
    });
  }

  // Cast/place art: name exactly who is missing a sheet.
  const missingSheets = w.characters?.missingSheet ?? [];
  if (vw.exists && missingSheets.length) {
    cards.push({
      id: 'sheets-characters',
      kind: 'sheets',
      title: 'Design the cast',
      subtitle: `No sheet for ${joinList(missingSheets)}`,
      blurb: `${joinList(missingSheets)} ${missingSheets.length === 1 ? 'has' : 'have'} no character sheet yet. I’ll design them from their descriptions in the bible, in the visual style you locked, and keep every sheet consistent with the rest of the cast.`,
      prompt: `Generate character sheets for ${joinList(missingSheets)}. Use their appearance and voice from the world bible plus the visual style we locked, keep every sheet consistent with the others, show them to me before saving, and attach the ones I approve to their roster cards.`,
    });
  }

  const missingLocSheets = w.locations?.missingSheet ?? [];
  if (vw.exists && !missingSheets.length && missingLocSheets.length) {
    cards.push({
      id: 'sheets-locations',
      kind: 'sheets',
      title: 'Build the places',
      subtitle: `No reference art for ${joinList(missingLocSheets)}`,
      blurb: `${joinList(missingLocSheets)} ${missingLocSheets.length === 1 ? 'has' : 'have'} no reference art yet. I’ll build a locked background for each from its description in the bible, so every shot set there matches the one before it.`,
      prompt: `Generate location sheets for ${joinList(missingLocSheets)} — a locked background per place, in the visual style we established, from each location's description in the world bible. Show them to me first, then attach the ones I approve to their roster cards.`,
    });
  }

  // --- Shot list -------------------------------------------------------------

  if (scriptExists && shots === 0) {
    cards.push({
      id: 'shotlist-create',
      kind: 'shots',
      title: 'Break it into shots',
      subtitle: s.signed ? 'The script is signed off' : 'Turn the script into a shot list',
      blurb: `${s.signed ? 'The script is signed off, so it can become a shot list' : 'The script is ready to become a shot list'} — the beat each shot serves, its location, who’s in it, the camera, the action and its dialogue. You’ll see the count and the rough running time before anything is saved.`,
      prompt: `Let’s turn the script into a shot list. Read the pinned draft, then break it into shots — for each one the beat it serves, the location slug, who’s in it, the camera, the action, its dialogue and a rough duration. Keep the scene order, tell me how many shots and roughly how long the episode comes out, and save it once I’ve looked.`,
    });
  }

  // --- Storyboard ------------------------------------------------------------

  const withStill = sb.withStill ?? 0;
  if (shots > 0 && withStill < shots) {
    const gap = shots - withStill;
    const which = (sb.missing ?? []).slice(0, 6);
    cards.push({
      id: 'storyboard-fill',
      kind: 'board',
      title: 'Board the episode',
      // "148 of 148 shots have no still" reads like a bug; a day-one board just
      // hasn't started.
      subtitle:
        gap === shots
          ? `No stills yet · ${plural(shots, 'shot')}`
          : `${gap} of ${shots} shots have no still`,
      blurb: `${
        gap === shots
          ? `Nothing is boarded yet — ${plural(shots, 'shot')} waiting for a still.`
          : `${gap} of ${shots} shots still have no storyboard still.`
      } I’ll generate them in shot order in the locked style, using the character and location sheets so the cast stays consistent, and stop after a first batch for your note.`,
      prompt: `${plural(gap, 'shot')} still ${gap === 1 ? 'has' : 'have'} no storyboard still${which.length ? ` (starting with ${joinList(which.map((n) => `shot ${n}`))})` : ''}. Generate them in shot order using the locked visual style, each shot's own prompt, and the character and location sheets as references so the cast stays consistent. Do a first batch, show me the results, and wait for my note before continuing.`,
    });
  }

  // --- Radio (voiced dialogue) ----------------------------------------------

  const lines = radio.lines ?? 0;
  const voiced = radio.voiced ?? 0;
  if (lines > 0 && voiced < lines) {
    const cast = radio.cast ?? 0;
    cards.push({
      id: 'radio-voice',
      kind: 'voice',
      title: 'Voice the episode',
      subtitle: !cast
        ? 'Nobody is cast yet'
        : voiced === 0
          ? `Nothing voiced yet · ${plural(lines, 'line')}`
          : `${lines - voiced} of ${lines} lines unvoiced`,
      blurb: cast
        ? `${plural(lines - voiced, 'dialogue line')} ${lines - voiced === 1 ? 'is' : 'are'} still unvoiced. I’ll render them in script order with each character’s cast voice and tell you which takes I’d keep, so you can hear the episode before you look at it.`
        : `Nobody is cast yet, so nothing can be voiced. I’ll propose a voice for each speaking character from their description in the bible, and once you approve the casting, render all ${plural(lines, 'line')} in script order.`,
      prompt: cast
        ? `${plural(lines - voiced, 'dialogue line')} ${lines - voiced === 1 ? 'is' : 'are'} still unvoiced. Render them with each character's cast voice, in script order, and tell me which takes you'd keep. Play them back to me as a radio version so I can hear the episode before we look at it.`
        : `Let's make the radio version. Read the dialogue, propose a voice for each speaking character from the world bible's descriptions, and once I approve the casting render the lines in script order so I can hear the whole episode.`,
    });
  }

  // --- Renders / cut --------------------------------------------------------

  const bundles = ep.bundles ?? 0;
  const rendered = ep.rendered ?? 0;
  if (bundles > 0 && rendered < bundles) {
    cards.push({
      id: 'episode-render',
      kind: 'render',
      title: 'Render the shots',
      subtitle: `${bundles - rendered} of ${bundles} bundles unrendered`,
      blurb: `${plural(bundles - rendered, 'bundle')} of ${bundles} still ${bundles - rendered === 1 ? 'has' : 'have'} no video. I’ll render them in order from each bundle’s first frame and reference video, then report which came back clean and which want another take.`,
      prompt: `${plural(bundles - rendered, 'bundle')} still ${bundles - rendered === 1 ? 'has' : 'have'} no video. Render them in order, using each bundle's first frame and reference video where one is set, and report which came back clean and which need another take.`,
    });
  }

  if (bundles > 0 && rendered === bundles && (cuts.count ?? 0) === 0) {
    cards.push({
      id: 'cut-stitch',
      kind: 'cut',
      title: 'Stitch the complete cut',
      subtitle: 'Every bundle is rendered',
      blurb:
        'Every bundle is rendered, so the episode can be assembled end to end — the selected take of each in order, with the dialogue and sound in place. Then I’ll give you the running time and score where it drags.',
      prompt: `Every bundle is rendered, so stitch the complete cut: the selected take of each bundle in order, with the dialogue and sound in place. Then tell me the running time and score the cut — where it drags, where a beat lands early, what I should look at first.`,
    });
  }

  // --- Always available -----------------------------------------------------
  // The tail card, and the reason the row is never empty — for a finished
  // episode, or a status shape this build doesn't understand, it's the whole
  // deck. It's appended AFTER the cut rather than competing for a slot, so a
  // busy project can't push "where does it stand" off the end.
  return [...cards.slice(0, Math.max(1, max) - 1), STATUS_CARD];
}
