'use client';

/**
 * Reads the module configuration.
 *
 * A live subscription rather than a one-off read: an administrator changing the register layout or
 * making a field mandatory should reach the people already on those screens, not only whoever
 * loads the page next. Settings resolve through `resolveExpensesSettings`, so a page always gets a
 * complete, valid object — a missing document is the shipped defaults, not `undefined` to guard
 * against at every call site.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  EXPENSES_SETTINGS_PATH,
  defaultExpensesSettings,
  resolveExpensesSettings,
  type ExpensesModuleSettings,
} from '@/lib/expenses-settings';

export function useExpensesSettings(): { settings: ExpensesModuleSettings; isLoading: boolean } {
  const [settings, setSettings] = useState<ExpensesModuleSettings>(() => defaultExpensesSettings());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, EXPENSES_SETTINGS_PATH.collection, EXPENSES_SETTINGS_PATH.doc),
      snapshot => {
        setSettings(resolveExpensesSettings(snapshot.data()));
        setIsLoading(false);
      },
      error => {
        // A module that cannot read its configuration should still work on the shipped defaults
        // rather than render nothing.
        console.error('Could not read Expenses settings:', error);
        setSettings(defaultExpensesSettings());
        setIsLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  return { settings, isLoading };
}
