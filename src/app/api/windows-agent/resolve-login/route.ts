import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { agentErrorResponse, authenticateDevice } from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/resolve-login
 *
 * Turns an employee ID into the email address Firebase Authentication knows the person by.
 *
 * §5's sign-in form offers "Employee ID / Email" and Firebase only understands the second, so
 * something has to bridge them. Doing it here rather than on the PC keeps the mapping next to the
 * employee master instead of shipping a copy of the staff directory to four hundred desktops.
 *
 * ── What this does and does not disclose ────────────────────────────────────────────────────────
 *
 * It requires a valid device credential, so an unenrolled machine learns nothing at all. On an
 * enrolled machine — a company PC, where the internal directory is not a secret — it confirms that
 * a given employee ID belongs to someone and returns their work email.
 *
 * Two deliberate limits keep that from becoming an enumeration tool:
 *
 *   • **It never accepts an email.** Passing one back would let somebody test addresses one at a
 *     time and learn which have accounts, which is the more useful half of a credential-stuffing
 *     setup. An input containing `@` is refused outright; the agent does not send one anyway,
 *     because it has nothing to resolve.
 *
 *   • **Inactive accounts do not resolve.** A resigned employee's ID returns nothing rather than
 *     an address that would fail at the password step for a different reason.
 *
 * It is a read with no password in it, so a wrong answer costs a failed sign-in and nothing more.
 */

/** Long enough for any real employee number, short enough to bound the query. */
const MAX_IDENTIFIER_LENGTH = 40;

export async function POST(request: Request) {
  try {
    await authenticateDevice(request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const identifier = String(body?.identifier || '').trim();

    if (!identifier || identifier.length > MAX_IDENTIFIER_LENGTH) {
      return Response.json({ email: null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (identifier.includes('@')) {
      return Response.json(
        { error: 'Sign in with the email address directly.' },
        { status: 400 },
      );
    }

    const firestore = getFirebaseAdminFirestore();

    // Both fields are tried because this database uses them for different things: `employeeNo` is
    // the printed staff number people actually know, and `employeeId` is the greytHR record id
    // that some accounts were linked by. A user who types either should get in.
    const [byNumber, byId] = await Promise.all([
      firestore.collection('users').where('employeeNo', '==', identifier).limit(2).get().catch(() => null),
      firestore.collection('users').where('employeeId', '==', identifier).limit(2).get().catch(() => null),
    ]);

    const matches = [...(byNumber?.docs ?? []), ...(byId?.docs ?? [])].filter(
      (doc) => doc.get('status') !== 'Inactive' && typeof doc.get('email') === 'string',
    );

    // Deduplicated because a user matching on both fields appears twice. More than one *distinct*
    // account for one employee number is a data problem, and guessing which was meant would sign
    // somebody in as a colleague — so it resolves to nothing and the person uses their email.
    const distinct = new Map(matches.map((doc) => [doc.id, doc]));
    if (distinct.size !== 1) {
      return Response.json({ email: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const [match] = distinct.values();
    return Response.json(
      { email: String(match.get('email')), displayName: String(match.get('name') || '') },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}
