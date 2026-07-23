export type PermissionRecord = Record<string, string[]>;

export const hasChatPermission = (
  permissions: PermissionRecord | undefined,
  resource: 'Chat System' | 'Chat System.Conversations' | 'Chat System.Groups',
  action: string
) => Boolean(permissions?.[resource]?.includes(action));

/**
 * A user may be offered as a new chat recipient only when their assigned role
 * is allowed to open the chat module and view conversations.
 */
export const canRoleReceiveChats = (permissions: PermissionRecord | undefined) =>
  hasChatPermission(permissions, 'Chat System', 'View Module') &&
  hasChatPermission(permissions, 'Chat System.Conversations', 'View');
