import { getFirebaseAdminAuth } from '@/lib/firebase-admin';
import {
  AgentRequestError,
  agentErrorResponse,
  authenticateDevice,
  resolveAgentUser,
} from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/erp-session
 *
 * Mints a short-lived Firebase custom token so the agent's embedded ERP window opens already
 * signed in as the person who signed in to the agent.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────────
 *
 * The embedded window is a separate browser profile from Chrome or Edge, so it starts with no
 * Firebase session. Without this the employee would sign in to the agent and then be asked to
 * sign in again inside it — which is not "access the ERP from the app", it is two logins and a
 * reason to stop using the window.
 *
 * ── Why a custom token rather than passing the ID token through ────────────────────────────────
 *
 * The agent already holds a Firebase ID token, and it is tempting to hand that to the page. It
 * would not work: an ID token is a *result* of signing in, not a way to sign in. The web SDK has
 * no API to adopt one, and the page needs a real session with a refresh token so it can outlive
 * the hour the ID token lasts. `signInWithCustomToken` is the supported route, and it is what
 * the Admin SDK's `createCustomToken` exists for.
 *
 * ── What this can and cannot be used for ───────────────────────────────────────────────────────
 *
 * The token is minted for one uid — the caller's own, taken from their verified ID token, never
 * from the request body. There is no parameter by which a caller could ask for somebody else's
 * session. It requires both the device credential and a valid user token, so possession of the
 * device secret alone is not enough.
 *
 * Firebase custom tokens are valid for one hour and are exchanged immediately; the agent never
 * writes one to disk and never puts it in a URL — it is injected into the embedded page's script
 * context before navigation, so it does not appear in history, in a Referer header, or in any
 * server log along the way.
 */
export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const user = await resolveAgentUser(String(body.idToken || ''));

    // The uid comes from the verified token, not from the request. Worth being explicit about:
    // this is the single line that decides whose session is being handed out.
    //
    // Wrapped, because this is the only place in the entire application that asks the Admin SDK
    // to *sign* something, and signing is the one server capability that can be absent while
    // everything else works. Firestore reads, Firestore writes and verifyIdToken all succeed
    // with an unsigned credential; only minting a token needs a private key, or the IAM
    // signBlob permission when running on application-default credentials. A deployment missing
    // either looks completely healthy until somebody opens the ERP window, and then reports
    // "Something went wrong. Please try again." — which points nowhere.
    let customToken: string;
    try {
      customToken = await getFirebaseAdminAuth().createCustomToken(user.firebaseUid, {
        // Surfaced in the web session's token claims so the ERP can tell an agent-originated
        // session from a browser one — useful for the activity trail, and costs nothing here.
        selAgentDevice: authenticated.device.id,
      });
    } catch (signingError) {
      const code =
        signingError && typeof signingError === 'object' && 'code' in signingError
          ? String((signingError as { code: unknown }).code)
          : 'unknown';
      const detail = signingError instanceof Error ? signingError.message : String(signingError);

      console.error('[windows-agent] createCustomToken failed:', code, detail);

      // 503, not 500: the request was valid and will succeed once the server is configured.
      //
      // `diagnostic` names the failure class, not a secret, and only a caller holding a valid
      // device credential and a valid user token ever sees it. The alternative — making an
      // administrator correlate a generic 500 against logs they may not have access to — is how
      // a one-line IAM fix turns into a day.
      throw new AgentRequestError(
        'SEL LIVE cannot open signed-in inside the agent on this server yet. '
          + 'The window will still open; sign in there as usual, and tell IT that the server '
          + 'cannot mint sign-in tokens.',
        503,
        'ERP_SESSION_UNAVAILABLE',
        { diagnostic: code, detail: detail.slice(0, 300) },
      );
    }

    return Response.json(
      {
        customToken,
        userId: user.userId,
        userName: user.name,
        // Echoed so the agent can show who the window is signed in as without decoding a JWT.
        email: user.email,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}
