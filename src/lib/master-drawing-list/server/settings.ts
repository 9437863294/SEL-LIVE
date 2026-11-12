import 'server-only';

/**
 * Master Drawing List settings, stored in `mdl_settings/{masterData,fieldControl,dateControl}`
 * (server-only, like the register). Read by every write that applies them; changed with
 * Settings · Manage. Each document keeps its last 30 changes for the settings pages.
 */

import { FieldValue, type DocumentData } from 'firebase-admin/firestore';

import type { DateControlInput, FieldControlInput, MasterDataInput } from '../schemas.ts';
import {
  MASTER_KINDS,
  masterValuesError,
  resolveDateControl,
  resolveFieldControl,
  resolveMasterData,
  usedValueChange,
  type MdlSettings,
} from '../settings.ts';
import { MdlError, type MdlContext } from './context.ts';
import { db, itemsCol } from './store.ts';

export const SETTINGS_COLLECTION = 'mdl_settings';
const settingsDoc = (id: 'masterData' | 'fieldControl' | 'dateControl') => db().collection(SETTINGS_COLLECTION).doc(id);

export interface SettingsChange {
  at: string;
  by: string;
  byName: string;
  summary: string;
}

/** All three settings, resolved (defaults where nothing is stored). */
export async function loadSettings(): Promise<MdlSettings> {
  const [master, fields, dates] = await db().getAll(settingsDoc('masterData'), settingsDoc('fieldControl'), settingsDoc('dateControl'));
  return {
    masterData: resolveMasterData(master.exists ? master.data() : null),
    fieldControl: resolveFieldControl(fields.exists ? (fields.data() as DocumentData).forms : null),
    dateControl: resolveDateControl(dates.exists ? dates.data() : null),
  };
}

/** How many items use each schedule and scope name, over every drawing list. */
export async function masterUsage(): Promise<{ schedules: Record<string, number>; scopes: Record<string, number> }> {
  const snap = await itemsCol().select('schedule', 'scope').get();
  const usage = { schedules: {} as Record<string, number>, scopes: {} as Record<string, number> };
  for (const doc of snap.docs) {
    const data = doc.data() as { schedule?: string; scope?: string };
    if (data.schedule) usage.schedules[data.schedule] = (usage.schedules[data.schedule] ?? 0) + 1;
    if (data.scope) usage.scopes[data.scope] = (usage.scopes[data.scope] ?? 0) + 1;
  }
  return usage;
}

/** The settings pages' data: the settings, what uses each list value, and the recent changes. */
export async function settingsView(context: MdlContext) {
  context.require('Settings', 'View');
  const [settings, usage, docs] = await Promise.all([loadSettings(), masterUsage(), db().getAll(settingsDoc('masterData'), settingsDoc('fieldControl'), settingsDoc('dateControl'))]);
  const history = (snap: (typeof docs)[number]) => ((snap.exists ? (snap.data() as DocumentData).history : null) ?? []) as SettingsChange[];
  return {
    settings,
    usage,
    history: { masterData: history(docs[0]), fieldControl: history(docs[1]), dateControl: history(docs[2]) },
    canManage: context.can('Settings', 'Manage'),
  };
}

async function write(context: MdlContext, id: 'masterData' | 'fieldControl' | 'dateControl', data: Record<string, unknown>, summary: string) {
  const ref = settingsDoc(id);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const history = ((snap.exists ? (snap.data() as DocumentData).history : null) ?? []) as SettingsChange[];
    const entry: SettingsChange = { at: new Date().toISOString(), by: context.userId, byName: context.userName || context.userId, summary };
    tx.set(ref, { ...data, history: [entry, ...history].slice(0, 30), updatedAt: FieldValue.serverTimestamp(), updatedBy: context.userId, updatedByName: context.userName || null });
  });
}

export async function saveMasterData(context: MdlContext, input: MasterDataInput): Promise<void> {
  context.require('Settings', 'Manage');
  const before = (await loadSettings()).masterData;
  const usage = await masterUsage();
  const next = { schedules: input.schedules.map((v) => ({ ...v, name: v.name.trim() })), scopes: input.scopes.map((v) => ({ ...v, name: v.name.trim() })) };
  for (const kind of MASTER_KINDS) {
    const error = masterValuesError(kind, next[kind]) ?? usedValueChange(before[kind], next[kind], usage[kind]);
    if (error) throw new MdlError(error, 422);
  }
  const summary = MASTER_KINDS.map((kind) => `${kind === 'schedules' ? 'Schedules' : 'Scopes'}: ${next[kind].map((v) => (v.active ? v.name : `${v.name} (off)`)).join(', ')}`).join(' · ');
  await write(context, 'masterData', next, summary);
}

export async function saveFieldControl(context: MdlContext, input: FieldControlInput): Promise<void> {
  context.require('Settings', 'Manage');
  const forms = resolveFieldControl(input.forms);
  const changed = Object.values(forms).reduce((sum, fields) => sum + Object.keys(fields ?? {}).length, 0);
  await write(context, 'fieldControl', { forms }, changed ? `${changed} field${changed === 1 ? '' : 's'} changed from the defaults` : 'Back to the defaults');
}

export async function saveDateControl(context: MdlContext, input: DateControlInput): Promise<void> {
  context.require('Settings', 'Manage');
  const control = resolveDateControl(input);
  const own = Object.keys(control.projects ?? {}).length;
  const summary = `${control.enabled ? `On: ${control.backdateDays} days back, ${control.futureDays} ahead` : 'Off'}${own ? ` · ${own} drawing list${own === 1 ? '' : 's'} with their own rule` : ''}`;
  await write(context, 'dateControl', { ...control }, summary);
}

/** For a write: the schedule and scope must be switched on in Settings (an import may use any listed one). */
export function requireListed(settings: MdlSettings, schedule: string, scope: string, { activeOnly }: { activeOnly: boolean }) {
  const ok = (values: MdlSettings['masterData']['schedules'], name: string) => values.some((value) => value.name === name && (!activeOnly || value.active));
  if (!ok(settings.masterData.schedules, schedule)) throw new MdlError(`“${schedule}” is not a schedule${activeOnly ? ' in use' : ''} in Settings › Schedules & Scopes.`, 422);
  if (!ok(settings.masterData.scopes, scope)) throw new MdlError(`“${scope}” is not a scope${activeOnly ? ' in use' : ''} in Settings › Schedules & Scopes.`, 422);
}
