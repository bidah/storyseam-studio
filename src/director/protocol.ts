import type { Recipe } from '@/lib/series';

// The Director's control protocol: JSON both ways on the data channel named
// `control`, alongside the video and audio tracks.
//
// Typed here rather than taken from `@fal-ai/client`, because the client
// deliberately does not know it — the WMA transport carries opaque strings and
// says so ("the extension delivers; the application parses and validates").
// This module is that application half, and it is pure: no fal import, no
// WebRTC, so the state machine can be tested against a script of messages.

/**
 * What we send.
 *
 * Every one of these is validated server-side against a closed schema —
 * "additional properties: not allowed" — and a message that fails it comes back
 * as `error` with code `invalid_message` and TAKES THE SESSION WITH IT. So the
 * extra keys are not harmless, and only `configure` accepts
 * `protocol_version`; on `prompt`, `stop` and `ping` it is the thing that gets
 * the session killed. `ping` additionally requires `ts`.
 */
export type OutboundMessage =
  | Recipe
  | {
      type: 'prompt';
      prompt_version: number;
      prompt: string;
      end_image_url?: string | null;
      audio_url?: string | null;
      audio_behavior?: 'replace' | 'queue';
      replan?: boolean;
    }
  // A later REEL. Same wire type as the message above and almost disjoint from
  // it: `script` is exclusive with `prompt`, `end_image_url` and `audio_url`,
  // and those must be ABSENT rather than null. Typed in `schema.ts` beside the
  // cue sheet it is cut from, and named here so the transport will carry it.
  | {
      type: 'prompt';
      prompt_version: number;
      script: {
        offset: number;
        prompt: string | null;
        end_image_url: string | null;
        audio_url: string | null;
      }[];
      script_mode: 'append' | 'replace';
    }
  | { type: 'stop' }
  | { type: 'ping'; ts: number };

/** What arrives. Unknown types are ignored rather than treated as failures. */
export type InboundMessage =
  | { type: 'session_info'; [k: string]: unknown }
  | { type: 'configured'; [k: string]: unknown }
  | { type: 'chunk'; index?: number; [k: string]: unknown }
  | { type: 'deadline_missed'; [k: string]: unknown }
  | { type: 'prompt_applied'; prompt_version?: number; [k: string]: unknown }
  | { type: 'prompt_rejected'; prompt_version?: number; reason?: string; [k: string]: unknown }
  // The soundtrack's own four. None of them ends a sitting: audio is target
  // audio, so a refusal changes what film gets GENERATED rather than whether
  // any does, and the stream carries on either way.
  | { type: 'audio_pending'; [k: string]: unknown }
  | { type: 'audio_applied'; [k: string]: unknown }
  | { type: 'audio_exhausted'; [k: string]: unknown }
  | {
      type: 'audio_rejected';
      /** `invalid_audio`, `content_policy`, `preparation_failed`, `queue_full`, `stale_prompt_version`. */
      reason?: string;
      [k: string]: unknown;
    }
  | { type: 'stream_exhausted'; reason?: string; [k: string]: unknown }
  // THE TEXT IS IN `error`, NOT IN `message`.
  //
  // The endpoint's error message is `{ type, error, code, detail? }` — `error`
  // is the required sentence and there is no `message` key at all. This was
  // typed as `message` and read as `message`, so every refusal the Director
  // ever gave — including a `configure` rejected against its own schema, which
  // says in full prose which rule was broken — arrived, was thrown away, and
  // came out as "The stream stopped unexpectedly. Try again."
  //
  // `detail` is pydantic's own list of failed validators, which names the field
  // when the prose does not.
  | {
      type: 'error';
      code?: string;
      error?: string;
      detail?: unknown;
      [k: string]: unknown;
    }
  | { type: string; [k: string]: unknown };

export function parseInbound(raw: string): InboundMessage | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    const message = value as InboundMessage;
    return typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}

