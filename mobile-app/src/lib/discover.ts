// The Chat landing screen's DISCOVER deck — the full-width posters under "Try
// something new".
//
// The two decks answer different questions on purpose. "Try something new" is
// DERIVED (see suggestions.ts): small cards, composed from where the project
// actually stands, and a card retires the moment its gap closes. Discover is
// EDITORIAL: a fixed, hand-written set of the big moves the studio can make —
// find the look, board it, put it in motion — which are true on day one and
// still true on the day the episode is finished. That's why the slugs are
// stable: each one is a route (`chat/discover/[slug]`), and the card zooms into
// it (Link.AppleZoom, iOS 18+).
//
// A card is a PICTURE first. The art is the project's own work when there is
// any — a concept frame, a storyboard still — and the shipped hero below when
// there isn't, so the row reads the same on an empty project as on a finished
// one. See use-discover.ts for the resolution.

export type DiscoverArt = 'visual' | 'storyboard' | null;

export type DiscoverEntry = {
  /** Stable — it is the detail route's path segment. Never renumber. */
  slug: string;
  /** Eyebrow over the title, naming the surface this is about. */
  kicker: string;
  title: string;
  /** One line under the title, on the card and again as the screen's standfirst. */
  tagline: string;
  /**
   * The opening paragraph, split the way an App Store Today story splits it:
   * `opener` is set in the foreground colour and bold, `rest` continues in the
   * body colour on the same line. One sentence made of two styles, not two
   * paragraphs — the bold runs INTO the text rather than sitting above it.
   */
  lead: { opener: string; rest: string };
  /** The article under the lead: a bold heading over a paragraph, repeated. */
  sections: { heading: string; body: string }[];
  /** The composed brief "Try this" sends. Never just the title. */
  prompt: string;
  /** Which project media illustrates it, or null for the shipped hero. */
  art: DiscoverArt;
};

// The shipped hero, in R2 behind the Worker (`/files/…`) rather than bundled in
// the app: art is content, and content that lives on the server can change
// without a new binary or an OTA. Stored RELATIVE so `mediaUrl()` puts the
// configured API origin in front of it — a hardcoded workers.dev URL would
// break the moment the Worker moves.
export const DISCOVER_HERO_REL =
  '/files/chat-uploads/d29c9831-7a1b-4060-afbd-4a7fc5aabf96-discover-rider.jpg';

// The hero's OWN blurhash, computed from the file at build time (ffmpeg → 64×47
// RGBA → blurhash encode, 4×3 components). Shipped as a constant rather than
// learned at runtime because a hash can only be generated from pixels you have
// already downloaded: on a cold start that's exactly one download too late for
// the blur-up to be worth anything. Project media has no such luxury and gets
// its hash generated after first sight (see lib/image-tint.ts) — which is also
// where this string turns into the card's tint colour, since a blurhash's first
// component IS the picture's average colour.
export const DISCOVER_HERO_BLURHASH = 'L48}PxInS6n4k]D*IU?cS0Mys8o~';

// The neutral used while an unknown picture is still being hashed.
export const DISCOVER_BLURHASH = 'L6C%b^~qRj00_3xu9F%L00IU-;M{';

