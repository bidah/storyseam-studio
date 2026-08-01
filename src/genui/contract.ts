/**
 * The Studio generative-UI CONTRACT — the single model-facing component surface.
 *
 * Everything the agent knows about the chat's component library lives here:
 * names, positional prop schemas, and the descriptions that become its prompt.
 * Renderers (shadcn on web, React Native on mobile) only decide how each
 * component LOOKS, never what it IS — which is what lets one `render_ui` tool
 * call draw the same decision on both platforms.
 *
 * This file is CANONICAL. It is vendored into `mobile-app/src/genui/contract.ts`
 * and compiled into the agent's prompt reference by `npm run genui:sync` —
 * editing the copy or the reference by hand puts the three out of sync, exactly
 * like `render-fn`'s vendored composition.
 *
 * ## Actions are just messages
 *
 * flue cannot suspend a turn for a human (see whistlewood.md "Asking the
 * user"), so every interactive element answers the same way `ask_question` did:
 * the pick becomes the NEXT USER MESSAGE and the turn continues from there.
 * That's why nothing here takes an OpenUI ActionExpression — actionable
 * components carry a plain `send` string instead, the message posted on the
 * user's behalf when it is tapped. One less thing the model can malform, and
 * the host wires it up with a single `triggerAction(send)`.
 *
 * ## buildStudioLibrary() runs exactly ONCE per bundle
 *
 * `defineComponent` registers each schema in zod's global registry by name, and
 * duplicate ids crash JSON-schema conversion. Each app calls it once, from its
 * own `library` module.
 */
import type { ComponentRenderer, Library } from "@openuidev/react-lang";
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import type { ReactNode } from "react";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Renderer prop types — what each design system implements.
// ---------------------------------------------------------------------------

/** A `{ label, value }` detail row, used by KeyValue and Compare columns. */
export interface DetailRow {
  label: string;
  value: string;
}

export interface StepSpec {
  title: string;
  detail?: string;
  meta?: string;
}

export interface CardProps {
  children?: unknown[];
}
export interface SectionProps {
  title: string;
  children?: unknown[];
  subtitle?: string | null;
}
export interface TextProps {
  text: string;
  style?: "body" | "muted" | "strong" | "title";
}
export interface CalloutProps {
  variant: "info" | "success" | "warning" | "danger";
  title: string;
  description?: string | null;
}
/** How a list resolves taps: see the SELECT note below. */
export type SelectMode = "one" | "many" | "one-per-group";

export interface OptionProps {
  title: string;
  send: string;
  subtitle?: string | null;
  meta?: string | null;
  image?: string | null;
  badge?: string | null;
  selected?: boolean;
  tone?: "normal" | "danger";
  group?: string | null;
}
export interface OptionListProps {
  options?: unknown[];
  header?: string | null;
  footnote?: string | null;
  select?: SelectMode;
  send?: string | null;
  confirm?: string | null;
}
export interface MediaItemProps {
  src: string;
  send?: string | null;
  label?: string | null;
  caption?: string | null;
  selected?: boolean;
  group?: string | null;
}
export interface MediaGridProps {
  items?: unknown[];
  header?: string | null;
  columns?: number;
  select?: SelectMode;
  send?: string | null;
  confirm?: string | null;
}
export interface AudioItemProps {
  src: string;
  title: string;
  send?: string | null;
  subtitle?: string | null;
  meta?: string | null;
  badge?: string | null;
  selected?: boolean;
  group?: string | null;
}
export interface AudioListProps {
  items?: unknown[];
  header?: string | null;
  footnote?: string | null;
  select?: SelectMode;
  send?: string | null;
  confirm?: string | null;
}
export interface RecommendationProps {
  title: string;
  body: string;
  send: string;
  cta?: string | null;
  image?: string | null;
  badge?: string | null;
  meta?: string | null;
  bullets?: string[];
}
export interface ColumnProps {
  label: string;
  rows?: DetailRow[];
  badge?: string | null;
  send?: string | null;
}
export interface CompareProps {
  columns?: unknown[];
  header?: string | null;
}
export interface KeyValueProps {
  rows?: DetailRow[];
  header?: string | null;
}
export interface StepsProps {
  steps?: StepSpec[];
  header?: string | null;
  current?: number;
}
export interface ChipsProps {
  labels?: string[];
}
export interface ActionProps {
  label: string;
  send: string;
  variant?: "primary" | "secondary";
  tone?: "normal" | "danger";
}
export interface ActionsProps {
  actions?: unknown[];
  direction?: "row" | "column";
}

