import type { HomeDesign } from '@/lib/appearance/model';

/** Names and one-line descriptions of the home designs, for Settings › Appearance. */
export const HOME_DESIGN_META: Record<HomeDesign, { label: string; description: string }> = {
  classic: {
    label: 'Classic',
    description: 'The module launcher: cards in your own order, or grouped by category.',
  },
  command: {
    label: 'Command',
    description: "A welcome band with today's meetings and the modules holding work for you, over every module by category.",
  },
  launchpad: {
    label: 'Launchpad',
    description: 'A greeting with module search and work figures, over favourites and a grid of module tiles.',
  },
  aurora: {
    label: 'Aurora Glass',
    description: 'Launchpad as frosted glass over a soft colour glow, with a gradient greeting.',
  },
};
