'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  DAILY_REQUISITION_SETTINGS_PATH,
  defaultDailyRequisitionSettings,
  resolveDailyRequisitionSettings,
  resolveSettingsMeta,
  toStoredSettings,
  type DailyRequisitionSettings,
  type DailyRequisitionSettingsMeta,
  type DRSectionMeta,
} from '@/lib/daily-requisition-settings';

export interface DailyRequisitionSettingsState {
  /** Always usable: the shipped defaults until (and unless) a stored document says otherwise. */
  settings: DailyRequisitionSettings;
  /** Who last saved Field Control and Data Control. */
  meta: DailyRequisitionSettingsMeta;
  /** Whether a stored document exists at all. */
  exists: boolean;
  isLoading: boolean;
}

const INITIAL: DailyRequisitionSettingsState = {
  settings: defaultDailyRequisitionSettings(),
  meta: resolveSettingsMeta(null),
  exists: false,
  isLoading: true,
};

/**
 * Daily Requisition's Field Control and Data Control, live. A subscription rather than a read, so
 * a setting saved by an administrator reaches an open Entry Sheet without a reload.
 *
 * A read failure falls back to the defaults, which reproduce the module's shipped behaviour — a
 * settings outage must never stop anyone recording a requisition.
 */
export function useDailyRequisitionSettings(): DailyRequisitionSettingsState {
  const [state, setState] = useState<DailyRequisitionSettingsState>(INITIAL);

  useEffect(
    () =>
      onSnapshot(
        doc(db, DAILY_REQUISITION_SETTINGS_PATH.collection, DAILY_REQUISITION_SETTINGS_PATH.doc),
        (snapshot) => {
          const raw = snapshot.exists() ? snapshot.data() : undefined;
          setState({
            settings: resolveDailyRequisitionSettings(raw),
            meta: resolveSettingsMeta(raw),
            exists: snapshot.exists(),
            isLoading: false,
          });
        },
        (error) => {
          console.error('Could not read Daily Requisition settings:', error);
          setState((previous) => ({ ...previous, isLoading: false }));
        },
      ),
    [],
  );

  return state;
}

const definedOnly = (meta: DRSectionMeta): Record<string, unknown> =>
  Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined));

/**
 * Writes the whole settings document (`merge: false`): one section as edited, the other as it
 * stands live, and a stamp on the section that changed — so each page can say who last saved it.
 */
export async function saveDailyRequisitionSettings({
  section,
  next,
  meta,
  user,
}: {
  section: 'fieldControl' | 'dataControl';
  next: DailyRequisitionSettings;
  meta: DailyRequisitionSettingsMeta;
  user: { id?: string | null; name?: string | null } | null | undefined;
}): Promise<void> {
  const stamp = {
    updatedAt: serverTimestamp(),
    updatedById: user?.id ?? '',
    updatedByName: user?.name ?? '',
  };
  const other = section === 'fieldControl' ? 'dataControl' : 'fieldControl';
  await setDoc(
    doc(db, DAILY_REQUISITION_SETTINGS_PATH.collection, DAILY_REQUISITION_SETTINGS_PATH.doc),
    {
      ...toStoredSettings(next),
      meta: { [section]: stamp, [other]: definedOnly(meta[other]) },
      ...stamp,
    },
    { merge: false },
  );
}
