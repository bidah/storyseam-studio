import { useCallback, useEffect, useRef, useState } from "react";

// Voice message capture for the chat composer — the web counterpart of the
// mobile app's `use-audio-recording` hook. Records via the browser
// `MediaRecorder` API and POSTs the raw bytes to the Worker's `/api/transcribe`
// (Cloudflare Whisper) route, which returns `{ text }`.
//
// Mime negotiation: Chrome/Firefox produce `audio/webm;codecs=opus`, Safari only
// supports `audio/mp4` (AAC). We record whatever the browser can encode and send
// that container's mime as the request `content-type`; the Worker just hands the
// raw bytes to Whisper, which decodes common formats.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
];

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

// `123` seconds → `2:03`.
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function useVoiceRecording() {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const stopResolveRef = useRef(null);

  // Tick a 1s timer while recording, mirroring the mobile duration counter.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Voice recording isn't supported in this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    const rec = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      cleanup();
      setRecording(false);
      stopResolveRef.current?.(blob);
      stopResolveRef.current = null;
    };
    streamRef.current = stream;
    recorderRef.current = rec;
    rec.start();
    setDuration(0);
    setRecording(true);
  }, [cleanup]);

  // Stop and resolve with the recorded Blob (null if nothing was captured).
  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      cleanup();
      setRecording(false);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      try {
        rec.stop();
      } catch {
        cleanup();
        setRecording(false);
        resolve(null);
      }
    });
  }, [cleanup]);

  // Discard the take: stop the recorder/stream without producing a usable blob.
  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    stopResolveRef.current = null;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    cleanup();
    setRecording(false);
  }, [cleanup]);

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => () => cleanup(), [cleanup]);

  return { recording, duration, start, stop, cancel };
}

// POST raw audio bytes to the Worker's Whisper route and return `{ text }`.
// Same-origin, so the project fetch shim attaches the session cookie + project
// headers automatically (the route requires an authenticated user).
export async function transcribeAudio(blob) {
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "content-type": blob.type || "audio/webm" },
    body: blob,
  });
  if (!res.ok) {
    let message = `Transcription failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = String(data.error);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const data = await res.json().catch(() => ({}));
  return { text: (data?.text || "").trim() };
}
