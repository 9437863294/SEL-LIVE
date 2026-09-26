/**
 * Dotted paths of every leaf that differs between two configurations — what an audit row and the
 * version history list as "changed". A brand asset counts as one thing, not its five fields.
 * Pure, so it is unit-tested.
 */
export function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObject(before) && isObject(after)) {
    if ('path' in before || 'path' in after) return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null) ? [] : [prefix];
}
