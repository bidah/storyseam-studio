import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, Check, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  RotateCcw, Maximize2, Volume2, VolumeX, Speech, Star, Play, RefreshCw,
  Copy, Pencil, ExternalLink, Leaf, Sparkles, TriangleAlert, Circle,
  Heart, Music, Save, Clock, Download, Trash2,
  PenLine, FileText, CheckSquare, Square, Image as ImageIcon,
} from "lucide-react";

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
        {dirty && <span className="dirty-dot"><Circle size={8} fill="currentColor" /> unsaved</span>}
        {status === "ok" && <span className="saved-msg"><Check size={13} /> written to file</span>}
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
        {i === 0 && (
          <span className="take-latest"><Star size={12} fill="currentColor" /> LATEST · </span>
        )}
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
          <X size={18} />
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
          no generations yet — submit the Seedance multishot job, then <RefreshCw size={12} /> Refresh
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
            <ChevronLeft size={16} />
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
            <ChevronRight size={16} />
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
              {g.hasAudio ? <><Volume2 size={13} /> has audio</> : <><VolumeX size={13} /> silent</>}
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
              result URL <ExternalLink size={12} />
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
                <div className="ms-shot-line"><Speech size={13} /> {s.dialogue}</div>
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

// Friendly label for a reference image, from its filename.
function refLabel(rel) {
  const base = rel.split("/").pop().toLowerCase();
  const night = base.includes("night");
  const t = (n) => (night ? `${n} (night)` : n);
  if (base.includes("kids")) return "Elf kids";
  if (base.includes("king") && base.includes("house")) return "King's house";
  if (base.includes("king")) return t("Forest King");
  if (base.includes("sara")) return t("Sara");
  if (base.includes("helena")) return t("Helena");
  if (base.includes("mote") || base.includes("glow")) return t("Mote");
  if (base.includes("deep") && base.includes("forest")) return t("deep wood");
  if (base.includes("school")) return "school";
  if (base.includes("classroom")) return "classroom";
  if (base.includes("forest")) return t("forest");
  return base.replace(/\.[a-z0-9]+$/, "");
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
      {copied ? <><Check size={13} /> copied</> : <><Copy size={13} /> copy prompt</>}
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

// Per-bundle revision signing. Three independent section signatures
// (images | prompt | audio); toggling a box signs/clears that section with the
// signer name + a server timestamp. When all three are set the bundle is signed.
const SIGN_SECTIONS = [
  { key: "images", label: "Images", hint: "all references needed for the prompt are assigned", Icon: ImageIcon },
  { key: "prompt", label: "Prompt", hint: "the skill prompt is final", Icon: FileText },
  { key: "audio", label: "Audio", hint: "the voice / sound references are correct", Icon: Volume2 },
];
function SigningModal({ bundle, signoff, onSign, onClose }) {
  const [signedBy, setSignedBy] = useState(() => {
    try { return localStorage.getItem("shotStudioSigner") || ""; } catch { return ""; }
  });
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const so = signoff || { images: null, prompt: null, audio: null };
  const name = signedBy.trim();
  const toggle = (section, signed) => {
    if (signed) {
      if (!name) return;
      try { localStorage.setItem("shotStudioSigner", name); } catch { /* ignore */ }
    }
    onSign(bundle.id, section, signed, name);
  };
  const fmt = (at) => { try { return new Date(at).toLocaleString(); } catch { return at; } };
  return (
    <div className="ms-modal-overlay" onClick={onClose}>
      <div className="confirm-modal signing-modal" onClick={(e) => e.stopPropagation()}>
        <h3><PenLine size={16} /> Revision signing · <span className="ep-id">{bundle.id}</span> <span className="ep-name">{bundle.beatTitle}</span></h3>
        <label className="signing-by">
          Signed by
          <input
            type="text"
            value={signedBy}
            placeholder="your name"
            onChange={(e) => setSignedBy(e.target.value)}
          />
        </label>
        <div className="signing-rows">
          {SIGN_SECTIONS.map(({ key, label, hint, Icon }) => {
            const sig = so[key];
            const on = !!sig;
            return (
              <div key={key} className={`signing-row ${on ? "signed" : ""}`}>
                <button
                  className="signing-check"
                  aria-label={on ? `unsign ${label}` : `sign ${label}`}
                  disabled={!on && !name}
                  onClick={() => toggle(key, !on)}
                >
                  {on ? <CheckSquare size={18} /> : <Square size={18} />}
                </button>
                <div className="signing-meta">
                  <div className="signing-label"><Icon size={13} /> {label}</div>
                  <div className="signing-hint">{on ? `signed by ${sig.by} · ${fmt(sig.at)}` : hint}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="confirm-actions">
          <button className="secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// A single square reference thumbnail with an assign (Plus) / remove (X) button.
function SqItem({ im, on, bundleId, onAdd, onRemove, onView }) {
  return (
    <figure className={`sq-item ${on ? "selected" : ""}`}>
      <button className="ep-img-btn" onClick={() => onView({ url: im.url, name: im.rel, role: "reference" })}>
        <img src={im.url} loading="lazy" alt={im.name} />
      </button>
      {on ? (
        <button className="ep-remove" title="remove from this shot" aria-label="remove from this shot" onClick={() => onRemove(bundleId, im)}><X size={13} /></button>
      ) : (
        <button className="ep-pick-check" title="use in this shot" aria-label="use in this shot" onClick={() => onAdd(bundleId, im)}><Plus size={14} /></button>
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
          <button className="ms-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
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
                <button className="secondary" onClick={() => setActive(null)}><ChevronLeft size={14} /> folders</button>
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
                      {inShot > 0 && <span className="lib-folder-badge">{inShot} <Check size={11} /></span>}
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

// Right-rail slider over a bundle's rendered generations (newest selected first),
// mirroring the multishot tab's slideshow: name label + prev/next + dots.
function EpVideoRail({ bundleId, vids, reloadKey, onToggleVideo }) {
  const [i, setI] = useState(vids.length - 1); // default to newest
  useEffect(() => {
    setI(vids.length - 1);
  }, [vids.length]);
  const idx = Math.min(i, vids.length - 1);
  const g = vids[idx];
  const prev = () => setI((n) => (n - 1 + vids.length) % vids.length);
  const next = () => setI((n) => (n + 1) % vids.length);
  const selCount = vids.filter((v) => v.selected).length;
  return (
    <div className="ep-rail">
      <div className="ep-rail-head">
        <span className="ep-rail-name">
          {bundleId} · {g.name || `gen ${idx + 1}`}
          {selCount > 0 && <span className="ep-rail-selcount">{selCount} <Check size={11} /> for stitch</span>}
        </span>
        <div className="ep-rail-nav">
          <button className="secondary" onClick={prev} disabled={vids.length < 2} aria-label="Previous"><ChevronLeft size={16} /></button>
          <span className="ep-rail-count">{idx + 1} / {vids.length}</span>
          <button className="secondary" onClick={next} disabled={vids.length < 2} aria-label="Next"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className={`ep-rail-frame ${g.selected ? "selected" : ""}`}>
        <video key={`${g.url}?v=${reloadKey}-${idx}`} controls preload="metadata" playsInline>
          <source src={`${g.url}?v=${reloadKey}`} type="video/mp4" />
        </video>
        <button
          className={`ep-vid-check ${g.selected ? "on" : ""}`}
          title={g.selected ? "selected for stitching — click to unselect" : "select this take for stitching"}
          onClick={() => onToggleVideo(bundleId, g.file, !g.selected)}
        >
          {g.selected && <Check size={14} />}
        </button>
        {g.selected && <span className="ep-vid-badge">selected</span>}
      </div>
      {vids.length > 1 && (
        <div className="ep-rail-dots">
          {vids.map((v, k) => (
            <button
              key={v.file || k}
              className={`ep-rail-dot ${k === idx ? "active" : ""} ${v.selected ? "picked" : ""}`}
              onClick={() => setI(k)}
              title={`${v.name || `gen ${k + 1}`}${v.selected ? " — selected" : ""}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Restriction toggles for the lead line (originally the single NOFX line
// "NO VISUAL EFFECTS AND NO BACKGROUND MUSIC."). Each selected toggle contributes
// its caps fragment; the fragments are joined back into that one line.
const RESTRICTIONS = [
  { key: "noMusic", label: "no background music", frag: "NO BACKGROUND MUSIC" },
  { key: "noVfx", label: "no visual effects & sounds", frag: "NO VISUAL EFFECTS AND NO SOUND EFFECTS" },
  { key: "justDialog", label: "just dialog", frag: "ONLY DIALOGUE — NO OTHER AUDIO" },
];

function restrictionsFromLine(line) {
  return {
    noMusic: /background music/i.test(line),
    noVfx: /visual effects/i.test(line),
    justDialog: /only dialogue|just dialog/i.test(line),
  };
}

function lineFromRestrictions(state) {
  const frags = RESTRICTIONS.filter((r) => state[r.key]).map((r) => r.frag);
  return frags.length ? frags.join(". ") + "." : "";
}

// Split a bundle's skill-prompt body into editable sections: the lead restriction
// line, the STYLE line, the middle directives block, and one block per shot.
// serializePrompt() is the exact inverse.
function parsePrompt(body) {
  const shotStart = body.search(/^SHOT \d+ \(/m);
  const head = (shotStart >= 0 ? body.slice(0, shotStart) : body).replace(/\s+$/, "");
  const shotsText = shotStart >= 0 ? body.slice(shotStart) : "";
  const shots = shotsText
    ? shotsText.split(/\n\n(?=SHOT \d+ \()/).map((s) => s.replace(/\s+$/, ""))
    : [];
  const lines = head.split("\n");
  const restrictionLine = lines[0] ?? "";
  const styleIdx = lines.findIndex((l) => /^STYLE:/i.test(l));
  const directives = (styleIdx >= 0 ? lines.slice(styleIdx + 1) : lines.slice(1)).join("\n").trim();
  return { restrictionLine, styleLine: styleIdx >= 0 ? lines[styleIdx] : "", directives, shots };
}

function serializePrompt({ restrictionLine, styleLine, directives, shots }) {
  const head = [restrictionLine, styleLine, directives].join("\n");
  return shots.length ? head + "\n\n" + shots.join("\n\n") : head;
}

// Full-screen editor for a bundle's skill prompt. Edits the sections; every change
// recomposes the body and is pushed up (parent debounce-saves it). Image / sound
// references are managed by the pickers behind the modal, shown here read-only.
function PromptModal({ bundle, body, fullPrefix, assigned, audioAssigned, edited, onView, onChange, onReset, onClose }) {
  const [sec, setSec] = useState(() => parsePrompt(body));
  const restr = useMemo(() => restrictionsFromLine(sec.restrictionLine), [sec.restrictionLine]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const push = useCallback(
    (next) => {
      setSec(next);
      onChange(serializePrompt(next));
    },
    [onChange]
  );
  const toggleRestriction = (key) =>
    push({ ...sec, restrictionLine: lineFromRestrictions({ ...restr, [key]: !restr[key] }) });
  const setField = (field, val) => push({ ...sec, [field]: val });
  const setShot = (i, val) => {
    const shots = sec.shots.slice();
    shots[i] = val;
    push({ ...sec, shots });
  };

  return (
    <div className="ms-modal-overlay" onClick={onClose}>
      <div className="prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-head">
          <h3>
            <span className="ep-id">{bundle.id}</span> {bundle.beatTitle} — edit prompt
            {edited ? <span className="ep-prompt-flag"><Pencil size={11} /> edited</span> : <span className="ep-prompt-flag live">live</span>}
          </h3>
          <div className="pm-head-actions">
            {edited && (
              <button className="secondary" onClick={onReset} title="discard edits, return to the auto-composed prompt">
                <RotateCcw size={13} /> reset to live
              </button>
            )}
            <CopyButton text={fullPrefix + serializePrompt(sec)} />
            <button className="ms-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>

        <div className="pm-body">
          <section className="pm-sec">
            <label className="pm-label">Audio / VFX restrictions</label>
            <div className="pm-restrictions">
              {RESTRICTIONS.map((r) => (
                <button
                  key={r.key}
                  className={`pm-chip ${restr[r.key] ? "on" : ""}`}
                  onClick={() => toggleRestriction(r.key)}
                >
                  {restr[r.key] && <Check size={13} className="pm-chip-check" />}
                  {r.label}
                </button>
              ))}
            </div>
            <div className="pm-line-preview">
              {sec.restrictionLine || "(no restrictions — Seedance may add music, VFX & sound)"}
            </div>
          </section>

          <section className="pm-sec">
            <label className="pm-label">
              References <span className="pm-hint">managed with the pickers behind this modal · click a thumbnail to preview</span>
            </label>
            {assigned.length === 0 && audioAssigned.length === 0 ? (
              <span className="not-yet">no references chosen</span>
            ) : (
              <div className="pm-refs">
                {assigned.map((im) => (
                  <figure key={im.rel} className="pm-ref-thumb">
                    <button
                      type="button"
                      className="ep-img-btn"
                      onClick={() => onView({ url: im.url, name: im.rel, role: "reference" })}
                      title="click to view full image"
                    >
                      <img src={im.url} loading="lazy" alt={im.name} />
                    </button>
                    <figcaption>{refLabel(im.rel)}</figcaption>
                  </figure>
                ))}
                {audioAssigned.map((a) => (
                  <span key={a.rel} className="pm-ref-chip"><Volume2 size={12} /> {a.label}</span>
                ))}
              </div>
            )}
          </section>

          <section className="pm-sec">
            <label className="pm-label">Style</label>
            <textarea
              className="pm-textarea"
              rows={6}
              value={sec.styleLine}
              onChange={(e) => setField("styleLine", e.target.value)}
            />
          </section>

          <section className="pm-sec">
            <label className="pm-label">Directives</label>
            <textarea
              className="pm-textarea"
              rows={7}
              value={sec.directives}
              onChange={(e) => setField("directives", e.target.value)}
            />
          </section>

          <section className="pm-sec">
            <label className="pm-label">Shots ({sec.shots.length})</label>
            <div className="pm-shots">
              {sec.shots.map((s, i) => (
                <div className="pm-shot" key={i}>
                  <div className="pm-shot-num">Shot {i + 1}</div>
                  <textarea
                    className="pm-textarea"
                    rows={5}
                    value={s}
                    onChange={(e) => setShot(i, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function EpisodeBundle({ b, flat, picked, onOpenPicker, onRemove, onView, audioMap, audioPicked, onOpenAudio, vids, reloadKey, onToggleVideo, override, onEditPrompt, onResetPrompt, signoff, onSign }) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const signedCount = signoff ? ["images", "prompt", "audio"].filter((k) => signoff[k]).length : 0;
  const hasVid = Array.isArray(vids) && vids.length > 0;
  const edited = typeof override === "string";
  const assigned = [...picked].map((rel) => flat.get(rel)).filter(Boolean);
  const audioAssigned = [...audioPicked].map((rel) => audioMap.get(rel)).filter(Boolean);

  // Live skill prompt: image refs + voice refs (name + path) on top, then body.
  const refBlock = assigned.length
    ? "IMAGE REFERENCES (pass each file as an image_references entry):\n" +
      assigned.map((im) => `- ${refLabel(im.rel)}: ${im.abs || im.rel}`).join("\n")
    : "IMAGE REFERENCES: (none selected yet — use “choose references” above)";
  const audioBlock = audioAssigned.length
    ? "\n\nVOICE / SOUND REFERENCES (pass as the audio reference — voice identity, NOT dialogue):\n" +
      audioAssigned
        .map(
          (a) =>
            `- ${a.label}: ${a.abs || a.rel}` +
            (a.order && a.order.length > 1
              ? ` — voices appear in this order: ${a.order.map((n, i) => `${i + 1}=${n}`).join(", ")}`
              : "")
        )
        .join("\n")
    : "";
  // The override stores only the edited BODY; the image/sound reference blocks stay
  // live-composed and prepended, so they keep updating even after the body is edited.
  const bodyPrompt = edited ? override : b.skillPrompt;
  const fullPrefix = refBlock + audioBlock + "\n\n";
  const displayPrompt = fullPrefix + bodyPrompt;
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
          {hasVid && <span className="ep-badge rendered"><Play size={11} fill="currentColor" /> {vids.length} rendered</span>}
          {signedCount === 3 ? (
            <span className="ep-badge dur"><Check size={11} /> signed</span>
          ) : signedCount > 0 ? (
            <span className="ep-badge miss">{signedCount}/3 signed</span>
          ) : null}
          <button className="secondary ep-sign" onClick={() => setSignOpen(true)} title="revision signing">
            <PenLine size={13} /> revision signing
          </button>
        </div>
      </div>

      <div className={`ep-body ${hasVid ? "has-video" : ""}`}>
        <div className="ep-main">

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
                <button className="ep-remove" title="remove from this shot" aria-label="remove from this shot" onClick={() => onRemove(b.id, im)}><X size={13} /></button>
                <figcaption>{im.name}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <button className="secondary ep-choose" onClick={() => onOpenPicker(b)}><Plus size={14} /> choose references</button>
      </div>

      {/* Voice / sound references for this scene */}
      <div className="ep-assigned ep-audio-row">
        {audioAssigned.length === 0 ? (
          <span className="not-yet">no voice reference chosen</span>
        ) : (
          <div className="ep-audio-chips">
            {audioAssigned.map((a) => (
              <span key={a.rel} className="ep-audio-chip" title={a.rel}>
                <Volume2 size={12} /> {a.label}
                {a.order && a.order.length > 1 && (
                  <em> ({a.order.map((n, i) => `${i + 1}=${n}`).join(", ")})</em>
                )}
              </span>
            ))}
          </div>
        )}
        <button className="secondary ep-choose" onClick={() => onOpenAudio(b)}><Volume2 size={14} /> choose audio references</button>
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
              <div className="ep-shot-line"><Speech size={13} /> {s.dialogue}</div>
            )}
          </li>
        ))}
      </ol>

      <div className="ep-prompt-wrap">
        <div className="ep-prompt-bar">
          <span className="ep-prompt-label">
            skill prompt — click to edit, auto-saves
            {edited ? <span className="ep-prompt-flag"><Pencil size={11} /> edited</span> : <span className="ep-prompt-flag live">live</span>}
          </span>
          <div className="ep-prompt-actions">
            {edited && (
              <button className="secondary ep-reset" onClick={() => onResetPrompt(b.id)} title="discard edits, return to the auto-composed prompt">
                <RotateCcw size={13} /> reset to live
              </button>
            )}
            <button className="secondary ep-edit" onClick={() => setModalOpen(true)} title="open the full-screen prompt editor">
              <Maximize2 size={13} /> edit
            </button>
            <CopyButton text={displayPrompt} />
          </div>
        </div>
        <textarea
          className="ep-prompt ep-prompt-preview"
          rows={open ? 20 : 6}
          value={displayPrompt}
          readOnly
          onClick={() => setModalOpen(true)}
          title="click to open the full-screen editor"
        />
        <button className="ep-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <><ChevronUp size={13} /> collapse</> : <><ChevronDown size={13} /> expand prompt</>}
        </button>
      </div>
      {modalOpen && (
        <PromptModal
          bundle={b}
          body={bodyPrompt}
          fullPrefix={fullPrefix}
          assigned={assigned}
          audioAssigned={audioAssigned}
          edited={edited}
          onView={onView}
          onChange={(text) => onEditPrompt(b.id, text)}
          onReset={() => { onResetPrompt(b.id); setModalOpen(false); }}
          onClose={() => setModalOpen(false)}
        />
      )}
      {signOpen && (
        <SigningModal
          bundle={b}
          signoff={signoff}
          onSign={onSign}
          onClose={() => setSignOpen(false)}
        />
      )}
        </div>{/* /ep-main */}

        {/* The rendered Seedance clips — right rail, ~1/3 width, slider per gen. */}
        {hasVid && (
          <aside className="ep-video">
            <EpVideoRail bundleId={b.id} vids={vids} reloadKey={reloadKey} onToggleVideo={onToggleVideo} />
          </aside>
        )}
      </div>{/* /ep-body */}
    </section>
  );
}

function AudioPickerModal({ bundle, audioRefs, picked, onToggle, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ms-modal-overlay" onClick={onClose}>
      <div className="picker-modal audio-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h3>
            Voice / sound references · <span className="ep-id">{bundle.id}</span>{" "}
            <span className="ep-name">{bundle.beatTitle}</span>
          </h3>
          <button className="ms-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="audio-list">
          {audioRefs.map((a) => {
            const on = picked.has(a.rel);
            return (
              <div key={a.rel} className={`audio-item ${on ? "selected" : ""}`}>
                <button
                  className={`ep-pick-check ${on ? "on" : ""}`}
                  title={on ? "remove from this shot" : "use in this shot"}
                  onClick={() => onToggle(bundle.id, a.rel, !on)}
                >
                  {on ? <Check size={14} /> : <Plus size={14} />}
                </button>
                <div className="audio-meta">
                  <div className="audio-label">
                    {a.label}
                    {!a.exists && <span className="ep-badge miss"> missing file</span>}
                  </div>
                  {a.order && a.order.length > 1 && (
                    <div className="audio-order">voice order: {a.order.map((n, i) => `${i + 1}=${n}`).join(", ")}</div>
                  )}
                  <audio controls preload="none" src={a.url} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
  const [audioRefs, setAudioRefs] = useState([]);
  const [audioPicks, setAudioPicks] = useState({}); // bundleId -> Set(rel)
  const [audioPicker, setAudioPicker] = useState(null);
  const [videos, setVideos] = useState({}); // bundleId -> { url, ... } rendered clips
  const [prompts, setPrompts] = useState({}); // bundleId -> edited prompt override
  const [signoffs, setSignoffs] = useState({}); // bundleId -> { images, prompt, audio }
  const promptTimers = useRef({}); // bundleId -> debounce timer

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch("/api/episode").then((r) => r.json()),
      fetch("/api/library").then((r) => r.json()),
      fetch("/api/final").then((r) => r.json()),
      fetch("/api/audio").then((r) => r.json()),
    ])
      .then(([ep, lib, fn, au]) => {
        if (!alive) return;
        if (ep.error) throw new Error(ep.error);
        setData(ep.episode);
        setVideos(ep.video || {});
        setPrompts(ep.prompts || {});
        setSignoffs(ep.signoffs || {});
        setFolders(lib.folders || []);
        const m = {};
        for (const [k, v] of Object.entries(fn.episode || {})) m[k] = new Set(v);
        setPicks(m);
        setAudioRefs(au.audio || []);
        const am = {};
        for (const [k, v] of Object.entries(au.episode || {})) am[k] = new Set(v);
        setAudioPicks(am);
      })
      .catch((e) => alive && setError(String(e.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const audioMap = useMemo(() => {
    const m = new Map();
    for (const a of audioRefs) m.set(a.rel, a);
    return m;
  }, [audioRefs]);

  const onAudioToggle = useCallback(async (bundle, rel, selected) => {
    setAudioPicks((p) => {
      const s = new Set(p[bundle] || []);
      if (selected) s.add(rel);
      else s.delete(rel);
      return { ...p, [bundle]: s };
    });
    try {
      await fetch("/api/episode/audio-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, rel, selected }),
      });
    } catch {
      /* keep optimistic state */
    }
  }, []);

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

  // Select/deselect a rendered generation for later stitching.
  const onToggleVideo = useCallback((bundle, file, selected) => {
    setVideos((vs) => {
      const arr = (vs[bundle] || []).map((g) => (g.file === file ? { ...g, selected } : g));
      return { ...vs, [bundle]: arr };
    });
    fetch("/api/episode/video-select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, file, selected }),
    }).catch(() => {});
  }, []);

  // Edited skill prompt: update local state immediately, debounce-save to disk.
  const onEditPrompt = useCallback((bundle, text) => {
    setPrompts((p) => ({ ...p, [bundle]: text }));
    clearTimeout(promptTimers.current[bundle]);
    promptTimers.current[bundle] = setTimeout(() => {
      fetch("/api/episode/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, text }),
      }).catch(() => {});
    }, 600);
  }, []);
  // Reset to the live auto-composed prompt (clears the override on disk too).
  const onResetPrompt = useCallback((bundle) => {
    setPrompts((p) => {
      const n = { ...p };
      delete n[bundle];
      return n;
    });
    clearTimeout(promptTimers.current[bundle]);
    fetch("/api/episode/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, text: "" }),
    }).catch(() => {});
  }, []);

  // Revision signing: sign/clear one section (images|prompt|audio) of a bundle.
  const onSign = useCallback(async (bundle, section, signed, signedBy) => {
    try {
      const res = await fetch("/api/episode/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, section, signed, signedBy }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      setSignoffs((s) => ({ ...s, [bundle]: out.signoff }));
    } catch {
      /* leave prior state on failure */
    }
  }, []);

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
      const au = await fetch("/api/audio").then((r) => r.json());
      const am = {};
      for (const [k, v] of Object.entries(au.episode || {})) am[k] = new Set(v);
      setAudioPicks(am);
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
            {assigning ? "assigning…" : <><Sparkles size={14} /> auto-assign references</>}
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
            audioMap={audioMap}
            audioPicked={audioPicks[b.id] || new Set()}
            onOpenAudio={setAudioPicker}
            vids={videos[b.id] || []}
            reloadKey={reloadKey}
            onToggleVideo={onToggleVideo}
            override={prompts[b.id]}
            onEditPrompt={onEditPrompt}
            onResetPrompt={onResetPrompt}
            signoff={signoffs[b.id]}
            onSign={onSign}
          />
        ))}
      </div>

      {audioPicker && (
        <AudioPickerModal
          bundle={audioPicker}
          audioRefs={audioRefs}
          picked={audioPicks[audioPicker.id] || new Set()}
          onToggle={onAudioToggle}
          onClose={() => setAudioPicker(null)}
        />
      )}

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

// ---------------- Complete cuts (stitch selected takes MS-01 → MS-22) --------------
function fmtTime(sec) {
  if (!sec && sec !== 0) return "—";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function CompleteCuts({ reloadKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stitching, setStitching] = useState(false);
  const [bump, setBump] = useState(0); // cache-bust the output video after a stitch

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/episode/cuts");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const stitch = useCallback(async () => {
    setStitching(true);
    setError(null);
    try {
      const res = await fetch("/api/episode/stitch", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Stitch failed");
      await load();
      setBump((b) => b + 1);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setStitching(false);
    }
  }, [load]);

  if (loading) return <p className="status">loading cuts…</p>;
  if (!data) return <p className="err-msg">Error: {error}</p>;

  const segs = data.segments || [];
  const usable = segs.filter((s) => s.file);
  const missing = segs.filter((s) => s.missing);
  const fallbacks = usable.filter((s) => s.fallback);
  const total = usable.reduce((a, s) => a + s.duration, 0);
  const out = data.output;

  return (
    <div className="cuts">
      <div className="ep-head">
        <div className="ep-head-top">
          <h2>Complete cut · {data.range.from} → {data.range.to}</h2>
          <button className="ep-autoassign" onClick={stitch} disabled={stitching || usable.length === 0}>
            {stitching ? "stitching…" : out ? <><RefreshCw size={13} /> re-stitch</> : <><Play size={13} fill="currentColor" /> stitch selected takes</>}
          </button>
        </div>
        <div className="ep-head-meta">
          <span className="ep-badge">{usable.length} scenes</span>
          <span className="ep-badge dur">~{fmtTime(total)} total</span>
          {fallbacks.length > 0 && <span className="ep-badge over">{fallbacks.length} fallback (no take selected)</span>}
          {missing.length > 0 && <span className="ep-badge over">{missing.length} missing</span>}
          <span>concatenates the <Check size={11} /> selected take of each scene, in order, into one mp4</span>
        </div>
      </div>

      {error && <p className="err-msg">Error: {error}</p>}

      {/* The stitched result */}
      {out ? (
        <section className="ms-panel cuts-output">
          <h3>Stitched video</h3>
          <video key={`${out.url}?v=${bump}`} controls preload="metadata">
            <source src={`${out.url}?v=${bump}`} type="video/mp4" />
          </video>
          <div className="cuts-out-meta">
            stitched from <strong>{out.range?.from || data.range.from}</strong> →{" "}
            <strong>{out.range?.to || data.range.to}</strong>
            {out.totalDuration != null && <> · {fmtTime(out.totalDuration)}</>}
            {out.stitchedAt && <> · {new Date(out.stitchedAt).toLocaleString()}</>}
          </div>
          <a className="ms-link" href={`${out.url}?v=${bump}`} target="_blank" rel="noreferrer" download>
            download mp4 <ExternalLink size={12} />
          </a>
        </section>
      ) : (
        <div className="not-yet">
          not stitched yet — press “stitch selected takes” to build the {data.range.from} → {data.range.to} cut.
        </div>
      )}

      {/* The ordered stitch timeline: which take each scene contributes + from→to */}
      <section className="ms-panel">
        <h3>Stitch order ({usable.length} scenes)</h3>
        <ol className="cuts-list">
          {segs.map((s) => (
            <li key={s.id} className={`cuts-row ${s.missing ? "missing" : ""} ${s.fallback ? "fallback" : ""}`}>
              <span className="cuts-id">{s.id}</span>
              {s.missing ? (
                <span className="not-yet">no rendered take</span>
              ) : (
                <>
                  <span className="cuts-take">
                    {s.name}
                    {s.fallback ? (
                      <span className="ep-prompt-flag"><TriangleAlert size={11} /> no take selected — using first</span>
                    ) : (
                      <span className="ep-prompt-flag live"><Check size={11} /> selected</span>
                    )}
                  </span>
                  <span className="cuts-range">
                    {fmtTime(s.start)} → {fmtTime(s.end)}
                    <em> ({s.duration.toFixed(1)}s)</em>
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      </section>
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
          <button className="secondary" onClick={() => setActive(null)}><ChevronLeft size={14} /> all folders</button>
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
                <button className="ep-remove" title="remove from final_selection" aria-label="remove from final_selection" onClick={() => setConfirm(im)}><X size={13} /></button>
              ) : (
                <button className="ep-pick-check" title="add to final_selection" aria-label="add to final_selection" onClick={() => toggle(im)}><Plus size={14} /></button>
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
                {sel > 0 && <span className="lib-folder-badge">{sel} <Check size={11} /></span>}
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

// ===========================================================================
// Sound Studio — an audio library. Each track keeps ordered versions; editing
// a prompt saves a NEW version (starts "pending" until rendered). Like a
// version, rename it or the track, and play/download the rendered audio.
// ===========================================================================
async function soundApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function SoundVersion({ track, ver, onChanged }) {
  const [prompt, setPrompt] = useState(ver.prompt);
  const [vname, setVname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setPrompt(ver.prompt);
  }, [ver.prompt, ver.v, track.id]);
  const dirty = prompt !== ver.prompt;

  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveNewVersion = () =>
    run(async () => {
      await soundApi(`/api/sounds/${track.id}/version`, {
        method: "POST",
        body: JSON.stringify({ prompt, name: vname }),
      });
      setVname("");
    });
  const saveInPlace = () =>
    run(() =>
      soundApi(`/api/sounds/${track.id}/version/${ver.v}`, {
        method: "PATCH",
        body: JSON.stringify({ prompt }),
      })
    );
  const toggleLike = () =>
    run(() => soundApi(`/api/sounds/${track.id}/version/${ver.v}/like`, { method: "POST" }));
  const del = () => {
    if (window.confirm(`Delete v${ver.v}?`))
      run(() => soundApi(`/api/sounds/${track.id}/version/${ver.v}`, { method: "DELETE" }));
  };

  return (
    <div className={`ss-ver ${ver.liked ? "liked" : ""}`}>
      <div className="ss-ver-top">
        <span className="ss-badge">v{ver.v}</span>
        {ver.name && <span className="ss-vname">{ver.name}</span>}
        {ver.status === "ready" ? (
          <span className="ss-pill ready">ready</span>
        ) : (
          <span className="ss-pill pending">
            <Clock size={11} /> needs render
          </span>
        )}
        {ver.duration ? <span className="ss-dur">{ver.duration.toFixed(1)}s</span> : null}
        <span className="ss-spacer" />
        <button
          className="ss-like"
          aria-label={ver.liked ? "Unlike this version" : "Like this version"}
          onClick={toggleLike}
          disabled={busy}
          title="Like"
        >
          <Heart size={16} fill={ver.liked ? "#c33a54" : "none"} />
        </button>
        <button
          className="ss-icon-btn"
          aria-label="Delete this version"
          onClick={del}
          disabled={busy}
          title="Delete version"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <textarea
        className="ss-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        spellCheck={false}
      />

      <div className="ss-actions">
        <input
          className="ss-vname-input"
          placeholder="new version name (optional)"
          value={vname}
          onChange={(e) => setVname(e.target.value)}
        />
        <button
          className="save ss-mini"
          onClick={saveNewVersion}
          disabled={busy || !prompt.trim()}
          title="Save the edited prompt as a new version (starts pending)"
        >
          <Plus size={13} /> Save as new version
        </button>
        {dirty && (
          <>
            <button
              className="secondary ss-mini"
              onClick={saveInPlace}
              disabled={busy}
              title="Overwrite this version's prompt (no new version)"
            >
              <Save size={13} /> Update v{ver.v}
            </button>
            <button
              className="secondary ss-mini"
              onClick={() => setPrompt(ver.prompt)}
              disabled={busy}
            >
              <RotateCcw size={13} /> Reset
            </button>
          </>
        )}
        <span className="ss-dur">{prompt.length} chars</span>
        {err && <span className="err-msg">{err}</span>}
      </div>

      {ver.status === "ready" && ver.url ? (
        <div className="ss-audio">
          <audio controls src={ver.url} preload="none" />
          <a className="ss-dl" href={ver.url} download>
            <Download size={13} /> download
          </a>
        </div>
      ) : (
        <div className="ss-hint">
          <Clock size={13} /> pending — ask me to “render pending sounds” and I’ll run Seed
          Audio and attach the audio here.
        </div>
      )}
    </div>
  );
}

function SoundTrack({ track, onChanged }) {
  const [name, setName] = useState(track.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(track.name);
  }, [track.name, track.id]);

  const saveName = async () => {
    if (!name.trim() || name.trim() === track.name) {
      setName(track.name);
      return;
    }
    setBusy(true);
    try {
      await soundApi(`/api/sounds/${track.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      onChanged();
    } catch {
      setName(track.name);
    } finally {
      setBusy(false);
    }
  };
  const delTrack = async () => {
    if (!window.confirm(`Delete “${track.name}” and all its versions?`)) return;
    setBusy(true);
    try {
      await soundApi(`/api/sounds/${track.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const liked = track.versions.some((v) => v.liked);
  const versions = [...track.versions].sort((a, b) => b.v - a.v);

  return (
    <div className="ss-card">
      <div className="ss-card-top">
        <Music size={18} />
        <input
          className="ss-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          disabled={busy}
          aria-label="Track name"
        />
        {liked && <Heart size={15} fill="#c33a54" color="#c33a54" />}
        <span className="ss-dur">
          {track.versions.length} version{track.versions.length === 1 ? "" : "s"}
        </span>
        <button
          className="ss-icon-btn"
          aria-label="Delete track"
          onClick={delTrack}
          disabled={busy}
          title="Delete track"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="ss-versions">
        {versions.map((v) => (
          <SoundVersion key={v.v} track={track} ver={v} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

// Preset moods for the New-sound builder (plus a free-text field for others).
const MOODS = [
  "whimsical", "tension", "mystery", "chill", "exploratory", "friendly",
  "frightening", "playful", "tender", "magical", "adventurous", "melancholic",
  "triumphant", "dreamy", "cozy", "suspenseful", "somber", "hopeful",
];
const SEED_AUDIO_CAP = 2048;

// Structured prompt builder for a new sound. Assembles a Seed Audio prompt from
// duration + moods + selected multi-shot references + optional sound-design
// marks, with a live editable preview you can copy or turn into a track.
function NewSoundBuilder({ bundles, busy, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [seconds, setSeconds] = useState(15);
  const [moods, setMoods] = useState(() => new Set());
  const [customMood, setCustomMood] = useState("");
  const [picked, setPicked] = useState(() => new Set()); // "MS-01/01"
  const [expanded, setExpanded] = useState(() => new Set());
  const [marks, setMarks] = useState("");
  const [edited, setEdited] = useState(false);
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState(false);

  const toggleFrom = (set, key) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };
  const toggleMood = (m) => {
    setMoods((s) => toggleFrom(s, m));
    setEdited(false);
  };
  const toggleShot = (k) => {
    setPicked((s) => toggleFrom(s, k));
    setEdited(false);
  };
  const toggleBundle = (b) => {
    const keys = b.shots.map((s) => `${b.id}/${s.id}`);
    const allSel = keys.every((k) => picked.has(k));
    setPicked((s) => {
      const next = new Set(s);
      keys.forEach((k) => (allSel ? next.delete(k) : next.add(k)));
      return next;
    });
    setEdited(false);
  };
  const toggleExpand = (id) => setExpanded((s) => toggleFrom(s, id));

  const moodList = useMemo(
    () => [
      ...moods,
      ...customMood.split(",").map((s) => s.trim()).filter(Boolean),
    ],
    [moods, customMood]
  );

  const composed = useMemo(() => {
    const secs = Number(seconds) || 15;
    let p =
      `Create a background music track that must be ${secs} seconds long. ` +
      `It should have a start, and an ending that finishes the song not abruptly but gracefully.`;
    if (moodList.length) p += `\n\nNotice this track is ${moodList.join(", ")}.`;
    if (picked.size) {
      p += `\n\nUse the following multi-shot prompt as reference for the scene the music plays under:`;
      for (const b of bundles) {
        for (const s of b.shots) {
          if (picked.has(`${b.id}/${s.id}`))
            p += `\n- ${b.id} shot ${s.id} (${s.dur}s): ${s.summary}`;
        }
      }
    }
    if (marks.trim())
      p +=
        `\n\nTry to make some sound design on the track that has some highs or lows ` +
        `at these second marks: ${marks.trim()}.`;
    return p;
  }, [seconds, moodList, picked, marks, bundles]);

  const promptText = edited ? manual : composed;
  const over = promptText.length > SEED_AUDIO_CAP;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="ss-new">
      <input
        className="ss-newname"
        placeholder="name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="ss-field">
        <label className="ss-label">Duration</label>
        <div className="ss-inline">
          <input
            type="number"
            className="ss-num"
            min={1}
            max={120}
            value={seconds}
            onChange={(e) => {
              setSeconds(e.target.value);
              setEdited(false);
            }}
          />
          <span className="ss-dur">seconds</span>
        </div>
      </div>

      <div className="ss-field">
        <label className="ss-label">Mood</label>
        <div className="ss-chips">
          {MOODS.map((m) => (
            <button
              key={m}
              type="button"
              className={`ss-chip ${moods.has(m) ? "on" : ""}`}
              onClick={() => toggleMood(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <input
          className="ss-vname-input ss-custommood"
          placeholder="other moods (comma-separated)…"
          value={customMood}
          onChange={(e) => {
            setCustomMood(e.target.value);
            setEdited(false);
          }}
        />
      </div>

      <div className="ss-field">
        <label className="ss-label">
          Scene reference — pick shots (whole MS bundle, or individual shots)
        </label>
        {bundles.length === 0 ? (
          <span className="not-yet">no multi-shot bundles loaded</span>
        ) : (
          <div className="ss-bundles">
            {bundles.map((b) => {
              const keys = b.shots.map((s) => `${b.id}/${s.id}`);
              const allSel = keys.every((k) => picked.has(k));
              const someSel = keys.some((k) => picked.has(k));
              const open = expanded.has(b.id);
              return (
                <div className="ss-bundle" key={b.id}>
                  <div className="ss-bundle-head">
                    <input
                      type="checkbox"
                      checked={allSel}
                      ref={(el) => el && (el.indeterminate = someSel && !allSel)}
                      onChange={() => toggleBundle(b)}
                      aria-label={`Select all of ${b.id}`}
                    />
                    <button
                      type="button"
                      className="ss-bundle-toggle"
                      onClick={() => toggleExpand(b.id)}
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <strong>{b.id}</strong>
                      <span className="ss-bundle-title">
                        {b.beatTitle} · shots {b.shots[0]?.id}–{b.shots[b.shots.length - 1]?.id}
                      </span>
                      {someSel && (
                        <span className="ss-count">
                          {keys.filter((k) => picked.has(k)).length}/{keys.length}
                        </span>
                      )}
                    </button>
                  </div>
                  {open && (
                    <div className="ss-shotgrid">
                      {b.shots.map((s) => (
                        <label className="ss-shotchk" key={s.id}>
                          <input
                            type="checkbox"
                            checked={picked.has(`${b.id}/${s.id}`)}
                            onChange={() => toggleShot(`${b.id}/${s.id}`)}
                          />
                          shot {s.id} <span className="ss-shot-dur">{s.dur}s</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <span className="ss-note">
          references use each shot’s short summary to keep the prompt within Seed Audio’s {SEED_AUDIO_CAP}-char limit
        </span>
      </div>

      <div className="ss-field">
        <label className="ss-label">Sound design marks (optional)</label>
        <input
          className="ss-vname-input ss-marks"
          placeholder="e.g. swell at 0:03, dip at 0:08, sparkle at 0:12"
          value={marks}
          onChange={(e) => {
            setMarks(e.target.value);
            setEdited(false);
          }}
        />
      </div>

      <div className="ss-field">
        <div className="ss-preview-head">
          <label className="ss-label">Composed prompt</label>
          {edited && (
            <button className="secondary ss-mini" onClick={() => setEdited(false)}>
              <RotateCcw size={12} /> Rebuild from fields
            </button>
          )}
        </div>
        <textarea
          className="ss-prompt"
          value={promptText}
          spellCheck={false}
          onChange={(e) => {
            setManual(e.target.value);
            setEdited(true);
          }}
        />
      </div>

      <div className="ss-actions">
        <button
          className="save ss-mini"
          onClick={() => onCreate({ name, prompt: promptText })}
          disabled={busy || !promptText.trim() || over}
        >
          <Plus size={13} /> Create (pending render)
        </button>
        <button className="secondary ss-mini" onClick={copy} disabled={!promptText.trim()}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy prompt"}
        </button>
        <button className="secondary ss-mini" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <span className={`ss-dur ${over ? "over" : ""}`}>
          {promptText.length} / {SEED_AUDIO_CAP} chars
        </span>
      </div>
    </div>
  );
}

function SoundStudio({ reloadKey }) {
  const [tracks, setTracks] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await soundApi("/api/sounds");
      setTracks(data.tracks || []);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  // Multi-shot bundles feed the "scene reference" picker in the new-sound builder.
  useEffect(() => {
    (async () => {
      try {
        const data = await soundApi("/api/episode");
        setBundles(data.episode?.bundles || []);
      } catch {
        setBundles([]);
      }
    })();
  }, []);

  const createTrack = async ({ name, prompt }) => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await soundApi("/api/sounds", {
        method: "POST",
        body: JSON.stringify({ name, prompt }),
      });
      setShowNew(false);
      load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const pending = tracks.reduce(
    (n, t) => n + t.versions.filter((v) => v.status !== "ready").length,
    0
  );

  return (
    <div>
      <div className="ss-head">
        <h2>sound studio</h2>
        <div className="ms-meta">
          {pending > 0 && (
            <span className="ss-pill pending">
              <Clock size={11} /> {pending} pending render
            </span>
          )}
          <button onClick={() => setShowNew((s) => !s)}>
            <Plus size={14} /> New sound
          </button>
        </div>
      </div>

      {showNew && (
        <NewSoundBuilder
          bundles={bundles}
          busy={busy}
          onCreate={createTrack}
          onCancel={() => setShowNew(false)}
        />
      )}

      {error && <p className="err-msg">Error: {error}</p>}
      {loading ? (
        <p className="not-yet">loading…</p>
      ) : tracks.length === 0 ? (
        <p className="not-yet">No sounds yet — click “New sound”.</p>
      ) : (
        <div className="ss-tracks">
          {tracks.map((t) => (
            <SoundTrack key={t.id} track={t} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("shots"); // "shots" | "multishot" | "episode" | "cuts" | "library" | "sounds"
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
              className={`tab ${view === "cuts" ? "active" : ""}`}
              onClick={() => setView("cuts")}
            >
              complete cuts
            </button>
            <button
              className={`tab ${view === "library" ? "active" : ""}`}
              onClick={() => setView("library")}
            >
              library
            </button>
            <button
              className={`tab ${view === "sounds" ? "active" : ""}`}
              onClick={() => setView("sounds")}
            >
              sound studio
            </button>
          </nav>
        </div>
        <div className="right">
          <span className="status">
            {loading ? "loading…" : `${shots.length} shots`}
          </span>
          <button className="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </header>

      {view === "sounds" ? (
        <div className="wrap">
          <SoundStudio reloadKey={reloadKey} />
        </div>
      ) : view === "library" ? (
        <div className="wrap">
          <Library reloadKey={reloadKey} onView={setModalImage} />
        </div>
      ) : view === "cuts" ? (
        <div className="wrap">
          <CompleteCuts reloadKey={reloadKey} />
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
                  <div className="stem-label"><Speech size={13} /> Speech · for lipsync</div>
                  <MediaTakes kind="audio" takes={s.speechTakes} reloadKey={reloadKey} />
                  <div className="stem-label vfx"><Leaf size={13} /> VFX · layer on video</div>
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
