// Saving a media URL to disk.
//
// A bare `<a download>` is not enough here. The attribute is IGNORED on a
// cross-origin href (the browser navigates to the picture instead of saving
// it), and even same-origin our media routes serve inline, so the filename we
// want is only a hint. Fetching the bytes first turns it into a same-origin
// `blob:` URL, where `download` always wins and the name is exact — with a
// plain-anchor fallback when the fetch can't happen (offline, an opaque
// cross-origin response) so the click still does SOMETHING.

// Click a synthetic anchor. Detached links don't fire in every browser, so it
// goes through the document.
function clickAnchor(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename || "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// The last path segment of a URL, decoded — "/visual-media/abc%20(1).png" →
// "abc (1).png". Query strings (the `?v=` media cache-bust) are dropped.
export function filenameFromUrl(url, fallback = "download") {
  try {
    const path = new URL(url, window.location.origin).pathname;
    const base = decodeURIComponent(path.split("/").pop() || "");
    return base || fallback;
  } catch {
    return fallback;
  }
}

// Save `url` as `filename`. Resolves once the save has been handed to the
// browser; rejects only when neither path could start one.
export async function downloadUrl(url, filename) {
  if (!url) return;
  const name = filename || filenameFromUrl(url);
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    clickAnchor(href, name);
    // Revoking immediately can beat the download starting in Safari.
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch {
    clickAnchor(url, name);
  }
}
