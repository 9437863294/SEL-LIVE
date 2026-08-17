/**
 * Firebase Storage handle, kept out of `@/lib/firebase`.
 *
 * `@/lib/firebase` is imported by essentially every page, so anything it imports
 * statically ends up in the initial bundle. Only a handful of upload/attachment
 * screens need Storage, and importing it from here keeps the SDK in those route
 * chunks rather than on the app shell's critical path.
 */

import { getStorage } from 'firebase/storage';
import { app } from '@/lib/firebase';

export const storage = getStorage(app);
