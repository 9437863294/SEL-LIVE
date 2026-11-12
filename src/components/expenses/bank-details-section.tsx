'use client';

/**
 * Bank details on an expense request: the account the payment goes to.
 *
 * When the party is an employee, the account is filled from the Employee module
 * (`/api/expenses/employee-bank`, which reads greytHR's bank record) as soon as the party is chosen
 * — and every field stays editable, because the employee record is where the details start, not a
 * lock on them. A change is remembered as an edit, and "Use Employee module details" puts the
 * record's version back.
 *
 * What is filled when:
 *   - Nothing entered yet, or what is there came from an earlier lookup → the employee's details
 *     replace it.
 *   - Typed by hand → left alone; the button offers the employee's details instead.
 *   - The party changes to someone who is not that employee → details filled for the old one are
 *     cleared, since they belong to somebody else.
 *   - Several employees share the name → a picker asks which one.
 *
 * Everything is in capitals, as the rest of the request is. Rules (required once anything is
 * entered, IFSC shape) live in src/lib/expenses-bank.ts; the look is expense-form.module.css.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Landmark, Loader2, RotateCcw, UserRoundCheck } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { accentStyle, upperCaseTyped, xr } from '@/components/expenses/expense-form-ui';
import { auth } from '@/lib/firebase';
import {
  EMPTY_BANK_VALUE,
  bankErrors,
  employeeNameKey,
  hasBank,
  isIfsc,
  sameBank,
  type EmployeeBankLookup,
  type ExpenseBankField,
  type ExpenseBankValue,
} from '@/lib/expenses-bank';
import { cn } from '@/lib/utils';

async function lookUpEmployeeBank(params: { departmentId: string; name?: string; employeeId?: string }): Promise<EmployeeBankLookup> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const query = new URLSearchParams({ departmentId: params.departmentId });
  if (params.employeeId) query.set('employeeId', params.employeeId);
  else if (params.name) query.set('name', params.name);
  const response = await fetch(`/api/expenses/employee-bank?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'The Employee module could not be checked.');
  }
  return data as unknown as EmployeeBankLookup;
}

type Lookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: EmployeeBankLookup }
  | { status: 'error'; error: string };

/** How long after the party settles before the Employee module is asked. */
const LOOKUP_DELAY_MS = 350;

function Field({
  id,
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(xr.field, className)}>
      <label htmlFor={id} className={xr.lbl}>
        {label}
        {required && <i className={xr.req}> *</i>}
      </label>
      {children}
      {error ? <p className={cn(xr.sub, xr.subError)}>{error}</p> : <div className={xr.hint}>{hint}</div>}
    </div>
  );
}

