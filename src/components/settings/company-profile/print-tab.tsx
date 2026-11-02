'use client';

/**
 * Company Profile › Print: what printed documents add around their content — the printed-on line
 * and the signature captions at the foot.
 */

import Link from 'next/link';
import { Hash, PenLine, Plus, Printer, RotateCcw, Signature, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignatureBlock } from '@/components/shared/company-letterhead';
import { SettingsNotice, SettingsSection, SwitchRow } from '@/components/settings/settings-ui';
import { uiText, type CompanyDesign, type CompanyProfile } from '@/lib/company-profile';
import type { ProfileIssue } from '@/lib/company-profile-checks';
import { ProfileColumns, fieldDomId } from './profile-parts';

const MAX_CAPTIONS = 6;
const TEXT_LABELS_HREF = '/settings/appearance/company-layout';

export function PrintTab({
  print,
  preview,
  issues,
  readOnly,
  single,
  onChange,
}: {
  print: CompanyDesign['print'];
  /** The draft as Save stores it: the sample sign-off and the standard captions' words. */
  preview: CompanyProfile;
  issues: Record<string, ProfileIssue>;
  readOnly: boolean;
  /** One column: the preview is beside the form. */
  single: boolean;
  onChange: (patch: Partial<CompanyDesign['print']>) => void;
}) {
  const captions = print.signatureLabels;
  const own = captions.length > 0;
  const standard = [preview.labels.preparedBy, preview.labels.checkedBy, preview.labels.approvedBy];
  const setCaptions = (signatureLabels: string[]) => onChange({ signatureLabels });

  return (
    <ProfileColumns single={single}>
      <SettingsSection title="Around every print" icon={Printer} description="Added by each document as it prints.">
        <SwitchRow
          label="Printed-on date and time"
          description={`Above the footer: “${uiText(preview.labels, 'printedOn')} 14 Oct 2026, 10:42”, stamped as the print dialog opens.`}
          checked={print.showPrintedOn}
          onCheckedChange={(showPrintedOn) => onChange({ showPrintedOn })}
          disabled={readOnly}
        />
        <SettingsNotice icon={Hash} title="Page numbers">
          Put the Page number and Page count fields in a designed letterhead&rsquo;s header or footer (Letterhead › Designed). They print in the
          page margin on Chrome and Edge 131 and later; older browsers, such as Chrome 109, leave them out.
        </SettingsNotice>
      </SettingsSection>

      <SettingsSection
        title="Signature captions"
        icon={Signature}
        description="The sign-off boxes at the foot of vouchers and reports, left to right."
        action={
          !readOnly && own ? (
            <Button variant="ghost" size="sm" onClick={() => setCaptions([])}>
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Use the standard
            </Button>
          ) : undefined
        }
        contentClassName="space-y-3"
      >
        {own ? (
          <ol className="space-y-2" aria-label="Captions, left to right">
            {captions.map((caption, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground" aria-hidden="true">
                  {index + 1}
                </span>
                <Input
                  id={fieldDomId(`signature.${index}`)}
                  aria-label={`Caption ${index + 1}`}
                  value={caption}
                  onChange={(event) => setCaptions(captions.map((entry, i) => (i === index ? event.target.value : entry)))}
                  disabled={readOnly}
                  maxLength={40}
                  placeholder={standard[index] ?? 'Caption'}
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-rose-600"
                    aria-label={`Remove caption ${index + 1}`}
                    onClick={() => setCaptions(captions.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-lg border border-dashed px-3 py-2.5">
            <p className="text-sm font-medium">{standard.join(' · ')}</p>
            <p className="text-xs text-muted-foreground">
              The standard captions, worded in{' '}
              <Link href={TEXT_LABELS_HREF} className="font-medium text-primary underline-offset-2 hover:underline">Appearance › Text labels</Link>.
            </p>
          </div>
        )}
        {issues.signatureLabels && <p id={fieldDomId('signatureLabels')} className="text-[11px] text-amber-700">{issues.signatureLabels.message}</p>}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {own ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setCaptions([...captions, ''])} disabled={captions.length >= MAX_CAPTIONS}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Add a caption
                </Button>
                <span className="text-[11px] tabular-nums text-muted-foreground">{captions.length} of {MAX_CAPTIONS}</span>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setCaptions([...standard])}>
                <PenLine className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Change the captions
              </Button>
            )}
          </div>
        )}
        <div className="keep-light rounded-lg border border-slate-200 bg-white px-4 pb-4">
          {/* Side by side, as on paper, even on a phone. */}
          <SignatureBlock profile={preview} className="mt-0 grid-cols-[repeat(var(--signature-columns),minmax(0,1fr))]" />
        </div>
      </SettingsSection>
    </ProfileColumns>
  );
}
