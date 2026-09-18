/**
 * Office Hub's authorization rules (§48).
 *
 * Pure, and built on the existing `access-control.ts` — which has no imports at all, so this module
 * stays runnable under `node --test` and inside the Admin-SDK cron route. Reusing that resolver
 * rather than writing a second one is the point of §89.7–8: a user's Office Hub access comes from
 * the same role documents, the same additive grants and the same live listener as their access to
 * every other module, so an administrator who grants a role does not have to know that Office Hub
 * exists.
 *
 * ── Permission *and* relationship ───────────────────────────────────────────────────────────────
 *
 * A role permission alone cannot answer most of the questions this module asks. "May I edit this
 * meeting?" depends on whether you organised it; "may I see this task?" depends on whether it is
 * assigned to you, to your team, or to your department. So every function below takes two things:
 * the permission map, and an `OfficeHubViewer` describing the person's place in the organisation.
 *
 * The rule that falls out of that, and which is worth stating because it recurs:
 *
 *   **Being the organizer of a meeting is authority over that meeting.** An organizer does not need
 *   `Meetings.Edit` to change their own meeting's agenda, mark its attendance or write its minutes —
 *   they need it to edit *other people's*. The same reading applies to a task's assignee and a
 *   decision's owner. Requiring a matching role permission on top is how a meeting ends up parked
 *   with somebody who cannot act on it, and it is the same conclusion E-Approval reached about
 *   assigned workflow steps (see the comment above its permission block in `permissions.ts`).
 */

import { hasPermission, type PermissionSubject } from './access-control.ts';
import type {
  MeetingStatus,
  MomStage,
  OfficeHubActionItem,
  OfficeHubDecision,
  OfficeHubMeeting,
  OfficeHubTask,
  OfficeHubTeam,
} from './office-hub-model.ts';
import { momStageRank } from './office-hub-rules.ts';

export const OFFICE_HUB_PERMISSION_RESOURCE = 'Office Hub';
export const OFFICE_HUB_ACTIVITY_MODULE = 'Office Hub';
export const OFFICE_HUB_BASE_PATH = '/office-hub';

/** The dotted permission resources this module gates on. One constant per screen. */
export const OFFICE_HUB_RESOURCES = {
  module: 'Office Hub',
  dashboard: 'Office Hub.Dashboard',
  calendar: 'Office Hub.Calendar',
  meetings: 'Office Hub.Meetings',
  agenda: 'Office Hub.Agenda',
  attendance: 'Office Hub.Attendance',
  minutes: 'Office Hub.Minutes',
  decisions: 'Office Hub.Decisions',
  actionItems: 'Office Hub.Action Items',
  tasks: 'Office Hub.Tasks',
  teams: 'Office Hub.Teams',
  employees: 'Office Hub.Employees',
  documents: 'Office Hub.Documents',
  reports: 'Office Hub.Reports',
  workload: 'Office Hub.Workload',
  managementOverview: 'Office Hub.Management Overview',
  templates: 'Office Hub.Templates',
  settings: 'Office Hub.Settings',
} as const;

/**
 * Who is asking, and where they sit.
 *
 * Assembled once per session by `useOfficeHub` from the auth session plus the user's team
 * memberships, and passed to every check. It is deliberately plain data: the same object is built
 * on the server from an Admin-SDK read when the cron route needs to decide what to include in a
 * digest.
 */
export interface OfficeHubViewer {
  userId: string;
  name: string;
  email?: string | null;
  /** The department the person belongs to. */
  departmentId?: string | null;
  departmentName?: string | null;
  /** Departments they head — from `departments.head`. Empty for most people. */
  headsDepartmentIds?: string[];
  /** Teams they are a member of. */
  teamIds?: string[];
  /** Teams they lead. A subset of `teamIds`. */
  leadsTeamIds?: string[];
  employeeId?: string | null;
  designation?: string | null;
  timeZone?: string | null;
}

export const EMPTY_VIEWER: OfficeHubViewer = { userId: '', name: '' };

/* ── the flat capability set ──────────────────────────────────────────────────────────────────── */

