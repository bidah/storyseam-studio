import {
  describeEnding,
  describeError,
  errorDetail,
  parseInbound,
  type OutboundMessage,
} from './protocol';
import {
  REEL_CHANGE_ALLOWANCE_SECONDS,
  SCRIPT_TAIL_SECONDS,
  type AppendedReel,
  type Recipe,
  type Screening,
} from '@/lib/series';

// A DIRECTOR SESSION: one open WebRTC session with fal, for one Series, on one
// device — opened only by a play button, closed by pause, swipe, background,
// error, or the cap.
//
// This module is the sequence and nothing else. No React, no WebRTC, no fal
// import: it drives a TRANSPORT it is handed, so the whole of it can be tested
// against a scripted fake, and the feed page (card 06) can ask five questions —
// what state, what stream, what error, how long, and how do I stop — instead of
// knowing about ICE, SDP, data channels and a dozen error codes.
//
// The one thing the page must never have to remember is that a session costs
// money from its first second. That is why `stop()` is idempotent, why close
// always sends `stop` before tearing down the peer connection, and why opening
// a second session anywhere in the app closes the first.

export type SessionState =
  /** Nothing open. */
  | 'idle'
  /** The peer connection is being negotiated. */
  | 'opening'
  /** Connected; `configure` is sent and we are waiting for `configured`. */
  | 'configuring'
  /** Frames are arriving but none has been painted yet. */
  | 'buffering'
  /** Playing. */
  | 'live'
  /** `stop` sent, tearing down. */
  | 'closing'
  /** Over, on purpose or because the Director ran out. */
  | 'ended'
  /** Over, badly. `error` holds what to tell the viewer. */
  | 'failed';

export type TransportEvent =
  /** The kernel's own lifecycle, as `@fal-ai/client` reports it. */
  | { type: 'state'; state: 'opening' | 'live' | 'failed' | 'closed' }
  /** One control message, unparsed. */
  | { type: 'data'; raw: string }
  /** The remote media stream, once. */
  | { type: 'media'; stream: unknown }
  /** A frame actually reached the screen. */
  | { type: 'frame' }
  /**
   * What the transport OBSERVED, in its own vocabulary — the fal client's
   * `RealtimeDiagnostic`, translated by the transport into the one thing the
   * machine cares about: a failure it can quote.
   *
   * This channel exists because the alternative is what shipped first: the
   * proxy answering 500 with `the thin API has no FAL_KEY`, and the viewer
   * being told "the stream stopped unexpectedly". The message a viewer reads
   * stays a plain sentence — a raw diagnostic sends whoever reads it into the
   * network after the wrong thing — but it is kept beside that sentence and
   * shown wherever the reader is a developer.
   */
  | { type: 'diagnostic'; failure: string; observed?: Record<string, string | number> }
  | { type: 'error'; error: unknown };

export interface Transport {
  send(message: OutboundMessage): void;
  close(): void | Promise<void>;
}

export type TransportFactory = (emit: (event: TransportEvent) => void) => Transport;

export type Snapshot = {
  state: SessionState;
  /** What to tell the viewer. Set on `failed`, and on a clean `ended`. */
  message: string | null;
  /**
   * What actually happened, for whoever can act on it. Never shown to a viewer
   * — the feed prints it only under `__DEV__`, Admin's preview always — and
   * always logged, because a session that failed at 3am is otherwise a shrug.
   */
  detail: string | null;
  /** True between a `deadline_missed` and the next chunk: the picture is held. */
  holding: boolean;
  stream: unknown | null;
  /** Monotonic, owned by the session; card 07's Directions increment it. */
  promptVersion: number;
  /** When `open()` was called. Wall clock, and used only to time the backstop. */
  startedAt: number | null;
  /**
   * Seconds of FILM generated so far — the script's own clock.
   *
   * This is what the badge counts and what the ceiling is measured against.
   * It advances only when a chunk arrives, so it stands still through
   * negotiation and through every `deadline_missed`, which is precisely the
   * behaviour that makes it comparable to a beat's `offset`.
   */
  videoSeconds: number;
  /** Film this sitting is generating toward, once `open()` has read the script. */
  videoTarget: number | null;
  /**
   * What became of the soundtrack.
   *
   * A Recipe's audio is not decoration the endpoint plays over the picture: it
   * is FL2VA TARGET AUDIO, so every chunk is conditioned on the next window of
   * it and the source PCM itself is what comes back. That makes "did the audio
   * arrive" a question about the FILM, not about the sound — an audio-led
   * sitting whose audio was refused is a different film, generated from the
   * prompts alone.
   *
   * It has to be reported because the two are indistinguishable on screen. A
   * refused soundtrack produces a silent sitting that runs its full length and
   * looks exactly like a successful one, so without this a test of whether the
   * Director honours the audio cannot be told from a test of whether it ignores
   * it. `carriesAudio()` decides between `none` and `waiting` at `open()`;
   * everything after is the endpoint's own word.
   */
  audio: AudioState;
  /**
   * The endpoint's reason when the audio was refused, or the detail worth
   * keeping when it ran out. `null` while nothing has been said.
   */
  audioDetail: string | null;
  /**
   * How long the RUNNER will keep this session, from its own `session_info`.
   *
   * Not our cap and not our backstop — theirs, and the only one that can end a
   * sitting without warning us first. `null` until `session_info` arrives, and
   * `null` after it if the endpoint declares no limit.
   */
  sessionCeiling: number | null;
  /** `configured` or `effective`: what that ceiling counts. */
  sessionLimitScope: string | null;
  /**
   * Which REEL is generating, as the endpoint reports it on each chunk, and the
   * film second the last reel change landed on.
   *
   * `reel` is 1 for every Series that was never cut, which is most of them.
   * `reelChangeAt` stays null until a seam actually happens — and when it does,
   * the distance between it and the offset the Series asked for is the whole
   * measurable cost of cutting a cue sheet into reels.
   */
  reel: number;
  reelChangeAt: number | null;
};