/** A design-system renderer for one component of the contract. */
export type Renderer<P> = (renderProps: {
  props: P;
  renderNode: (value: unknown) => ReactNode;
}) => ReactNode;

/**
 * One entry per contract component. `Option`, `MediaItem`, `Column` and
 * `Action` ARE rendered (by their parents, through `renderNode`), so unlike
 * appless's structural placeholders they each need a real renderer.
 */
export interface StudioRenderers {
  Card: Renderer<CardProps>;
  Section: Renderer<SectionProps>;
  Text: Renderer<TextProps>;
  Callout: Renderer<CalloutProps>;
  Option: Renderer<OptionProps>;
  OptionList: Renderer<OptionListProps>;
  MediaItem: Renderer<MediaItemProps>;
  MediaGrid: Renderer<MediaGridProps>;
  AudioItem: Renderer<AudioItemProps>;
  AudioList: Renderer<AudioListProps>;
  Recommendation: Renderer<RecommendationProps>;
  Column: Renderer<ColumnProps>;
  Compare: Renderer<CompareProps>;
  KeyValue: Renderer<KeyValueProps>;
  Steps: Renderer<StepsProps>;
  Chips: Renderer<ChipsProps>;
  Action: Renderer<ActionProps>;
  Actions: Renderer<ActionsProps>;
}

// ---------------------------------------------------------------------------
// Shared sub-schemas.
// ---------------------------------------------------------------------------

const detailRow = z.object({ label: z.string(), value: z.string() });

const stepSpec = z.object({
  title: z.string(),
  detail: z.string().optional(),
  meta: z.string().optional(),
});

/**
 * The message an interactive element posts on the user's behalf. Described once
 * so every component's prompt signature says the same thing about it.
 */
const SEND =
  "the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'";

/**
 * Deferred selection, shared by OptionList, MediaGrid and AudioList. In both
 * `"many"` and `"one-per-group"` modes a tap only TOGGLES a row/tile; nothing is
 * sent until the confirm button, and the message posted is the list's own `send`
 * followed by the picked items' `send` strings joined with commas. That's why a
 * deferred item's `send` is a NOUN PHRASE ("Shopkeeper Miles", "Miles 2") while
 * a single-select one is a whole sentence ("Use the dawn reference") — the two
 * compose differently.
 *
 * `"one-per-group"` is the ANSWER-SEVERAL-QUESTIONS-AT-ONCE mode: items carrying
 * the same `group` form one sub-question, exactly one item in each can be
 * picked, and the confirm button stays disabled until EVERY group has an answer.
 * It exists because the alternative — one single-select card per sub-question —
 * cannot work: the first tap posts a message and ends the turn, stranding every
 * other question on a card that is now inert.
 */
const SELECT =
  "'one' (default) — a tap picks that item and sends immediately. 'many' — taps toggle and nothing is sent until the confirm button. 'one-per-group' — the items are split into sub-questions by their `group` prop, each group takes exactly ONE pick, and the confirm button unlocks only once every group is answered";
const LIST_SEND =
  "REQUIRED when select is 'many' or 'one-per-group': the lead of the composed message, to which the picked items' `send` values are appended after a colon — e.g. send \"Add these characters to the World\" + picks \"Miles\", \"Vera\" posts \"Add these characters to the World: Miles, Vera\". Ignored when select is 'one'";
const CONFIRM =
  "the confirm button's label when select is 'many' or 'one-per-group' (default \"Continue\"). Ignored when select is 'one'";
