import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';

// The film, in the browser: read, measured, and written back out with a new
// audio track. Everything in this file is the part of the pipeline that used
// to be ffmpeg on a laptop (ADR-0014).
//
// mediabunny reads the container and hands the codecs to WebCodecs. Reading a
// kept sitting's audio, drawing its frames, and copying its video packets into
// a new mp4 UNCHANGED are all things a browser does today; what it does not
// reliably do is encode AAC (Firefox), which is what the polyfill is for.

/** The rate every measurement and the mix are done at. The films' own rate, and the cue's. */
export const SAMPLE_RATE = 48_000;

export type FilmAudio = {
  /** Mono, at SAMPLE_RATE. */
  samples: Float32Array;
  durationMs: number;
};

/** The film's bytes, fetched once and reused by every step. */
export async function fetchFilm(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`could not read the film (${res.status})`);
  return res.blob();
}

function openInput(blob: Blob): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
}

/** Fold a decoded buffer into mono, at the buffer's own rate. */
function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels;
  }
  return mono;
}

/** Linear resample — good enough for measurement and for a bed; the film's own audio is copied through the mix at its rate. */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.round((samples.length * to) / from);
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const at = i * ratio;
    const index = Math.floor(at);
    const frac = at - index;
    const a = samples[index] ?? 0;
    const b = samples[index + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * The film's own audio, as one mono track at SAMPLE_RATE, and its measured
 * length — the number the plan has to add up to.
 *
 * Decoded through mediabunny rather than `decodeAudioData`, which some engines
 * refuse for a container with a video track in it and which cannot say how long
 * the FILM is when the audio track is shorter than the picture.
 */
export async function readFilmAudio(blob: Blob): Promise<FilmAudio> {
  const input = openInput(blob);
  const durationSec = await input.computeDuration();
  const durationMs = Math.round(durationSec * 1000);
  const track = await input.getPrimaryAudioTrack();
  const total = Math.round(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(total);
  if (track && (await track.canDecode())) {
    const sink = new AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers()) {
      const mono = resample(toMono(buffer), buffer.sampleRate, SAMPLE_RATE);
      const start = Math.round(timestamp * SAMPLE_RATE);
      samples.set(mono.subarray(0, Math.max(0, Math.min(mono.length, total - start))), start);
    }
  }
  return { samples, durationMs };
}

/** A rendered cue (mp3) as mono samples at SAMPLE_RATE, and its MEASURED length. */
export async function readCue(url: string, signal?: AbortSignal): Promise<FilmAudio> {
  const blob = await fetchFilm(url, signal);
  return readFilmAudio(blob);
}

export type Frame = { at: number; dataUrl: string };

/**
 * A frame every `everySec` seconds, small, with the clock on it — the contact
 * sheet, drawn by the browser. Yields as it goes so the sheet fills in rather
 * than appearing at once.
 */
export async function* contactSheet(
  blob: Blob,
  everySec: number,
  durationSec: number,
  width = 208,
): AsyncGenerator<Frame> {
  const input = openInput(blob);
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) return;
  const sink = new CanvasSink(track, { width, fit: 'contain' });
  const times: number[] = [];
  for (let t = 0; t < durationSec; t += everySec) times.push(t);
  const scratch = document.createElement('canvas');
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    if (!wrapped) continue;
    const source = wrapped.canvas;
    scratch.width = source.width;
    scratch.height = source.height;
    const ctx = scratch.getContext('2d')!;
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    yield { at: wrapped.timestamp, dataUrl: scratch.toDataURL('image/jpeg', 0.7) };
  }
}

/**
 * The scored film: the picture copied, the mixed audio encoded to AAC beside it.
 *
 * `composable` conversion with the input's audio discarded is mediabunny's
 * `-c:v copy -map 1:a`: the video packets are moved, not decoded. A film that
 * arrived as WebM (Chrome's recorder) cannot be carried into an mp4 without a
 * transcode, and mediabunny transcodes it rather than refusing — slower, and
 * the caller is told which happened.
 */
export async function writeScoredFilm(
  film: Blob,
  mixed: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): Promise<{ blob: Blob; videoCopied: boolean }> {
  if (!(await canEncodeAudio('aac'))) registerAacEncoder();

  const input = openInput(film);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, audio: { discard: true }, composable: true });
  if (onProgress) conversion.onProgress = (fraction) => onProgress(fraction);

  const audioSource = new AudioBufferSource({ codec: 'aac', bitrate: new Quality({ bitrate: 192_000 }) });
  output.addAudioTrack(audioSource);

  // An AudioBuffer needs a context to be made; the OfflineAudioContext never renders.
  const ctx = new OfflineAudioContext(1, mixed.length, sampleRate);
  const buffer = ctx.createBuffer(1, mixed.length, sampleRate);
  buffer.copyToChannel(mixed as Float32Array<ArrayBuffer>, 0);

  await output.start();
  await Promise.all([conversion.execute(), audioSource.add(buffer).then(() => audioSource.close())]);
  await output.finalize();

  const videoTrack = await input.getPrimaryVideoTrack();
  const videoCopied = conversion.utilizedTracks.some((track) => track === videoTrack) && (await input.getFormat()).name.toLowerCase().includes('mp4');
  const bytes = (output.target as BufferTarget).buffer;
  if (!bytes) throw new Error('the scored film came out empty');
  return { blob: new Blob([bytes], { type: 'video/mp4' }), videoCopied };
}
