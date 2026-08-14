import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

// The raw /api/episode payload runs ~400 KB (48 bundles, each carrying full
// per-shot Seedance prompts plus a ~5 KB composed skillPrompt). Returning that
// verbatim blows the Workers AI binding's request cap on the next model call
// (413 Payload Too Large), so this tool defaults to a compact overview and
// only returns full bundle detail when scoped to one bundle or one beat.

type Shot = {
  id?: string;
  src?: string;
  dur?: number;
  location?: string;
  characters?: string[];
  [k: string]: unknown;
};
type Bundle = {
  id?: string;
  title?: string;
  beat?: string;
  beatTitle?: string;
  group?: string;
  durationEst?: number;
  duration?: number;
  shots?: Shot[];
  images?: unknown[];
  missing?: string[];
  speakers?: string[];
  skillPrompt?: string;
  [k: string]: unknown;
};
type Take = { name?: string; selected?: boolean; [k: string]: unknown };
// One entry of the voice/sound reference pool (`/api/audio`), the same shape the
// Episode tab's audio rail works with. `refUrl` is the ungated absolute /files
// URL an anonymous fetcher (the render agent / Higgsfield import) can pull.
type AudioRef = {
  rel?: string;
  label?: string;
  order?: string[];
  character?: string;
  url?: string;
  refUrl?: string;
  source?: string;
  trackId?: string | null;
  v?: number | null;
  exists?: boolean;
};
type EpisodePayload = {
  episode: {
    title?: string;
    totalShots?: number;
    bundles?: Bundle[];
  } | null;
  video?: Record<string, Take[]>;
  prompts?: Record<string, string>;
  signoffs?: Record<
    string,
    Record<"images" | "prompt" | "audio", unknown>
  >;
  firstFrames?: Record<string, unknown>;
  // Episode-wide video reference (uploaded or a picked take) every bundle
  // inherits; `refVideos[id]` overrides or disables it per bundle.
  videoRef?: { url?: string; name?: string; source?: string; file?: string | null } | null;
  refVideos?: Record<string, unknown>;
  needs?: Record<string, unknown>;
  audio?: AudioRef[];
  audioPicks?: Record<string, string[]>;
};

// Per-bundle state folded in from the payload's top-level maps.
const bundleState = (data: EpisodePayload, id: string) => {
  const takes = data.video?.[id] ?? [];
  const signed = data.signoffs?.[id];
  return {
    videoTakes: takes.length,
    selectedTake: takes.find((t) => t?.selected)?.name ?? null,
    promptOverride: typeof data.prompts?.[id] === "string",
    signoff: signed
      ? {
          images: Boolean(signed.images),
          prompt: Boolean(signed.prompt),
          audio: Boolean(signed.audio),
        }
      : null,
    firstFrame: data.firstFrames?.[id] ?? null,
    refVideo: data.refVideos?.[id] ?? null,
  };
};

export const getEpisode = (api: Api) =>
  defineTool({
    name: "get_episode",
    description:
      "Get the episode plan: the multishot bundles (MS-01 …), their rendered video generations, per-bundle prompt overrides, and sign-off state. With no arguments returns a COMPACT overview of every bundle (no prompts). Pass `bundle` (e.g. \"MS-01\") or `beat` (e.g. \"B1\") to get full detail — per-shot summaries and Seedance prompts, the composed skillPrompt, prompt-override text, the bundle's attached VOICE / SOUND references (with their agent-fetchable `refUrl`), and video take URLs — for just that slice. Always scope when working on specific bundles.",
    input: v.object({
      bundle: v.optional(
        d(
          v.pipe(v.string(), v.minLength(1)),
          "Bundle id, e.g. MS-01. Returns full detail for this bundle only.",
        ),
      ),
      beat: v.optional(
        d(
          v.pipe(v.string(), v.minLength(1)),
          "Beat id, e.g. B1. Returns full detail for every bundle in this beat.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const data = (await api.get(
        "/api/episode",
        signal,
      )) as unknown as EpisodePayload;
      const manifest = data.episode;
      if (!manifest) return { output: { episode: null } };
      const bundles = manifest.bundles ?? [];
      // `videoRef` is the episode-wide reference each bundle inherits (pass its
      // `url` to Seedance as a video_references entry) unless the bundle's own
      // `refVideo` overrides it, or disables it (`{ disabled: true }`).
      const head = {
        title: manifest.title,
        totalShots: manifest.totalShots,
        videoRef: data.videoRef ?? null,
      };

      // Scoped: full detail for one bundle or one beat's bundles.
      if (input.bundle || input.beat) {
        const wantB = input.bundle
          ? String(input.bundle).trim().toUpperCase()
          : undefined;
        const wantBeat = input.beat
          ? String(input.beat).trim().toUpperCase()
          : undefined;
        const hits = bundles.filter((b) =>
          wantB
            ? String(b.id).toUpperCase() === wantB
            : String(b.beat).toUpperCase() === wantBeat,
        );
        if (!hits.length) {
          return {
            output: {
              error: `No bundle matched ${wantB ? `bundle "${wantB}"` : `beat "${wantBeat}"`}.`,
              bundles: bundles.map((b) => ({ id: b.id, beat: b.beat })),
            } as Json,
          };
        }
        return {
          output: {
            ...head,
            bundles: hits.map((b) => ({
              ...b,
              ...bundleState(data, String(b.id)),
              promptOverride: data.prompts?.[String(b.id)] ?? null,
              video: data.video?.[String(b.id)] ?? [],
              sceneNeeds: data.needs?.[String(b.id)] ?? null,
              // The voices attached to this bundle, resolved from the pool —
              // pass their `refUrl` to the render (black-MP4 voice path).
              audioRefs: (data.audioPicks?.[String(b.id)] ?? [])
                .map((rel) => data.audio?.find((a) => a.rel === rel))
                .filter((a): a is AudioRef => Boolean(a)) as Json,
            })),
          } as Json,
        };
      }

      // Unscoped: compact overview — drop skillPrompt and the per-shot prompt/
      // summary/camera/dialogue text, keep everything needed to pick a slice.
      return {
        output: {
          ...head,
          bundleCount: bundles.length,
          bundles: bundles.map((b) => ({
            id: b.id,
            title: b.title,
            beat: b.beat,
            beatTitle: b.beatTitle,
            group: b.group,
            durationEst: b.durationEst,
            shots: (b.shots ?? []).map((s) => ({
              id: s.id,
              src: s.src,
              dur: s.dur,
              location: s.location,
              characters: s.characters,
            })),
            refs: b.images ?? [],
            missing: b.missing ?? [],
            speakers: b.speakers ?? [],
            sceneNeeds: data.needs?.[String(b.id)] ?? null,
            ...bundleState(data, String(b.id)),
          })),
          note: "Compact overview. Call get_episode with { bundle } or { beat } for shot summaries, prompts, skillPrompt and video take URLs.",
        } as Json,
      };
    },
  });