/**
 * The life of a sitting's soundtrack.
 *
 * `none` — this Recipe asked for no audio.
 * `waiting` — audio was sent and the endpoint has not ruled on it yet.
 * `playing` — accepted; it is conditioning chunks (`audio_applied`).
 * `exhausted` — it ran out mid-sitting; the rest is silence and unconditioned
 *   film (`audio_exhausted`). Not a failure: a 68-second track under a
 *   70-second script ends this way by arithmetic.
 * `refused` — the endpoint would not take it (`audio_rejected`). The sitting
 *   continues WITHOUT it, which is the case worth shouting about.
 */
export type AudioState = 'none' | 'waiting' | 'playing' | 'exhausted' | 'refused';

/**
 * Whether a Recipe is asking for any audio at all.
 *
 * Both places it can live, because they are mutually exclusive and which one is
 * used depends on whether the Series has a cue sheet: `recipe()` moves a
 * Series' `audioUrl` to null the moment a script exists, since the endpoint
 * refuses the two together and says "place them in the script".
 */
export function carriesAudio(recipe: Recipe): boolean {
  if (recipe.audio_url) return true;
  return (recipe.script ?? []).some((beat) => Boolean(beat.audio_url));
}

/** The same question of a later reel, which has only ever one place to keep it. */
export function reelCarriesAudio(reel: AppendedReel): boolean {
  return reel.script.some((beat) => Boolean(beat.audio_url));
}

/**
 * The authored length of a Recipe that arrived without its Screening.
 *
 * `screening()` states this properly, from the whole cue sheet. This is the
 * fallback for the surfaces that still hand over a bare Recipe, where the first
 * reel IS the whole film because nothing cut it.
 */
function filmSecondsOf(recipe: Recipe): number {
  const last = recipe.script?.at(-1);
  return (last?.offset ?? 0) + (last?.prompt ? SCRIPT_TAIL_SECONDS : 0);
}

export type SessionOptions = {
  transport: TransportFactory;
  now?: () => number;
  /**
   * How long to wait for a painted frame after the first chunk before showing
   * the picture anyway.
   *
   * There is no reliable "first frame" signal on this platform — react-native-
   * webrtc's `RTCView` has no `onDimensionsChange`, so the transport reports a
   * frame from the video track's `unmute` and this deadline is what stands
   * behind it. Waiting forever on a signal that may not come would leave a
   * viewer staring at a poster over a stream that is already playing.
   */
  firstFrameDeadlineMs?: number;
  /**
   * The film a sitting is paid for whether or not it collects it.
   *
   * The endpoint bills PER SECOND OF VIDEO GENERATED, with a minimum of sixty
   * seconds. The unit is film, not wall time: a sitting that generates ten
   * seconds and one that generates sixty cost exactly the same, and stopping
   * before sixty leaves paid-for film ungenerated.
   *
   * The ceiling this feeds is the larger of it and the script's last beat, so
   * an authored piece always runs to its own ending and never stops short of
   * what it cost.
   */
  minVideoSeconds?: number;
  /**
   * Where the control-event trace goes, if anywhere.
   *
   * Absent means no tracing, which is the default and what production gets.
   * The app passes `console.log` in a development build.
   */
  onTrace?: (line: string) => void;
  /**
   * Wall-clock backstop, for a sitting whose film clock stopped advancing.
   *
   * Not a ceiling, and deliberately far looser than one. Generation runs slower
   * than realtime — sixty seconds of film has been observed to take upward of
   * two minutes — so any wall-clock value tight enough to act as a ceiling ends
   * sittings in the middle of their own script, which is the bug this replaced.
   * What it still catches is a session that has stopped producing film
   * altogether and would otherwise sit open forever.
   *
   * The server cap (`session-cap.ts`) backs this in turn, and must stay looser
   * again: it refuses heartbeats rather than closing anything, and the client
   * gives up after three refused beats.
   */
  maxWallSeconds?: number;
  timer?: (fn: () => void, ms: number) => () => void;
  /** Told about every inbound message, including `chunk`. */
  onEvent?: (event: { type: string; [k: string]: unknown }) => void;
};

