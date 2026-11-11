/**
 * Loads the consolidated Master Drawing List workbook into Firestore — the command-line twin of the
 * module's Excel Import page. Both read the workbook with the same code
 * (`src/lib/master-drawing-list/import.ts`), so they report the same counts and problems.
 *
 *   node tools/mdl-import/import.ts --file docs/mdl/SEL_MDL_consolidated_import.xlsx --dry-run
 *   node tools/mdl-import/import.ts --file docs/mdl/SEL_MDL_consolidated_import.xlsx
 *
 * Node 24 runs this TypeScript file as it is (type stripping), so no tsx is needed; that is why the
 * imports below carry their `.ts` extension.
 *
 * Credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key for
 * the Firebase project (or run where default credentials already exist). With
 * FIRESTORE_EMULATOR_HOST set it writes to that emulator instead (project id
 * from GCLOUD_PROJECT, else "demo-mdl").
 *
 * --link CODE=projectId (repeatable) links a drawing list to its ERP project
 * (`projects/{id}`), which decides who sees it. Lists can also be linked later on
 * the module's Settings page; a re-import never clears a link already made there.
 *
 * Safe to run again: an item that already exists is skipped. With --overwrite,
 * an existing item is replaced only if nobody has edited it in the ERP since
 * the import (its updatedBy is still "import").
 */
import ExcelJS from 'exceljs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import { gridFromWorkbook, parseImport, summariseImport, summaryLines, writeImport } from '../../src/lib/master-drawing-list/import.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const file = option('file');
const dryRun = flag('dry-run');
const overwrite = flag('overwrite');
if (!file) {
  console.error('Usage: node tools/mdl-import/import.ts --file <workbook.xlsx> [--dry-run] [--overwrite] [--link CODE=projectId ...]');
  process.exit(1);
}

/** `--link CODE=projectId`, as often as needed. */
const links = new Map<string, string>();
args.forEach((arg, i) => {
  if (arg !== '--link') return;
  const m = /^([^=]+)=(.+)$/.exec(args[i + 1] ?? '');
  if (!m) {
    console.error(`--link needs CODE=projectId, got "${args[i + 1] ?? ''}".`);
    process.exit(1);
  }
  links.set(m[1].trim(), m[2].trim());
});

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file!);
  const parsed = parseImport(gridFromWorkbook(wb));
  for (const code of links.keys()) {
    if (!parsed.projects.some((p) => p.code === code)) parsed.problems.push(`--link ${code}: no such project code on the Projects sheet; ignored.`);
  }
  summaryLines(summariseImport(parsed)).forEach((line) => console.log(line));

  const linked = parsed.projects.filter((p) => links.has(p.code));
  if (linked.length) {
    console.log('\nLinks to ERP projects:');
    linked.forEach((p) => console.log(`  ${p.code} (${p.short}) → projects/${links.get(p.code)}`));
  }
  if (dryRun) {
    console.log('\nDry run: nothing was written.');
    return;
  }

  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT || 'demo-mdl' } : { credential: applicationDefault() });
  if (emulator) console.log(`\nWriting to the Firestore emulator at ${emulator}.`);
  const result = await writeImport(getFirestore(), parsed, { overwrite, links, timestamp: () => FieldValue.serverTimestamp() });
  console.log(`\nWrote ${result.projects} projects and ${result.written} items. Skipped ${result.skipped} items that already exist.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
