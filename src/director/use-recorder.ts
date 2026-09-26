import { useCallback, useEffect, useRef, useState } from 'react';
import { verdictFor } from './recording';
import type { SessionState } from './session';

// KEEPING A SITTING, in a browser.
//
// fal returns no file. A WMA session is a peer connection and nothing else, so
// a sitting not recorded AS IT PLAYS cannot be recovered afterwards — and it
// was billed at a sixty-second minimum whether or not anybody kept it. That is
// the whole argument for this file: without it the Stage's takes rail could
// only ever show films the PHONE made.
//
// `MediaRecorder` over the incoming `MediaStream`, which is the browser's
// equivalent of the device's `AVAssetWriter` tap and considerably less work —
// the stream already carries the Director's video and its audio on one object,
// so there is no muxing step and nothing to align.
//
// The rule about WHEN a film is worth keeping is not re-decided here. It lives
// in `verdictFor` beside the device's recorder, and the part that matters is
// that `ended` and `failed` are the SAME decision: a stream that drops at fifty
// seconds has fifty seconds of generated, billed film in the buffer.

/**
 * What the browser will actually record in, best first.
 *
 * Safari muxes mp4 and Chrome has shipped it recently; Firefox has only ever
 * offered WebM. The recordings route accepts both and names the key from the
 * container, so this list is about quality of playback rather than about
 * whether the film survives — mp4 plays everywhere, a VP8 WebM does not play
 * on older iOS.
 */
const CONTAINERS = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function supportedContainer(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return CONTAINERS.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/**
 * The container without its codec parameters, which is what the route matches
 * on and what the object is stored as.
 */
export function baseType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export type StageRecorder = {
  /** Drive from the session's state: arms on `live`, keeps or drops on the end. */
  sync: (state: SessionState) => void;
  /** Passed to the session as `onEvent`; see the note on `note` below. */
  note: (event: { type: string; [k: string]: unknown }) => void;
  /** What to tell whoever is watching. `null` while there is nothing to say. */
  status: string | null;
  /** Bumped when a film lands in the bucket, so the takes rail re-reads. */
  kept: number;
  /** True while frames are being written. */
  recording: boolean;
};

export function useStageRecorder(options: {
  seriesId: string;
  /** The live stream. Recording starts when this and `live` are both true. */
  stream: MediaStream | null;
  /**
   * Seconds of FILM this sitting generated, read at the moment it is kept.
   *
   * A function rather than a value because `finish` is built once and must not
   * be rebuilt every time the counter ticks — a recorder rebuilt mid-sitting is
   * a recorder that drops the film it was holding.
   */
  filmSeconds: () => number;
}): StageRecorder {
  const { seriesId, stream, filmSeconds } = options;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const armedRef = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [kept, setKept] = useState(0);
  const [recording, setRecording] = useState(false);

  const streamRef = useRef(stream);
  streamRef.current = stream;
  const filmSecondsRef = useRef(filmSeconds);
  filmSecondsRef.current = filmSeconds;
  const seriesRef = useRef(seriesId);
  seriesRef.current = seriesId;

  /**
   * The control channel, forwarded.
   *
   * Nothing reads it yet. It is here because the device's recorder builds the
   * soundtrack's cue list from `audio_applied` and `audio_exhausted`, and the
   * Stage's session is wired to hand it over the same way — so the seam exists
   * before the first thing that needs it, rather than being retrofitted into a
   * session that has already been constructed.
   */
  const note = useCallback(() => {}, []);

  const finish = useCallback(async (keep: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    armedRef.current = false;
    setRecording(false);

    const parts = await new Promise<Blob[]>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          const collected = chunksRef.current;
          chunksRef.current = [];
          resolve(collected);
        },
        { once: true },
      );
      // `stop()` on an already-inactive recorder throws; a session that failed
      // during negotiation can reach here with nothing started.
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve([]);
    });

    if (!keep) {
      setStatus(null);
      return;
    }
    const bytes = parts.reduce((total, part) => total + part.size, 0);
    if (bytes === 0) {
      setStatus('nothing was recorded — this sitting produced no film');
      return;
    }

    const type = baseType(recorder.mimeType || parts[0]?.type || 'video/webm');
    const film = new Blob(parts, { type });
    setStatus(`keeping ${Math.round(bytes / 1024 / 1024)} MB…`);
    try {
      // Multipart rather than a raw PUT: the sitting arrives with the Series it
      // belongs to and the film length it reached, and neither belongs in a
      // header. The project id is stamped by the projectFetch shim.
      const form = new FormData();
      form.append('film', film, `sitting.${type.includes('mp4') ? 'mp4' : 'webm'}`);
      form.append('seriesId', seriesRef.current);
      form.append('seconds', String(filmSecondsRef.current()));
      const response = await fetch('/api/stage/sittings', { method: 'POST', body: form });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `the server said ${response.status}`);
      }
      setStatus('kept');
      setKept((n) => n + 1);
    } catch (error) {
      // The film is gone either way — it only ever existed in this tab — so
      // the honest thing is to say so rather than to retry silently.
      setStatus(`this take could not be kept: ${(error as Error).message}`);
    }
  }, []);

  const sync = useCallback(
    (state: SessionState) => {
      const verdict = verdictFor(state, armedRef.current);
      if (verdict === 'keep') {
        void finish(true);
        return;
      }
      if (verdict === 'drop') {
        void finish(false);
        return;
      }
      // `wait`: arm once, the moment there is both a stream and a picture.
      if (armedRef.current || state !== 'live') return;
      const live = streamRef.current;
      if (!live) return;

      const mimeType = supportedContainer();
      if (!mimeType) {
        setStatus('this browser cannot record — the take will not be kept');
        return;
      }
      try {
        const recorder = new MediaRecorder(live, { mimeType });
        chunksRef.current = [];
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        });
        // A timeslice rather than one blob at the end: a tab that is closed
        // mid-sitting still leaves whole chunks behind, and a long sitting
        // does not sit in one growing allocation.
        recorder.start(2000);
        recorderRef.current = recorder;
        armedRef.current = true;
        setRecording(true);
        setStatus(null);
      } catch (error) {
        setStatus(`this take will not be kept: ${(error as Error).message}`);
      }
    },
    [finish],
  );

  // A tab closed mid-sitting: stop the recorder so the chunks already written
  // are flushed. There is no time to upload them, and pretending otherwise
  // with a beacon would send a partial film under a whole one's name.
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  return { sync, note, status, kept, recording };
}
