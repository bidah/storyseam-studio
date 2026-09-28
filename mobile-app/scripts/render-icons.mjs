// Render assets/images/icon.svg to the app icons: icon.png (1024², full bleed),
// the splash mark, the Android adaptive layers, and icon-dev.png (the same with a "DEV" band, so a dev client is told apart
// on the home screen). Uses the worker's resvg-wasm — no native image tools.
//
//   node scripts/render-icons.mjs
//
// The app icon is NATIVE: a changed icon needs a new build, never an OTA.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const require = createRequire(path.resolve(APP, '../worker/package.json'));
const mod = await import(require.resolve('@resvg/resvg-wasm'));
const { initWasm, Resvg } = mod.initWasm ? mod : mod.default;
await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

const svg = fs.readFileSync(path.join(APP, 'assets/images/icon.svg'), 'utf8');
const FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

function render(source, out) {
  const opts = { fitTo: { mode: 'width', value: 1024 } };
  if (fs.existsSync(FONT)) opts.font = { fontBuffers: [fs.readFileSync(FONT)], loadSystemFonts: false };
  const png = new Resvg(source, opts).render().asPng();
  fs.writeFileSync(path.join(APP, 'assets/images', out), png);
  console.log(`icons: ${out} (${png.length} bytes)`);
}

render(svg, 'icon.png');
// The splash mark and the web favicon are the same tile.
render(svg, 'splash-icon.png');
render(svg, 'splash-icon-light.png');
render(svg, 'favicon.png');
// Android adaptive icon: the purple as the background layer, the glyph alone on
// transparent as the foreground (scaled into the 66% safe zone), and a black
// glyph for the themed monochrome layer.
const glyph = svg.match(/<g [\s\S]*?<\/g>/)[0]
  .replace('translate(232 232) scale(23.333)', 'translate(320 320) scale(16)');
const layer = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${body}</svg>`;
render(layer('<rect width="1024" height="1024" fill="#681DE4"/>'), 'android-icon-background.png');
render(layer(glyph), 'android-icon-foreground.png');
render(layer(glyph.replace('stroke="#FAFAFA"', 'stroke="#000000"')), 'android-icon-monochrome.png');
const band =
  '<rect y="820" width="1024" height="204" fill="#FAFAFA"/>' +
  '<text x="512" y="970" text-anchor="middle" font-family="Arial" font-weight="700" font-size="150" fill="#681DE4">DEV</text>';
render(svg.replace('</svg>', `${band}</svg>`), 'icon-dev.png');