export function BankDetailsSection({
  partyName,
  departmentId,
  value,
  onChange,
  showErrors,
}: {
  /** The request's party — looked up among the employees as it changes. */
  partyName: string;
  /** The request's department: who may look an employee's account up is decided per department. */
  departmentId: string;
  value: ExpenseBankValue;
  onChange: (next: ExpenseBankValue) => void;
  showErrors: boolean;
}) {
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });

  /** The latest value, for the lookup to judge when its answer lands — not a reason to look again. */
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  /** Answers to an older party are dropped rather than written over a newer one. */
  const sequence = useRef(0);

  /**
   * Fill from the employee's record. Unforced, it only replaces what an earlier lookup filled (and
   * an edit of the same employee's details is kept); forced — the button — it replaces whatever
   * is there.
   */
  const apply = useCallback(
    (data: EmployeeBankLookup, force: boolean) => {
      if (!data.employee || !data.bank) return;
      const current = valueRef.current;
      const ours = current.source === 'employee';
      const keepEdit = ours && current.edited && current.employeeId === data.employee.employeeId;
      if (!force && (keepEdit || (hasBank(current) && !ours))) return;
      const next: ExpenseBankValue = {
        ...data.bank,
        source: 'employee',
        employeeId: data.employee.employeeId,
        employeeNo: data.employee.employeeNo,
        edited: false,
      };
      valueRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  /** Details filled for an employee who is no longer the party belong to somebody else. */
  const dropFilled = useCallback(
    (keepEmployeeIds: readonly string[] = []) => {
      const current = valueRef.current;
      if (current.source === 'employee' && !keepEmployeeIds.includes(current.employeeId)) {
        valueRef.current = EMPTY_BANK_VALUE;
        onChange(EMPTY_BANK_VALUE);
      }
    },
    [onChange],
  );

  const partyKey = employeeNameKey(partyName);

  useEffect(() => {
    const ticket = ++sequence.current;
    if (!partyKey || !departmentId) {
      setLookup({ status: 'idle' });
      dropFilled();
      return;
    }
    setLookup({ status: 'loading' });
    const timer = window.setTimeout(() => {
      lookUpEmployeeBank({ departmentId, name: partyName })
        .then(data => {
          if (ticket !== sequence.current) return;
          setLookup({ status: 'done', data });
          if (data.employee && data.bank) apply(data, false);
          else dropFilled(data.matches.map(match => match.employeeId));
        })
        .catch((error: unknown) => {
          if (ticket !== sequence.current) return;
          setLookup({ status: 'error', error: error instanceof Error ? error.message : 'The Employee module could not be checked.' });
        });
    }, LOOKUP_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `partyName` is read only through its key: a change of case is not a different party.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyKey, departmentId, apply, dropFilled]);

  /** One of several employees with the party's name, chosen here. */
  const chooseEmployee = (employeeId: string) => {
    if (lookup.status !== 'done') return;
    const matches = lookup.data.matches;
    const ticket = ++sequence.current;
    setLookup({ status: 'loading' });
    lookUpEmployeeBank({ departmentId, employeeId })
      .then(data => {
        if (ticket !== sequence.current) return;
        const answer = { ...data, matches };
        setLookup({ status: 'done', data: answer });
        // Unforced: details typed by hand, or edits to this same employee's, are kept.
        if (data.bank) apply(answer, false);
        else dropFilled();
      })
      .catch((error: unknown) => {
        if (ticket !== sequence.current) return;
        setLookup({ status: 'error', error: error instanceof Error ? error.message : 'The Employee module could not be checked.' });
      });
  };

  const found = lookup.status === 'done' ? lookup.data : null;
  /** The employee record's details, when they are for the employee the party names. */
  const recordBank = found?.employee && found.bank ? found.bank : null;
  const fromRecord = value.source === 'employee' && !!found?.employee && value.employeeId === found.employee.employeeId;
  /** What is on the form is not the record's version — offer it. */
  const offerRecord = !!recordBank && (!fromRecord || !sameBank(value, recordBank));

  const set = (field: ExpenseBankField, typed: string) => {
    const next: ExpenseBankValue = { ...value, [field]: typed };
    if (!hasBank(next)) {
      onChange(EMPTY_BANK_VALUE);
      return;
    }
    if (value.source === 'employee') {
      // An edit is measured against the record it was filled from, so typing a change back undoes it.
      onChange({ ...next, edited: !(fromRecord && recordBank && sameBank(next, recordBank)) });
      return;
    }
    onChange({ ...next, source: 'manual', employeeId: '', employeeNo: '', edited: false });
  };

  const errors: Partial<Record<ExpenseBankField, string>> = showErrors ? bankErrors(value) : {};
  const required = hasBank(value);
  const ifscOk = isIfsc(value.ifscCode);

  const input = (field: ExpenseBankField, props: { placeholder: string; mono?: boolean; maxLength?: number; inputMode?: 'numeric' | 'text' }) => (
    <input
      id={`bank-${field}`}
      type="text"
      autoComplete="off"
      inputMode={props.inputMode}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      aria-invalid={errors[field] ? true : undefined}
      className={cn(xr.control, props.mono && xr.mono, value[field] && xr.set)}
      value={value[field]}
      onChange={event => set(field, upperCaseTyped(event))}
    />
  );

  /* ── the line that says where the details came from ── */
  let status: ReactNode = null;
  if (lookup.status === 'loading') {
    status = (
      <>
        <Loader2 className="animate-spin" aria-hidden="true" />
        Checking the Employee module for {partyName.trim().toUpperCase()}…
      </>
    );
  } else if (lookup.status === 'error') {
    status = (
      <>
        <AlertCircle className="!text-amber-600" aria-hidden="true" />
        Could not check the Employee module: {lookup.error} Enter the bank details by hand.
      </>
    );
  } else if (found?.employee) {
    const who = `${found.employee.name.toUpperCase()}${found.employee.employeeNo ? ` · ${found.employee.employeeNo}` : ''}`;
    status = fromRecord ? (
      <>
        <UserRoundCheck aria-hidden="true" />
        <span>
          Filled from the Employee module — <b>{who}</b>
          {found.bankFrom === 'greythr' ? ' (read from greytHR just now)' : ''}.{' '}
          {value.edited ? 'Changed here — the changes are saved with this request.' : 'You can still change any of it.'}
          {found.note ? ` ${found.note}` : ''}
        </span>
      </>
    ) : (
      <>
        <UserRoundCheck aria-hidden="true" />
        <span>
          The party is an employee — <b>{who}</b>.{' '}
          {found.bank
            ? 'The bank details below were typed by hand; use the button to take the Employee module’s instead.'
            : (found.note ?? 'No bank details are on file for them.')}
        </span>
      </>
    );
  } else if (found && found.matches.length > 1) {
    status = (
      <>
        <AlertCircle className="!text-amber-600" aria-hidden="true" />
        {found.note}
      </>
    );
  } else if (found && partyKey) {
    status = (
      <>
        <CheckCircle2 aria-hidden="true" />
        Not an employee on record — enter the party’s bank details by hand.
      </>
    );
  }

  return (
    <div className={xr.scope}>
      <div className={xr.taxHead}>
        <div className="min-w-0">
          <h2 className={xr.taxTitle}>Bank details</h2>
          <p className={xr.taxNote}>
            The account this request is paid into. Filled from the Employee module when the party is an employee — every field stays editable.
          </p>
        </div>
        {offerRecord && (
          <div className={xr.toggles}>
            <button
              type="button"
              className={xr.toggle}
              style={accentStyle('indigo')}
              aria-pressed={false}
              onClick={() => found && apply(found, true)}
            >
              <span className={xr.toggleDot} aria-hidden="true">
                <RotateCcw />
              </span>
              Use Employee module details
            </button>
          </div>
        )}
      </div>

      {status && (
        <p className={xr.plain} aria-live="polite">
          {status}
        </p>
      )}

      {found && found.matches.length > 1 && (
        <div className="mt-2.5 max-w-md">
          <Select value={found.employee?.employeeId ?? ''} onValueChange={chooseEmployee}>
            <SelectTrigger className={cn(xr.control, found.employee && xr.set)} aria-label="Which employee is being paid">
              <SelectValue placeholder="Choose the employee being paid" />
            </SelectTrigger>
            <SelectContent>
              {found.matches.map(match => (
                <SelectItem key={match.employeeId} value={match.employeeId}>
                  {[match.name.toUpperCase(), match.employeeNo, match.designation, match.department, match.current ? '' : 'not on current roster']
                    .filter(Boolean)
                    .join(' · ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <section className={xr.box} style={accentStyle('indigo')}>
        <div className={xr.boxHead}>
          <h3 className={xr.boxTitle}>
            <Landmark aria-hidden="true" />
            Account
          </h3>
          <div className={xr.boxAside}>
            {value.source === 'employee'
              ? value.edited
                ? 'From the Employee module · changed here'
                : 'From the Employee module'
              : value.source === 'manual'
                ? 'Entered by hand'
                : 'Optional — required once any field is filled'}
          </div>
        </div>
        <div className={xr.boxGrid}>
          <Field id="bank-accountHolderName" label="Account holder name" required={required} error={errors.accountHolderName} className={xr.span2}>
            {input('accountHolderName', { placeholder: 'NAME AS PER BANK' })}
          </Field>
          <Field id="bank-accountNumber" label="Account number" required={required} error={errors.accountNumber}>
            {input('accountNumber', { placeholder: 'ACCOUNT NUMBER', mono: true, maxLength: 24, inputMode: 'numeric' })}
          </Field>
          <Field
            id="bank-ifscCode"
            label="IFSC code"
            required={required}
            error={errors.ifscCode}
            hint={
              ifscOk ? (
                <p className="flex items-center gap-1 text-[11px] leading-tight text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" /> Valid IFSC format
                </p>
              ) : null
            }
          >
            {input('ifscCode', { placeholder: 'SBIN0001234', mono: true, maxLength: 11 })}
          </Field>
          <Field id="bank-bankName" label="Bank name" error={errors.bankName}>
            {input('bankName', { placeholder: 'BANK NAME' })}
          </Field>
          <Field id="bank-branchName" label="Branch" error={errors.branchName}>
            {input('branchName', { placeholder: 'BRANCH' })}
          </Field>
        </div>
      </section>
    </div>
  );
}
