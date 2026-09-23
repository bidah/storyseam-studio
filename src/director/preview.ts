import { levelAt, levelBreakpoints, type MixSettings } from './mix';
import { SAMPLE_RATE } from './film';

// Hearing the mix before it is written: the film plays in its own <video>,
// with its own sound, and the cue plays through Web Audio under it with the
// same schedule the render will use. No file is made to check a level.
//
// The two clocks are joined at every play and seek: the cue restarts from the
// video's current second, and the gain is scheduled from that second forward.
// It drifts by nothing a person can hear over three minutes; the render is
// sample-exact and is what gets kept.

export type Preview = {
  /** Call on the video's `play`, `seeking` and `ratechange`. */
  follow: (video: HTMLVideoElement) => void;
  /** Call on `pause` and `ended`. */
  hold: () => void;
  /** New settings take effect at the next `follow`. */
  retune: (settings: MixSettings) => void;
  close: () => void;
};

export function makePreview(cue: Float32Array, settings: MixSettings): Preview {
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let current = settings;
  let buffer: AudioBuffer | null = null;

  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      buffer = ctx.createBuffer(1, cue.length, SAMPLE_RATE);
      buffer.copyToChannel(cue as Float32Array<ArrayBuffer>, 0);
    }
    return ctx;
  };

  const hold = () => {
    if (source) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
      source = null;
    }
    if (gain) {
      gain.disconnect();
      gain = null;
    }
  };

  const follow = (video: HTMLVideoElement) => {
    hold();
    if (video.paused || !buffer) {
      if (!buffer) ensure();
      if (video.paused) return;
    }
    const context = ensure();
    if (context.state === 'suspended') void context.resume();
    const at = video.currentTime;
    if (at >= cue.length / SAMPLE_RATE) return;

    gain = context.createGain();
    // The schedule, from this second onward: flat between breakpoints, a ramp
    // through the fade. `setValueAtTime` at each breakpoint is exactly what the
    // render does per sample; the fade is drawn with a linear ramp.
    const now = context.currentTime;
    gain.gain.setValueAtTime(levelAt(current, at), now);
    for (const t of levelBreakpoints(current)) {
      if (t <= at) continue;
      const when = now + (t - at) / video.playbackRate;
      if (t <= current.fadeInSec) gain.gain.linearRampToValueAtTime(levelAt(current, t), when);
      else gain.gain.setValueAtTime(levelAt(current, t), when);
    }

    source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = video.playbackRate;
    source.connect(gain).connect(context.destination);
    source.start(now, at);
  };

  return {
    follow,
    hold,
    retune: (next) => {
      current = next;
    },
    close: () => {
      hold();
      void ctx?.close();
      ctx = null;
      buffer = null;
    },
  };
}
