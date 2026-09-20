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
  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!firebaseApiKey || !projectId) {
    // A deployment problem rather than a caller problem, and worth saying plainly: the agent
    // surfaces this text to whoever is standing at the PC, and "500" would send them to the
    // wrong person.
    return Response.json(
      {
        error:
          'This SEL LIVE server is missing its public Firebase configuration '
          + '(NEXT_PUBLIC_FIREBASE_API_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID). '
          + 'The agent cannot be configured until that is set on the server.',
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
