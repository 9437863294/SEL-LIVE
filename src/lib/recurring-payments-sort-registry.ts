/**
 * The Recurring Payments lists whose opening order an administrator can choose, from
 * Settings › Field Control › Sort Order. Each default is the order the list used before the
 * setting existed, so nothing moves until someone changes it.
 *
 * Type-only import, so this stays loadable by `node --test` like the generic sorter it feeds.
 */

import type { ListSortRegistry, SortControlDoc } from './list-sort';

export type RPListKey = 'payments' | 'masters' | 'vendors' | 'workflowTasks';

export const RP_LIST_REGISTRY: ListSortRegistry<RPListKey> = {
  payments: {
    title: 'All Payments',
    description: 'The payment register.',
    fields: [
      { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'title', label: 'Payment', type: 'text' },
      { key: 'vendorName', label: 'Vendor', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'projectName', label: 'Project', type: 'text' },
      { key: 'expectedAmount', label: 'Expected Amount', type: 'number' },
      { key: 'billAmount', label: 'Bill Amount', type: 'number' },
      { key: 'billingPeriodStart', label: 'Billing Period', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'createdAt', label: 'Generated At', type: 'date' },
    ],
    defaultSort: { field: 'dueDate', direction: 'asc' },
  },
  masters: {
    title: 'Recurring Masters',
    description: 'The master register.',
    fields: [
      { key: 'title', label: 'Master', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'vendorName', label: 'Vendor', type: 'text' },
      { key: 'frequency', label: 'Frequency', type: 'text' },
      { key: 'amount', label: 'Expected Amount', type: 'number' },
      { key: 'assignedToName', label: 'Owner', type: 'text' },
      { key: 'startDate', label: 'Start Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'createdAt', label: 'Created At', type: 'date' },
    ],
    defaultSort: { field: 'title', direction: 'asc' },
  },
  vendors: {
    title: 'Vendors',
    description: 'The vendor list.',
    fields: [
      { key: 'name', label: 'Vendor', type: 'text' },
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'contactPerson', label: 'Contact Person', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultSort: { field: 'name', direction: 'asc' },
  },
  workflowTasks: {
    title: 'Workflow Step Queues',
    description: "Each step's “awaiting my action” queue.",
    fields: [
      { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'workflowDeadline', label: 'SLA Deadline', type: 'date' },
      { key: 'stepEnteredAt', label: 'Arrived At Step', type: 'date' },
      { key: 'title', label: 'Payment', type: 'text' },
      { key: 'vendorName', label: 'Vendor', type: 'text' },
      { key: 'billAmount', label: 'Bill Amount', type: 'number' },
      { key: 'expectedAmount', label: 'Expected Amount', type: 'number' },
    ],
    defaultSort: { field: 'dueDate', direction: 'asc' },
  },
};

export const RP_LIST_KEYS = Object.keys(RP_LIST_REGISTRY) as RPListKey[];

export type RPSortControlDoc = SortControlDoc<RPListKey>;

/**
 * The sort-order document id. Under the `fieldControl_` prefix on purpose: the Firestore rules
 * grant writes to `recurringPaymentSettings/fieldControl_*` to holders of "Manage Field Control",
 * which is exactly who edits it — so the sort order and the field settings share one permission.
 */
export const sortControlDocId = (organizationId: string) =>
  `fieldControl_${organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')}_sortOrder`;
