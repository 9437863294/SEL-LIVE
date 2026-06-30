'use client';

import { AppProgressBar } from 'next-nprogress-bar';

/**
 * Renders a slim top progress bar that activates on every Next.js
 * route change. Must be a Client Component but can be used inside
 * the Server Component root layout.
 */
export default function ProgressBar() {
  return (
    <AppProgressBar
      height="2px"
      color="#06b6d4"          // cyan-500 — matches the app's brand colour
      options={{ showSpinner: false }}
      shallowRouting
    />
  );
}
