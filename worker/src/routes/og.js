// Open Graph cards — what a link to StorySeam looks like when it is pasted into
// a chat, a post or a DM. PUBLIC: nothing here reads a session, and these paths
// sit outside `/api`, so the ownership middleware never sees them.
//
//   GET /og/default.png        the site card: the wordmark and the one line
//   GET /og/watch/:token.png   a shared Film's card: the wordmark and its title
//   GET /watch/:token          the SPA's index.html with THAT Film's og tags
//
// A crawler doesn't run the SPA, so the tags it reads have to be in the HTML the
// Worker answers with. `/watch/*` is in `run_worker_first` for exactly that: the
// page itself is the same index.html every route gets, rewritten on the way out.
// A revoked or fabricated token gets the site's own card, not an error — the
// page still has to load and say "no longer available" itself.
//
// The look is the light theme's, kept to almost nothing: a white ground, the
// app's hairline border, the square purple mark, STORY + a bold SEAM, and the
// title in capitals. Colours are src/index.css `:root` resolved to hex, like
// public/favicon.svg — re-resolve them here if those tokens change.
import { ImageResponse, GoogleFont, cache } from "@cf-wasm/og/workerd";
import { resolveFilmShare } from "../lib/film-share.js";

export const OG_TAGLINE = "Text to long form video stories in seconds";

const W = 1200;
const H = 630;
const INK = "#19191A"; // --foreground
const MUTED = "#5B5B64"; // --muted-foreground
const PURPLE = "#681DE4"; // --primary
const ON_PURPLE = "#FAFAFA"; // --primary-foreground
const HAIRLINE = "rgba(18,18,22,0.12)"; // --border

const FONTS = () => [
  new GoogleFont("Inter Tight", { weight: 500 }),
  new GoogleFont("Inter Tight", { weight: 800 }),
  new GoogleFont("JetBrains Mono", { weight: 500 }),
];

// satori takes React-shaped nodes; the Worker has no JSX, so build them bare.
const h = (type, style, ...children) => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});

// The header mark: lucide `Clapperboard` on a square purple tile.
function mark(size) {
  const glyph = Math.round(size * 0.6);
  return h(
    "div",
    { display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, background: PURPLE },
    {
      type: "svg",
      props: {
        width: glyph, height: glyph, viewBox: "0 0 24 24", fill: "none",
        stroke: ON_PURPLE, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
        children: [
          "m12.296 3.464 3.02 3.956",
          "M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z",
          "M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
          "m6.18 5.276 3.1 3.899",
        ].map((d) => ({ type: "path", props: { d } })),
      },
    },
  );
}

// The logo: the mark, then STORY in the regular weight and SEAM in the bold.
function logo(size) {
  return h(
    "div",
    { display: "flex", alignItems: "center", gap: Math.round(size * 0.32) },
    mark(Math.round(size * 1.05)),
    h(
      "div",
      { display: "flex", fontFamily: "Inter Tight", fontSize: size, color: INK, letterSpacing: "0.02em", lineHeight: 1 },
      h("span", { fontWeight: 500 }, "STORY"),
      h("span", { fontWeight: 800 }, "SEAM"),
    ),
  );
}

// The white card with the hairline frame every surface in the app draws.
function frame(style, ...children) {
  return h(
    "div",
    { display: "flex", width: W, height: H, background: "#FFFFFF", padding: 36 },
    h("div", { display: "flex", flexDirection: "column", flex: 1, border: `2px solid ${HAIRLINE}`, ...style }, ...children),
  );
}

function siteCard() {
  return frame(
    { alignItems: "center", justifyContent: "center", gap: 48 },
    logo(112),
    h(
      "div",
      { display: "flex", fontFamily: "JetBrains Mono", fontWeight: 500, fontSize: 30, color: MUTED, letterSpacing: "0.08em" },
      OG_TAGLINE.toUpperCase(),
    ),
  );
}

function filmCard(title) {
  const t = String(title || "A StorySeam story").toUpperCase();
  const size = t.length <= 22 ? 108 : t.length <= 44 ? 88 : t.length <= 80 ? 68 : 56;
  return frame(
    { justifyContent: "space-between", padding: 64 },
    logo(44),
    h(
      "div",
      {
        display: "block", fontFamily: "Inter Tight", fontWeight: 800, fontSize: size, color: INK,
        lineHeight: 1.02, letterSpacing: "0.01em", lineClamp: 4,
      },
      t,
    ),
  );
}

// Render once, then serve from the edge cache: a card changes only when its
// Film is retitled, and a day's lag on that is invisible to anyone.
async function cachedPng(c, node) {
  const hit = await caches.default.match(c.req.raw);
  if (hit) return hit;
  cache.setExecutionContext(c.executionCtx);
  const img = await ImageResponse.async(node, { width: W, height: H, fonts: FONTS() });
  const res = new Response(img.body, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
  c.executionCtx.waitUntil(caches.default.put(c.req.raw, res.clone()));
  return res;
}

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function registerOg(app) {
  app.get("/og/default.png", (c) => cachedPng(c, siteCard()));

  app.get("/og/watch/:file", async (c) => {
    const token = c.req.param("file").replace(/\.png$/, "");
    const r = await resolveFilmShare(c.env, token).catch(() => null);
    return cachedPng(c, r ? filmCard(r.film.title) : siteCard());
  });

  app.get("/watch/:token", async (c) => {
    const page = await c.env.ASSETS.fetch(new URL("/", c.req.url));
    const token = c.req.param("token");
    const r = await resolveFilmShare(c.env, token).catch(() => null);
    if (!r) return page;
    const origin = new URL(c.req.url).origin;
    const title = r.film.title || "A StorySeam story";
    const tags = {
      "og:title": title,
      "og:description": r.film.idea || OG_TAGLINE,
      "og:image": `${origin}/og/watch/${encodeURIComponent(token)}.png`,
      "og:url": `${origin}/watch/${encodeURIComponent(token)}`,
      "og:type": "video.other",
      "og:site_name": "StorySeam",
      "og:image:width": String(W),
      "og:image:height": String(H),
    };
    const meta = Object.entries(tags)
      .map(([k, v]) => `<meta property="${k}" content="${escapeAttr(v)}" />`)
      .concat(
        `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
        `<meta name="twitter:image" content="${escapeAttr(tags["og:image"])}" />`,
      )
      .join("");
    return new HTMLRewriter()
      .on('meta[property^="og:"]', { element: (el) => el.remove() })
      .on('meta[name="twitter:title"], meta[name="twitter:image"]', { element: (el) => el.remove() })
      .on("title", { element: (el) => el.setInnerContent(`${title} — StorySeam`) })
      .on("head", { element: (el) => el.append(meta, { html: true }) })
      .transform(page);
  });
}
