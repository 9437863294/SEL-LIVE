# Access management — the additive permission layer

How a user's permissions are decided, where the new access-management layer sits relative to the
authorisation system that shipped before it, and what to do when somebody says "I can't see X".

---

## 1. The one rule

**Granting is a union. Nothing in this layer can take permissions away.**

```
Effective = BaseRole ∪ AdditionalRoles ∪ Direct ∪ Department ∪ Designation
            ∪ Project ∪ Temporary(unexpired)
```

The pre-existing system — a single role *name* on `users.role`, resolved against
`roles/{doc}.permissions` — keeps working untouched and remains the **base** of every calculation.
This layer only ever adds.

That is enforced structurally, not by convention:

| Guard | Where | What it does |
| --- | --- | --- |
| `mergePermissionMaps` | [access-control.ts](../src/lib/access-control.ts) | The only way permissions are ever combined. Has no code path that drops a key or an action. |
| `applyAssignmentToGrant` | same | Append-only. Cannot express `user.roles = [newRole]`. |
| `assertAdditive` | same | Called on every grant path before the batch commits. Throws rather than let a write reduce access. |
| `previewAssignment` | same | Reports `permissionsRemoved`; the confirm button disables if it is ever non-zero. |

`grantAccess` never writes `users.role`, and never writes `roles/{doc}.permissions`. The only writes
to `roles` come from the Role Builder, which is an explicit role-editing action.

---

## 2. Where things live

### Files

| File | Role |
| --- | --- |
| [`src/lib/access-control.ts`](../src/lib/access-control.ts) | Pure resolver and every rule. Dependency-free, runs under `node --test`. |
| [`src/lib/access-control-service.ts`](../src/lib/access-control-service.ts) | Firestore reads and writes (client SDK). |
| [`src/lib/access-control-server.ts`](../src/lib/access-control-server.ts) | Admin-SDK route guard: `authenticateAccess`, `requireAccess`. |
| [`src/hooks/useAccessDirectory.ts`](../src/hooks/useAccessDirectory.ts) | One load of users, roles, grants, scope rules and templates for the whole screen. |
| [`src/components/access-management/`](../src/components/access-management/) | The UI. |
| [`tests/access-control-domain.test.mjs`](../tests/access-control-domain.test.mjs) | 73 tests, including the non-negotiable §49 scenario. |

Same split as `e-approval-policy.ts` / `e-approval-service.ts` and `hr-policy.ts` /
`hr-requirement-service.ts`: rules stay unit-testable without an emulator, persistence stays boring.

### Collections

| Collection | Written by this layer | Shape |
| --- | --- | --- |
| `users/{uid}` | **No** — read only, except user creation which writes the same five fields User Management does | unchanged |
| `roles/{id}` | Role Builder only | `+ description? status? type? duplicatedFrom*?` — all optional |
| `accessGrants/{userId}` | Yes | `additionalRoles[] directPermissions[] departmentIds[] designations[] projectAccess[] temporaryAccess[] status` |
| `accessScopeGrants/{type_id}` | Yes | Department / Designation / Project → roles and permissions |
| `accessTemplates/{id}` | Yes | reusable bundles |
| `accessAuditLogs/{id}` | Yes, append-only | one row per affected user per change |
| `accessBatches/{batchId}` | Yes, append-only | `ACCESS-BATCH-20260825-001` |

**A user with no `accessGrants` document has exactly their base role's permissions** — which is
every user in the system on the day this shipped.

---

## 3. How a permission check resolves

### In the browser

`AuthProvider` does two things now instead of one:

1. The original live listener on `roles where name == user.role` → `basePermissions`. **Unchanged**,
   and still what gates the first paint.
2. A new listener on `accessGrants/{uid}`. If the document has any content, it loads the roles
   collection and the scope rules and runs the full resolver.

`permissions` in context is `mergePermissionMaps(basePermissions, additive.permissions)`.

Every failure path in step 2 — missing document, rules denial, offline, malformed data — leaves the
additive result null, and the merge degrades to `basePermissions` exactly. **A user cannot lose a
permission because the additive layer is unavailable.**

### In components

`useAuthorization().can(action, resource, scope)` is unchanged and still the primary check. Several
hundred call sites depend on its exact behaviour, including its alias map for renamed permission
nodes. The hook now also returns the §19 vocabulary:

