/**
 * The Firebase project's public client configuration, in one place.
 *
 * ── Why this file exists ───────────────────────────────────────────────────────────────────────
 *
 * These values were hard-coded inside `firebase.ts`, and `.env` separately carried a set of
 * `NEXT_PUBLIC_FIREBASE_*` variables that nothing on the client actually read. The two had
 * drifted: the `.env` copy pointed at a different app registration (sender 910767405564) whose
 * API key Google now rejects outright, while the working key lived only in `firebase.ts`.
 *
 * Nothing noticed, because the web app never read the environment copy. Then the Windows Agent's
 * `/api/windows-agent/bootstrap` route did — it is a *server* route, so the hard-coded client
 * value was not available to it — and handed every agent a dead key. The agent reported
 * "Sign-in failed. Please try again." and the actual cause, `API key not valid`, was two layers
 * down.
 *
 * A duplicated constant that only one consumer reads is a constant that will be wrong the first
 * time a second consumer appears. So there is now exactly one definition, imported by both the
 * browser SDK and the server route.
 *
 * ── None of this is secret ─────────────────────────────────────────────────────────────────────
 *
 * A Firebase Web API key identifies a project; it authorises nothing. It is compiled into the
 * JavaScript of every public page and is meant to be. Access is decided by Firebase
 * Authentication and the Firestore rules, not by whether somebody can read this file.
 *
 * ── Why the environment does NOT override this ─────────────────────────────────────────────────
 *
 * The obvious design is "environment wins, fall back to the built-in". It is wrong here, and
 * would have broken the web app the moment it shipped: the environment copy on this installation
 * is the *dead* key. Letting it win would take a working application and point it at a key Google
 * rejects — and the same stale variables are presumably set wherever this deploys, so the failure
 * would not be limited to one developer's machine.
 *
 * So the values below are authoritative, which is exactly what `firebase.ts` already did. The
 * only environment variable consulted is `databaseURL`, because that is the one `firebase.ts`
 * already allowed to be overridden and installations do legitimately move it.
 *
 * Pointing at a different Firebase project therefore means editing this file. That is a
 * deliberate trade: an explicit code change is easier to review than a deployment that silently
 * authenticates against the wrong project. `firebaseConfigSource` below reports any disagreement
 * so a stale variable is visible rather than merely inert.
 *
 * This module imports nothing, so it is safe on both sides of the server/client boundary.
 */

export interface FirebasePublicConfig {
  projectId: string;
  appId: string;
  storageBucket: string;
  apiKey: string;
  authDomain: string;
  messagingSenderId: string;
  databaseURL: string;
}

/**
 * The values the browser SDK has been initialising with.
 *
 * Verified against Google's Identity Toolkit: this key answers `INVALID_LOGIN_CREDENTIALS` to a
 * bad password, which is what a valid key does. The `.env` key answers `API key not valid`.
 */
const BUILT_IN: FirebasePublicConfig = {
  projectId: 'module-hub-uc7tw',
  appId: '1:1098805626846:web:53c37d00f62dbbc19dbf4f',
  storageBucket: 'module-hub-uc7tw.firebasestorage.app',
  apiKey: 'AIzaSyBRnB-SvnQWuNipl2SOnuV4opME0ZmsdPQ',
  authDomain: 'module-hub-uc7tw.firebaseapp.com',
  messagingSenderId: '1098805626846',
  databaseURL: 'https://module-hub-uc7tw-default-rtdb.firebaseio.com',
};

export const firebasePublicConfig: FirebasePublicConfig = {
  ...BUILT_IN,
  // The one value `firebase.ts` already allowed the environment to move.
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim() || BUILT_IN.databaseURL,
};

/**
 * Whether a `NEXT_PUBLIC_FIREBASE_API_KEY` is set and whether it disagrees with the built-in one.
 *
 * A disagreement is not an error — the variable is simply not used — but it is a trap, and it is
 * the exact trap that produced a fleet of agents holding a dead key. The bootstrap route logs it
 * once so somebody can delete the stale variable rather than rediscover it later.
 */
export const firebaseConfigSource = {
  apiKeyFromEnvironment: Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim()),
  apiKeyDiffersFromBuiltIn:
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim()) &&
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() !== BUILT_IN.apiKey,
};
