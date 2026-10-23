import 'server-only';

/**
 * Settings › Rates, Workflow and Trip rules.
 *
 * Each part is saved on its own over a fresh read of the document, so two administrators editing
 * different parts never overwrite each other. Two consequences are applied at once rather than left
 * to surprise anyone later:
 *
 * - A saved workflow re-routes every claim still in process (`rerouteClaim`), and the people it now
 *   waits for are told.
 * - A saved rate card re-prices every unclaimed trip, so My Trips shows what a claim would pay.
 *   Submitted trips keep the rate they were submitted at; a revision that priced any of them can no
 *   longer be edited or deleted — a new revision is the way to change a rate.
 */

import { normaliseRevision, sortRevisions } from '../rates.ts';
import { settingsUpdateSchema } from '../schemas.ts';
import { ACTIVE_CLAIM_STATUSES, ET_COLLECTIONS, type RateRevision, type TripClaimSettings } from '../types.ts';
import { normaliseSettings, rerouteClaim } from '../workflow.ts';
import { TripError, db, nowIso, type TripContext } from './context';
import { toClaim } from './claims';
import { departmentOptions, forgetSettings, loadSettings, projectOptions, userDirectory } from './lookups';
import { afterAudit, afterClaimChange, claimSummary } from './notify';
import { priceAndFlag, toTrip } from './trips';

export async function getSettingsForEditing(context: TripContext) {
  if (!context.trip.settingsView) throw new TripError('Trip settings need Driver Management · Trip Settings · View.', 403);
  const [settings, directory, projects, departments] = await Promise.all([loadSettings(context.organizationId), userDirectory(), projectOptions(), departmentOptions()]);
  const users = [...directory.values()].filter((user) => user.active).map(({ id, name, email }) => ({ id, name, email })).sort((a, b) => a.name.localeCompare(b.name));
  return { settings, users, projects, departments, canEdit: context.trip.settingsEdit };
}

/** Is the revision the rate of any trip already on a claim (or past one)? */
async function revisionInUse(revisionId: string): Promise<boolean> {
  const snapshot = await db().collection(ET_COLLECTIONS.trips).where('rateRevisionId', '==', revisionId).get();
  return snapshot.docs.some((doc) => doc.data().status !== 'draft');
}

export async function saveSettings(context: TripContext, body: unknown): Promise<{ settings: TripClaimSettings; rerouted: number; repriced: number }> {
  if (!context.trip.settingsEdit) throw new TripError('Changing trip settings needs Driver Management · Trip Settings · Edit.', 403);
  const update = settingsUpdateSchema.parse(body);
  const ref = db().collection(ET_COLLECTIONS.settings).doc(context.organizationId);
  const directory = await userDirectory();
  const now = nowIso();
  const stamp = { updatedAt: now, updatedById: context.userId, updatedByName: context.userName };

  let next: TripClaimSettings;
  if (update.part === 'rules') {
    const stored = await ref.get();
    next = normaliseSettings({ ...(stored.data() as Partial<TripClaimSettings> | undefined), rules: update.rules });
    await ref.set({ rules: next.rules, ...stamp }, { merge: true });
  } else if (update.part === 'stages') {
    const normalised = normaliseSettings({ stages: update.stages }).stages;
    for (const stage of normalised) {
      // A reporting exception's key is the employee it is for, so it must be a real user too.
      const everyone = [...stage.userIds, ...stage.routes.flatMap((route) => (stage.routing === 'reporting' ? [route.key, ...route.userIds] : route.userIds))];
      const unknown = everyone.filter((id) => !directory.get(id)?.active);
      if (unknown.length) throw new TripError(`“${stage.name}” names someone who is not an active user. Choose again.`);
      if (!stage.userIds.length) {
        const forWhom =
          stage.routing === 'reporting' ? ' for employees with no reporting authority on record' : stage.routing === 'users' ? '' : ' for claims without a route of their own';
        throw new TripError(`Name at least one person on “${stage.name}”${forWhom}.`);
      }
    }
    const stored = await ref.get();
    next = normaliseSettings({ ...(stored.data() as Partial<TripClaimSettings> | undefined), stages: normalised });
    await ref.set({ stages: next.stages, ...stamp }, { merge: true });
  } else {
    const result = await db().runTransaction(async (transaction) => {
      const stored = await transaction.get(ref);
      const current = normaliseSettings(stored.data() as Partial<TripClaimSettings> | undefined);
      let revisions: RateRevision[] = current.rateRevisions;
      if (update.part === 'rate-revision') {
        const revision = normaliseRevision({ ...update.revision, id: update.revision.id || db().collection(ET_COLLECTIONS.settings).doc().id, rates: update.revision.rates, savedById: context.userId, savedByName: context.userName, savedAt: now });
        if (!revision.rates.length) throw new TripError('Add at least one vehicle type with a rate.');
        if (revisions.some((entry) => entry.effectiveFrom === revision.effectiveFrom && entry.id !== revision.id)) {
          throw new TripError(`A rate card from ${revision.effectiveFrom} already exists — edit that one instead.`);
        }
        const existing = revisions.find((entry) => entry.id === revision.id);
        if (existing && (await revisionInUse(existing.id))) {
          throw new TripError('Claims have already been priced with this rate card, so it cannot change. Add a new rate card from the date the new rates start.', 409);
        }
        revisions = sortRevisions([...revisions.filter((entry) => entry.id !== revision.id), revision]);
      } else {
        if (!revisions.some((entry) => entry.id === update.revisionId)) throw new TripError('That rate card was not found.', 404);
        if (await revisionInUse(update.revisionId)) throw new TripError('Claims have already been priced with this rate card, so it cannot be deleted.', 409);
        revisions = revisions.filter((entry) => entry.id !== update.revisionId);
      }
      transaction.set(ref, { rateRevisions: revisions, ...stamp }, { merge: true });
      return { ...current, rateRevisions: revisions, ...stamp };
    });
    next = result;
  }

  forgetSettings(context.organizationId);
  const rerouted = update.part === 'stages' ? await rerouteActiveClaims(context, next) : 0;
  const repriced = update.part === 'rate-revision' || update.part === 'delete-rate-revision' || update.part === 'rules' ? await repriceDrafts(context.organizationId, next) : 0;
  afterAudit(context, 'Update Trip Settings', { part: update.part, rerouted, repriced });
  return { settings: next, rerouted, repriced };
}

