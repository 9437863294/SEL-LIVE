import { NextResponse } from 'next/server';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
} from '@/lib/access-control-server';
import {
  applyAssignmentToGrant,
  canAssignAccess,
  canCreateUser,
  checkerFor,
  emptyUserAccessGrant,
  type RoleLike,
} from '@/lib/access-control';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { logServerActivity, requestProvenance } from '@/lib/activity-logger-server';
import {
  deriveEmploymentState,
  employmentSignals,
  isEmployeeMasterRecord,
  isSafeGreytHRId,
  isWorkingState,
  todayIso,
} from '@/lib/greythr';
import { fetchSingleEmployee, isGreytHRConfigured } from '@/lib/greythr-client';

export const runtime = 'nodejs';

interface CreateUserBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  mobile?: unknown;
  baseRole?: unknown;
  /** Legacy alias used by the original route. */
  role?: unknown;
  status?: unknown;
  employeeId?: unknown;
  employeeNo?: unknown;
  additionalRoleIds?: unknown;
  departmentIds?: unknown;
  designations?: unknown;
  projectIds?: unknown;
  reportingManagerId?: unknown;
  location?: unknown;
  /** Access Management asks for a grant document even when its optional selections are empty. */
  createAccessGrant?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function stringList(value: unknown, maximum = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, maximum);
}

function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function friendlyAuthError(error: unknown): string | null {
  const code = (error as { code?: string })?.code;
  if (code === 'auth/email-already-exists') return 'An account with this email already exists.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/invalid-password') return 'Password must be at least 6 characters.';
  return null;
}

/**
 * Create Firebase Auth and Firestore identity as one protected workflow.
 *
 * The old route was unauthenticated and created only the Auth account; both settings screens then
 * wrote the Firestore profile from the browser. A rejected profile write therefore left a login
 * that could authenticate but had no application user. This route authorizes the actor, validates
 * role/employee links on the server, and deletes the Auth account if the Firestore commit fails.
 */
