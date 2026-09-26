/**
 * Generates `src/app/dark-compat.css` — the layer that lets screens built light-only read properly
 * in dark mode.
 *
 * Most of the app hardcodes light utilities (`bg-white`, `text-slate-900`, `border-slate-200`,
 * pastel `bg-emerald-50` chips…) and only a handful of files carry `dark:` variants. Under `.dark`
 * this remaps those utilities onto the dark tokens, so a white card becomes a dark card with light
 * text instead of a white card whose token-coloured text has turned white.
 *
 * Rules:
 * - Every selector is `.dark :where(...)`, so it has the specificity of `.dark` alone: it beats the
 *   plain utility (the file is imported after Tailwind's) but loses to any explicit `dark:` class.
 * - Anything inside `.keep-light` is left alone — a signature pad, a QR code.
 * - Only on screen: printing always uses the light tokens (see the print block in globals.css).
 * - Base classes are always emitted. Opacity (`/80`) and state (`hover:`, `even:`…) variants are
 *   emitted only when some file in `src/` uses them, which keeps the file small — so re-run this
 *   after introducing a new one: `npm run theme:dark-compat`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const colors = require('tailwindcss/colors');
const OUT = join(root, 'src', 'app', 'dark-compat.css');

// ── Which class tokens does the app actually use? ─────────────────────────────────────────────
const used = new Set();
(function scan(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) scan(path);
    else if (/\.(tsx?|jsx?|mdx)$/.test(name)) {
      for (const token of readFileSync(path, 'utf8').match(/[A-Za-z0-9:\/\-\[\]._%]+/g) ?? []) used.add(token);
    }
  }
})(join(root, 'src'));

const esc = (cls) => cls.replace(/([\/.:\[\]%])/g, '\\$1');
const rgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const KEEP = ':not(.keep-light, .keep-light *)';
const sel = (cls, extra = '', tail = '') => `.dark :where(.${esc(cls)}${KEEP}${extra})${tail}`;

const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const CHROMA = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const ALPHAS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95];
const withAlphas = (base) => [base, ...ALPHAS.map((a) => `${base}/${a}`)];
const alphaOf = (cls) => {
  const m = cls.match(/\/(\d+)$/);
  return m ? Number(m[1]) / 100 : 1;
};

const rules = new Map(); // declaration → selectors sharing it
/** `cls` is the class as written in source; variants and opacity forms are kept only if used. */
function add(cls, selector, decl) {
  const variant = cls.includes(':') || cls.includes('/');
  if (variant && !used.has(cls)) return;
  if (!rules.has(decl)) rules.set(decl, []);
  rules.get(decl).push(selector);
}
const plain = (cls, decl, extra = '') => add(cls, sel(cls, extra), decl);
const state = (prefix, cls, tail, decl) => add(`${prefix}:${cls}`, sel(`${prefix}:${cls}`, '', tail), decl);

// ── Neutral surfaces ─────────────────────────────────────────────────────────────────────────
// White → the card token; the -50…-300 steps → a ladder around it (see `--dc-*` in globals.css).
const SURFACE = { white: 'var(--card)', 50: 'var(--dc-50)', 100: 'var(--dc-100)', 200: 'var(--dc-200)', 300: 'var(--dc-300)' };
const HOVER_SURFACE = { white: 'var(--dc-100)', 50: 'var(--dc-100)', 100: 'var(--dc-200)', 200: 'var(--dc-300)' };
const surfaces = [['white', 'bg-white'], ...NEUTRALS.flatMap((n) => [50, 100, 200, 300].map((s) => [s, `bg-${n}-${s}`]))];
for (const [step, base] of surfaces) {
  for (const cls of withAlphas(base)) {
    const a = alphaOf(cls);
    plain(cls, `background-color: hsl(${SURFACE[step]} / ${a})`);
    if (HOVER_SURFACE[step]) state('hover', cls, ':hover', `background-color: hsl(${HOVER_SURFACE[step]} / ${a})`);
    state('even', cls, ':nth-child(even)', `background-color: hsl(${SURFACE[step]} / ${a})`);
    state('odd', cls, ':nth-child(odd)', `background-color: hsl(${SURFACE[step]} / ${a})`);
  }
}

// ── Neutral text ─────────────────────────────────────────────────────────────────────────────
const TEXT = { 950: 95, 900: 95, 800: 92, 700: 86, 600: 74, 500: 64, 400: 52, 300: 40 };
plain('text-black', 'color: hsl(0 0% 95%)');
for (const n of NEUTRALS) {
  for (const [shade, l] of Object.entries(TEXT)) {
    const cls = `text-${n}-${shade}`;
    plain(cls, `color: hsl(0 0% ${l}%)`);
    state('hover', cls, ':hover', `color: hsl(0 0% ${Math.min(98, l + 4)}%)`);
    state('placeholder', cls, '::placeholder', `color: hsl(0 0% ${l}%)`);
  }
}