const GROUP =
  "ONLY for a list whose select is 'one-per-group': which sub-question this item answers, e.g. the character whose portrait this is (\"Miles Okonkwo\"). Items sharing a group are drawn together under it as a heading and are mutually exclusive. Groups appear in the order their first item does. Omit it in every other mode";

/** Compose the full Studio library from one design system's renderers. */
export function buildStudioLibrary(renderers: StudioRenderers): Library {
  // defineComponent ties the renderer's prop type to z.infer of the schema;
  // our contract interfaces are hand-written equivalents, so bridge the two.
  const r = <P,>(fn: Renderer<P>) => fn as unknown as ComponentRenderer<any>;

  // --- Text ----------------------------------------------------------------

  const Text = defineComponent({
    name: "Text",
    props: z.object({
      text: z.string(),
      style: z.enum(["body", "muted", "strong", "title"]).optional(),
    }),
    description:
      "A line or paragraph of prose. style: 'title' a small section heading · 'strong' emphasis · 'muted' a quiet aside · 'body' (default). Use ONE short Text to frame a decision — the chat message above already carries your explanation, so do not repeat it here.",
    component: r(renderers.Text),
  });

  const Callout = defineComponent({
    name: "Callout",
    props: z.object({
      variant: z.enum(["info", "success", "warning", "danger"]),
      title: z.string(),
      description: z.string().optional().nullable(),
    }),
    description:
      "A tinted banner for something the user must notice before choosing: a cost, an overwrite warning, a blocked prerequisite, a render that will take minutes. Use 'danger' only for destructive or irreversible consequences.",
    component: r(renderers.Callout),
  });

  // --- Options -------------------------------------------------------------

  const Option = defineComponent({
    name: "Option",
    props: z.object({
      title: z.string(),
      send: z.string(),
      subtitle: z.string().optional().nullable(),
      meta: z.string().optional().nullable(),
      image: z.string().optional().nullable(),
      badge: z.string().optional().nullable(),
      selected: z.boolean().optional(),
      tone: z.enum(["normal", "danger"]).optional(),
      group: z.string().optional().nullable(),
    }),
    description: `One choice in an OptionList, rendered as a tappable row. title: the choice. send: ${SEND}. subtitle: one line of why-you'd-pick-this. meta: a short right-aligned qualifier ("~40s", "12 credits", "shot03"). image: a thumbnail URL for the row's leading badge. badge: a tiny pill ("Recommended", "Current"). selected: marks the option already in force. tone 'danger' for a destructive choice. group: ${GROUP}.`,
    component: r(renderers.Option),
  });

  const OptionList = defineComponent({
    name: "OptionList",
    props: z.object({
      options: z.array(Option.ref),
      header: z.string().optional().nullable(),
      footnote: z.string().optional().nullable(),
      select: z.enum(["one", "many", "one-per-group"]).optional(),
      send: z.string().optional().nullable(),
      confirm: z.string().optional().nullable(),
    }),
    description: `THE default way to ask the author to choose — an inset card of Option rows separated by hairlines. Use it for 2–6 choices that need more than a bare label: models, durations, takes, drafts, characters to add, next steps. header: a small uppercase label above the card. footnote: one quiet line beneath it (e.g. 'Or just tell me what you want instead.'). select: ${SELECT}. Reach for 'many' whenever the author may legitimately want SEVERAL of the listed things (which speakers to add to the World, which takes to keep), and 'one-per-group' when you are asking the SAME question about several subjects at once (a voice per character, a length per scene). send: ${LIST_SEND}. confirm: ${CONFIRM}.`,
    component: r(renderers.OptionList),
  });

  // --- Media ---------------------------------------------------------------

  const MediaItem = defineComponent({
    name: "MediaItem",
    props: z.object({
      src: z.string(),
      send: z.string().optional().nullable(),
      label: z.string().optional().nullable(),
      caption: z.string().optional().nullable(),
      selected: z.boolean().optional(),
      group: z.string().optional().nullable(),
    }),
    description: `One image in a MediaGrid. src: the image URL (a /storyboard-media, /library or generation URL from the tools — never invent one). send: OPTIONAL — give it only when picking this image is a real decision; then it follows the usual rules (${SEND}; in a 'many' or 'one-per-group' grid a NOUN PHRASE instead, because the picks are joined into one sentence). OMIT send entirely when the card is just showing the author a picture you made — the tile is then look-only, with no "Use this" button under it. label: a short name under the thumbnail. caption: one extra line of context. selected: marks the current pick. group: ${GROUP}.`,
    component: r(renderers.MediaItem),
  });

  const MediaGrid = defineComponent({
    name: "MediaGrid",
    props: z.object({
      items: z.array(MediaItem.ref),
      header: z.string().optional().nullable(),
      columns: z.number().optional(),
      select: z.enum(["one", "many", "one-per-group"]).optional(),
      send: z.string().optional().nullable(),
      confirm: z.string().optional().nullable(),
    }),
    description: `A grid of image thumbnails. It does TWO jobs. (1) SHOWING finished pictures: the moment an image generation you started completes, draw this card with the result — that is how the author SEES it. Never answer an image job with prose alone ("it's on the Visual board", "saved to the library") and never paste the URL as markdown; the picture belongs in the chat, next to the words. Rows you are only showing get NO \`send\`, so there is no pick control under them. (2) ASKING which reference, still, take or character sheet to use — then each tile carries a \`send\`. Tapping a thumbnail always opens it FULL-SCREEN for a proper look; picking, when offered, is a separate explicit control so the author can inspect before committing. columns: 2 (default) or 3; use 3 only for six or more small thumbnails. A single image is fine — one tile, columns 2. select: ${SELECT}. Reach for 'many' when several images are legitimately wanted (a multi-reference generation), and 'one-per-group' for the very common CANDIDATES-PER-SUBJECT card: several portraits for each of several characters, several looks for each of several locations. One grid, one \`group\` per subject, one confirm. send: ${LIST_SEND}. confirm: ${CONFIRM}.`,
    component: r(renderers.MediaGrid),
  });

  // --- Audio ---------------------------------------------------------------

  const AudioItem = defineComponent({
    name: "AudioItem",
    props: z.object({
      src: z.string(),
      title: z.string(),
      send: z.string().optional().nullable(),
      subtitle: z.string().optional().nullable(),
      meta: z.string().optional().nullable(),
      badge: z.string().optional().nullable(),
      selected: z.boolean().optional(),
      group: z.string().optional().nullable(),
    }),
    description: `One playable clip in an AudioList, rendered as a row with an inline play button. src: the audio URL (a /sound-media or generation URL a tool returned — never invent one). title: what the clip is ("Take 2 — heavier rain"). send: OPTIONAL — give it only when picking this clip is a real decision; then it follows the usual rules (${SEND}; in a 'many' or 'one-per-group' list a NOUN PHRASE instead). Omit send entirely when the card is just for listening. subtitle: one line of context (what changed in this take). meta: a short right-aligned qualifier ("12s", "v3"). badge: a tiny pill ("Liked", "New"). selected: marks the take already in force. group: ${GROUP}.`,
    component: r(renderers.AudioItem),
  });

  const AudioList = defineComponent({
    name: "AudioList",
    props: z.object({
      items: z.array(AudioItem.ref),
      header: z.string().optional().nullable(),
      footnote: z.string().optional().nullable(),
      select: z.enum(["one", "many", "one-per-group"]).optional(),
      send: z.string().optional().nullable(),
      confirm: z.string().optional().nullable(),
    }),
    description: `A stack of playable audio rows — THE way to hand finished audio back to the author: a Seed Audio scene, radio takes, new sound versions. The author plays each clip right in the chat; NEVER paste an audio URL as a markdown link instead. Playing never sends anything — picking is a separate control that appears only on rows given a \`send\`, so a listen-only card is simply rows without one. select: ${SELECT}. Reach for 'many' when several takes can be kept, and 'one-per-group' to audition takes for several lines or characters in one card (group by the character or the line). send: ${LIST_SEND}. confirm: ${CONFIRM}.`,
    component: r(renderers.AudioList),
  });

  // --- Recommendation ------------------------------------------------------

  const Recommendation = defineComponent({
    name: "Recommendation",
    props: z.object({
      title: z.string(),
      body: z.string(),
      send: z.string(),
      cta: z.string().optional().nullable(),
      image: z.string().optional().nullable(),
      badge: z.string().optional().nullable(),
      meta: z.string().optional().nullable(),
      bullets: z.array(z.string()).optional(),
    }),
    description: `A single recommended course of action, presented as a hero card with one big call-to-action button. Use it when you have ONE thing to propose and want a clean yes — a render you're about to submit, a plan you'd run next, a draft you'd pin. title: the proposal. body: two sentences of why. send: ${SEND} (the go-ahead). cta: the button text ("Render it", "Do it") — default "Continue". bullets: up to 4 short supporting facts. image: a preview thumbnail. meta: cost/duration ("~90s · 12 credits").`,
    component: r(renderers.Recommendation),
  });

  // --- Comparison ----------------------------------------------------------

  const Column = defineComponent({
    name: "Column",
    props: z.object({
      label: z.string(),
      rows: z.array(detailRow),
      badge: z.string().optional().nullable(),
      send: z.string().optional().nullable(),
    }),
    description: `One side of a Compare. label: what this column is ("Seedance", "Veo 3.1"). rows: the same {label, value} keys IN THE SAME ORDER as every other column, so they line up. badge: a tiny pill ("Recommended"). send: ${SEND} — supply it to make the whole column pickable.`,
    component: r(renderers.Column),
  });

  const Compare = defineComponent({
    name: "Compare",
    props: z.object({
      columns: z.array(Column.ref),
      header: z.string().optional().nullable(),
    }),
    description:
      "Two or three options weighed side by side on identical rows — models, providers, takes, drafts. Use it only when the choice genuinely turns on comparing the SAME attributes; a plain OptionList reads better for everything else. Never more than 3 columns: the chat rail is narrow.",
    component: r(renderers.Compare),
  });

  // --- Detail & plan -------------------------------------------------------

  const KeyValue = defineComponent({
    name: "KeyValue",
    props: z.object({
      rows: z.array(detailRow),
      header: z.string().optional().nullable(),
    }),
    description:
      "A compact label/value detail block — the parameters of a render you're about to submit, a shot's settings, a cut's stats. Pair it with Actions to make a confirmation.",
    component: r(renderers.KeyValue),
  });

  const Steps = defineComponent({
    name: "Steps",
    props: z.object({
      steps: z.array(stepSpec),
      header: z.string().optional().nullable(),
      current: z.number().optional(),
    }),
    description:
      "An ordered plan, numbered, shown BEFORE you run a multi-step pipeline so the author can see what's coming. steps: {title, detail?, meta?}. current: index of the step in progress (0-based) — omit when nothing has started yet.",
    component: r(renderers.Steps),
  });

  const Chips = defineComponent({
    name: "Chips",
    props: z.object({ labels: z.array(z.string()) }),
    description:
      "A row of small follow-up pills. Tapping one sends its label verbatim as the user's next message, so write each as something the AUTHOR would say ('Show me the other takes'). Use for cheap side-quests offered alongside the main choice — never as the main choice itself.",
    component: r(renderers.Chips),
  });

  // --- Buttons -------------------------------------------------------------

  const Action = defineComponent({
    name: "Action",
    props: z.object({
      label: z.string(),
      send: z.string(),
      variant: z.enum(["primary", "secondary"]).optional(),
      tone: z.enum(["normal", "danger"]).optional(),
    }),
    description: `One button. label: the button text. send: ${SEND}. Exactly ONE action in a group should be 'primary'. tone 'danger' for destructive or irreversible choices (overwrite, delete, regenerate over existing work).`,
    component: r(renderers.Action),
  });

  const Actions = defineComponent({
    name: "Actions",
    props: z.object({
      actions: z.array(Action.ref),
      direction: z.enum(["row", "column"]).optional(),
    }),
    description:
      "A group of buttons — the plain yes/no/other choice. direction: 'row' (default) for two or three short labels, 'column' when the labels are sentences.",
    component: r(renderers.Actions),
  });

  // --- Containers ----------------------------------------------------------

  /** Everything that may appear inside a Section. */
  const blockRef = z.union([
    Text.ref,
    Callout.ref,
    OptionList.ref,
    MediaGrid.ref,
    AudioList.ref,
    Recommendation.ref,
    Compare.ref,
    KeyValue.ref,
    Steps.ref,
    Chips.ref,
    Actions.ref,
  ]);

  const Section = defineComponent({
    name: "Section",
    props: z.object({
      title: z.string(),
      children: z.array(blockRef),
      subtitle: z.string().optional().nullable(),
    }),
    description:
      "A titled group of blocks, separated from its neighbours by a rule. Only reach for it when one card genuinely carries two distinct groups (e.g. 'The references' and 'What I'd do'); a single-section card should skip it and put the blocks straight in the Card.",
    component: r(renderers.Section),
  });

  const Card = defineComponent({
    name: "Card",
    props: z.object({ children: z.array(z.union([blockRef, Section.ref])) }),
    description:
      "Root of every rendered UI — children stack vertically inside one card in the chat. Keep it to two or three blocks: this sits in a narrow chat rail, under a message that has already done the explaining.",
    component: r(renderers.Card),
  });

  return createLibrary({
    root: "Card",
    id: "shot-studio-chat",
    components: [
      Card,
      Section,
      Text,
      Callout,
      Option,
      OptionList,
      MediaItem,
      MediaGrid,
      AudioItem,
      AudioList,
      Recommendation,
      Column,
      Compare,
      KeyValue,
      Steps,
      Chips,
      Action,
      Actions,
    ],
    componentGroups: [
      {
        name: "Choosing",
        components: ["OptionList", "Option", "Actions", "Action", "Chips"],
        notes: [
          "OptionList is the DEFAULT decision surface — reach for it first whenever the author has to pick between things.",
          "Actions is for a plain go/no-go; Chips is for optional side-quests, never for the main decision.",
          "Every option's `send` is written in the AUTHOR's voice, because it is posted as their next message.",
          "NEVER put two single-select lists on one card. The first tap sends and ends the turn, so the second question dies unanswered — if the card asks more than one thing, it is ONE list with select 'one-per-group'.",
        ],
      },
      {
        name: "Picking media",
        components: ["MediaGrid", "MediaItem"],
        notes: [
          "Reference-image, still, take and character-sheet picks ALWAYS go through MediaGrid — never as markdown image links in your message text.",
          "Candidates for SEVERAL subjects (two portraits each for three characters) are ONE MediaGrid with select 'one-per-group' and a `group` per subject — never a grid per character, which would let only the first pick through.",
          "Only use URLs the tools gave you (list_library, get_visual_world, get_episode, …). Never invent or guess an image URL.",
        ],
      },
      {
        name: "Playing audio",
        components: ["AudioList", "AudioItem"],
        notes: [
          "Audio that just finished rendering (a Seed Audio scene, radio takes, sound versions) is handed back as an AudioList so the author can LISTEN in place — never as a markdown link to a /sound-media URL.",
          "A row is pickable only if you give it a `send` ('Keep take 2'); leave `send` off every row when there is nothing to decide.",
          "Only use audio URLs a tool actually returned (list_sounds, get_radio, attach_sound, …). A version whose status is still 'pending' has no URL yet — don't card it.",
        ],
      },
      {
        name: "Proposing",
        components: ["Recommendation", "Compare", "Column", "KeyValue", "Steps"],
        notes: [
          "Recommendation is for ONE proposal with a single big CTA; Compare is for weighing 2–3 options on identical rows.",
          "A Higgsfield/fal/Atlas submit confirmation reads best as KeyValue (the params) + Actions (go / change something).",
          "Show Steps before a long pipeline so the author sees the shape of what you're about to run.",
        ],
      },
      {
        name: "Framing",
        components: ["Card", "Section", "Text", "Callout"],
        notes: [
          "Card is the root and holds two or three blocks at most.",
          "Your chat message above the card does the explaining — the card is the decision, not a second copy of the prose.",
        ],
      },
    ],
  });
}
