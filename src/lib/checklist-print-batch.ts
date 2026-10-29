/**
 * How the entry sheet hands a checklist selection to its print page.
 *
 * A short selection travels in the address (`/daily-requisition/entry-sheet/print?ids=a,b,c`). A long
 * one — "Select all" on a long register — would not fit: servers refuse request lines past 8–16 KB,
 * and 1,800 ids are near 38 KB. So it goes through this browser's storage, which every tab of the
 * site shares, and the address carries only a key (`?batch=<key>`). A batch is kept for a day, so
 * reloading the print tab still works; older ones are cleared whenever a new one is saved.
 *
 * Browser-only: both callers run in the browser (a click handler, an effect after mount).
 */

const PRINT_PATH = '/daily-requisition/entry-sheet/print';
const STORAGE_PREFIX = 'daily-requisition:print-batch:';
const KEEP_MS = 24 * 60 * 60 * 1000;
/** Joined ids longer than this go by storage instead of in the address. */
const IDS_IN_URL_MAX = 2000;

/** Drops this browser's saved batches older than a day. */
function pruneBatches(storage: Storage, now: number) {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    let at = 0;
    try {
      at = Number((JSON.parse(storage.getItem(key) || '{}') as { at?: unknown }).at) || 0;
    } catch {
      // Unreadable: treated as old.
    }
    if (now - at > KEEP_MS) storage.removeItem(key);
  }
}

/** The print page's address for these requisitions, in this order. */
export function checklistPrintHref(ids: string[]): string {
  const joined = ids.join(',');
  if (joined.length <= IDS_IN_URL_MAX) return `${PRINT_PATH}?ids=${joined}`;
  try {
    const now = Date.now();
    pruneBatches(window.localStorage, now);
    const batch = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem(`${STORAGE_PREFIX}${batch}`, JSON.stringify({ at: now, ids }));
    return `${PRINT_PATH}?batch=${batch}`;
  } catch {
    // Storage blocked or full: the address after all, which a server may refuse if it is too long.
    return `${PRINT_PATH}?ids=${joined}`;
  }
}

/** The ids a `?batch=` key stands for — none if this browser no longer has it. */
export function readChecklistPrintBatch(batch: string): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${batch}`) || 'null') as { ids?: unknown } | null;
    return Array.isArray(stored?.ids) ? stored.ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch {
    return [];
  }
}
