// Server-side link unfurling — turns a pasted URL into a preview card.
//
// Ported from idea-mural's `shared/unfurl.ts`. It has to run here rather than in
// the browser for two reasons: CORS (most sites refuse a cross-origin fetch of
// their own HTML) and consistency (the preview is stored on the card, so every
// viewer sees the same unfurl instead of each one re-fetching).
//
// `parsePreview` is pure (HTML string → preview); `unfurl` wraps it with an
// injected fetch so it stays testable.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function metaContent(html, names) {
  for (const name of names) {
    // property="og:title" or name="description", attribute order agnostic.
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escapeRe(name)}["'][^>]*\\scontent=["']([^"']*)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapeRe(name)}["']`,
        "i",
      ),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return decodeEntities(m[1].trim());
    }
  }
  return undefined;
}

function absolutize(href, base) {
  if (!href) return undefined;
  try {
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

const faviconFor = (url) => {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  } catch {
    return undefined;
  }
};

/** Parse Open Graph / fallback metadata out of an HTML document. Pure. */
export function parsePreview(html, url) {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ||
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();

  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  const image = absolutize(metaContent(html, ["og:image", "twitter:image"]), url);
  const siteName = metaContent(html, ["og:site_name"]);

  // Favicon from <link rel="icon|shortcut icon|apple-touch-icon">.
  let favicon;
  const iconMatch = html.match(
    /<link[^>]+rel=["'][^"']*(?:icon|shortcut icon|apple-touch-icon)[^"']*["'][^>]*>/i,
  );
  if (iconMatch) {
    favicon = absolutize(iconMatch[0].match(/href=["']([^"']+)["']/i)?.[1], url);
  }
  if (!favicon) favicon = faviconFor(url);

  return { title, description, image, siteName, favicon };
}

// x.com / twitter.com serve an empty JS shell (no og: tags) to generic crawlers,
// so plain HTML unfurling yields nothing. Route tweet URLs through the FxTwitter
// public JSON API instead, which returns clean tweet data with no auth.
const TWEET_HOSTS = new Set([
  "x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com",
]);

/** The numeric tweet/status id in an x.com or twitter.com URL, else undefined. */
export function tweetIdFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!TWEET_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;
  // /<user>/status/<id> or /i/web/status/<id>
  return parsed.pathname.match(/\/status(?:es)?\/(\d+)/i)?.[1];
}

/** Build a link preview from a parsed FxTwitter API response. Pure. */
export function parseTweetPreview(data, url) {
  const tweet = data.tweet;
  if (!tweet) throw new Error("no tweet in response");
  const author = tweet.author;
  const handle = author?.screen_name ? `@${author.screen_name}` : undefined;
  const title = [author?.name, handle && `(${handle})`].filter(Boolean).join(" ") || "X post";

  const media = tweet.media;
  const image =
    media?.mosaic?.formats?.jpeg ||
    media?.mosaic?.formats?.webp ||
    media?.photos?.[0]?.url ||
    media?.videos?.[0]?.thumbnail_url ||
    author?.avatar_url;

  return {
    title,
    description: tweet.text || undefined,
    image: image || undefined,
    siteName: "X",
    favicon: faviconFor(url),
  };
}

// YouTube serves an empty JS shell (and gates crawlers behind a consent page),
// so plain HTML unfurling yields nothing. Pull the title + thumbnail from the
// auth-free oEmbed endpoint, and the description best-effort from the watch
// page's embedded `shortDescription` JSON.
const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
]);

/** The 11-char video id in a watch / youtu.be / shorts / embed URL, else undefined. */
export function youtubeIdFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return undefined;

  let id;
  if (host === "youtu.be") {
    id = parsed.pathname.slice(1).split("/")[0];
  } else if (parsed.pathname === "/watch") {
    id = parsed.searchParams.get("v") ?? undefined;
  } else {
    // /shorts/<id>, /embed/<id>, /live/<id>
    id = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : undefined;
}

/**
 * The video description out of a watch page's embedded ytInitialPlayerResponse
 * JSON (`"shortDescription":"…"`). Pure; undefined when the field is absent
 * (e.g. a consent-gated response).
 */
export function extractYouTubeDescription(html) {
  const m = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  if (!m) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Build a link preview from a YouTube oEmbed response + optional description. Pure. */
export function parseYouTubePreview(oembed, description, id) {
  return {
    title: oembed.title || "YouTube video",
    description: description || oembed.author_name || undefined,
    image: oembed.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    siteName: "YouTube",
    favicon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=128",
  };
}

// Link shorteners that wrap tweets (and everything else). We resolve these to
// their destination before unfurling so a wrapped tweet still hits the tweet API.
const SHORTENER_HOSTS = new Set(["t.co"]);

function isShortener(url) {
  try {
    return SHORTENER_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

const UA = "shot-studio-unfurl/1.0";

/**
 * Follow redirects manually (reading Location, not the body) up to `maxHops`
 * and return the final URL. Falls back to the input on any failure.
 */
export async function resolveRedirect(url, fetchImpl, maxHops = 5) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    let res;
    try {
      res = await fetchImpl(current, { headers: { "User-Agent": UA }, redirect: "manual" });
    } catch {
      break;
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      try {
        current = new URL(loc, current).href;
      } catch {
        break;
      }
      continue;
    }
    break;
  }
  return current;
}

/** Fetch a URL server-side and extract a link preview. */
export async function unfurl(url, fetchImpl) {
  // Resolve t.co (and similar) short links first so wrapped tweet links route
  // through the tweet API below instead of being HTML-parsed.
  if (isShortener(url)) url = await resolveRedirect(url, fetchImpl);

  const tweetId = tweetIdFromUrl(url);
  if (tweetId) {
    const res = await fetchImpl(`https://api.fxtwitter.com/status/${tweetId}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseTweetPreview(await res.json(), url);
  }

  const youtubeId = youtubeIdFromUrl(url);
  if (youtubeId) {
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${youtubeId}`,
    )}`;
    const res = await fetchImpl(oembedUrl, {
      headers: { Accept: "application/json", "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const oembed = await res.json();

    // Description isn't in oEmbed; pull it best-effort from the watch page.
    let description;
    try {
      const page = await fetchImpl(`https://www.youtube.com/watch?v=${youtubeId}`, {
        headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
        redirect: "follow",
      });
      if (page.ok) description = extractYouTubeDescription(await page.text());
    } catch {
      /* description stays undefined */
    }
    return parseYouTubePreview(oembed, description, youtubeId);
  }

  const res = await fetchImpl(url, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePreview(await res.text(), url);
}
