import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextCoreWebVitals,
  {
    settings: {
      /**
       * Pinned deliberately rather than left to auto-detection.
       *
       * Under ESLint 10, `eslint-plugin-react`'s `detectReactVersion` calls `getFilename()` on
       * something that is no longer a context object, so every rule that consults the React
       * version (`react/display-name`, `react/no-unescaped-entities`, …) threw
       * `TypeError: contextOrFilename.getFilename is not a function` and aborted the whole run —
       * lint crashed on every file in the repo, including files with no JSX at all. Declaring the
       * version short-circuits that detection, so the plugin never takes the broken path.
       *
       * Keep this in step with the `react` dependency in package.json when it moves to 20.x.
       */
      react: { version: "19.2" },
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Plain Node scripts and `node --test` suites, not part of the Next build. The Next/React
    // config isn't written for them and throws `scopeManager.addGlobals is not a function` when
    // applied to them, which took down `npm run lint` for the entire repo. They're checked by
    // `tsc` and by actually running them.
    "scripts/**",
    "tests/**",
    // Root-level build config (this file, postcss). Same `addGlobals` crash, same reason: the
    // Next/React flat config is aimed at app source, not at plain ESM config modules.
    "*.mjs",
    // Native shells, static assets and generated documentation exports. None of it is app source
    // we author; `eslint .` was walking into all of it, and the vendored scripts inside crash the
    // same way. Linting the app means linting `src/`.
    "android/**",
    "ios/**",
    "public/**",
    "docs/**",
    "*_files/**",
  ]),
]);
