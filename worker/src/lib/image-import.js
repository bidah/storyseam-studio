// Bringing an image in from OUTSIDE the app.
//
// Every image picker the app itself ships starts from something already inside
// the project — a library `rel`, a generation id, a still's file. A remote MCP
// client starts from neither: it holds a URL its model just produced, or the
// bytes of a file the user pointed it at. These helpers turn either of those
// into bytes the upload route will take, and they are deliberately strict about
// what an "image" is — a 200 HTML error page stored as a character sheet is
// worse than a failed call, because nothing downstream reports it.
//
// Kept out of mcp-agent.js so it can be exercised without the Workers runtime.

// Capped because these ride in a tool-call argument and land in R2 — a runaway
// `data` string is the cheapest way to make a session fail slowly rather than
// loudly.
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const EXT_FOR_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Content type from the leading magic bytes, for a base64 blob that arrived with
// no data: prefix and no filename — which is what an MCP client sends when it
// read a file and handed us the encoding.
export function sniffImageType(bytes) {
  const b = new Uint8Array(bytes);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "";
}

// Decode a base64 image argument. Accepts a data: URI (whose declared type wins)
// or bare base64.
export function decodeBase64Image(data) {
  let raw = String(data).trim();
  let declared = "";
  const m = /^data:([^;,]+)(;base64)?,(.*)$/is.exec(raw);
  if (m) {
    declared = m[1].toLowerCase();
    raw = m[3];
  }
  raw = raw.replace(/\s+/g, "");
  let bin;
  try {
    bin = atob(raw);
  } catch {
    throw new Error("`data` is not valid base64 — pass the raw base64 of the image file, or a data: URI.");
  }
  if (bin.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${Math.round(bin.length / 1e6)}MB — the limit is ${MAX_IMAGE_BYTES / 1e6}MB.`);
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const contentType = (declared.startsWith("image/") && declared) || sniffImageType(bytes);
  if (!contentType) {
    throw new Error("Could not tell what image format `data` is — pass a data: URI, or a `filename` with a .png/.jpg/.webp/.gif extension.");
  }
  return { bytes, contentType };
}

// Pull an image the client only has a URL for. https only, and the response has
// to actually BE an image: a 200 HTML error page stored as a "character sheet"
// is worse than a failed call, because nothing downstream reports it.
export async function fetchImage(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`\`url\` is not a valid URL: ${url}`);
  }
  if (u.protocol !== "https:") throw new Error("`url` must be an https URL.");
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Could not fetch ${u.href} (${res.status} ${res.statusText}).`);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`${u.href} returned "${contentType || "an unknown type"}", not an image — pass the direct image URL, not the page it sits on.`);
  }
  const bytes = await res.arrayBuffer();
  if (!bytes.byteLength) throw new Error(`${u.href} returned an empty body.`);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${Math.round(bytes.byteLength / 1e6)}MB — the limit is ${MAX_IMAGE_BYTES / 1e6}MB.`);
  }
  return { bytes, contentType, name: decodeURIComponent(u.pathname.split("/").pop() || "") };
}

// A single JSON text block — the shape every MCP client renders. Objects are
// pretty-printed so the model (and a human reading the transcript) can scan them.
function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