/**
 * Every permission question the UI asks, answered once.
 *
 * Resolved in one pass and memoised by the hook, because a register row asks a dozen of these and a
 * detail page asks fifty. Screens read this rather than calling `hasPermission` with string
 * literals — a typo'd resource string silently returns false, which shows up as a button that is
 * missing rather than as an error.
 */
export interface OfficeHubCapabilities {
  canViewModule: boolean;
  canViewDashboard: boolean;
  canViewCalendar: boolean;
  canRescheduleFromCalendar: boolean;

  canViewMeetings: boolean;
  canViewAllMeetings: boolean;
  canViewDepartmentMeetings: boolean;
  canViewTeamMeetings: boolean;
  canCreateMeeting: boolean;
  canEditAnyMeeting: boolean;
  canCancelAnyMeeting: boolean;
  canManageAnyParticipants: boolean;
  canChangeOrganizer: boolean;
  canExportMeetings: boolean;

  canManageAnyAgenda: boolean;
  canRecordAnyAttendance: boolean;

  canViewMinutes: boolean;
  canPrepareMinutes: boolean;
  canReviewMinutes: boolean;
  canApproveMinutes: boolean;
  canPublishMinutes: boolean;

  canViewDecisions: boolean;
  canViewAllDecisions: boolean;
  canCreateDecision: boolean;
  canEditAnyDecision: boolean;
  canCloseAnyDecision: boolean;

  canViewActionItems: boolean;
  canCreateActionItem: boolean;
  canEditAnyActionItem: boolean;
  canConvertActionItem: boolean;

  canViewTasks: boolean;
  canViewAllTasks: boolean;
  canViewDepartmentTasks: boolean;
  canViewTeamTasks: boolean;
  canCreateTask: boolean;
  canEditAnyTask: boolean;
  canAssignTasks: boolean;
  canCompleteAnyTask: boolean;
  canDeleteTask: boolean;
  canCommentOnTasks: boolean;
  canExportTasks: boolean;

  canViewTeams: boolean;
  canCreateTeam: boolean;
  canEditAnyTeam: boolean;
  canManageAnyTeamMembers: boolean;
  canChangeTeamLeader: boolean;
  canArchiveTeam: boolean;

  canViewEmployees: boolean;
  canImportEmployees: boolean;

  canViewDocuments: boolean;
  canUploadDocuments: boolean;
  canDownloadDocuments: boolean;
  canRemoveDocuments: boolean;

  canViewReports: boolean;
  canExportReports: boolean;
  canViewWorkload: boolean;
  canViewManagementOverview: boolean;

  canViewTemplates: boolean;
  canManageTemplates: boolean;
  canViewSettings: boolean;
  canEditSettings: boolean;
}

