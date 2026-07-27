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
  /** One line under the title on the card. */
  tagline: string;
  /** The detail screen's paragraph — what this actually is, in plain words. */
  body: string;
  /** The composed brief "Start this" sends. Never just the title. */
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
    body:
      'An animatic is the episode before anything can move: every shot’s still held on screen for exactly as long as its line takes, the radio dialogue running underneath, and a labelled slate standing in wherever the artwork does not exist yet. It is the first version you can actually watch — and the first place the pacing tells you the truth.',
    prompt:
      'Let’s put the episode in motion: build an animatic from what we already have — each shot’s storyboard still on the picture track for as long as its dialogue runs, the radio under it, and slates where a still doesn’t exist yet. Before you start, tell me which shots are missing artwork and how long the whole thing is going to run. Then cut it together and give me a cut I can play.',
    art: null,
  },
  {
    slug: 'look',
    kicker: 'Visual world',
    title: 'Find the look',
    tagline: 'Concept frames before a single shot',
    body:
      'Before the boards there is the look: a spread of concept frames for the places and the people, all shot the same way — one lens, one light, one palette — so the series reads as one world instead of a folder of pretty images. Everything downstream, every sheet and every still, inherits from what gets settled here.',
    prompt:
      'Let’s find the look of the series: generate a spread of concept frames for the locations and characters we already have — the same lens, light and palette across all of them, so they read as one world. Ask me which direction to push before you spend a second round, and once we can see them side by side tell me what the through-line is.',
    art: 'visual',
  },
  {
    slug: 'board',
    kicker: 'Storyboard',
    title: 'See it as boards',
    tagline: 'Every shot as a frame you can read',
    body:
      'A board per shot, in the visual language the world already established. Boarding is where a shot list stops being a spreadsheet: you find out which beats have no image behind them, which two shots are the same shot, and what the episode is going to feel like — while it still costs a picture to change your mind.',
    prompt:
      'Let’s board the episode: go through the shot list and generate the storyboard still each shot is missing, matching the visual world we’ve already established. Start with the shots that carry the story rather than the first ones in the list, work in small batches, and show me each batch before moving on.',
    art: 'storyboard',
  },
];