export async function POST(request: Request) {
  let createdUid: string | null = null;
  let profileCommitted = false;

  try {
    const context = await authenticateAccess(request);
    const body = (await request.json().catch(() => null)) as CreateUserBody | null;
    if (!body) return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });

    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const mobile = text(body.mobile) || 'N/A';
    const baseRole = text(body.baseRole) || text(body.role);
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const employeeId = text(body.employeeId);
    const additionalRoleIds = stringList(body.additionalRoleIds);
    const departmentIds = stringList(body.departmentIds);
    const designations = stringList(body.designations);
    const projectIds = stringList(body.projectIds);
    const reportingManagerId = text(body.reportingManagerId);
    const location = text(body.location);
    const createAccessGrant = body.createAccessGrant === true;

    if (!name || !email || !password || !baseRole) {
      return NextResponse.json(
        { error: 'Name, email, password and base role are required.' },
        { status: 400 },
      );
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }
    if (name.length > 160 || mobile.length > 50 || baseRole.length > 120 || location.length > 200) {
      return NextResponse.json({ error: 'One or more fields are too long.' }, { status: 400 });
    }

    const can = checkerFor(context.access);
    if (!canCreateUser(can)) {
      throw new AccessDeniedError('Add permission on Settings.User Management is required.');
    }

    const carriesAdditionalAccess =
      createAccessGrant ||
      additionalRoleIds.length > 0 ||
      departmentIds.length > 0 ||
      designations.length > 0 ||
      projectIds.length > 0 ||
      Boolean(reportingManagerId || location);
    if (carriesAdditionalAccess && !canAssignAccess(can)) {
      throw new AccessDeniedError('Assign permission on Settings.Access Management is required.');
    }

    const db = getFirebaseAdminFirestore();
    const rolesSnapshot = await db.collection('roles').get();
    const roles = rolesSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as RoleLike);
    const baseRoleMatches = roles.filter((role) => role.name.trim().toLowerCase() === baseRole.toLowerCase());
    if (baseRoleMatches.length !== 1) {
      return NextResponse.json({ error: 'Select one valid base role.' }, { status: 400 });
    }
    const selectedBaseRole = baseRoleMatches[0];
    if (selectedBaseRole.status === 'Inactive' || selectedBaseRole.status === 'Disabled') {
      return NextResponse.json({ error: 'The selected base role is inactive.' }, { status: 400 });
    }

    const additionalRoles = additionalRoleIds.map((roleId) => roles.find((role) => role.id === roleId));
    if (
      additionalRoles.some(
        (role) => !role || role.status === 'Inactive' || role.status === 'Disabled',
      )
    ) {
      return NextResponse.json({ error: 'One or more additional roles are missing or inactive.' }, { status: 400 });
    }

    // Protect both joins. Auth enforces unique email in Firebase, but legacy Firestore profiles can
    // exist without a matching Auth account and still make an employee look unlinked in a race.
    const existingProfile = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!existingProfile.empty) {
      return NextResponse.json({ error: 'A user profile with this email already exists.' }, { status: 409 });
    }

    let canonicalEmployeeNo = text(body.employeeNo);
    let employeeEmail = '';
    if (employeeId) {
      if (!isSafeGreytHRId(employeeId)) {
        return NextResponse.json({ error: 'The selected employee id is invalid.' }, { status: 400 });
      }

      const employeeSnapshot = await db.collection('employees').doc(employeeId).get();
      let employeeSource: { employeeNo?: unknown; email?: unknown } | null =
        employeeSnapshot.exists && isEmployeeMasterRecord(employeeSnapshot.data())
          ? (employeeSnapshot.data() ?? {})
          : null;

      /**
       * Not every current employee is in the mirror yet.
       *
       * The Add User picker (`/api/greythr/employees`) offers anyone on greytHR's live CURRENT
       * roster, topped up on top of whatever the mirror happens to hold — an employee who joined
       * after the last successful sync, or was caught by one that partially failed, is offerable
       * there without being written to Firestore first. Checking only the mirror here rejected
       * exactly the people that fix was meant to unblock: the picker would offer them, and this
       * route would then refuse to create their account.
       *
       * Re-verified live rather than trusting whatever the browser sends, because this is the one
       * check that exists precisely so a client-asserted employee id cannot be trusted on its own
       * (§30) — the fix for one gap must not reopen the other.
       */
      if (!employeeSource && isGreytHRConfigured()) {
        try {
          const live = await fetchSingleEmployee(employeeId);
          if (live.employee) {
            const state = deriveEmploymentState(
              employmentSignals(live.employee, live.separation),
              todayIso(),
            );
            if (isWorkingState(state.state)) {
              employeeSource = { employeeNo: live.employee.employeeNo, email: live.employee.email };
            }
          }
        } catch {
          // Treated the same as "not found" below — greytHR being unreachable is not evidence the
          // employee exists, so this must not fail open.
        }
      }

      if (!employeeSource) {
        return NextResponse.json(
          {
            error:
              'This employee could not be confirmed as a current greytHR employee, in the mirror or live. ' +
              'They may have left, or the id may be stale — reopen the picker and try again.',
          },
          { status: 409 },
        );
      }

      canonicalEmployeeNo = text(employeeSource.employeeNo) || canonicalEmployeeNo;
      employeeEmail = text(employeeSource.email).toLowerCase();

      const byEmployeeId = await db
        .collection('users')
        .where('employeeId', '==', employeeId)
        .limit(1)
        .get();
      if (!byEmployeeId.empty) {
        return NextResponse.json({ error: 'This employee already has a platform login.' }, { status: 409 });
      }

      if (employeeEmail) {
        const byEmployeeEmail = await db
          .collection('users')
          .where('email', '==', employeeEmail)
          .limit(1)
          .get();
        if (!byEmployeeEmail.empty) {
          return NextResponse.json({ error: 'This employee is already linked by email.' }, { status: 409 });
        }
      }
    }

    const adminAuth = getFirebaseAdminAuth();
    const authUser = await adminAuth.createUser({
      email,
      password,
      displayName: name,
      disabled: status === 'Inactive',
    });
    createdUid = authUser.uid;

    const now = new Date().toISOString();
    const batch = db.batch();
    const userData = {
      name,
      email,
      mobile,
      role: selectedBaseRole.name,
      status,
      ...(employeeId ? { employeeId, employeeNo: canonicalEmployeeNo } : {}),
      ...(employeeId
        ? {
            greytHR: {
              linked: true,
              employeeId,
              employeeNo: canonicalEmployeeNo,
              method: 'manual',
              linkedAt: now,
              linkedBy: context.userId,
            },
          }
        : {}),
      createdAt: now,
      createdBy: context.userId,
      createdByName: context.userName,
    };
    batch.set(db.collection('users').doc(createdUid), userData);

    let additionalRoleNames: string[] = [];
    if (carriesAdditionalAccess) {
      const grant = emptyUserAccessGrant(createdUid);
      grant.departmentIds = departmentIds;
      grant.designations = designations;
      grant.createdBy = context.userId;
      grant.createdByName = context.userName;
      grant.createdAt = now;

      const assigned = applyAssignmentToGrant(
        grant,
        { roleIds: additionalRoleIds, projectIds },
        {
          roles,
          actor: { userId: context.userId, userName: context.userName },
        },
      );
      additionalRoleNames = assigned.additionalRoles.map((entry) => entry.roleName);
      batch.set(db.collection('accessGrants').doc(createdUid), {
        ...assigned,
        reportingManagerId: reportingManagerId || null,
        location: location || null,
      });
    }

    const auditRef = db.collection('accessAuditLogs').doc();
    batch.set(auditRef, {
      targetUserId: createdUid,
      targetUserName: name,
      action: 'Create User',
      roleNames: [selectedBaseRole.name, ...additionalRoleNames],
      permissionsAdded: [],
      permissionsRemoved: [],
      permissionsSkipped: [],
      sourceKind: 'Base Role',
      changedBy: context.userId,
      changedByName: context.userName,
      changedAt: now,
      createdAt: now,
      organizationId: context.organizationId || null,
    });

    try {
      await batch.commit();
    } catch (error) {
      await adminAuth.deleteUser(createdUid).catch((cleanupError) => {
        console.error('[create-user] Failed to remove orphaned Auth account', cleanupError);
      });
      createdUid = null;
      throw error;
    }
    profileCommitted = true;

    const provenance = requestProvenance(request);
    void logServerActivity({
      userId: context.userId,
      userName: context.userName,
      userEmail: context.userEmail ?? undefined,
      module: 'User Management',
      action: 'Create User',
      details: {
        createdUserId: createdUid,
        createdUserName: name,
        createdUserEmail: email,
        assignedRole: selectedBaseRole.name,
        employeeId: employeeId || null,
      },
      ...provenance,
      source: 'api',
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: createdUid,
        name,
        email,
        mobile,
        role: selectedBaseRole.name,
        status,
        ...(employeeId ? { employeeId, employeeNo: canonicalEmployeeNo } : {}),
      },
    });
  } catch (error) {
    if (createdUid && !profileCommitted) {
      await getFirebaseAdminAuth().deleteUser(createdUid).catch((cleanupError) => {
        console.error('[create-user] Failed to remove orphaned Auth account', cleanupError);
      });
    }
    const friendly = friendlyAuthError(error);
    if (friendly) return NextResponse.json({ error: friendly }, { status: 400 });

    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