export function resolveOfficeHubCapabilities(
  subject: PermissionSubject,
  viewer: OfficeHubViewer = EMPTY_VIEWER,
): OfficeHubCapabilities {
  const can = (resource: string, action: string) => hasPermission(subject, resource, action);
  const R = OFFICE_HUB_RESOURCES;

  /**
   * Leading a team or heading a department carries a baseline that no role has to grant.
   *
   * §48 gives Team Leader and Department Head as roles, but in this organisation those are facts
   * about the `teams` and `departments` records rather than roles anybody is assigned. Deriving the
   * baseline from the record means a newly appointed team leader can run their team's meetings the
   * moment they are named, without a second administrative step that everybody forgets.
   */
  const leadsSomething = Boolean(viewer.leadsTeamIds?.length || viewer.headsDepartmentIds?.length);

  const canViewMeetings = can(R.meetings, 'View') || can(R.meetings, 'View All');
  const canViewTasks = can(R.tasks, 'View') || can(R.tasks, 'View All');

  return {
    canViewModule:
      can(R.module, 'View Module') ||
      canViewMeetings ||
      canViewTasks ||
      can(R.dashboard, 'View') ||
      can(R.calendar, 'View'),
    canViewDashboard: can(R.dashboard, 'View') || canViewMeetings,
    canViewCalendar: can(R.calendar, 'View') || canViewMeetings,
    canRescheduleFromCalendar: can(R.calendar, 'Reschedule') || can(R.meetings, 'Reschedule'),

    canViewMeetings,
    canViewAllMeetings: can(R.meetings, 'View All'),
    canViewDepartmentMeetings: can(R.meetings, 'View Department') || leadsSomething,
    canViewTeamMeetings: can(R.meetings, 'View Team') || leadsSomething,
    canCreateMeeting: can(R.meetings, 'Create'),
    canEditAnyMeeting: can(R.meetings, 'Edit'),
    canCancelAnyMeeting: can(R.meetings, 'Cancel'),
    canManageAnyParticipants: can(R.meetings, 'Manage Participants'),
    canChangeOrganizer: can(R.meetings, 'Change Organizer'),
    canExportMeetings: can(R.meetings, 'Export'),

    canManageAnyAgenda: can(R.agenda, 'Add') || can(R.agenda, 'Edit'),
    canRecordAnyAttendance: can(R.attendance, 'Record'),

    canViewMinutes: can(R.minutes, 'View') || canViewMeetings,
    canPrepareMinutes: can(R.minutes, 'Prepare'),
    canReviewMinutes: can(R.minutes, 'Review'),
    canApproveMinutes: can(R.minutes, 'Approve'),
    canPublishMinutes: can(R.minutes, 'Publish'),

    canViewDecisions: can(R.decisions, 'View') || can(R.decisions, 'View All'),
    canViewAllDecisions: can(R.decisions, 'View All'),
    canCreateDecision: can(R.decisions, 'Create'),
    canEditAnyDecision: can(R.decisions, 'Edit'),
    canCloseAnyDecision: can(R.decisions, 'Close'),

    canViewActionItems: can(R.actionItems, 'View') || canViewMeetings,
    canCreateActionItem: can(R.actionItems, 'Create'),
    canEditAnyActionItem: can(R.actionItems, 'Edit'),
    canConvertActionItem: can(R.actionItems, 'Convert to Task') || can(R.tasks, 'Create'),

    canViewTasks,
    canViewAllTasks: can(R.tasks, 'View All'),
    canViewDepartmentTasks: can(R.tasks, 'View Department') || leadsSomething,
    canViewTeamTasks: can(R.tasks, 'View Team') || leadsSomething,
    canCreateTask: can(R.tasks, 'Create'),
    canEditAnyTask: can(R.tasks, 'Edit'),
    canAssignTasks: can(R.tasks, 'Assign') || leadsSomething,
    canCompleteAnyTask: can(R.tasks, 'Complete'),
    canDeleteTask: can(R.tasks, 'Delete'),
    canCommentOnTasks: can(R.tasks, 'Comment') || canViewTasks,
    canExportTasks: can(R.tasks, 'Export'),

    canViewTeams: can(R.teams, 'View'),
    canCreateTeam: can(R.teams, 'Create'),
    canEditAnyTeam: can(R.teams, 'Edit'),
    canManageAnyTeamMembers: can(R.teams, 'Manage Members'),
    canChangeTeamLeader: can(R.teams, 'Change Leader'),
    canArchiveTeam: can(R.teams, 'Archive'),

    canViewEmployees: can(R.employees, 'View'),
    canImportEmployees: can(R.employees, 'Import'),

    canViewDocuments: can(R.documents, 'View') || canViewMeetings,
    canUploadDocuments: can(R.documents, 'Upload'),
    canDownloadDocuments: can(R.documents, 'Download') || can(R.documents, 'View'),
    canRemoveDocuments: can(R.documents, 'Delete'),

    canViewReports: can(R.reports, 'View'),
    canExportReports: can(R.reports, 'Export'),
    canViewWorkload: can(R.workload, 'View') || can(R.reports, 'View'),
    canViewManagementOverview: can(R.managementOverview, 'View'),

    canViewTemplates: can(R.templates, 'View') || can(R.meetings, 'Create'),
    canManageTemplates: can(R.templates, 'Add') || can(R.templates, 'Edit'),
    canViewSettings: can(R.settings, 'View'),
    canEditSettings: can(R.settings, 'Edit'),
  };
}

