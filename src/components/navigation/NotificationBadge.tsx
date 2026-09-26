/**
 * The count (or dot) pinned to a nav icon's upper-right corner. Decorative: the item's accessible
 * name carries the count, so screen readers hear "Inbox, 3 new" once instead of "Inbox 3".
 */
export function NotificationBadge({ count }: { count?: number | boolean }) {
  if (count === undefined || count === false || count === 0 || (typeof count === 'number' && count < 0)) return null;
  const dot = count === true;
  return (
    <span className="fbn-badge" data-dot={dot ? 'true' : 'false'} aria-hidden="true">
      {dot ? null : count > 99 ? '99+' : count}
    </span>
  );
}

/** The phrase appended to an item's accessible name for its badge, or '' when there is none. */
export function badgeDescription(count?: number | boolean) {
  if (count === true) return ', new activity';
  if (typeof count === 'number' && count > 0) return `, ${count > 99 ? 'more than 99' : count} new`;
  return '';
}
