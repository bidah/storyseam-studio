import React, { useCallback, useEffect, useMemo, useState } from "react";

function EditableCell({ shotId, kind, initialText, found, segmentTag, segmentLabel }) {
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [status, setStatus] = useState(null); // "saving" | "ok" | error string
  const dirty = text !== saved;

  // Re-sync when a refresh brings new server text (only if user hasn't edited).
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
    return <span className="not-yet">no matching block in source file</span>;
  }

  return (
    <div>
      {segmentLabel ? (
        <div className="seg-header" title="Shared segment context (not editable here)">
          {segmentLabel}
        </div>
      ) : (
        segmentTag != null && <span className="seg-tag">SEGMENT {segmentTag}</span>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <div className="cell-actions">
        <button className="save" onClick={onSave} disabled={!dirty || status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {dirty && <span className="dirty-dot">● unsaved</span>}
        {status === "ok" && <span className="saved-msg">✓ written to file</span>}
        {status && status !== "ok" && status !== "saving" && (
          <span className="err-msg">{status}</span>
        )}
      </div>
    </div>
  );
}

function MediaTakes({ kind, takes, reloadKey }) {
  const list = Array.isArray(takes) ? takes : [];
  // index 0 = latest. Slider goes oldest (left) → latest (right).
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [reloadKey, list.length]);

  if (list.length === 0) {
    return <span className="not-yet">not generated yet</span>;
  }
  const takesArr = list;
  const t = takesArr[Math.min(i, takesArr.length - 1)];
  const src = `${t.url}?v=${reloadKey}`;
  return (
    <div className="media-takes">
      <div className="take-title" title={t.title}>
        {i === 0 ? "★ LATEST · " : ""}
        {t.title}
      </div>
      {kind === "audio" ? (
        <audio key={src} controls preload="none">
          <source src={src} type="audio/mpeg" />
        </audio>
      ) : (
        <video key={src} controls preload="metadata">
          <source src={src} type="video/mp4" />
        </video>
      )}
      {takesArr.length > 1 && (
        <div className="take-slider">
          <input
            type="range"
            min="0"
            max={takesArr.length - 1}
            value={takesArr.length - 1 - i}
            onChange={(e) => setI(takesArr.length - 1 - Number(e.target.value))}
          />
          <span className="take-count">
            take {t.take}
            {t.variant && t.variant !== "final" ? ` · ${t.variant}` : ""} ·{" "}
            {takesArr.length - i}/{takesArr.length}
          </span>
        </div>
      )}
    </div>
  );
}

function ImageModal({ image, onClose }) {
  // Close on Escape.
  useEffect(() => {
    if (!image) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [image, onClose]);

  if (!image) return null;
  return (
    <div className="ms-modal-overlay" onClick={onClose}>
      <div className="ms-modal" onClick={(e) => e.stopPropagation()}>
        <button className="ms-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <img src={image.url} alt={image.name} />
        <div className="ms-modal-cap">
          <span className="ms-ref-role">{image.role}</span>
          {image.name}
        </div>
      </div>
    </div>
  );
}

function GenerationSlideshow({ generations, reloadKey }) {
  const list = Array.isArray(generations) ? generations : [];
  const [i, setI] = useState(0);
  // Clamp when the list size changes (e.g. after a refresh).
  useEffect(() => {
    setI((cur) => Math.min(cur, Math.max(0, list.length - 1)));
  }, [list.length]);

  if (list.length === 0) {
    return (
      <section className="ms-panel ms-slideshow">
        <h3>Generations</h3>
        <div className="not-yet">
          no generations yet — submit the Seedance multishot job, then ↻ Refresh
        </div>
      </section>
    );
  }

  const g = list[Math.min(i, list.length - 1)];
  const prev = () => setI((c) => (c - 1 + list.length) % list.length);
  const next = () => setI((c) => (c + 1) % list.length);
  const params = g.params || {};

  return (
    <section className="ms-panel ms-slideshow">
      <div className="ms-slide-head">
        <h3>Generations</h3>
        <div className="ms-slide-nav">
          <button className="secondary" onClick={prev} disabled={list.length < 2} aria-label="Previous">
            ‹
          </button>
          <div className="ms-dots">
            {list.map((gen, idx) => (
              <button
                key={gen.id || idx}
                className={`ms-dot ${idx === i ? "active" : ""}`}
                onClick={() => setI(idx)}
                title={gen.label || `Take ${idx + 1}`}
              />
            ))}
          </div>
          <button className="secondary" onClick={next} disabled={list.length < 2} aria-label="Next">
            ›
          </button>
          <span className="ms-slide-count">
            {i + 1} / {list.length}
          </span>
        </div>
      </div>

      <div className="ms-slide-body">
        <div className="ms-slide-video">
          <div className="ms-slide-label">
            <strong>{g.label || `Take ${i + 1}`}</strong>
            <span className={`ms-audio-badge ${g.hasAudio ? "on" : "off"}`}>
              {g.hasAudio ? "🔊 has audio" : "🔇 silent"}
            </span>
            {g.createdAt && <span className="ms-slide-date">{g.createdAt}</span>}
          </div>
          {g.videoUrl ? (
            <video key={`${g.videoUrl}?v=${reloadKey}-${i}`} controls preload="metadata">
              <source src={`${g.videoUrl}?v=${reloadKey}`} type="video/mp4" />
            </video>
          ) : (
            <div className="not-yet">video file missing</div>
          )}
          {g.resultUrl && (
            <a className="ms-link" href={g.resultUrl} target="_blank" rel="noreferrer">
              result URL ↗
            </a>
          )}
        </div>

        <div className="ms-slide-details">
          <div className="ms-detail-block">
            <div className="ms-detail-title">Params</div>
            <div className="ms-params">
              {Object.entries(params).map(([k, v]) => (
                <div className="ms-param" key={k}>
                  <span className="ms-param-k">{k}</span>
                  <span className={`ms-param-v ${k === "generate_audio" ? (v ? "v-true" : "v-false") : ""}`}>
                    {String(v)}
                  </span>
                </div>
              ))}
              {g.id && (
                <div className="ms-param">
                  <span className="ms-param-k">job id</span>
                  <span className="ms-param-v mono">{g.id}</span>
                </div>
              )}
            </div>
          </div>

          {Array.isArray(g.mediaInputs) && g.mediaInputs.length > 0 && (
            <div className="ms-detail-block">
              <div className="ms-detail-title">Media inputs</div>
              <ul className="ms-mediainputs">
                {g.mediaInputs.map((m, idx) => (
                  <li key={idx}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="ms-detail-block">
            <div className="ms-detail-title">Prompt</div>
            <pre className="ms-prompt">{g.prompt}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function MultiShot({ reloadKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalImage, setModalImage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/multishot");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json.multishot);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) return <p className="status">loading multishot…</p>;
  if (error) return <p className="err-msg">Error: {error}</p>;
  if (!data) return <p className="not-yet">No multishot experiment found.</p>;

  return (
    <div className="multishot">
      <div className="ms-head">
        <h2>{data.title}</h2>
        <div className="ms-meta">
          <span className="ms-badge status-done">
            {(data.generations || []).length} generation
            {(data.generations || []).length === 1 ? "" : "s"}
          </span>
          <span>{data.model}</span>
          <span>{data.submittedVia}</span>
        </div>
      </div>

      {/* Generations slideshow (newest first), each with its prompt + params */}
      <GenerationSlideshow generations={data.generations} reloadKey={reloadKey} />

      <div className="ms-grid">
        {/* Summary: shots used */}
        <section className="ms-panel">
          <h3>Shots used ({data.shots.length})</h3>
          <ol className="ms-shots">
            {data.shots.map((s) => (
              <li key={s.id}>
                <div className="ms-shot-top">
                  <span className="ms-shot-id">shot{s.id}</span>
                  <span className="ms-shot-time">{s.time}</span>
                  <span className="ms-shot-cam">{s.camera}</span>
                </div>
                <div className="ms-shot-sum">{s.summary}</div>
                <div className="ms-shot-line">🗣 {s.dialogue}</div>
              </li>
            ))}
          </ol>
        </section>

        {/* Summary: image references used */}
        <section className="ms-panel">
          <h3>Images used ({data.images.length})</h3>
          <div className="ms-refs">
            {data.images.map((im) => (
              <figure key={im.file} className="ms-ref">
                <button
                  type="button"
                  className="ms-ref-btn"
                  onClick={() => setModalImage({ ...im, url: `${im.url}?v=${reloadKey}` })}
                  title="Click to view full image"
                >
                  <img src={`${im.url}?v=${reloadKey}`} alt={im.name} />
                </button>
                <figcaption>
                  <span className="ms-ref-role">{im.role}</span>
                  {im.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Summary: audio references used */}
        <section className="ms-panel">
          <h3>Audio used ({data.audio.length})</h3>
          <ul className="ms-audio">
            {data.audio.map((a) => (
              <li key={a.file}>
                <div className="ms-audio-top">
                  <span className="ms-ref-role">{a.role}</span>
                  <span className="ms-audio-name">{a.name}</span>
                </div>
                <audio controls preload="none" src={`${a.url}?v=${reloadKey}`} />
                {a.note && <div className="ms-audio-note">{a.note}</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button className={`ep-copy ${copied ? "ok" : ""}`} onClick={onCopy}>
      {copied ? "✓ copied" : "⧉ copy prompt"}
    </button>
  );
}

function ConfirmModal({ open, title, message, confirmLabel = "Remove", onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="ms-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// A single square reference thumbnail with an assign (＋) / remove (✕) button.
function SqItem({ im, on, bundleId, onAdd, onRemove, onView }) {
  return (
    <figure className={`sq-item ${on ? "selected" : ""}`}>
      <button className="ep-img-btn" onClick={() => onView({ url: im.url, name: im.rel, role: "reference" })}>
        <img src={im.url} loading="lazy" alt={im.name} />
      </button>
      {on ? (
        <button className="ep-remove" title="remove from this shot" onClick={() => onRemove(bundleId, im)}>✕</button>
      ) : (
        <button className="ep-pick-check" title="use in this shot" onClick={() => onAdd(bundleId, im)}>＋</button>
      )}
      <figcaption>{im.name}</figcaption>
    </figure>
  );
}

// Per-shot reference picker, in a modal. Same structure as the library tab
// (folders → grid) but limited to images PRE-SELECTED in the library, with the
// references already assigned to this shot pinned on top.
function RefPickerModal({ bundle, folders, picked, flat, onAdd, onRemove, onView, onClose }) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = [...picked].map((rel) => flat.get(rel)).filter(Boolean);
  const af = active && folders.find((f) => f.folder === active);

  return (
    <div className="ms-modal-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h3>
            References · <span className="ep-id">{bundle.id}</span>{" "}
            <span className="ep-name">{bundle.beatTitle}</span>
          </h3>
          <button className="ms-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* selections for THIS shot, pinned on top */}
        <div className="picker-selected">
          <div className="ep-sel-label">selected for this shot ({selected.length})</div>
          {selected.length === 0 ? (
            <div className="not-yet">none yet — pick from your library selections below</div>
          ) : (
            <div className="sq-grid">
              {selected.map((im) => (
                <SqItem key={im.rel} im={im} on bundleId={bundle.id} onAdd={onAdd} onRemove={onRemove} onView={onView} />
              ))}
            </div>
          )}
        </div>

        {/* browse the pre-selected pool, folders first */}
        <div className="picker-browse">
          {folders.length === 0 ? (
            <div className="not-yet">no images pre-selected yet — go to the library tab and select some first.</div>
          ) : af ? (
            <>
              <div className="lib-head">
                <button className="secondary" onClick={() => setActive(null)}>‹ folders</button>
                <h4>{af.folder}</h4>
                <span className="ep-badge">{af.images.length} selected here</span>
              </div>
              <div className="sq-grid">
                {af.images.map((im) => (
                  <SqItem
                    key={im.rel}
                    im={im}
                    on={picked.has(im.rel)}
                    bundleId={bundle.id}
                    onAdd={onAdd}
                    onRemove={onRemove}
                    onView={onView}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="lib-folders">
              {folders.map((f) => {
                const inShot = f.images.filter((i) => picked.has(i.rel)).length;
                return (
                  <button key={f.folder} className="lib-folder-card" onClick={() => setActive(f.folder)}>
                    <div className="lib-folder-thumb">
                      <img src={f.preview} loading="lazy" alt={f.folder} />
                      {inShot > 0 && <span className="lib-folder-badge">{inShot} ✓</span>}
                    </div>
                    <div className="lib-folder-meta">
                      <span className="lib-folder-name">{f.folder}</span>
                      <span className="lib-folder-count">{f.images.length} selected</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EpisodeBundle({ b, flat, picked, onOpenPicker, onRemove, onView }) {
  const [open, setOpen] = useState(false);
  const assigned = [...picked].map((rel) => flat.get(rel)).filter(Boolean);
  return (
    <section className="ep-bundle">
      <div className="ep-bundle-head">
        <div className="ep-bundle-title">
          <span className="ep-id">{b.id}</span>
          <span className="ep-name">{b.beatTitle}</span>
        </div>
        <div className="ep-meta">
          <span className="ep-badge">{b.shots.length} shots</span>
          <span className={`ep-badge ${b.durationEst > 15 ? "over" : "dur"}`}>~{b.durationEst}s → {b.duration}s</span>
          {assigned.length > 0 && <span className="ep-badge dur">{assigned.length} refs</span>}
        </div>
      </div>

      {/* What this scene needs (build's computed ref slots) — text only. */}
      <div className="ep-needs">
        <span className="ep-needs-label">scene needs:</span> {b.images.map((im) => im.key).join(" · ")}
      </div>

      {/* References ASSIGNED to this shot (square thumbnails) + open the picker. */}
      <div className="ep-assigned">
        {assigned.length === 0 ? (
          <span className="not-yet">no references chosen for this shot</span>
        ) : (
          <div className="sq-grid">
            {assigned.map((im) => (
              <figure key={im.rel} className="sq-item selected">
                <button className="ep-img-btn" onClick={() => onView({ url: im.url, name: im.rel, role: "reference" })}>
                  <img src={im.url} loading="lazy" alt={im.name} />
                </button>
                <button className="ep-remove" title="remove from this shot" onClick={() => onRemove(b.id, im)}>✕</button>
                <figcaption>{im.name}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <button className="secondary ep-choose" onClick={() => onOpenPicker(b)}>＋ choose references</button>
      </div>

      <ol className="ep-shots">
        {b.shots.map((s) => (
          <li key={s.id}>
            <div className="ep-shot-top">
              <span className="ep-shot-id">{s.id}</span>
              <span className="ep-shot-dur">{s.dur}s</span>
              <span className="ep-shot-loc">{s.location}</span>
              <span className="ep-shot-cam">{s.camera}</span>
            </div>
            <div className="ep-shot-sum">{s.summary}</div>
            {!/\(no dialogue\)/i.test(s.dialogue) && s.dialogue && (
              <div className="ep-shot-line">🗣 {s.dialogue}</div>
            )}
          </li>
        ))}
      </ol>

      <div className="ep-prompt-wrap">
        <div className="ep-prompt-bar">
          <span className="ep-prompt-label">skill prompt — paste back to generate this multishot</span>
          <CopyButton text={b.skillPrompt} />
        </div>
        <textarea
          className="ep-prompt"
          readOnly
          rows={open ? 18 : 4}
          value={b.skillPrompt}
          onFocus={() => setOpen(true)}
        />
        <button className="ep-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▴ collapse" : "▾ expand prompt"}
        </button>
      </div>
    </section>
  );
}

function Episode({ reloadKey, onView }) {
  const [data, setData] = useState(null);
  const [folders, setFolders] = useState([]); // raw /api/library folders
  const [picks, setPicks] = useState({}); // bundleId -> Set(rel)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // { bundle, f }
  const [pickerBundle, setPickerBundle] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch("/api/episode").then((r) => r.json()),
      fetch("/api/library").then((r) => r.json()),
      fetch("/api/final").then((r) => r.json()),
    ])
      .then(([ep, lib, fn]) => {
        if (!alive) return;
        if (ep.error) throw new Error(ep.error);
        setData(ep.episode);
        setFolders(lib.folders || []);
        const m = {};
        for (const [k, v] of Object.entries(fn.episode || {})) m[k] = new Set(v);
        setPicks(m);
      })
      .catch((e) => alive && setError(String(e.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Map every library image by rel (to resolve assigned thumbnails).
  const flat = useMemo(() => {
    const m = new Map();
    for (const f of folders) for (const im of f.images) m.set(im.rel, im);
    return m;
  }, [folders]);

  // The PRE-SELECTED pool, folder-structured (only library-selected images).
  const selFolders = useMemo(
    () =>
      folders
        .map((f) => {
          const imgs = f.images.filter((im) => im.selected);
          return { folder: f.folder, images: imgs, preview: imgs[0]?.url };
        })
        .filter((f) => f.images.length > 0),
    [folders]
  );
  const selCount = useMemo(() => [...flat.values()].filter((im) => im.selected).length, [flat]);

  const setPick = useCallback(async (bundle, rel, selected) => {
    setPicks((p) => {
      const s = new Set(p[bundle] || []);
      if (selected) s.add(rel);
      else s.delete(rel);
      return { ...p, [bundle]: s };
    });
    try {
      await fetch("/api/episode/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, rel, selected }),
      });
    } catch {
      /* keep optimistic state */
    }
  }, []);

  const onAdd = useCallback((bundle, im) => setPick(bundle, im.rel, true), [setPick]);
  const onRemove = useCallback((bundle, im) => setConfirm({ bundle, f: im }), []);

  const [assigning, setAssigning] = useState(false);
  const autoAssign = useCallback(async () => {
    setAssigning(true);
    try {
      const res = await fetch("/api/episode/auto-assign", { method: "POST" });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      const fn = await fetch("/api/final").then((r) => r.json());
      const m = {};
      for (const [k, v] of Object.entries(fn.episode || {})) m[k] = new Set(v);
      setPicks(m);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setAssigning(false);
    }
  }, []);

  if (loading) return <p className="status">loading episode plan…</p>;
  if (error) return <p className="err-msg">Error: {error}</p>;
  if (!data) return <p className="not-yet">No episode plan found. Run episode-multishot/build.mjs.</p>;

  return (
    <div className="episode">
      <div className="ep-head">
        <div className="ep-head-top">
          <h2>{data.title}</h2>
          <button className="ep-autoassign" onClick={autoAssign} disabled={assigning || selCount === 0}>
            {assigning ? "assigning…" : "✨ auto-assign references"}
          </button>
        </div>
        <div className="ep-head-meta">
          <span className="ep-badge">{data.bundles.length} multishot bundles</span>
          <span className="ep-badge">{data.totalShots} shots total</span>
          <span className="ep-badge dur">{selCount} library-selected refs</span>
          <span>auto-assign matches your library picks to each shot by character + location</span>
        </div>
      </div>
      <div className="ep-list">
        {data.bundles.map((b) => (
          <EpisodeBundle
            key={b.id}
            b={b}
            flat={flat}
            picked={picks[b.id] || new Set()}
            onOpenPicker={setPickerBundle}
            onRemove={onRemove}
            onView={onView}
          />
        ))}
      </div>

      {pickerBundle && (
        <RefPickerModal
          bundle={pickerBundle}
          folders={selFolders}
          picked={picks[pickerBundle.id] || new Set()}
          flat={flat}
          onAdd={onAdd}
          onRemove={onRemove}
          onView={onView}
          onClose={() => setPickerBundle(null)}
        />
      )}

      <ConfirmModal
        open={!!confirm}
        title="Remove reference from this shot?"
        message={confirm ? `"${confirm.f.name}" will no longer be used to generate ${confirm.bundle}.` : ""}
        confirmLabel="Remove from shot"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setPick(confirm.bundle, confirm.f.rel, false);
          setConfirm(null);
        }}
      />
    </div>
  );
}

// ---------------- Asset library (browse folders, select into final_selection) -----
function Library({ reloadKey, onView }) {
  const [folders, setFolders] = useState(null);
  const [active, setActive] = useState(null); // folder name
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // image pending removal

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/library")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setFolders(j.folders);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const toggle = useCallback(async (im) => {
    try {
      const res = await fetch("/api/library/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: im.rel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolders((fs) =>
        fs.map((f) => ({
          ...f,
          images: f.images.map((x) => (x.rel === im.rel ? { ...x, selected: data.selected } : x)),
        }))
      );
    } catch (e) {
      setError(String(e.message || e));
    }
  }, []);

  if (loading) return <p className="status">loading library…</p>;
  if (error) return <p className="err-msg">Error: {error}</p>;
  if (!folders) return null;

  const af = active && folders.find((f) => f.folder === active);

  if (af) {
    const selCount = af.images.filter((i) => i.selected).length;
    return (
      <div className="library">
        <div className="lib-head">
          <button className="secondary" onClick={() => setActive(null)}>‹ all folders</button>
          <h2>{af.folder}</h2>
          <span className="ep-badge">{af.count} images</span>
          {selCount > 0 && <span className="ep-badge dur">{selCount} selected</span>}
        </div>
        <div className="lib-grid">
          {af.images.map((im) => (
            <figure key={im.rel} className={`lib-item ${im.selected ? "selected" : ""}`}>
              <button className="ep-img-btn" onClick={() => onView({ url: im.url, name: im.rel, role: "asset" })}>
                <img src={im.url} loading="lazy" alt={im.name} />
              </button>
              {im.selected ? (
                <button className="ep-remove" title="remove from final_selection" onClick={() => setConfirm(im)}>✕</button>
              ) : (
                <button className="ep-pick-check" title="add to final_selection" onClick={() => toggle(im)}>＋</button>
              )}
              {im.selected && <span className="ep-sel-tag">selected</span>}
              <figcaption>{im.name}</figcaption>
            </figure>
          ))}
        </div>

        <ConfirmModal
          open={!!confirm}
          title="Remove from selection?"
          message={confirm ? `"${confirm.name}" will be removed from final_selection (and any shots it was assigned to).` : ""}
          confirmLabel="Remove"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            toggle(confirm);
            setConfirm(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="library">
      <div className="lib-head">
        <h2>Asset library</h2>
        <span className="ep-badge">{folders.length} folders</span>
        <span className="ep-badge dur">{folders.reduce((a, f) => a + f.images.filter((i) => i.selected).length, 0)} selected → final_selection</span>
      </div>
      <div className="lib-folders">
        {folders.map((f) => {
          const sel = f.images.filter((i) => i.selected).length;
          return (
            <button key={f.folder} className="lib-folder-card" onClick={() => setActive(f.folder)}>
              <div className="lib-folder-thumb">
                <img src={f.preview} loading="lazy" alt={f.folder} />
                {sel > 0 && <span className="lib-folder-badge">{sel} ✓</span>}
              </div>
              <div className="lib-folder-meta">
                <span className="lib-folder-name">{f.folder}</span>
                <span className="lib-folder-count">{f.count} images</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("shots"); // "shots" | "multishot" | "episode" | "library"
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // bump key forces media elements to reload when refreshing.
  const [reloadKey, setReloadKey] = useState(0);
  // shared full-size image modal for the episode + library tabs.
  const [modalImage, setModalImage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setShots(data.shots);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <header className="app-header">
        <div className="header-left">
          <h1>shot-studio · animation pipeline dashboard</h1>
          <nav className="tabs">
            <button
              className={`tab ${view === "shots" ? "active" : ""}`}
              onClick={() => setView("shots")}
            >
              shots
            </button>
            <button
              className={`tab ${view === "multishot" ? "active" : ""}`}
              onClick={() => setView("multishot")}
            >
              multi shot
            </button>
            <button
              className={`tab ${view === "episode" ? "active" : ""}`}
              onClick={() => setView("episode")}
            >
              episode (48)
            </button>
            <button
              className={`tab ${view === "library" ? "active" : ""}`}
              onClick={() => setView("library")}
            >
              library
            </button>
          </nav>
        </div>
        <div className="right">
          <span className="status">
            {loading ? "loading…" : `${shots.length} shots`}
          </span>
          <button className="secondary" onClick={load} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
      </header>

      {view === "library" ? (
        <div className="wrap">
          <Library reloadKey={reloadKey} onView={setModalImage} />
        </div>
      ) : view === "episode" ? (
        <div className="wrap">
          <Episode reloadKey={reloadKey} onView={setModalImage} />
        </div>
      ) : view === "multishot" ? (
        <div className="wrap">
          <MultiShot reloadKey={reloadKey} />
        </div>
      ) : (
      <div className="wrap">
        {error && <p className="err-msg">Error: {error}</p>}
        <table className="grid">
          <thead>
            <tr>
              <th className="col-shot">Shot</th>
              <th className="col-text">Seedance shot</th>
              <th className="col-text">Audio shot (seed-audio)</th>
              <th className="col-media">Audio generation</th>
              <th className="col-media">Video generation</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const rows = [];
              let lastSeg = null;
              for (const s of shots) {
                // Emit a sticky segment header whenever the segment changes.
                if (s.audioSegmentLabel && s.audioSegment !== lastSeg) {
                  lastSeg = s.audioSegment;
                  rows.push(
                    <tr key={`seg-${s.audioSegment}`} className="seg-row">
                      <td colSpan={5} className="seg-sticky">
                        {s.audioSegmentLabel}
                      </td>
                    </tr>
                  );
                }
                rows.push(
              <tr key={s.id}>
                <td className="col-shot">shot{s.id}</td>
                <td className="col-text">
                  <EditableCell
                    shotId={s.id}
                    kind="seedance"
                    initialText={s.seedanceText}
                    found={s.seedanceFound}
                  />
                </td>
                <td className="col-text">
                  <EditableCell
                    shotId={s.id}
                    kind="audio"
                    initialText={s.audioText}
                    found={s.audioFound}
                  />
                </td>
                <td className="col-media">
                  <div className="stem-label">🗣 Speech · for lipsync</div>
                  <MediaTakes kind="audio" takes={s.speechTakes} reloadKey={reloadKey} />
                  <div className="stem-label vfx">🌿 VFX · layer on video</div>
                  <MediaTakes kind="audio" takes={s.vfxTakes} reloadKey={reloadKey} />
                </td>
                <td className="col-media">
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
      )}

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
    </>
  );
}