/* ── meetings ─────────────────────────────────────────────────────────────────────────────────── */

export const isMeetingOrganizer = (
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById'>,
  viewer: OfficeHubViewer,
): boolean => meeting.organizerId === viewer.userId || meeting.scheduledById === viewer.userId;

export const isMeetingParticipant = (
  meeting: Pick<OfficeHubMeeting, 'participantUserIds' | 'organizerId'>,
  viewer: OfficeHubViewer,
): boolean =>
  meeting.organizerId === viewer.userId || (meeting.participantUserIds ?? []).includes(viewer.userId);

/**
 * Whether the viewer may open this meeting at all.
 *
 * Participants and the organizer always may. Beyond that it widens by grant: department-wide,
 * team-wide, or everything. A meeting that belongs to a department the viewer *heads* is visible
 * even without the grant, which is what makes "Department Head" in §48 mean anything.
 */
export function canViewMeeting(
  meeting: Pick<
    OfficeHubMeeting,
    'organizerId' | 'scheduledById' | 'participantUserIds' | 'departmentIds' | 'teamIds'
  >,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): boolean {
  if (!capabilities.canViewModule) return false;
  if (capabilities.canViewAllMeetings) return true;
  if (isMeetingParticipant(meeting, viewer)) return true;

  const headedDepartments = viewer.headsDepartmentIds ?? [];
  if ((meeting.departmentIds ?? []).some((id) => headedDepartments.includes(id))) return true;

  if (capabilities.canViewDepartmentMeetings && viewer.departmentId) {
    if ((meeting.departmentIds ?? []).includes(viewer.departmentId)) return true;
  }
  if (capabilities.canViewTeamMeetings) {
    const teams = viewer.teamIds ?? [];
    if ((meeting.teamIds ?? []).some((id) => teams.includes(id))) return true;
  }
  return false;
}

export interface Verdict {
  allowed: boolean;
  reason: string | null;
}

const allow: Verdict = { allowed: true, reason: null };
const deny = (reason: string): Verdict => ({ allowed: false, reason });

/**
 * Whether this meeting can be edited, and by whom.
 *
 * A completed meeting is closed to editing even for its organizer: its agenda, participants and
 * times are now part of the record that the minutes, the attendance sheet and any tasks raised from
 * it all refer to. Editing them afterwards does not correct history, it falsifies it — and §83's
 * whole position is that historical records are not to be rewritten. The screens that *should* stay
 * open after a meeting (minutes, action items, follow-ups) are governed separately below.
 */
export function canEditMeeting(
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById' | 'status' | 'isDeleted'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (meeting.isDeleted) return deny('This meeting has been removed.');
  if (meeting.status === 'Cancelled') return deny('A cancelled meeting cannot be edited.');
  if (meeting.status === 'Completed') {
    return deny('This meeting has finished. Record its outcome in the minutes instead.');
  }
  if (isMeetingOrganizer(meeting, viewer)) return allow;
  if (capabilities.canEditAnyMeeting) return allow;
  return deny('Only the organizer can change this meeting.');
}

export function canCancelMeeting(
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById' | 'status' | 'isDeleted'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (meeting.isDeleted) return deny('This meeting has been removed.');
  if (meeting.status === 'Cancelled') return deny('This meeting is already cancelled.');
  if (meeting.status === 'Completed') return deny('A completed meeting cannot be cancelled.');
  if (isMeetingOrganizer(meeting, viewer)) return allow;
  if (capabilities.canCancelAnyMeeting) return allow;
  return deny('Only the organizer can cancel this meeting.');
}

export function canManageParticipants(
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (meeting.status === 'Cancelled') return deny('This meeting is cancelled.');
  if (isMeetingOrganizer(meeting, viewer)) return allow;
  if (capabilities.canManageAnyParticipants) return allow;
  return deny('Only the organizer can change the invitation list.');
}

