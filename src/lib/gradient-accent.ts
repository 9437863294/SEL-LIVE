/**
 * Hex for the `to-*` stop of a Tailwind gradient (Tailwind's own palette), so a card can cast a
 * shadow or glow in its icon's colour. A class built at runtime would not exist in the CSS, hence a
 * table. A gradient whose stop is not listed falls back to slate until it is added here.
 *
 * Used by the home page's module tiles (module-icon-registry.tsx gradients) and by the shared
 * module tile on each module's landing page (`@/components/shared/module-tile`).
 */
const TAILWIND_STOPS: Record<string, string> = {
  'amber-600': '#d97706', 'amber-700': '#b45309', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8',
  'cyan-600': '#0891b2', 'emerald-600': '#059669', 'emerald-700': '#047857', 'fuchsia-600': '#c026d3',
  'gray-600': '#4b5563', 'green-600': '#16a34a', 'indigo-600': '#4f46e5', 'indigo-700': '#4338ca',
  'orange-600': '#ea580c', 'pink-600': '#db2777', 'purple-600': '#9333ea', 'purple-700': '#7e22ce',
  'red-600': '#dc2626', 'rose-600': '#e11d48', 'sky-600': '#0284c7', 'sky-700': '#0369a1',
  'slate-700': '#334155', 'stone-700': '#44403c', 'teal-600': '#0d9488', 'teal-700': '#0f766e',
  'violet-600': '#7c3aed',
};

export function gradientAccent(gradient: string): string {
  const stop = /\bto-([a-z]+-\d{3})\b/.exec(gradient)?.[1];
  return (stop && TAILWIND_STOPS[stop]) || '#475569';
}
