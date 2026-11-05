/**
 * A JMC / MVAC workflow document's steps as Billing Recon's screens use them: named steps only,
 * each with an id. Saved workflows always carry ids; for older hand-made documents without one,
 * JMC falls back to the step's position and MVAC to its slugged name — the rules the stage pages
 * (`[project]/jmc|mvac/stage/[stageId]`) resolve `stageId` with, so a link built from these ids
 * always opens its stage.
 *
 * Used by the JMC / MVAC desk (desk/register-desk.tsx) and the module menu's stage links
 * (billing-recon-shell.tsx). Pure — no Firebase, no React.
 */

export type StepRegisterKind = 'JMC' | 'MVAC';

export interface NamedStep {
  id: string;
  name: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');

export function readWorkflowSteps<T extends object = Record<string, unknown>>(raw: unknown, kind: StepRegisterKind): Array<T & NamedStep> {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((s): s is T & { id?: unknown; name: unknown } => Boolean(s && typeof s === 'object' && (s as { name?: unknown }).name))
    .map((s, index) => ({
      ...s,
      id: kind === 'JMC' ? String(s.id || index + 1) : String(s.id || slugify(String(s.name))),
      name: String(s.name),
    }));
}