/**
 * What a viewer is told when a session fails.
 *
 * The distinction that matters to somebody looking at a black screen is
 * whether trying again is worth it, so every line here answers that. The codes
 * are the endpoint's; anything not listed falls through to a sentence that
 * admits we do not know, which is better than inventing a reason.
 *
 * Every key below is now one the endpoint actually sends. Half of them were
 * not: `image_unavailable`, `audio_unavailable`, `timeout`, `capacity` and
 * `internal_error` were plausible names for codes that do not exist, so the
 * table looked complete while matching almost nothing that ever arrived. The
 * list the endpoint publishes is the list here, and the ones a viewer cannot
 * act on are grouped rather than each given a shade of the same apology.
 */
const MESSAGES: Record<string, string> = {
  balance_unavailable: 'This film is out of budget right now. Try again later.',
  content_policy: 'The Director would not film this one.',
  // The three refusals that mean the Series itself is wrong. Retrying changes
  // nothing — the cue sheet does — so none of them says "try again".
  invalid_message: 'This series is misconfigured — it cannot start.',
  invalid_input: 'This series is misconfigured — it cannot start.',
  invalid_initial_script: 'This cue sheet was refused — it cannot start.',
  invalid_initial_image: 'The opening frame was refused.',
  invalid_initial_audio: 'The soundtrack was refused.',
  immutable_settings: 'This series is misconfigured — it cannot start.',
  // The four that are the Director's own bad day.
  configuration_timeout: 'The Director took too long to answer. Try again.',
  initialization_timeout: 'The Director took too long to start. Try again.',
  generation_timeout: 'The Director took too long to answer. Try again.',
  generation_failed: 'Something went wrong on the Director’s side. Try again.',
  not_configured: 'Something went wrong on the Director’s side. Try again.',
  stale_prompt_version: 'That direction arrived too late to use.',
  session_limit: 'That is as long as one sitting runs.',
};

export function describeError(code: string | undefined, fallback?: string): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  return fallback || 'The stream stopped unexpectedly. Try again.';
}

/**
 * What the endpoint actually said, for whoever can act on it.
 *
 * Never a viewer's sentence — a rejected `configure` comes back as a pydantic
 * dump naming a validator — which is exactly why it belongs in `detail` rather
 * than being handed to `describeError` as a fallback. It is the difference
 * between "the stream stopped unexpectedly" and being told which rule the cue
 * sheet broke, and it costs a sitting to find out any other way.
 */
export function errorDetail(message: { [k: string]: unknown }): string | undefined {
  const said = typeof message.error === 'string' ? message.error.trim() : '';
  const code = typeof message.code === 'string' ? message.code : '';
  // Kept because the prose names the union, and this names the field.
  const detail = message.detail == null ? '' : JSON.stringify(message.detail);
  const parts = [code, said, detail].filter(Boolean);
  return parts.length ? parts.join(' — ') : undefined;
}

/**
 * Why a stream ended on its own.
 *
 * `stream_exhausted` is not a failure — the Director reached the end of what it
 * was asked for, or the session hit its cap — so it reads as an ending rather
 * than an error, and the page offers Play again rather than an apology.
 */
export function describeEnding(reason: string | undefined): string {
  if (reason === 'session_limit') return 'That is as long as one sitting runs.';
  return 'That is the end of this stretch.';
}

/**
 * Why the Director would not take the soundtrack.
 *
 * Worth its own table rather than folding into `describeError`, because none of
 * these ends anything: the sitting runs on and the reader's question is not
 * "should I retry" but "is the film I am watching the one I asked for". They
 * are written for whoever is directing, not for a viewer — a refusal is
 * invisible on screen and this is the only place it gets said.
 */
const AUDIO_REFUSALS: Record<string, string> = {
  invalid_audio: 'the file could not be read as audio — check what the url actually serves',
  content_policy: 'the Director would not use this audio',
  preparation_failed: 'the audio could not be prepared in time',
  queue_full: 'too much audio was queued at once',
  stale_prompt_version: 'the audio arrived against a superseded prompt version',
};

export function describeAudioRefusal(reason: string | undefined): string {
  if (reason && AUDIO_REFUSALS[reason]) return AUDIO_REFUSALS[reason];
  return reason ? `the Director refused it (${reason})` : 'the Director refused it';
}
