import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

// Cutting the sheet up.
//
// The shot sheet is one video whose only purpose is to be split, so this is
// the step the whole technique turns on: seek to the middle of each shot's
// span, take the frame the decoder is actually showing there, and hand it back
// as bytes that can be uploaded as a pin.
//
// In the browser, with mediabunny, for the same reason the mix is (ADR-0014):
// the file is already here, WebCodecs decodes it, and a round trip to a laptop
// with ffmpeg on it is the thing this surface exists to remove.
//
// PNG, not JPEG. The grab is already a lossy frame of a lossy video and it is
// about to become the exact picture the Director continues from; re-encoding it
// a third time to save a megabyte is paying in the one currency that matters
// here. The upload route takes PNG and the ceiling is 10 MB a frame.

export type Grabbed = {
  /** The second it was actually decoded at, which is not always the second asked for. */
  at: number;
  /** The second it was asked for, so a grab can be matched to its shot. */
  wanted: number;
  blob: Blob;
  /** For showing it. Revoked by the caller when the sheet is replaced. */
  href: string;
  width: number;
  height: number;
};

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the frame could not be read off the canvas'))),
      'image/png',
    ),
  );
}

/**
 * One frame per time asked for, in order, yielded as each is decoded.
 *
 * Yields rather than returns so the contact sheet fills in while the rest are
 * still being decoded — seventeen full-resolution frames is a few seconds of
 * work, and a blank panel for the duration reads as a hang.
 *
 * At the video's NATIVE size. These are not thumbnails: a pin is generated
 * from, so every pixel the render produced is one the Director gets.
 */
export async function* grabFrames(film: Blob, times: number[]): AsyncGenerator<Grabbed> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(film) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('the shot sheet has no video track');
  if (!(await track.canDecode())) throw new Error('this browser cannot decode the shot sheet');

  const sink = new CanvasSink(track);
  const scratch = document.createElement('canvas');
  let index = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    const wanted = times[index++];
    if (!wrapped) continue;
    const source = wrapped.canvas;
    scratch.width = source.width;
    scratch.height = source.height;
    const ctx = scratch.getContext('2d');
    if (!ctx) throw new Error('this browser gave no 2d canvas to read frames into');
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    const blob = await canvasBlob(scratch);
    yield {
      at: wrapped.timestamp,
      wanted,
      blob,
      href: URL.createObjectURL(blob),
      width: source.width,
      height: source.height,
    };
  }
}