// ── Neutral lines ────────────────────────────────────────────────────────────────────────────
const LINE = { 50: 16, 100: 18, 200: 20, 300: 26 };
for (const cls of withAlphas('border-white')) plain(cls, `border-color: hsl(0 0% 100% / ${(0.08 * alphaOf(cls) + 0.02).toFixed(3)})`);
for (const cls of withAlphas('ring-white')) plain(cls, `--tw-ring-color: hsl(0 0% 100% / ${(0.08 * alphaOf(cls) + 0.02).toFixed(3)})`);
for (const n of NEUTRALS) {
  for (const [shade, l] of Object.entries(LINE)) {
    for (const cls of withAlphas(`border-${n}-${shade}`)) plain(cls, `border-color: hsl(240 4% ${l}% / ${alphaOf(cls)})`);
    for (const cls of withAlphas(`ring-${n}-${shade}`)) plain(cls, `--tw-ring-color: hsl(240 4% ${l + 2}% / ${alphaOf(cls)})`);
    for (const cls of withAlphas(`divide-${n}-${shade}`)) {
      add(cls, `${sel(cls)} > :not([hidden]) ~ :not([hidden])`, `border-color: hsl(240 4% ${l}% / ${alphaOf(cls)})`);
    }
  }
}

// ── Gradient stops ───────────────────────────────────────────────────────────────────────────
// `from-*` replaces only its own stop, `via-*` rebuilds the stop list the way Tailwind does, and
// `to-*` replaces the end — so a gradient mixing remapped and untouched stops still composes.
function stops(base, color) {
  for (const cls of withAlphas(`from-${base}`)) plain(cls, `--tw-gradient-from: ${color(alphaOf(cls))} var(--tw-gradient-from-position)`);
  for (const cls of withAlphas(`via-${base}`)) {
    plain(cls, `--tw-gradient-stops: var(--tw-gradient-from), ${color(alphaOf(cls))} var(--tw-gradient-via-position), var(--tw-gradient-to)`);
  }
  for (const cls of withAlphas(`to-${base}`)) plain(cls, `--tw-gradient-to: ${color(alphaOf(cls))} var(--tw-gradient-to-position)`);
}
stops('white', (a) => `hsl(var(--card) / ${a})`);
for (const n of NEUTRALS) {
  stops(`${n}-50`, (a) => `hsl(var(--dc-50) / ${a})`);
  stops(`${n}-100`, (a) => `hsl(var(--dc-100) / ${a})`);
}

// ── Tinted chips, panels and status text ─────────────────────────────────────────────────────
// Pastel -50/-100/-200 fills become a translucent wash of their hue and dark -600…-950 text its
// light counterpart. Text on a *solid* mid-tone fill (amber-900 on amber-400) is left alone: it was
// already readable, and the light variant would not be.
const SOLID_FILL = ':not([class*="bg-"][class*="-300"], [class*="bg-"][class*="-400"], [class*="bg-"][class*="-500"])';
for (const c of CHROMA) {
  const hue = (shade) => rgb(colors[c][shade]);
  for (const [shade, a] of Object.entries({ 50: 0.12, 100: 0.18, 200: 0.26 })) {
    for (const cls of withAlphas(`bg-${c}-${shade}`)) {
      plain(cls, `background-color: rgb(${hue(500)} / ${(a * Math.max(alphaOf(cls), 0.6)).toFixed(3)})`);
      state('hover', cls, ':hover', `background-color: rgb(${hue(500)} / ${(a + 0.06).toFixed(3)})`);
    }
    for (const cls of withAlphas(`border-${c}-${shade}`)) plain(cls, `border-color: rgb(${hue(500)} / ${(a + 0.14).toFixed(3)})`);
    for (const cls of withAlphas(`ring-${c}-${shade}`)) plain(cls, `--tw-ring-color: rgb(${hue(500)} / ${(a + 0.14).toFixed(3)})`);
  }
  for (const shade of [50, 100]) stops(`${c}-${shade}`, (a) => `rgb(${hue(500)} / ${(0.1 * Math.max(a, 0.5)).toFixed(3)})`);
  for (const shade of [700, 800, 900, 950]) plain(`text-${c}-${shade}`, `color: rgb(${hue(300)})`, SOLID_FILL);
  plain(`text-${c}-600`, `color: rgb(${hue(400)})`, SOLID_FILL);
  for (const shade of [700, 800]) state('hover', `text-${c}-${shade}`, ':hover', `color: rgb(${hue(200)})`);
}

let body = '';
for (const [decl, selectors] of rules) body += `  ${selectors.join(',\n  ')} {\n    ${decl};\n  }\n`;
const header = `/* GENERATED by scripts/generate-dark-compat.mjs — do not edit by hand; run \`npm run theme:dark-compat\`.
 * Dark-mode compatibility for screens built with light-only utilities. See the script for the rules. */
`;
writeFileSync(OUT, `${header}@media screen {\n${body}}\n`.replace(/\n/g, '\r\n'));
console.log(`Wrote ${OUT} (${rules.size} rule blocks, ${[...rules.values()].reduce((n, s) => n + s.length, 0)} selectors).`);