async function rerouteActiveClaims(context: TripContext, settings: TripClaimSettings): Promise<number> {
  const directory = await userDirectory();
  const nameOf = (id: string) => directory.get(id)?.name ?? 'Unknown user';
  const snapshot = await db().collection(ET_COLLECTIONS.claims).where('status', 'in', [...ACTIVE_CLAIM_STATUSES]).get();
  const now = nowIso();
  let count = 0;
  for (const doc of snapshot.docs) {
    const claim = toClaim(doc.id, doc.data());
    if (claim.organizationId !== context.organizationId) continue;
    const routed = rerouteClaim(claim, settings, nameOf);
    if (!routed) continue;
    const before = claim.currentAssigneeIds;
    const waitingChanged = routed.currentAssigneeIds.length !== before.length || routed.currentAssigneeIds.some((id) => !before.includes(id));
    const stage = routed.stages[claim.currentStageIndex];
    await doc.ref.update({
      stages: routed.stages,
      currentAssigneeIds: routed.currentAssigneeIds,
      updatedAt: now,
      ...(waitingChanged
        ? { history: [...claim.history, { action: 'rerouted', stageName: stage.name, byId: context.userId, byName: context.userName, at: now, remarks: `Workflow changed — now with ${stage.assigneeNames.join(', ') || 'nobody'}.` }] }
        : {}),
    });
    count += 1;
    if (waitingChanged) {
      const newcomers = routed.currentAssigneeIds.filter((id) => !before.includes(id));
      afterClaimChange(context, claim, { action: 'Reroute Trip Claim', details: { stage: stage.name } }, [
        {
          userIds: newcomers,
          title: stage.kind === 'payment' ? `Trip claim ${claim.claimNumber} is ready for payment` : `Trip claim ${claim.claimNumber} needs your approval`,
          body: `${claimSummary(claim)} — ${stage.name} (reassigned to you)`,
        },
      ]);
    }
  }
  return count;
}

/** Unclaimed trips re-priced (and their rate flag recomputed) after the rate card or rules change. */
async function repriceDrafts(organizationId: string, settings: TripClaimSettings): Promise<number> {
  const snapshot = await db().collection(ET_COLLECTIONS.trips).where('status', '==', 'draft').get();
  const drafts = snapshot.docs.map((doc) => toTrip(doc.id, doc.data())).filter((trip) => trip.organizationId === organizationId);
  const changed = drafts.flatMap((trip) => {
    // Only the rate and its flag depend on the settings alone; the other flags keep their last check.
    const priced = priceAndFlag(trip, settings, { sameEmployee: [], sameVehicle: [] });
    const flags = [...trip.flags.filter((flag) => flag !== 'no_rate' && flag !== 'over_trip_limit'), ...priced.flags.filter((flag) => flag === 'no_rate' || flag === 'over_trip_limit')];
    const same = priced.ratePerKm === trip.ratePerKm && priced.totalAmount === trip.totalAmount && priced.rateRevisionId === trip.rateRevisionId && flags.length === trip.flags.length && flags.every((flag) => trip.flags.includes(flag));
    return same ? [] : [{ id: trip.id, ...priced, flags }];
  });
  const now = nowIso();
  for (let at = 0; at < changed.length; at += 400) {
    const batch = db().batch();
    for (const entry of changed.slice(at, at + 400)) {
      const { id, ...fields } = entry;
      batch.update(db().collection(ET_COLLECTIONS.trips).doc(id), { ...fields, updatedAt: now });
    }
    await batch.commit();
  }
  return changed.length;
}