/** Agenda editing. Open while the meeting is live — that is when items get added (§18). */
export function canManageAgenda(
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (meeting.status === 'Cancelled') return deny('This meeting is cancelled.');
  if (meeting.status === 'Completed') return deny('The meeting has finished.');
  if (isMeetingOrganizer(meeting, viewer)) return allow;
  if (capabilities.canManageAnyAgenda) return allow;
  return deny('Only the organizer can change the agenda.');
}

/**
 * Attendance (§19). Deliberately still open after the meeting is marked complete.
 *
 * Attendance is almost always filled in afterwards — during the meeting nobody is looking at a
 * screen — so locking it on completion would make the feature unusable. It is the organizer's
 * record to keep, and every change is in the audit trail.
 */
export function canRecordAttendance(
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (meeting.status === 'Draft') return deny('Send the invitations before recording attendance.');
  if (meeting.status === 'Cancelled') return deny('This meeting was cancelled.');
  if (isMeetingOrganizer(meeting, viewer)) return allow;
  if (capabilities.canRecordAnyAttendance) return allow;
  return deny('Only the organizer records attendance.');
}

/** Starting and ending a meeting in live mode (§18). */
export function canRunMeeting(
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (meeting.status === 'Cancelled') return deny('This meeting was cancelled.');
  if (meeting.status === 'Completed') return deny('This meeting has already finished.');
  if (meeting.status === 'Draft') return deny('Send the invitations before starting the meeting.');
  if (isMeetingOrganizer(meeting, viewer)) return allow;
  if (capabilities.canEditAnyMeeting) return allow;
  return deny('Only the organizer can start this meeting.');
}

/** A participant may always answer their own invitation, and only their own (§13). */
export function canRespondToInvitation(
  participant: { userId: string },
  meeting: Pick<OfficeHubMeeting, 'status'>,
  viewer: OfficeHubViewer,
): Verdict {
  if (participant.userId !== viewer.userId) {
    return deny('You can only respond to your own invitation.');
  }
  if (meeting.status === 'Cancelled') return deny('This meeting was cancelled.');
  if (meeting.status === 'Completed') return deny('This meeting has already happened.');
  return allow;
}

/* ── minutes ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Who may move the minutes to the next stage (§46).
 *
 * The organizer prepares; review, approval and publication need the corresponding grant. The one
 * rule enforced here that is not about permissions: the person who *prepared* the minutes may not
 * also approve them, when approval is required. An approval ladder every step of which one person
 * can walk alone is a ladder that records four signatures from one signatory.
 */
export function canAdvanceMinutes(
  mom: {
    stage: MomStage;
    approvalRequired: boolean;
    preparedById?: string | null;
    reviewedById?: string | null;
  },
  meeting: Pick<OfficeHubMeeting, 'organizerId' | 'scheduledById' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
  target: MomStage,
): Verdict {
  const organizer = isMeetingOrganizer(meeting, viewer);

  if (target === 'Prepared') {
    if (organizer || capabilities.canPrepareMinutes) return allow;
    return deny('Only the organizer can prepare the minutes.');
  }

  if (target === 'Reviewed') {
    if (!capabilities.canReviewMinutes) return deny('You do not have permission to review minutes.');
    if (momStageRank(mom.stage) < momStageRank('Prepared')) return deny('The minutes are not prepared yet.');
    return allow;
  }

  if (target === 'Approved') {
    if (!capabilities.canApproveMinutes) return deny('You do not have permission to approve minutes.');
    if (mom.approvalRequired && momStageRank(mom.stage) < momStageRank('Reviewed')) {
      return deny('The minutes still need review.');
    }
    if (mom.approvalRequired && mom.preparedById && mom.preparedById === viewer.userId) {
      return deny('The minutes must be approved by someone other than the person who prepared them.');
    }
    return allow;
  }

  if (target === 'Published') {
    if (!capabilities.canPublishMinutes && !organizer) {
      return deny('You do not have permission to publish minutes.');
    }
    if (meeting.status !== 'Completed') {
      return deny('Mark the meeting completed before publishing its minutes.');
    }
    if (mom.approvalRequired && momStageRank(mom.stage) < momStageRank('Approved')) {
      return deny('These minutes have not been approved yet.');
    }
    if (mom.stage === 'Draft') return deny('Prepare the minutes first.');
    return allow;
  }

  return deny('Unknown minutes stage.');
}

