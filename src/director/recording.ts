/**
 * Keeping a sitting: the orchestration around the native recorder.
 *
 * Split from the recorder itself so the interesting part — when it becomes
 * keepable, what happens when nothing was recorded — is testable without a
 * phone. The native module is injected for the same reason the session takes
 * a transport.
 *
 * The shape follows the session's: arm on `live`, note what the control
 * channel says, and finish only when somebody asks. Nothing reaches the
 * bucket on its own.
 *
 * There is no post-production step here, and that is deliberate. An earlier
 * version downloaded the Series' `audioUrl` and muxed it under the finished
 * film, because the card held that the Director generated no audio of its own.
 * It does (`09-findings.md`), `AudioTap` records it, and `audioUrl` turned out
 * to be an INPUT to the generation — a voice reference the Director is given,
 * not a track to lay over what it produced. So a kept sitting is the file the
 * writer closed, and nothing touches it afterwards.
 */

/**
 * The half of the native module this needs.
 *
 * Required rather than defaulted, and a type rather than an import, for the
 * reason `useDirectorSession` gives about the transport: the moment this file
 * imports the native module it stops being loadable in vitest.
 */
export type NativeRecorder = {
  isSupported(): boolean;
  start(path: string): void;
  stop(): Promise<{
    path: string;
    durationMs: number;
    frameCount: number;
    droppedFrames: number;
    degenerateTimestamps: number;
    audioSampleCount: number;
    audioSampleRate: number;
    audioNote: string;
  }>;
  cancel(): void;
  snapshot(path: string): Promise<string>;
};

export type KeptSitting = {
  /** A local mp4: the picture and the sound, as the sitting produced them. */
  path: string;
  durationMs: number;
  frameCount: number;
  droppedFrames: number;
  /** Frames paced at 24 fps because their own timestamps were unusable. */
  degenerateTimestamps: number;
  /** Audio frames captured from the session. Zero means a silent film. */
  audioSampleCount: number;
  /** The rate they were captured at. */
  audioSampleRate: number;
  /** Why the film is silent, when it is. */
  audioNote: string;
};

/**
 * What becomes of a recording when its session reaches a state.
 *
 * `keep` writes the film and uploads it; `drop` throws the frames away;
 * `wait` is every state where the sitting is still going.
 */
export type RecorderVerdict = 'wait' | 'keep' | 'drop';

/**
 * The rule, as a function, because it is the rule that decides whether a film
 * exists and it was previously a branch inside a React callback where no test
 * could reach it.
 *
 * `ended` and `failed` are the SAME decision, and that is the whole point. It
 * used to keep on `ended` and discard on `failed`, reasoning that a failed
 * sitting has nothing worth keeping — true only of one that fell over before it
 * filmed anything, which is exactly what `keepable` already distinguishes. A
 * stream that drops at fifty seconds has fifty seconds of generated, billed,
 * recorded film sitting on disk, and fal keeps nothing: a sitting not collected
 * as it played cannot be recovered (ADR-0010, card 09). An untidy ending is not
 * a reason to destroy the only copy.
 *
 * `idle` drops whatever it has: nothing has played, so there is nothing to lose.
 */
export function verdictFor(state: string, keepable: boolean): RecorderVerdict {
  if (state === 'ended' || state === 'failed') return keepable ? 'keep' : 'drop';
  if (state === 'idle') return 'drop';
  return 'wait';
}

export type SittingRecorder = {
  readonly armed: boolean;
  /** True once frames have been recorded and a film could be kept. */
  readonly keepable: boolean;
  /**
   * Start recording. Never throws: a sitting that cannot be recorded is still
   * a sitting worth watching, and card 09 says a recorder that will not start
   * logs a diagnostic and disappears rather than failing the session.
   */
  arm(): void;
  /** Feed it the session's events. Anything it does not care about is ignored. */
  note(event: { type: string; [k: string]: unknown }): void;
  /** Stop and close the file. Rejects if nothing was recorded. */
  finish(): Promise<KeptSitting>;
  /** Stop and throw the frames away. Idempotent. */
  discard(): void;
  /** The last frame, for a future session to be seeded on. */
  seedFrame(toPath: string): Promise<string>;
};

export type SittingRecorderOptions = {
  /** Where the film is written. `Paths.cache` at the call site. */
  directory: string;
  native: NativeRecorder;
  now?: () => number;
  onDiagnostic?: (message: string) => void;
};

export function createSittingRecorder(options: SittingRecorderOptions): SittingRecorder {
  const { directory, native, now = Date.now, onDiagnostic } = options;

  const path = `${directory}sitting-${Math.floor(now())}.mp4`;

  let armed = false;
  let keepable = false;

  return {
    get armed() {
      return armed;
    },
    get keepable() {
      return keepable;
    },

    arm() {
      if (armed || !native.isSupported()) return;
      try {
        native.start(path);
        armed = true;
      } catch (error) {
        onDiagnostic?.(`the recorder would not start: ${String(error)}`);
      }
    },

    note(event) {
      if (!armed) return;
      // A chunk is the endpoint confirming it produced film. Until one has
      // arrived there is nothing worth keeping, however long the peer
      // connection has been open.
      if (event.type === 'chunk') keepable = true;
    },

    async finish() {
      if (!armed) throw new Error('nothing was being recorded');
      armed = false;
      const summary = await native.stop();
      return {
        path: summary.path,
        durationMs: summary.durationMs,
        frameCount: summary.frameCount,
        droppedFrames: summary.droppedFrames,
        degenerateTimestamps: summary.degenerateTimestamps,
        audioSampleCount: summary.audioSampleCount,
        audioSampleRate: summary.audioSampleRate,
        audioNote: summary.audioNote,
      };
    },

    discard() {
      if (!armed) return;
      armed = false;
      keepable = false;
      native.cancel();
    },

    seedFrame(toPath: string) {
      return native.snapshot(toPath);
    },
  };
}
