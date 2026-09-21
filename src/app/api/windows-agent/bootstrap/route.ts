import { firebaseConfigSource, firebasePublicConfig } from '@/lib/firebase-public-config';

export const runtime = 'nodejs';

/**
 * GET /api/windows-agent/bootstrap
 *
 * The public configuration an agent needs before it can talk to anything: which Firebase project
 * this SEL LIVE installation belongs to, so the sign-in screen knows where to authenticate.
 *
 * ── Why this is unauthenticated, and why that is safe ──────────────────────────────────────────
 *
 * Everything returned here is already public. `NEXT_PUBLIC_FIREBASE_API_KEY` is compiled into the
 * JavaScript bundle of the login page — anybody who can reach this server can read it with view
 * source, and it is designed for that: a Firebase Web API key identifies a project, it does not
 * authorise anything. Signing in still needs a real password, and every agent call still needs
 * the device secret, which is issued at enrolment and never travels this way.
 *
 * ── What it buys ───────────────────────────────────────────────────────────────────────────────
 *
 * It removes a whole class of installation mistake. Without it, whoever installs the agent has to
 * find the Firebase Web API key and paste it correctly into an msiexec command line on every PC —
 * and a mistyped key fails at the first sign-in with a Google error that says nothing about the
 * key. With it, they type the address of the ERP they already know, and the agent asks the server
 * for the rest.
 *
 * That is also what lets the installer stop demanding the key as a property, which is what lets
 * the MSI be installed by double-clicking it.
 */
export async function GET() {
  // The same object the browser SDK initialises with, not the environment variables.
  //
  // Reading `NEXT_PUBLIC_FIREBASE_API_KEY` here was a real bug: on this installation those
  // variables describe a different, retired app registration whose key Google rejects with
  // "API key not valid". The web app never noticed because it had the working key hard-coded.
  // Every agent configured from this endpoint got the dead one.
  const { apiKey: firebaseApiKey, projectId } = firebasePublicConfig;

  if (firebaseConfigSource.apiKeyDiffersFromBuiltIn) {
    // Logged once per cold start rather than returned: the variable is unused, so this is a
    // tidiness problem, not a failure. Saying so is how it gets deleted instead of lying in wait.
    console.warn(
      '[windows-agent] NEXT_PUBLIC_FIREBASE_API_KEY is set and does not match the configured '
        + 'Firebase project. It is ignored — see src/lib/firebase-public-config.ts — but it is '
        + 'worth removing before it misleads somebody again.',
    );
  }

  if (!firebaseApiKey || !projectId) {
    // A deployment problem rather than a caller problem, and worth saying plainly: the agent
    // surfaces this text to whoever is standing at the PC, and "500" would send them to the
    // wrong person.
    return Response.json(
      {
        error:
          'This SEL LIVE server has no Firebase configuration. '
          + 'The agent cannot be set up until src/lib/firebase-public-config.ts is populated.',
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      firebaseApiKey,
      projectId,
      // Lets the agent's setup window confirm "you are connecting to SEL LIVE" rather than
      // silently accepting any host that happens to answer on that address.
      product: 'SEL LIVE',
      apiVersion: 1,
    },
    {
      // Never cached: an installer reading a stale key from a proxy after the project was
      // rotated would fail in a way nobody would think to look for here.
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
