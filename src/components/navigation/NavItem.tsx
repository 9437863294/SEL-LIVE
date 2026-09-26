import Link from 'next/link';
import type { ComponentType, CSSProperties, KeyboardEvent, MouseEvent, SVGProps } from 'react';
import { NotificationBadge, badgeDescription } from './NotificationBadge';

export type FloatingNavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface FloatingNavItem {
  /** Stable id; what `activeItem` and `onChange` speak in. */
  key: string;
  label: string;
  icon: FloatingNavIcon;
  /** A destination. Without one the item is an action (a button) — "More", or a create sheet. */
  href?: string;
  /** A count, or `true` for a plain dot. */
  badge?: number | boolean;
  /** Permanently emphasised — drawn in its own filled disc even when inactive. Use for Create. */
  emphasized?: boolean;
  /** Overrides the accessible name; defaults to the label. */
  ariaLabel?: string;
  /** Set when pressing the item opens a menu or sheet rather than a page. */
  opensMenu?: boolean;
  /** Held at the right-hand end of the bar while the other tabs scroll past — for "More". */
  pinned?: boolean;
}

/**
 * One slot of the bar. The slot's width (and, when pinned, its position) belong to
 * `FloatingBottomNav`; everything that only depends on whether the item is active — the icon
 * lifting into the button, colour, the label — is CSS keyed off `data-active`.
 */
export function NavItem({
  item,
  active,
  slotRef,
  style,
  onSelect,
  onKeyDown,
}: {
  item: FloatingNavItem;
  active: boolean;
  slotRef: (el: HTMLElement | null) => void;
  style?: CSSProperties;
  onSelect: (item: FloatingNavItem, event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const Icon = item.icon;
  const name = `${item.ariaLabel ?? item.label}${badgeDescription(item.badge)}`;
  const content = (
    <>
      <span className="fbn-icon">
        {item.emphasized && <span className="fbn-emph" aria-hidden="true" />}
        <Icon aria-hidden="true" focusable="false" />
        <NotificationBadge count={item.badge} />
      </span>
      <span className="fbn-label" aria-hidden="true">
        {item.label}
      </span>
    </>
  );
  const shared = {
    className: 'fbn-slot',
    'data-active': active ? 'true' : 'false',
    'data-emphasized': item.emphasized ? 'true' : 'false',
    'aria-label': name,
    'aria-current': active ? ('page' as const) : undefined,
    style,
    onClick: (event: MouseEvent<HTMLElement>) => onSelect(item, event),
    onKeyDown,
  };

  if (item.href) {
    return (
      <Link href={item.href} ref={slotRef} {...shared}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" ref={slotRef} aria-haspopup={item.opensMenu ? 'dialog' : undefined} {...shared}>
      {content}
    </button>
  );
}
