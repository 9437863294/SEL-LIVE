/**
 * What the copy leaves out, and where it goes. The lists live in src/lib/reporting-copy.ts, shared
 * with the app's scheduled refresh (Settings › Reporting Database), so this tool and the schedule
 * always copy the same thing — edit them there. Empty by decision on 2026-10-14: newdatabase is a
 * full copy, including personal data (employeeSensitive), Mail Hub and credentials; the comment on
 * EXCLUDED_COLLECTIONS there says what that means for its logins.
 *
 * Loaded with a `.ts` path, which needs Node's type stripping (on by default from Node 22.18 / 23.6;
 * add --experimental-strip-types on older versions).
 */
export {
  EXCLUDED_COLLECTIONS,
  EXCLUDED_FIELDS,
  SUBCOLLECTION_SAMPLE,
  TARGET_DATABASE,
} from '../../src/lib/reporting-copy.ts';