/* ── tasks ────────────────────────────────────────────────────────────────────────────────────── */

export function canViewTask(
  task: Pick<OfficeHubTask, 'assigneeId' | 'createdBy' | 'teamId' | 'departmentId' | 'watcherUserIds'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): boolean {
  if (!capabilities.canViewModule) return false;
  if (capabilities.canViewAllTasks) return true;
  if (task.assigneeId === viewer.userId) return true;
  if (task.createdBy === viewer.userId) return true;
  if ((task.watcherUserIds ?? []).includes(viewer.userId)) return true;
  if (task.teamId && (viewer.teamIds ?? []).includes(task.teamId)) return true;
  if (task.departmentId && (viewer.headsDepartmentIds ?? []).includes(task.departmentId)) return true;
  if (capabilities.canViewDepartmentTasks && task.departmentId && task.departmentId === viewer.departmentId) {
    return true;
  }
  if (capabilities.canViewTeamTasks && task.teamId && (viewer.teamIds ?? []).includes(task.teamId)) {
    return true;
  }
  return false;
}

/**
 * Whether the viewer may edit this task.
 *
 * The assignee may — it is their work, and a task whose owner cannot update its progress is a task
 * that never gets updated. The creator may, because they are accountable for having raised it. A
 * team leader may edit their team's tasks, which is §26's "allow team leader to assign individual
 * responsibility" read as the authority it implies.
 */
export function canEditTask(
  task: Pick<OfficeHubTask, 'assigneeId' | 'createdBy' | 'teamId' | 'departmentId' | 'status' | 'isDeleted'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (task.isDeleted) return deny('This task has been removed.');
  if (task.status === 'Cancelled') return deny('This task was cancelled.');
  if (task.assigneeId === viewer.userId) return allow;
  if (task.createdBy === viewer.userId) return allow;
  if (task.teamId && (viewer.leadsTeamIds ?? []).includes(task.teamId)) return allow;
  if (task.departmentId && (viewer.headsDepartmentIds ?? []).includes(task.departmentId)) return allow;
  if (capabilities.canEditAnyTask) return allow;
  return deny('Only the assignee, the person who raised it, or a team leader can change this task.');
}

export function canAssignTask(
  task: Pick<OfficeHubTask, 'createdBy' | 'teamId' | 'departmentId'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (capabilities.canAssignTasks) return allow;
  if (task.createdBy === viewer.userId) return allow;
  if (task.teamId && (viewer.leadsTeamIds ?? []).includes(task.teamId)) return allow;
  if (task.departmentId && (viewer.headsDepartmentIds ?? []).includes(task.departmentId)) return allow;
  return deny('You do not have permission to assign this task.');
}

export function canCompleteTaskAs(
  task: Pick<OfficeHubTask, 'assigneeId' | 'createdBy' | 'teamId' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (task.status === 'Completed') return deny('This task is already complete.');
  if (task.status === 'Cancelled') return deny('This task was cancelled.');
  if (task.assigneeId === viewer.userId) return allow;
  if (task.createdBy === viewer.userId) return allow;
  if (task.teamId && (viewer.leadsTeamIds ?? []).includes(task.teamId)) return allow;
  if (capabilities.canCompleteAnyTask) return allow;
  return deny('Only the assignee or the person who raised it can complete this task.');
}

/* ── decisions and action items ──────────────────────────────────────────────────────────────── */

export function canViewDecision(
  decision: Pick<OfficeHubDecision, 'ownerId' | 'createdBy' | 'departmentId' | 'meetingId'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
  options: { participantOfMeeting?: boolean } = {},
): boolean {
  if (!capabilities.canViewDecisions) return false;
  if (capabilities.canViewAllDecisions) return true;
  if (decision.ownerId === viewer.userId || decision.createdBy === viewer.userId) return true;
  if (decision.departmentId && decision.departmentId === viewer.departmentId) return true;
  if (decision.departmentId && (viewer.headsDepartmentIds ?? []).includes(decision.departmentId)) return true;
  return Boolean(options.participantOfMeeting);
}