export const DISCOVER: DiscoverEntry[] = [
  {
    slug: 'motion',
    kicker: 'Animatic',
    title: 'Put it in motion',
    tagline: 'Stills, voices and cuts on one timeline',
    lead: {
      opener: 'An animatic is the episode',
      rest:
        ' before anything can move: every shot’s still held on screen for exactly as long as its line takes, the radio dialogue running underneath, and a labelled slate standing in wherever the artwork doesn’t exist yet. It is the first version you can actually watch.',
    },
    sections: [
      {
        heading: 'Why it comes first',
        body:
          'A shot list can tell you what happens and in what order. It cannot tell you that the third beat runs eleven seconds and plays like forty, or that two shots you were proud of say the same thing back to back. Pacing only answers to a clock, and this is the cheapest clock there is — the whole thing re-cuts in seconds, while changing your mind still costs a still rather than a render.',
      },
      {
        heading: 'What it needs from you',
        body:
          'Whatever exists. Shots with stills use them; shots without get a slate carrying the shot number, so a half-boarded episode still plays end to end instead of refusing to assemble. Voiced dialogue sets each shot’s length; anything unvoiced falls back to a read-speed estimate, which is close enough to hear the shape.',
      },
      {
        heading: 'What you get back',
        body:
          'A cut on the timeline — scrubbable, re-timeable, and yours to argue with. Every still on it is a placeholder for that shot’s video, so when a shot is finally rendered it replaces the still in place. The animatic doesn’t get thrown away when the real footage lands; it becomes it, one shot at a time.',
      },
    ],
    prompt:
      'Let’s put the episode in motion: build an animatic from what we already have — each shot’s storyboard still on the picture track for as long as its dialogue runs, the radio under it, and slates where a still doesn’t exist yet. Before you start, tell me which shots are missing artwork and how long the whole thing is going to run. Then cut it together and give me a cut I can play.',
    art: null,
  },
  {
    slug: 'look',
    kicker: 'Visual world',
    title: 'Find the look',
    tagline: 'Concept frames before a single shot',
    lead: {
      opener: 'Before the boards there is the look',
      rest:
        ' — a spread of concept frames for the places and the people, all made the same way, so the series reads as one world instead of a folder of pretty images.',
    },
    sections: [
      {
        heading: 'One lens, one light',
        body:
          'What makes a set of images a world is not the subjects, it’s the constants: the same focal length, the same time of day, the same handful of colours doing the same jobs. Generated one at a time to individual taste, ten frames become ten different films. Generated against one visual brief, they become a place.',
      },
      {
        heading: 'It is a decision, not a gallery',
        body:
          'The point isn’t the images — it’s what you settle by looking at them. Which of these is the series? Once that’s answered, the answer travels: character and location sheets are drawn to it, storyboard stills inherit it, and every render downstream has something specific to match instead of a prompt reinventing the world each time.',
      },
      {
        heading: 'Push it before you commit',
        body:
          'The first spread exists to be reacted to. Warmer, harder, further back, more weather — say which direction and the next round is generated against it. Cheap while it’s only frames; expensive once forty stills have inherited a look nobody chose.',
      },
    ],
    prompt:
      'Let’s find the look of the series: generate a spread of concept frames for the locations and characters we already have — the same lens, light and palette across all of them, so they read as one world. Ask me which direction to push before you spend a second round, and once we can see them side by side tell me what the through-line is.',
    art: 'visual',
  },
  {
    slug: 'board',
    kicker: 'Storyboard',
    title: 'See it as boards',
    tagline: 'Every shot as a frame you can read',
    lead: {
      opener: 'A board per shot',
      rest:
        ', in the visual language the world already established. Boarding is where a shot list stops being a spreadsheet and starts being a film you can read at a glance.',
    },
    sections: [
      {
        heading: 'What boarding shakes loose',
        body:
          'Beats with no image behind them. Two shots that turn out to be the same shot. A line of dialogue that has nowhere to be spoken from. None of these are visible in a list — they surface the moment somebody has to draw the frame, which is exactly why the drawing happens before anything expensive does.',
      },
      {
        heading: 'In batches, in story order',
        body:
          'Not the first shots in the list — the shots that carry the episode. A batch comes back, you say what’s wrong with it, and the correction applies to everything after it rather than being re-explained forty times. Every still is keyed to its shot id, so a re-generated frame lands on the same shot and the takes stack up beside it.',
      },
      {
        heading: 'Then it moves',
        body:
          'Boards aren’t a deliverable, they’re the picture track. Every still you approve here is what the animatic plays and what its shot’s video eventually replaces — so a boarded episode is already a watchable one.',
      },
    ],
    prompt:
      'Let’s board the episode: go through the shot list and generate the storyboard still each shot is missing, matching the visual world we’ve already established. Start with the shots that carry the story rather than the first ones in the list, work in small batches, and show me each batch before moving on.',
    art: 'storyboard',
  },
];
