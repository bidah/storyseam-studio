// The Chat landing screen's DISCOVER deck — the full-width posters under "Try
// something new".
//
// The two decks answer different questions on purpose. "Continue building your
// story" is
// DERIVED (see suggestions.ts): small cards, composed from where the project
// actually stands, and a card retires the moment its gap closes. Discover is
// EDITORIAL: a fixed, hand-written set of the big moves the studio can make —
// cast it, build its places, put it in motion — which are true on day one and
// still true on the day the episode is finished. That's why the slugs are
// stable: each one is a route (`chat/discover/[slug]`), and the card zooms into
// it (Link.AppleZoom, iOS 18+).
//
// A card is a PICTURE first, and every card ships with one of its own. The
// project's matching work replaces it once there is any — your character on the
// cast card, your location on the world card — so the row reads the same on an
// empty project as on a finished one, but grows into the project as it fills up.
// See use-discover.ts for the resolution.

/**
 * Which of the project's own pictures may stand in for a card's shipped hero.
 * `character` / `location` are the visual world's SHEETS (a generation carries a
 * `sheetType`), so the cast card can show one of your characters and the world
 * card one of your places rather than both showing whatever was generated last.
 */
export type DiscoverArt = 'visual' | 'storyboard' | 'character' | 'location' | null;

/** A shipped picture: where it lives, and the hash computed from it at build time. */
export type DiscoverHero = { rel: string; blurhash: string };

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
  /** Which project media may replace the hero, or null to always show it. */
  art: DiscoverArt;
  /** The picture this card ships with — one per card, never shared. */
  hero: DiscoverHero;
};

// The shipped pictures live in R2 behind the Worker (`/files/…`) rather than
// bundled in the app: art is content, and content on the server can be swapped
// without a new binary or even an OTA. Stored RELATIVE so `mediaUrl()` puts the
// configured API origin in front — a hardcoded workers.dev URL would break the
// moment the Worker moves.
//
// Each carries its own blurhash, computed from the file at build time (ffmpeg →
// 64px RGBA → blurhash encode, 4×3 components). Shipped as a constant rather
// than learned at runtime because a hash can only be generated from pixels you
// have already downloaded: on a cold start that's exactly one download too late
// for the blur-up to be worth anything. Project media has no such luxury and
// gets hashed after first sight (see lib/image-tint.ts) — which is also where
// these strings become each card's tint colour, since a blurhash's first
// component IS the picture's average colour.
const HERO = {
  rider: {
    rel: '/files/chat-uploads/d29c9831-7a1b-4060-afbd-4a7fc5aabf96-discover-rider.jpg',
    blurhash: 'L48}PxInS6n4k]D*IU?cS0Mys8o~',
  },
  cast: {
    rel: '/files/chat-uploads/1620605a-242e-4ceb-a557-ba30b9739612-discover-cast.jpg',
    blurhash: 'LCC6iR00?vrq?^DitSNH%NxWofkD',
  },
  world: {
    rel: '/files/chat-uploads/6ca84d05-2933-4d37-a942-5a2281bf0476-discover-world.jpg',
    blurhash: 'LdIF3qW=n%sDysogNGg2%#ocR.Rk',
  },
} satisfies Record<string, DiscoverHero>;

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
    hero: HERO.rider,
  },
  {
    slug: 'cast',
    kicker: 'Characters',
    title: 'Give them a face',
    tagline: 'A sheet and a voice for everyone in the story',
    lead: {
      opener: 'A character sheet is a promise',
      rest:
        ' — that this is the same person in every shot they appear in, from any angle, in any light. Without one, a character is whatever each generation decides they look like that afternoon.',
    },
    sections: [
      {
        heading: 'A sheet, not a portrait',
        body:
          'One beautiful image of somebody is a picture. A sheet is that person turned around: front, three-quarter, profile, the silhouette that reads at a distance, the details that survive being small — the coat, the scar, the way the hair sits. It exists so every later frame has something to be consistent WITH, which is the whole difference between a cast and a series of strangers.',
      },
      {
        heading: 'Then give them a voice',
        body:
          'A character in this studio is a face and a voice, and the voice is doing at least half the work. Casting one is the same decision as casting the face — age, weight, where they’re from, what they sound like when they’re not performing — and once it’s cast, every line that character speaks in the radio and the animatic comes back in it.',
      },
      {
        heading: 'The roster is the source',
        body:
          'Characters aren’t invented at the image stage; they come off the world bible’s roster, which is what makes it possible to say who is still missing a sheet or a voice. Start from the names the script actually leans on — the ones with lines, the ones in the most shots — rather than the ones that happen to be first alphabetically.',
      },
    ],
    prompt:
      'Let’s give the cast faces and voices: go through the roster, tell me who is still missing a character sheet or a voice, and rank them by how much the script actually leans on them. Then generate sheets for the top of that list in the visual world’s established look — front, three-quarter and profile, consistent wardrobe and features — and show me each one before moving to the next. Ask me before casting a voice rather than picking one for me.',
    art: 'character',
    hero: HERO.cast,
  },
  {
    slug: 'world',
    kicker: 'Locations',
    title: 'Build the world',
    tagline: 'Every place the story visits, drawn once',
    lead: {
      opener: 'Somewhere the story keeps coming back to',
      rest:
        ' deserves to be drawn once and then reused, the way a production builds a standing set. Otherwise the same room is a slightly different room in every scene that happens in it.',
    },
    sections: [
      {
        heading: 'A place needs a sheet too',
        body:
          'The wide that establishes it. The angle you actually shoot most of the scenes from. What it looks like from the way in. Together they answer the question every later shot asks — where am I standing, and what is behind me — so a frame set in that place can be generated without re-describing it from scratch each time.',
      },
      {
        heading: 'Hour, weather, season',
        body:
          'A location is not one image; it is a place under conditions. The same hillside at noon and at dusk are two different scenes with the same geography, and deciding up front which ones the episode needs saves discovering halfway through the boards that half your shots quietly happen at a time of day nothing was drawn for.',
      },
      {
        heading: 'What the boards inherit',
        body:
          'Locations feed straight into the storyboard: a shot that names a place can be drawn against that place’s sheet instead of a sentence, which is what makes forty stills feel like one episode rather than forty prompts. Get the places right and the boarding stops being a negotiation.',
      },
    ],
    prompt:
      'Let’s build the world’s places: list the locations the script and shot list actually use, tell me which ones have no sheet yet, and rank them by how many shots happen there. Then generate location sheets for the busiest ones in our established look — an establishing wide, the main shooting angle, and the approach — plus any time of day the episode needs them in. Show me each location before starting the next.',
    art: 'location',
    hero: HERO.world,
  },
];
