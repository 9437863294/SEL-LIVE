import { NextResponse } from 'next/server';
import {
  accessErrorResponse,
  authenticateAccess,
  requireAccess,
  requireAnyAccess,
} from '@/lib/access-control-server';
import { bulkLink, buildReport, linkUser, unlinkUser } from '@/lib/greythr-link-service';

/**
 * The user ↔ greytHR employee link.
 *
 *   `GET  /api/greythr/link`   — the reconciliation report
 *   `POST /api/greythr/link`   — `{ action: 'link' | 'unlink' | 'bulk-link' }`
 *
 * ── Permissions ─────────────────────────────────────────────────────────────────────────────────
 *
 * Reading the report needs `Settings.User Management → View`. Changing a link needs either `Edit` or
 * the narrower `Link greytHR`, because the link decides which greytHR record drives an account's HR
 * data and — through the exit policy — whether that account gets deactivated when somebody resigns.
 * That is a user-management decision, not an employee-directory one, so it is deliberately a stronger
 * permission than the employee picker's. `Edit` is accepted so the administrators who already hold it
 * do not have to be re-granted anything.
 *
 * Checked here rather than trusted from the screen: the screens hide what a user cannot do, but §30
 * requires that navigating straight to this URL gains nothing.
 */

export const runtime = 'nodejs';

const RESOURCE = 'Settings.User Management';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, RESOURCE, 'View');

    const report = await buildReport();
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAnyAccess(context, [
      { resource: RESOURCE, action: 'Link greytHR' },
      { resource: RESOURCE, action: 'Edit' },
    ]);

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      userId?: string;
      employeeId?: string;
      method?: 'manual';
      reason?: string;
    };

    const actor = { userId: context.userId, userName: context.userName };

    switch (body.action) {
      case 'link': {
        if (!body.userId || !body.employeeId) {
          return NextResponse.json(
            { error: 'Both a user and an employee are required.' },
            { status: 400 },
          );
        }
        // Any link created through this route is a human decision, whatever match suggested it —
        // so it is recorded as `manual` and outranks every inferred method thereafter.
        const result = await linkUser(
          { userId: body.userId, employeeId: body.employeeId, method: 'manual' },
          actor,
        );
        return NextResponse.json({ ok: true, audit: result.audit });
      }

      case 'unlink': {
        if (!body.userId) return NextResponse.json({ error: 'A user is required.' }, { status: 400 });
        const result = await unlinkUser({ userId: body.userId, reason: body.reason }, actor);
        return NextResponse.json({ ok: true, audit: result.audit });
      }

      case 'bulk-link': {
        const result = await bulkLink(actor);
        return NextResponse.json({ ok: true, ...result });
      }

      case 'preview-bulk': {
        // The plan only. Shown before the button commits ~900 writes.
        const report = await buildReport();
        return NextResponse.json({ ok: true, plan: report.plan, counts: report.counts });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${body.action ?? ''}".` }, { status: 400 });
    }
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
