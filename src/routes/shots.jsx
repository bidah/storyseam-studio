import { useCallback, useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { Check, Speech, Star, Leaf, Circle, Save, Loader2 } from "lucide-react";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Empty, ErrorNote } from "@/components/shared";
import { useShell } from "@/lib/shellContext";

/* ---------------------------------------------------------------- *
 * Editable text cell (Seedance shot / seed-audio block)            *
 * ---------------------------------------------------------------- */

function EditableCell({ shotId, kind, initialText, found, segmentTag, segmentLabel }) {
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [status, setStatus] = useState(null); // "saving" | "ok" | error string
  const dirty = text !== saved;

  useEffect(() => {
    setText(initialText);
    setSaved(initialText);
  }, [initialText]);

  const onSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch(`/api/shots/${shotId}/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(text);
      setStatus("ok");
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setStatus(String(e.message || e));
    }
  }, [shotId, kind, text]);

  if (!found && !initialText) {
    return <Empty>no matching block in source file</Empty>;
  }

  return (
    <div className="space-y-2">
      {segmentLabel ? (
        <div
          className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500"
          title="Shared segment context (not editable here)"
        >
          {segmentLabel}
        </div>
      ) : (
        segmentTag != null && <Badge variant="muted">SEGMENT {segmentTag}</Badge>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[220px] resize-y font-mono text-xs leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onSave} disabled={!dirty || status === "saving"}>
          {status === "saving" ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save</>}
        </Button>
        {dirty && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <Circle size={8} fill="currentColor" /> unsaved
          </span>
        )}
        {status === "ok" && (
          <span className="flex items-center gap-1 text-xs text-primary">
            <Check size={13} /> written to file
          </span>
        )}
        {status && status !== "ok" && status !== "saving" && (
          <span className="text-xs text-destructive">{status}</span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Media takes (audio / video) with a take scrubber                 *
 * ---------------------------------------------------------------- */

function MediaTakes({ kind, takes, reloadKey }) {
  const list = Array.isArray(takes) ? takes : [];
  const [i, setI] = useState(0); // index 0 = latest
  useEffect(() => setI(0), [reloadKey, list.length]);

  if (list.length === 0) {
    return <Empty>not generated yet</Empty>;
  }
  const takesArr = list;
  const t = takesArr[Math.min(i, takesArr.length - 1)];
  const src = `${t.url}?v=${reloadKey}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground" title={t.title}>
        {i === 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <Star size={11} fill="currentColor" /> LATEST ·
          </span>
        )}
        <span className="truncate">{t.title}</span>
      </div>
      {kind === "audio" ? (
        <audio key={src} controls preload="none">
          <source src={src} type="audio/mpeg" />
        </audio>
      ) : (
        <video key={src} controls preload="metadata" className="bg-black">
          <source src={src} type="video/mp4" />
        </video>
      )}
      {takesArr.length > 1 && (
        <div className="flex items-center gap-2.5">
          <Slider
            className="flex-1"
            min={0}
            max={takesArr.length - 1}
            step={1}
            value={[takesArr.length - 1 - i]}
            onValueChange={([v]) => setI(takesArr.length - 1 - v)}
            aria-label="Select take"
          />
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            take {t.take}
            {t.variant && t.variant !== "final" ? ` · ${t.variant}` : ""} ·{" "}
            {takesArr.length - i}/{takesArr.length}
          </span>
        </div>
      )}
    </div>
  );
}

function Shots({ shots, error, reloadKey }) {
  return (
            <div className="space-y-4">
              {error && <ErrorNote>{error}</ErrorNote>}
              <div className="overflow-hidden rounded-xl border">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-[6%]" />
                      <col className="w-[30%]" />
                      <col className="w-[26%]" />
                      <col className="w-[20%]" />
                      <col className="w-[18%]" />
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/60 text-left">
                        <th className="border-b px-3 py-2.5 font-semibold">Shot</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Seedance shot</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Audio shot (seed-audio)</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Audio generation</th>
                        <th className="border-b px-3 py-2.5 font-semibold">Video generation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const rows = [];
                        let lastSeg = null;
                        for (const s of shots) {
                          if (s.audioSegmentLabel && s.audioSegment !== lastSeg) {
                            lastSeg = s.audioSegment;
                            rows.push(
                              <tr key={`seg-${s.audioSegment}`}>
                                <td
                                  colSpan={5}
                                  className="border-y border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-500"
                                >
                                  {s.audioSegmentLabel}
                                </td>
                              </tr>
                            );
                          }
                          rows.push(
                            <tr key={s.id} className="align-top odd:bg-muted/20">
                              <td className="border-b px-3 py-3 font-mono font-semibold">shot{s.id}</td>
                              <td className="border-b px-3 py-3">
                                <EditableCell shotId={s.id} kind="seedance" initialText={s.seedanceText} found={s.seedanceFound} />
                              </td>
                              <td className="border-b px-3 py-3">
                                <EditableCell shotId={s.id} kind="audio" initialText={s.audioText} found={s.audioFound} />
                              </td>
                              <td className="border-b px-3 py-3">
                                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                  <Speech size={13} /> Speech · for lipsync
                                </div>
                                <MediaTakes kind="audio" takes={s.speechTakes} reloadKey={reloadKey} />
                                <div className="mb-1 mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-500">
                                  <Leaf size={13} /> VFX · layer on video
                                </div>
                                <MediaTakes kind="audio" takes={s.vfxTakes} reloadKey={reloadKey} />
                              </td>
                              <td className="border-b px-3 py-3">
                                <MediaTakes kind="video" takes={s.videoTakes} reloadKey={reloadKey} />
                              </td>
                            </tr>
                          );
                        }
                        return rows;
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
  );
}

export { Shots };

// Route entry: loaderized like the other data tabs, so the live-sync firehose
// (invalidateTabCache + revalidate in RootLayout) refreshes it too. Load errors
// render through the route ErrorBoundary; `reloadKey` stays the media nonce.
export function loader() {
  return swr("shots", async () => {
    const res = await fetch("/api/shots");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load");
    return data.shots;
  });
}

export function Component() {
  const shots = useLoaderData();
  useRevalidateOnMount("shots");
  const { reloadKey } = useShell();
  return <Shots shots={shots} error={null} reloadKey={reloadKey} />;
}