```ts
const {
  can,                    // unchanged
  hasPermission,          // canPerformAction(resource, action, scope?)
  hasAnyPermission,
  hasAllPermissions,
  canAccessModule,
  canAccessPage,
  getEffectivePermissions,
  getPermissionSources,   // where does this come from?
  explainPermission,      // the §44 sentence
  effectiveAccess,
} = useAuthorization();
```

Prefer these over role-name comparisons. `user.role === 'Super Admin'` cannot be right in a system
where a user holds five roles — and there are still a few of those left in the codebase (see §7).

### On the server

```ts
import { authenticateAccess, requireAccess, accessErrorResponse } from '@/lib/access-control-server';

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Bank Guarantee Management.BG Requests', 'Approve');
    // context.access, context.projectIds, context.roleNames are all resolved
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
```

Existing routes are **not obliged to migrate**. Each currently hand-rolls the same twenty lines
(see [`api/inventory/route.ts:289`](<../src/app/api/inventory/route.ts#L289>)). `authenticateAccess`
returns a superset of what those compute — base role ∪ additions — so adopting it can only widen
what a route accepts, never narrow it.

---

## 4. Permission shape

Granted permissions are a **flat map of dotted keys to action arrays**, exactly as
`roles/{doc}.permissions` has always been:

```json
{
  "Project Management": ["View Module"],
  "Project Management.Tower Progress": ["View", "Update Progress"],
  "E-Approval.Settings.Approval Types": ["View", "Add"]
}
```

**Scoped permissions reuse the convention the app already has.** `can(action, resource, scope)` has
always checked `${resource}.${scope}` first — that is how `Expenses.Departments.<deptId>` works.
Project grants expand into exactly that shape:

```
project grant on "rayagada" carrying { "Project Management.Survey": ["Record"] }
  →  { "Project Management.Survey.rayagada": ["Record"] }
```

So a project grant is enforced by a checker that shipped years ago, with no changes to it. There is
no second lookup path to keep in sync.

The registry itself — modules, pages, actions — is derived from
[`permissionModules`](../src/lib/permissions.ts) by `flattenPermissionRegistry`. **A new module
registers itself by existing in that file.** Nothing else to configure.

### Add user is a page, not a dialog

`/settings/access-management/users/new`, entered from the Users tab and from Assign Access.

It was a modal. It is the longest form in the application — an employee picker over ~1,300 people,
eleven fields, then the entire role library — and a modal is the wrong container for that at any
width. Three concrete reasons, none of them taste:

1. **Two nested scrolling regions.** The employee list and the role picker each scroll *inside* a body
   that also scrolls, so a wheel gesture near either did something unpredictable.
2. **No address.** "Open the add-user form" was not a link, so it could not be shared, bookmarked, or
   returned to after a mis-click dismissed it and took the typed fields with it.
3. **Nowhere to grow.** A modal is capped at the viewport by definition; this form only gets longer.

The §14 handover is preserved exactly, which was the constraint: callers pass `?returnTo=`, and on
success the page navigates there with `assignTo=<uid>` appended — the parameter the access screens
already read to preselect somebody, so nothing new had to be invented. `returnTo` is validated as a
same-site path (`//evil.example` is rejected, not just `https://…`), because a `returnTo` an attacker
can set is an open redirect.

The form is exported separately from the page shell, so the layout is the only thing that changed —
`createUserWithAccess` is called with the same arguments as before.

Two actions were appended to existing nodes by later work, both additive — nobody holds them until
granted, and no existing check changed:

| Node | Action | Why it is not folded into `Edit` |
| --- | --- | --- |
| `Settings.User Management` | `Link greytHR` | Attaching a login to an HR record decides whose resignation deactivates whose account. An organisation may want HR to do the first-run linking without also being able to edit user records. See [greytHR integration §8b](greythr-integration.md). |
| `Employee.Documents` | `View` / `Download` | A document folder holds anything from an offer letter to a medical certificate. Knowing one exists is not the same as taking a copy. |

---

## 5. Removing access is a different operation

`removeAccessFromGrant` removes the *grant* and recomputes. It never subtracts a role's permission
list from a flattened array. That difference is the whole of the source-aware requirement:

> A user's base role grants `Tower Progress · View`. They are later given an additional role that
> also grants it. Remove the additional role → **they keep `Tower Progress · View`**, because the
> base role still grants it.

`RemovalOutcome` reports both sides: `permissionsLost` (what they genuinely lose) and
`permissionsRetainedByOtherSources` (what survives, and why the removal is safe).

Removal is a separate function, a separate dialog and a separate audit action from granting — never a
boolean on the grant path. The two carry opposite promises, and a shared component with a flag is how
the reassuring copy ends up on the destructive path.

Temporary grants are **revoked, not deleted**: `revokedAt` is stamped so the audit history survives.

---

## 6. Who can open the screen

`canOpenAccessManagement(can)` accepts **either**:

- `Settings.Access Management · View` (the new permission), **or**
- `Settings.User Management · Edit` **and** `Settings.Role Management · Edit`

The fallback is not laziness — it is what makes the feature possible to turn on. On the day this
shipped, no role document held the new permission, because it did not exist when those roles were
written. A page that only accepted the new permission would be unreachable by everybody, including
the administrator who has to grant it.

The same rule is applied in three places, deliberately duplicated rather than shared across a
trust boundary: the settings card, the page itself, and `requireAccessAdministrator` on the server.

---

## 7. Known role-name coupling

These still compare role *names*, and were not changed — each is load-bearing somewhere the additive
layer does not reach:

| Location | What it does | Effect of additional roles |
| --- | --- | --- |
| FD / BG / LC components | `user.role === 'Super Admin'` for cross-organisation scoping | An additionally-granted Super Admin role does **not** widen organisation scope. Multi-tenant scoping is separate from permissions. |
| [`e-approval-policy.ts:1381`](../src/lib/e-approval-policy.ts#L1381) | `actor.role === step.assignment.role` | A step addressed to a role matches only the user's **base** role. |
| `vehicle-insurance-workflow.ts` | `activeUsers.find(u => u.role === step.role)` | Same. |
| [`notifications.ts:141`](../src/lib/notifications.ts#L141) | `users where role in [...]` | Role-targeted notifications reach base-role holders only. |

`EffectiveAccess.effectiveRoleNames` carries base + additional + active temporary role names, so
each of these can be widened when wanted. Doing it wholesale would change who receives approvals and
notifications across four modules at once, which is a behavioural change rather than an additive
one — so it is left as an explicit decision per module.

---

## 8. Firestore rules

[`firestore.rules`](../firestore.rules) exists but is **not wired into `firebase.json`**, and must
not be deployed as-is.

This repository has never contained a Firestore rules file — `firebase.json` declares only the RTDB
rules, the Storage rules and the Firestore *indexes*. The Firestore rules for this project are
maintained in the Firebase console. Deploying the new file whole would replace the console ruleset
and lock every collection not mentioned in it.

**Recommended:** copy the five `access*` blocks plus the two helper functions into the existing
console ruleset, leaving everything else there untouched. The file's own header documents the
alternative.

Note the one rules limitation: security rules cannot run a query, so `rolePermissions()` resolves the
role by document **id**. `users.role` holds a role *name*. If your role document ids are not the role
names, gate these collections on whatever test the console ruleset already uses for
`Settings.User Management` instead.

---

## 9. Testing

```bash
npm run test:access-control        # 73 domain tests
npm run typecheck:access-control   # scoped typecheck
```

The suite covers the §49 non-negotiable scenario explicitly:

```
Before:  HR.View, Attendance.View, Attendance.Edit
Assign:  Project Viewer (Projects.View, Projects.Dashboard.View, Towers.View)
After:   all six — and `diff.removedCount === 0`
```

plus source-aware removal, multi-role resolution, temporary expiry, scope grants, idempotent
re-assignment, template expansion, copy-access, the matrix, privilege and SoD detection, the
last-administrator guard, and batch-id ordering.

Three typecheck errors exist on `main` and are unrelated to this work
(`bank-guarantee/document-panel.tsx` ×2, `insurance/RenewalDialog.tsx` ×1). ESLint is broken
repo-wide; use `tsc` and the node test runner.

---

## 10. Troubleshooting an access complaint

1. **`/settings/access-management/users/<userId>`** — the whole picture on one page.
2. **Effective access → Permissions & sources** — every held permission with a badge per grant.
3. **Effective access → Why?** — pick the exact resource and action; get a sentence naming the role,
   who assigned it, when, and whether removing one source would actually revoke it.
4. **Effective access → Preview as user** — what modules and pages they would see. A projection, not
   an impersonation; no audit record is attributed to them.
5. **Grants tab** — the individual grants, each with its own provenance, each removable.
6. **History tab** — every change to this user, with reasons and batch links.

If the answer is "the permission isn't granted anywhere", the Reports tab's **Permission usage**
report shows who *does* hold it — usually revealing which role should have been assigned.
