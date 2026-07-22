// A tiny in-memory stand-in for a Cloudflare R2 bucket binding, implementing the
// slice of the API worker/src/lib/{docs,media}.js actually call: get (with Range
// support + json()), put, head, list (prefix scan). Enough to unit-test the
// storage helpers without wrangler/miniflare.

let etagSeq = 0;

const toBytes = (body) =>
  body instanceof Uint8Array
    ? body
    : new TextEncoder().encode(typeof body === "string" ? body : String(body));

export function makeBucket(initial = {}) {
  const store = new Map(); // key -> { bytes, contentType, etag }
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, { bytes: toBytes(v), contentType: "application/octet-stream", etag: `"e${etagSeq++}"` });
  }

  const objFor = (key, entry, range) => {
    const total = entry.bytes.length;
    let bytes = entry.bytes;
    let appliedRange;
    if (range) {
      let offset = 0;
      let length = total;
      if (range.suffix != null) {
        offset = Math.max(0, total - range.suffix);
        length = total - offset;
      } else {
        offset = range.offset ?? 0;
        length = range.length ?? total - offset;
      }
      bytes = entry.bytes.slice(offset, offset + length);
      appliedRange = { offset, length };
    }
    return {
      key,
      size: total,
      etag: entry.etag, // raw (unquoted-style) etag — used by updateDoc's onlyIf
      httpEtag: entry.etag,
      range: appliedRange,
      body: bytes,
      writeHttpMetadata(headers) {
        if (entry.contentType) headers.set("content-type", entry.contentType);
      },
      async json() {
        return JSON.parse(new TextDecoder().decode(entry.bytes));
      },
      async text() {
        return new TextDecoder().decode(entry.bytes);
      },
    };
  };

  return {
    _store: store,
    async get(key, opts) {
      const entry = store.get(key);
      if (!entry) return null;
      return objFor(key, entry, opts?.range);
    },
    async head(key) {
      const entry = store.get(key);
      return entry ? { key, size: entry.bytes.length, httpEtag: entry.etag } : null;
    },
    async put(key, body, opts) {
      // Optimistic concurrency (updateDoc): honor onlyIf.etagMatches — a stale
      // etag means someone else wrote since our read, so the write fails (null).
      const wantEtag = opts?.onlyIf?.etagMatches;
      if (wantEtag != null) {
        const current = store.get(key);
        if (!current || current.etag !== wantEtag) return null;
      }
      const etag = `"e${etagSeq++}"`;
      store.set(key, {
        bytes: toBytes(body),
        contentType: opts?.httpMetadata?.contentType || "application/octet-stream",
        etag,
      });
      return { key, etag }; // R2 put resolves to the written object (truthy)
    },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        objects: slice.map((key) => ({ key })),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
      };
    },
  };
}

export function makeEnv(overrides = {}) {
  return { BUCKET: makeBucket(overrides.files || {}), ...overrides };
}