export interface DirectorSession {
  readonly snapshot: Snapshot;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  /**
   * Start. The cue sheet is INSIDE what is passed — `configure.script` for the
   * first reel, one appended `script` per reel after it — so there is still
   * nothing for this module to schedule: the Director plans every beat itself,
   * on the video's own clock, and even a reel change is its decision rather
   * than a timer of ours.
   *
   * A bare Recipe is a one-reel Screening and is accepted as one.
   */
  open(showing: Screening | Recipe): void;
  stop(): Promise<void>;
  /**
   * Improvisation: steer a stream that is already running.
   *
   * The endpoint's other path, and not how an authored Series is shot — those
   * beats are planned in `configure.script` before a frame exists. This is for
   * changing your mind mid-run, when the alien attack comes out wrong. Nothing
   * in the feed calls it, and that is the point.
   */
  direct(
    prompt: string,
    extras?: { endImageUrl?: string | null; audioUrl?: string | null; audioBehavior?: 'replace' | 'queue' },
  ): void;
}

const IDLE: Snapshot = {
  state: 'idle',
  message: null,
  detail: null,
  holding: false,
  stream: null,
  promptVersion: 1,
  startedAt: null,
  videoSeconds: 0,
  videoTarget: null,
  audio: 'none',
  audioDetail: null,
  sessionCeiling: null,
  sessionLimitScope: null,
  reel: 1,
  reelChangeAt: null,
};

/** Once a session is here, nothing it hears can move it again. */
const TERMINAL = new Set<SessionState>(['ended', 'failed']);

/**
 * One minute OF FILM, because one minute of film is what a sitting costs
 * whatever it collects.
 *
 * `minimax/h3-max/director` bills per second of video GENERATED, with a
 * sixty-second minimum. Below sixty seconds of film the money is spent anyway;
 * above it, every second is charged again — $0.08 since 2026-09-14, which puts
 * the minimum sitting at $4.80. So the floor under the ceiling is the minimum:
 * the most film that costs the least.
 */
export const DEFAULT_MIN_VIDEO_SECONDS = 60;

/**
 * Four minutes of wall clock, which is not a ceiling and should never act as
 * one.
 *
 * Sixty seconds of film has taken between two and seven minutes to generate in
 * practice, and resolution moves that more than anything else does. This value
 * only has to be past the slowest sitting worth waiting for; the film clock is
 * what actually ends a sitting.
 */
export const DEFAULT_MAX_WALL_SECONDS = 240;

/**
 * The endpoint's media contract pins the video track at 24 fps, which is what
 * makes a chunk's `generated_frame_count` convertible to seconds of film.
 */
const FRAME_RATE = 24;

/**
 * How much film one `chunk` carries.
 *
 * `generated_frame_count` is the honest number — it counts frames that exist,
 * in this chunk, and the contract fixes the rate. `requested_duration_seconds`
 * is what was ASKED for and stands in only when the frame count is missing; a
 * chunk that carries neither is not counted at all, because guessing here
 * either truncates the piece or pays for film twice.
 */
/**
 * A little past the picture's own arrival at the target, because the last
 * frames still have to decode and present after the playback clock says so.
 */
const PRESENTATION_GRACE_SECONDS = 2;

/**
 * The longest the picture is waited for. The runner has not been seen more
 * than about two chunks ahead of what is playing (a chunk is at most 15s), so
 * this is slack rather than a budget — it exists because the runner keeps
 * generating, and billing, for as long as `stop` is withheld, and a wait with
 * no bound is how a sitting bills forever.
 */
const MAX_PRESENTATION_WAIT_SECONDS = 45;

/** Where the runner's own playback clock stood when this chunk was announced. */
function playbackSeconds(message: { [k: string]: unknown }): number | null {
  const seconds = message.playback_seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function chunkVideoSeconds(message: { [k: string]: unknown }): number | null {
  const frames = message.generated_frame_count;
  if (typeof frames === 'number' && Number.isFinite(frames) && frames > 0) {
    return frames / FRAME_RATE;
  }
  const requested = message.requested_duration_seconds;
  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
    return requested;
  }
  return null;
}


/**
 * The film this recipe is trying to make.
 *
 * The last beat's offset is the floor, the billing minimum is the other floor,
 * and whether the last beat needs TIME AFTER IT depends on what it carries:
 *
 * - A beat that is only an end image is a PIN. "The exact final frame of the
 *   chunk that ends at this offset" — so the film ends there, at that frame,
 *   which is the whole point of writing it.
 * - A beat with a PROMPT is a direction that "starts at this offset and
 *   persists until the next text beat". A direction on the last beat with the
 *   film ending at the same second is a direction with nowhere to happen: it
 *   would be sent, planned against, and never filmed. It gets a chunk.
 *
 * The distinction is not cosmetic. Mecha Launch pins its final frame at 60s
 * with no prompt, and stopping at 60 is correct for it. Give that same beat a
 * prompt — the mecha's thrusters firing after the fist is already up — and 60
 * becomes the second the film must run PAST, not stop on.
 *
 * This is the length of a SILENT Series. When the Recipe carries audio the
 * soundtrack outranks it: the film is being generated AGAINST that audio, so
 * `audio_exhausted` ends the sitting wherever it lands and this target is only
 * the backstop for a piece whose audio outlasts its script.
 */
