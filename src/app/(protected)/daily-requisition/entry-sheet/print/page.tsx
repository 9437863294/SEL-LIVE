/**
 * Bulk checklist printing — `/daily-requisition/entry-sheet/print?ids=a,b,c`, opened by the entry
 * sheet's "Print Checklists". The checklist page prints one or many (`?ids=`), so this route is that
 * page: one checklist layout, not two copies that drift apart. (This file used to read `params.id`,
 * which this route does not have, so a bulk print never loaded.)
 */
export { default } from '@/app/(public)/daily-requisition/entry-sheet/[id]/print/page';