export function canEditDecision(
  decision: Pick<OfficeHubDecision, 'ownerId' | 'createdBy' | 'status' | 'isDeleted'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (decision.isDeleted) return deny('This decision has been removed.');
  if (decision.status === 'Cancelled') return deny('This decision was cancelled.');
  if (decision.ownerId === viewer.userId || decision.createdBy === viewer.userId) return allow;
  if (capabilities.canEditAnyDecision) return allow;
  return deny('Only the decision owner can change it.');
}

export function canEditActionItem(
  item: Pick<
    OfficeHubActionItem,
    'responsibleUserId' | 'responsibleTeamId' | 'createdBy' | 'status' | 'isDeleted'
  >,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
  options: { organizerOfMeeting?: boolean } = {},
): Verdict {
  if (item.isDeleted) return deny('This action item has been removed.');
  if (item.status === 'Cancelled') return deny('This action item was cancelled.');
  if (item.responsibleUserId === viewer.userId || item.createdBy === viewer.userId) return allow;
  if (item.responsibleTeamId && (viewer.leadsTeamIds ?? []).includes(item.responsibleTeamId)) return allow;
  if (options.organizerOfMeeting) return allow;
  if (capabilities.canEditAnyActionItem) return allow;
  return deny('Only the responsible person or the meeting organizer can change this action item.');
}

/* ── teams ────────────────────────────────────────────────────────────────────────────────────── */

export function canEditTeam(
  team: Pick<OfficeHubTeam, 'leaderId' | 'createdBy' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (team.status === 'Archived') return deny('This team is archived. Restore it before editing.');
  if (team.leaderId === viewer.userId) return allow;
  if (team.createdBy === viewer.userId) return allow;
  if (capabilities.canEditAnyTeam) return allow;
  return deny('Only the team leader can change this team.');
}

export function canManageTeamMembers(
  team: Pick<OfficeHubTeam, 'leaderId' | 'status'>,
  viewer: OfficeHubViewer,
  capabilities: OfficeHubCapabilities,
): Verdict {
  if (team.status === 'Archived') return deny('This team is archived.');
  if (team.leaderId === viewer.userId) return allow;
  if (capabilities.canManageAnyTeamMembers) return allow;
  return deny('Only the team leader can add or remove members.');
}

/* ── scoping queries ─────────────────────────────────────────────────────────────────────────── */

export type MeetingScope = 'mine' | 'organized' | 'team' | 'department' | 'all';

/**
 * The widest meeting scope this viewer is entitled to.
 *
 * Used to pick the Firestore query rather than to filter after the fact — §58's point about not
 * loading every meeting into the browser. A viewer entitled only to `mine` gets an
 * `array-contains` query on `participantUserIds`, which is both cheaper and impossible to leak
 * through.
 */
export function widestMeetingScope(capabilities: OfficeHubCapabilities): MeetingScope {
  if (capabilities.canViewAllMeetings) return 'all';
  if (capabilities.canViewDepartmentMeetings) return 'department';
  if (capabilities.canViewTeamMeetings) return 'team';
  return 'mine';
}

export type TaskScope = 'mine' | 'team' | 'department' | 'all';

export function widestTaskScope(capabilities: OfficeHubCapabilities): TaskScope {
  if (capabilities.canViewAllTasks) return 'all';
  if (capabilities.canViewDepartmentTasks) return 'department';
  if (capabilities.canViewTeamTasks) return 'team';
  return 'mine';
}

/** Whether a status transition on a meeting is one an authorised user may make by hand (§15). */
export function isManualMeetingStatusChangeAllowed(
  from: MeetingStatus,
  to: MeetingStatus,
): boolean {
  if (from === to) return false;
  // A cancelled meeting is not resurrected; a new one is scheduled. Re-opening it would leave the
  // cancellation notices that already went out contradicting the record.
  if (from === 'Cancelled') return false;
  if (to === 'Draft') return false;
  return true;
}
