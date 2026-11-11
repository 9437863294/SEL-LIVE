/** A path segment as text: decoded when it still carries %-escapes, left alone when it cannot be. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