function videoTargetFor(screening: Screening, minimum: number): number {
  // The AUTHORED length, plus room for every seam.
  //
  // Reading it off `configure.script` was right while a cue sheet was one
  // script; after a reel change that script holds only the first reel, and a
  // 180-second film would be targeted at 92 and cut off at the reel change.
  // `filmSeconds` is the whole sheet, and each cut is allowed a chunk of slip
  // because an appended reel starts on the chunk grid rather than on its
  // authored second — film nobody wrote, generated and billed like any other.
  const slip = screening.reels.length * REEL_CHANGE_ALLOWANCE_SECONDS;
  return Math.max(minimum, screening.filmSeconds + slip);
}

const defaultTimer = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/**
 * The one session this device has open.
 *
 * Module-level, because "at most one" is a property of the DEVICE and not of
 * any component: a fast scroll mounts and unmounts pages faster than a peer
 * connection negotiates, and three sessions billing at once is the failure this
 * prevents. A second open closes the first and says so — that is a caller bug,
 * not a feature, and it should be visible in the log rather than on the bill.
 */
let current: DirectorSession | null = null;

export function createDirectorSession(options: SessionOptions): DirectorSession {
  const now = options.now ?? Date.now;
  const timer = options.timer ?? defaultTimer;
  const deadlineMs = options.firstFrameDeadlineMs ?? 2500;
  const minVideoSeconds = options.minVideoSeconds ?? DEFAULT_MIN_VIDEO_SECONDS;
  const backstopMs = (options.maxWallSeconds ?? DEFAULT_MAX_WALL_SECONDS) * 1000;

  let snapshot: Snapshot = IDLE;
  const listeners = new Set<(s: Snapshot) => void>();
  let transport: Transport | null = null;
  let cancelDeadline: (() => void) | null = null;
  let cancelBackstop: (() => void) | null = null;
  let cancelDrain: (() => void) | null = null;
  /** True once the target is reached and the buffer is being let out. */
  let draining = false;
  /**
   * The Recipe this sitting was opened with, and how far ahead the runner was
   * as of the last chunk.
   *
   * Both exist for the audio-led ending: `audio_exhausted` carries no buffer
   * depth of its own, and whether the audio leads is a property of the Recipe
   * rather than of the message.
   */
  let openRecipe: Recipe | null = null;
  /**
   * The later reels this sitting still has to send, and which one is running.
   *
   * `pendingReels` is drained on `configured` — an append queues, so there is
   * nothing to gain by dribbling them out and a reel sent late is a reel that
   * can miss its boundary. `runningReel` is the endpoint's own word for which
   * script a chunk came from (`chunk.script_version`), which is the only way to
   * know a reel change has actually happened: we asked for one, the endpoint
   * decided when.
   */
  let pendingReels: AppendedReel[] = [];
  let lastReelVersion = 1;
  let runningReel = 1;
  /** Wall time of the first frame: playout runs in real time from here. */
  let firstFrameAt: number | null = null;
  /** The runner's playback clock as last announced, and when. */
  let lastPlayback: { at: number; seconds: number } | null = null;

  /** The last failure the transport reported, kept for `fail()` to quote. */
  let observed: string | null = null;

  function set(patch: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  }

  function clearDeadline() {
    cancelDeadline?.();
    cancelDeadline = null;
  }

  function clearBackstop() {
    cancelBackstop?.();
    cancelBackstop = null;
  }

  function clearDrain() {
    cancelDrain?.();
    cancelDrain = null;
  }

  /** Tear down the transport without moving the state — the caller owns that. */
  function release() {
    clearDeadline();
    clearBackstop();
    clearDrain();
    draining = false;
    openRecipe = null;
    const t = transport;
    transport = null;
    if (current === session) current = null;
    if (!t) return;
    // `stop` FIRST, then the connection. A peer connection dropped without it
    // leaves the runner waiting out its own timeout, and that wait is billed.
    try {
      t.send({ type: 'stop' });
    } catch {
      /* the channel may already be gone; closing is what matters */
    }
    void Promise.resolve(t.close()).catch(() => {});
  }

  function fail(message: string, detail?: string) {
    if (TERMINAL.has(snapshot.state)) return;
    release();
    const because = detail ?? observed;
    // Always logged, whatever the surface decides to render: the whole point of
    // keeping this is that it is available when something goes wrong.
    if (because) console.warn(`[director] session failed — ${because}`);
    set({ state: 'failed', message, detail: because, holding: false, stream: null });
  }

  function end(message: string | null) {
    if (TERMINAL.has(snapshot.state)) return;
    release();
    set({ state: 'ended', message, detail: null, holding: false, stream: null });
  }

  /**
   * The connection giving out AFTER `stop` was sent, which is the ending, not a
   * failure.
   *
   * Once `finish()` has sent `stop`, the runner tearing the peer connection
   * down is the expected next thing to happen — and it surfaces as
   * `state: 'failed'` or an `error` from the transport, both of which used to
   * go straight to `fail()`. So a sitting that ran its whole script, generated
   * every second it was billed for and wound down exactly as designed ended on
   * "COULDN'T PLAY — the stream stopped unexpectedly", and (before the recorder
   * was fixed) had its film discarded on the strength of it.
   *
   * `closed` was already handled this way. These two are the same event wearing
   * different clothes, and the only thing that separates a teardown from a real
   * drop is whether we asked for it — which is what `draining` records.
   */
  /**
   * One line per control event, with the two clocks beside it.
   *
   * Sittings keep dying with the peer connection reporting `failed` and nothing
   * else: no `stream_exhausted`, no `error` message, no diagnostic, no refused
   * heartbeat. The endpoint's contract says a session ends with
   * `stream_exhausted` (`stopped` or `session_limit`) or an `error` — so
   * whatever is happening is not the endpoint ending the session, and guessing
   * at it from film lengths has already cost more than measuring it will.
   *
   * Both clocks, because the whole question is which one the death is on: film
   * seconds come from `generated_frame_count`, wall seconds from `open()`. A
   * fixed wall time points at the transport or a lease; a fixed film length
   * points at the script or the runner.
   *
   * Injected rather than reaching for `__DEV__`, for the same reason the clock
   * and the timer are: this module is platform-free, and a React Native global
   * in it would stop it being testable in node — which is exactly how the first
   * version of this announced itself.
   */
  function trace(event: TransportEvent) {
    const write = options.onTrace;
    if (!write) return;
    const wall = snapshot.startedAt === null ? 0 : (now() - snapshot.startedAt) / 1000;
    const where = `${wall.toFixed(1)}s wall / ${snapshot.videoSeconds.toFixed(1)}s film`;
    if (event.type === 'data') {
      const message = parseInbound(event.raw);
      if (!message) return;
      // Everything except the shape of a chunk, which is the noisy one and is
      // already summarised by the film clock.
      const extra =
        message.type === 'chunk'
          ? `frames=${message.generated_frame_count ?? '?'} trimmed=${message.trimmed_context_frames ?? '?'}` +
            ` playback=${message.playback_seconds ?? '?'} buffer=${message.buffer_depth_seconds ?? '?'}` +
            ` script_offset=${message.script_offset_seconds ?? '?'} end_keyframe=${message.script_end_keyframe ?? '?'}`
          : // An error goes out whole. The 220 characters that keep the rest of
            // the trace readable cut a rejected `configure` off mid-way through
            // pydantic's list of union members — before it reaches the line
            // that says which rule was broken, which is the only line worth
            // having. A trace that truncates the answer is a trace that sends
            // you back to pay for another sitting.
            message.type === 'error'
            ? JSON.stringify(message)
            : JSON.stringify(message).slice(0, 220);
      write(`${where} ← ${message.type} ${extra}`);
      return;
    }
    const detail =
      event.type === 'state'
        ? event.state
        : event.type === 'error'
          ? String(event.error instanceof Error ? event.error.message : event.error).slice(0, 180)
          : event.type === 'diagnostic'
            ? `${event.failure} ${JSON.stringify(event.observed ?? {})}`.slice(0, 220)
            : '';
    write(`${where} ← ${event.type} ${detail}`);
  }

  function endOfDrain(detail?: string) {
    if (detail) console.log(`[director] the connection ended during the drain — ${detail}`);
    end(describeEnding('session_limit'));
  }

  function onChunk(message: { [k: string]: unknown }) {
    if (TERMINAL.has(snapshot.state)) return;
    // THE REEL CHANGE, as it actually happened rather than as it was asked for.
    //
    // We name the second a reel should open on; the endpoint starts it at the
    // chunk boundary after the previous reel's last text beat is represented
    // and its audio has finished. The difference is the seam's slip, and this
    // is the only place it can be measured — so it is measured, not assumed.
    const version = Number(message.script_version);
    if (Number.isFinite(version) && version > 0 && version !== runningReel) {
      const from = runningReel;
      runningReel = version;
      set({ reel: version, reelChangeAt: snapshot.videoSeconds });
      console.log(
        `[director] reel change: ${from} -> ${version} at ` +
          `${snapshot.videoSeconds.toFixed(1)}s of film`,
      );
      options.onEvent?.({ type: 'reel_change', reel: version, at: snapshot.videoSeconds });
    }
    // Any chunk clears a hold: whatever was late has arrived.
    if (snapshot.holding) set({ holding: false });
    const first = snapshot.state !== 'buffering' && snapshot.state !== 'live';
    if (first) {
      set({ state: 'buffering' });
      clearDeadline();
      cancelDeadline = timer(() => {
        cancelDeadline = null;
        if (snapshot.state === 'buffering') set({ state: 'live' });
      }, deadlineMs);
    }

    // The film clock, and the only thing that moves it.
    const seconds = chunkVideoSeconds(message);
    if (seconds === null) return;
    const videoSeconds = snapshot.videoSeconds + seconds;
    set({ videoSeconds });

    // The runner says where its playout stands as it announces each chunk.
    // Trusted only when it is not ahead of the film generated so far, which
    // would mean it is counting something else.
    const playback = playbackSeconds(message);
    if (playback !== null && playback <= videoSeconds) {
      lastPlayback = { at: now(), seconds: playback };
    }

    // The ceiling. A chunk is 5-15s of film and cannot be cut in half, so the
    // last one overshoots the target; ending on the chunk that CROSSES it is
    // the only choice that never stops short of the minimum already paid for.
    if (!draining && snapshot.videoTarget !== null && videoSeconds >= snapshot.videoTarget) {
      finish(snapshot.videoTarget);
    }
  }

  /**
   * Reaching the target ends the sitting, but not this instant — and not with
   * an immediate `stop`.
   *
   * The film clock counts film GENERATED, and the runner generates ahead of
   * what is playing. On Mecha Launch the chunk that carried the film past its
   * 68s target was announced while the device had PLAYED about 54s of it.
   * Sending `stop` on that announcement — which is what this used to do, on
   * the theory that the runner would wind down in order — made the runner
   * answer `stream_exhausted` within 0.2s and cut the media. The whole last
   * beat was generated, billed, and never reached the screen or the file;
   * every 46–57s take on a 68s script was this.
   *
   * So the stop waits for the picture. The runner's `playback_seconds` on the
   * last chunk says where playout stood when it was announced and playout runs
   * in real time from there; without it, the wall clock since the first frame
   * stands in. Once the picture has shown `untilSeconds` of film, plus a grace
   * for the last frames to present, `stop` goes out and the sitting ends.
   * Bounded, because the runner keeps generating — and billing — while we wait.
   */
  function finish(untilSeconds: number) {
    if (TERMINAL.has(snapshot.state) || draining) return;
    draining = true;
    const remaining = Math.max(untilSeconds - presentedSeconds(), 0);
    const wait = Math.min(
      remaining + PRESENTATION_GRACE_SECONDS,
      MAX_PRESENTATION_WAIT_SECONDS,
    );
    clearDrain();
    cancelDrain = timer(() => {
      cancelDrain = null;
      // `end` releases, and releasing says `stop` before it closes.
      end(describeEnding('session_limit'));
    }, wait * 1000);
  }

  /** How much film the picture has shown, as well as the session can tell. */
  function presentedSeconds(): number {
    if (lastPlayback) return lastPlayback.seconds + (now() - lastPlayback.at) / 1000;
    if (firstFrameAt !== null) return (now() - firstFrameAt) / 1000;
    return 0;
  }

  function receive(event: TransportEvent) {
    if (snapshot.state === 'idle') return;
    trace(event);

    switch (event.type) {
      case 'state': {
        if (event.state === 'live' && snapshot.state === 'opening') {
          set({ state: 'configuring' });
        } else if (event.state === 'failed') {
          // After `stop`, a dead connection is what we asked for.
          if (draining) endOfDrain('the transport reported failed');
          else fail(describeError(undefined));
        } else if (event.state === 'closed' && !TERMINAL.has(snapshot.state)) {
          // A close we did not ask for: the bridge dropped the lease, or the
          // proxy refused a heartbeat past the cap.
          end(describeEnding(undefined));
        }
        return;
      }
      case 'diagnostic':
        // Remembered rather than acted on: a failure diagnostic often arrives
        // BEFORE the state change it explains (the WMA bridge reports the
        // refused `/ice` call, then the connection gives up), so the machine
        // holds the most recent one and quotes it when it actually fails.
        observed = event.observed
          ? `${event.failure} (${Object.entries(event.observed)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')})`
          : event.failure;
        options.onEvent?.({ type: 'diagnostic', failure: event.failure });
        return;
      case 'media':
        set({ stream: event.stream });
        return;
      case 'frame':
        clearDeadline();
        if (firstFrameAt === null) firstFrameAt = now();
        if (snapshot.state === 'buffering') set({ state: 'live' });
        return;
      case 'error': {
        // An Error's own message is a developer's sentence, not a viewer's, so
        // it goes to `detail` and the viewer still gets a plain one.
        const raw = event.error instanceof Error ? event.error.message : String(event.error);
        if (draining) endOfDrain(raw || 'the transport errored');
        else fail(describeError(undefined), raw || undefined);
        return;
      }
      case 'data':
        break;
    }

    const message = parseInbound(event.raw);
    if (!message) return;

    switch (message.type) {
      case 'chunk':
        onChunk(message);
        // Forwarded like the rest. It was not, and the recorder — which counts
        // a sitting as worth keeping only once a chunk has arrived — waited
        // for a message that was being swallowed one line above it.
        options.onEvent?.(message);
        break;
      case 'deadline_missed':
        // Not a state. A late chunk is the picture holding still, and a page
        // that dropped to a "connecting" screen every time one was late would
        // flicker its way through a perfectly watchable stream.
        set({ holding: true });
        options.onEvent?.(message);
        break;
      // The soundtrack's own four messages. None of them is a state change —
      // a sitting whose audio was refused keeps generating, and one whose
      // audio ran out keeps generating silently — so they are recorded and
      // forwarded, never allowed to end anything.
      case 'audio_pending':
        set({ audio: 'waiting' });
        options.onEvent?.(message);
        break;
      case 'audio_applied':
        set({ audio: 'playing', audioDetail: null });
        options.onEvent?.(message);
        break;
      case 'audio_exhausted': {
        set({
          audio: 'exhausted',
          audioDetail: `the audio ran out at ${snapshot.videoSeconds.toFixed(1)}s of film`,
        });
        options.onEvent?.(message);
        // THE AUDIO IS THE LENGTH.
        //
        // On an audio-led piece the soundtrack is not decoration — it is FL2VA
        // target audio, so every chunk is conditioned on it and the film is
        // being generated AGAINST it. The moment it runs out the endpoint says
        // so, and says exactly what comes next: "the rest is silence… later
        // chunks continue without audio conditioning". That is film nobody
        // asked for, generated blind, and billed per second like any other.
        //
        // So the piece ends here rather than running on to a target computed
        // from the script. The script's last beat sets the length of a SILENT
        // Series; when there is audio, the audio outranks it — which is the
        // only reading under which "the audio leads the generation" is true of
        // the code and not just of the intention.
        //
        // Not `end()` — `finish()`, so the picture is given time to catch up
        // with the film already generated before `stop` cuts the media. Up to
        // the script's target, if the audio outlasts it.
        //
        // UNLESS THERE IS ANOTHER REEL. A cue sheet cut into reels has its
        // soundtrack cut with it — one piece per reel, because a single bed on
        // the first reel's opening beat holds every later reel off until it
        // finishes, which on a 179-second bed is the end of the film. So the
        // first reel's audio running out is the seam arriving, not the piece
        // ending, and treating it as the ending would stop a two-reel film
        // halfway through with its second half queued and paid for.
        const lastReel = runningReel >= lastReelVersion && pendingReels.length === 0;
        if (openRecipe && carriesAudio(openRecipe) && !draining && lastReel) {
          finish(Math.min(snapshot.videoSeconds, snapshot.videoTarget ?? snapshot.videoSeconds));
        } else if (!lastReel) {
          console.log(
            `[director] reel ${runningReel}'s audio ran out at ` +
              `${snapshot.videoSeconds.toFixed(1)}s — the next reel carries its own`,
          );
        }
        break;
      }
      case 'audio_rejected': {
        // The whole reason this is tracked: the picture carries on and looks
        // fine, so nothing else would ever say that the film being generated
        // is no longer the one that was asked for.
        const reason = (message.reason as string | undefined) ?? 'unknown';
        set({ audio: 'refused', audioDetail: reason });
        console.warn(
          `[director] the soundtrack was refused (${reason}) — the sitting continues without it`,
        );
        options.onEvent?.(message);
        break;
      }
      case 'stream_exhausted':
        end(describeEnding(message.reason as string | undefined));
        break;
      case 'error': {
        // Two audiences, two strings. The viewer gets the code's own sentence;
        // whoever can fix it gets what the endpoint said, verbatim — which on
        // a refused `configure` is the only place the broken rule is named.
        const because = errorDetail(message);
        const said = describeError(message.code as string | undefined);
        // During the drain the film is already made and paid for. The endpoint
        // may answer our `stop` with an error rather than winding down, and a
        // take that reached its ending is not a failed take.
        if (draining) endOfDrain(because ?? said);
        else fail(said, because);
        break;
      }
      case 'session_info': {
        // The endpoint states its OWN ceiling here, and we were throwing it
        // away. `max_session_seconds` is how long the runner will keep this
        // session alive; `session_limit_scope` says whether it counts what was
        // configured or what is effectively generated. Every sitting of Mecha
        // Launch has died between 46 and 57 seconds of film against a 66-second
        // script, with no diagnostic and no heartbeat refusal — a ceiling we
        // were never reading is the first thing to check, and it cannot be
        // checked without writing it down.
        const ceiling = Number(message.max_session_seconds);
        const scope = typeof message.session_limit_scope === 'string' ? message.session_limit_scope : null;
        set({
          sessionCeiling: Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null,
          sessionLimitScope: scope,
        });
        console.log(
          `[director] session_info — max_session_seconds=${message.max_session_seconds ?? 'null'}` +
            ` scope=${scope ?? 'null'} · our film target is ${snapshot.videoTarget}s`,
        );
        // Said out loud, because it decides whether the last beats can be
        // filmed at all and a script that cannot finish is worth knowing about
        // before the money is spent rather than after.
        if (Number.isFinite(ceiling) && ceiling > 0 && snapshot.videoTarget !== null && ceiling < snapshot.videoTarget) {
          console.warn(
            `[director] the endpoint will end this session at ${ceiling}s, but the script asks for ` +
              `${snapshot.videoTarget}s of film — the last beats cannot be reached.`,
          );
        }
        options.onEvent?.(message);
        break;
      }
      case 'configured': {
        // THE REELS GO OUT HERE, all of them, as soon as the Director has
        // accepted the first.
        //
        // Not on a timer and not one per reel change: an appended script
        // "queues behind earlier appended scripts", `script_max_queued` is 4,
        // and the endpoint decides when each one starts. Sending them now means
        // the decision is never waiting on us — a reel that arrives after its
        // boundary has passed is a reel that starts a chunk late for no reason.
        for (const reel of pendingReels) {
          try {
            transport?.send(reel);
          } catch (error) {
            console.warn(`[director] a reel could not be sent — ${String(error)}`);
          }
        }
        if (pendingReels.length) {
          console.log(
            `[director] ${pendingReels.length} later reel(s) queued; the film is ` +
              `${pendingReels.length + 1} reels of a ${snapshot.videoTarget}s target`,
          );
        }
        pendingReels = [];
        options.onEvent?.(message);
        break;
      }
      default:
        options.onEvent?.(message);
    }
  }

  const session: DirectorSession = {
    get snapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    open(showing) {
      // A Recipe alone is still a Screening: one reel, no appends. Accepted
      // because three surfaces open sessions and only the Stage has a Series
      // long enough to need cutting — and because a Recipe is what the admin
      // preview holds while a form is being typed.
      const screening: Screening =
        'configure' in showing
          ? showing
          : { configure: showing, reels: [], filmSeconds: filmSecondsOf(showing) };
      const recipe = screening.configure;
      if (snapshot.state !== 'idle' && !TERMINAL.has(snapshot.state)) {
        // Already opening or playing. Opening again would negotiate a second
        // peer connection for the same page and bill for both.
        console.warn('[director] open() while a session is already open — ignored');
        return;
      }
      if (current && current !== session) {
        console.warn('[director] a second session opened — closing the first');
        void current.stop();
      }
      current = session;

      observed = null;
      draining = false;
      openRecipe = recipe;
      firstFrameAt = null;
      lastPlayback = null;
      pendingReels = screening.reels;
      runningReel = 1;
      // `configure` is version 1 and each reel takes the next, so a live
      // `direct()` after the last reel must not reuse one: `prompt_version` is
      // monotonic per sitting, and a repeat is `stale_prompt_version`.
      lastReelVersion = screening.reels.at(-1)?.prompt_version ?? 1;
      snapshot = {
        ...IDLE,
        state: 'opening',
        startedAt: now(),
        videoTarget: videoTargetFor(screening, minVideoSeconds),
        promptVersion: lastReelVersion,
        // Asked for, but not yet ruled on. A Recipe with no audio stays at
        // `none` for the whole sitting, so a silent film is never reported as
        // one whose soundtrack went missing.
        audio: carriesAudio(recipe) || screening.reels.some(reelCarriesAudio) ? 'waiting' : 'none',
      };
      for (const listener of listeners) listener(snapshot);

      // The BACKSTOP, not the ceiling — the ceiling is the film clock in
      // `onChunk`. This one only catches a sitting that stopped generating, so
      // it fails rather than ends: a session that produced no film in four
      // minutes did not finish, and calling that an ending hides it.
      clearBackstop();
      cancelBackstop = timer(() => {
        cancelBackstop = null;
        if (TERMINAL.has(snapshot.state)) return;
        fail(
          describeEnding(undefined),
          `no film for ${Math.round(backstopMs / 1000)}s — stopped at ` +
            `${snapshot.videoSeconds.toFixed(1)}s of ${snapshot.videoTarget}s`,
        );
      }, backstopMs);

      transport = options.transport(receive);
      // Sent immediately: the fal client returns its handle synchronously in
      // state `opening` and queues sends until the control channel is live, so
      // there is nothing to await between opening and configuring.
      transport.send(recipe);
    },

    async stop() {
      if (snapshot.state === 'idle' || TERMINAL.has(snapshot.state)) {
        // Idempotent: pause, swipe and background can all fire for one gesture.
        release();
        return;
      }
      set({ state: 'closing' });
      release();
      set({ state: 'ended', message: null, holding: false, stream: null });
    },

    direct(prompt, extras) {
      if (!transport) return;
      const promptVersion = snapshot.promptVersion + 1;
      set({ promptVersion });
      transport.send({
        type: 'prompt',
        prompt_version: promptVersion,
        prompt,
        end_image_url: extras?.endImageUrl ?? null,
        audio_url: extras?.audioUrl ?? null,
        ...(extras?.audioBehavior ? { audio_behavior: extras.audioBehavior } : {}),
        replan: true,
      });
    },
  };

  return session;
}

/** The session this device has open, if any. For the hook's guard, and tests. */
export function currentSession(): DirectorSession | null {
  return current;
}
