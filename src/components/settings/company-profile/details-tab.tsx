'use client';

/**
 * Company Profile › Details: the names, logo, registration numbers, address and contacts every
 * document prints. Each check under a field is the sanitiser's (company-profile-checks.ts).
 */

import { useRef, useState } from 'react';
import { BadgeCheck, Building2, CheckCircle2, Globe, ImageIcon, Link2, Loader2, Mail, MapPin, Phone, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SettingsSection } from '@/components/settings/settings-ui';
import { uploadLetterheadAsset } from '@/components/shared/letterhead-designer';
import { panFromGstins, type ProfileIssue } from '@/lib/company-profile-checks';
import type { CompanyProfile } from '@/lib/company-profile';
import { GST_STATES } from '@/lib/statutory';
import { cn } from '@/lib/utils';
import { INVALID_CONTROL, IconInput, ProfileColumns, ProfileField, controlProps, fieldDomId } from './profile-parts';

/** State names for the State field's suggestions; the codes 97 and 99 are not places. */
const STATE_NAMES = [...new Set(Object.entries(GST_STATES).filter(([code]) => Number(code) < 90).map(([, name]) => name))].sort();

const LOGO_TYPES = 'image/png,image/jpeg,image/webp';
const LOGO_MAX_BYTES = 1024 * 1024;

/** "Valid", beside a filled-in number that passes its check. */
function ValidMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      Valid
    </span>
  );
}

/**
 * The logo documents print: a thumbnail, Upload (stored with the letterhead images), a link instead,
 * and Remove. With none of its own the profile falls back to Appearance › Branding's light logo.
 */
function LogoField({
  value,
  onChange,
  brandingLogoUrl,
  issue,
  readOnly,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  brandingLogoUrl: string | null;
  issue?: ProfileIssue;
  readOnly: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const own = value?.trim() ? value.trim() : null;
  const shown = own ? (issue ? null : own) : brandingLogoUrl;
  // A link being typed, or one that fails its check, keeps the link field open.
  const showLink = !readOnly && (linkOpen || Boolean(issue));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      setUploadError('Logos must be 1 MB or smaller.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      onChange(await uploadLetterheadAsset(file));
      setLinkOpen(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'The logo could not be uploaded.');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const note = own
    ? 'This logo prints on every document.'
    : brandingLogoUrl
      ? 'None of its own: documents print the light logo from Appearance › Company Branding.'
      : 'No logo yet. Upload one, or add one in Appearance › Company Branding.';

  return (
    <div className="min-w-0 space-y-2 sm:col-span-2">
      <p className="text-xs font-semibold">Logo</p>
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border p-2.5">
        <div className="keep-light flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white p-1">
          {shown && brokenSrc !== shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="Logo" className="max-h-full max-w-full object-contain" onError={() => setBrokenSrc(shown)} />
          ) : (
            <ImageIcon className="h-6 w-6 text-slate-300" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1 basis-48 space-y-1.5">
          <p className="text-xs text-muted-foreground">{note}</p>
          {!readOnly && (
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {own ? 'Replace' : 'Upload'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen((open) => !open)} aria-expanded={showLink} aria-controls={fieldDomId('logoUrl')}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Link
              </Button>
              {own && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Remove
                </Button>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept={LOGO_TYPES} className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
        </div>
      </div>
      {showLink && (
        <ProfileField field="logoUrl" label="Logo link" issue={issue} hint="An https:// address of a PNG, JPEG or WebP image.">
          <Input
            {...controlProps('logoUrl', issue, true)}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://…"
            maxLength={2000}
            className={cn(issue?.severity === 'error' && INVALID_CONTROL)}
          />
        </ProfileField>
      )}
      {uploadError && <p role="alert" className="text-[11px] text-rose-600">{uploadError}</p>}
      {!uploadError && shown && brokenSrc === shown && <p className="text-[11px] text-amber-700">This image could not be loaded. Check the link, or upload the logo.</p>}
      {!readOnly && !showLink && <p className="text-[11px] text-muted-foreground">PNG, JPEG or WebP, up to 1 MB. A wide logo about 48 px tall prints best.</p>}
    </div>
  );
}

export function DetailsTab({
  draft,
  issues,
  readOnly,
  single,
  brandingLogoUrl,
  update,
}: {
  draft: CompanyProfile;
  issues: Record<string, ProfileIssue>;
  readOnly: boolean;
  /** One column: the preview is beside the form. */
  single: boolean;
  brandingLogoUrl: string | null;
  update: (patch: Partial<CompanyProfile>) => void;
}) {
  const invalid = (field: string) => issues[field]?.severity === 'error' && INVALID_CONTROL;
  const text = (field: keyof CompanyProfile & string, hasHint = false) => ({
    ...controlProps(field, issues[field], hasHint),
    value: (draft[field] as string | null) ?? '',
    disabled: readOnly,
    className: cn(invalid(field) || undefined),
  });
  const gstPan = panFromGstins(draft.gstRegistrations);
  const cinValid = Boolean(draft.cin?.trim()) && !issues.cin;
  const panValid = Boolean(draft.pan?.trim()) && !issues.pan;

  return (
    <ProfileColumns single={single}>
      <>
        <SettingsSection title="Identity" icon={Building2} description="The names and logo at the head of every document." contentClassName="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ProfileField field="legalName" label="Legal name" issue={issues.legalName} className="sm:col-span-2">
            <Input {...text('legalName')} onChange={(event) => update({ legalName: event.target.value })} maxLength={160} />
          </ProfileField>
          <ProfileField field="shortName" label="Short name" issue={issues.shortName} hint="Where the full name will not fit.">
            <Input {...text('shortName', true)} onChange={(event) => update({ shortName: event.target.value })} maxLength={40} />
          </ProfileField>
          <ProfileField field="tagline" label="Tagline" hint="Under the name on the letterhead.">
            <Input {...text('tagline', true)} onChange={(event) => update({ tagline: event.target.value })} maxLength={160} />
          </ProfileField>
          <LogoField value={draft.logoUrl} onChange={(logoUrl) => update({ logoUrl })} brandingLogoUrl={brandingLogoUrl} issue={issues.logoUrl} readOnly={readOnly} />
        </SettingsSection>

        <SettingsSection title="Registration numbers" icon={BadgeCheck} description="Printed beside the GSTIN when the letterhead shows them." contentClassName="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ProfileField field="cin" label="CIN" issue={issues.cin} status={cinValid && <ValidMark />} hint="21 characters, like U31200OR1990PLC002345.">
            <Input {...text('cin', true)} onChange={(event) => update({ cin: event.target.value.toUpperCase() })} maxLength={21} className={cn('font-mono uppercase', invalid('cin'))} />
          </ProfileField>
          <ProfileField
            field="pan"
            label="PAN"
            issue={issues.pan}
            status={panValid && <ValidMark />}
            hint={
              !draft.pan?.trim() && gstPan && !readOnly ? (
                <button type="button" onClick={() => update({ pan: gstPan })} className="rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Use {gstPan}, from the GSTIN
                </button>
              ) : (
                '10 characters, like AAACS1234F.'
              )
            }
          >
            <Input {...text('pan', true)} onChange={(event) => update({ pan: event.target.value.toUpperCase() })} maxLength={10} className={cn('font-mono uppercase', invalid('pan'))} />
          </ProfileField>
        </SettingsSection>
      </>

      <>
        {/* Two across even on a phone: a city and a PIN code are short. */}
        <SettingsSection title="Address" icon={MapPin} description="The registered office, as the letterhead prints it." contentClassName="grid grid-cols-2 gap-3">
          <ProfileField field="addressLines" label="Street address" issue={issues.addressLines} hint="One line each, up to four." className="col-span-2">
            <Textarea
              {...controlProps('addressLines', issues.addressLines, true)}
              rows={3}
              value={draft.addressLines.join('\n')}
              onChange={(event) => update({ addressLines: event.target.value.split('\n') })}
              disabled={readOnly}
            />
          </ProfileField>
          <ProfileField field="city" label="City" issue={issues.city}>
            <Input {...text('city')} onChange={(event) => update({ city: event.target.value })} maxLength={60} />
          </ProfileField>
          <ProfileField field="pincode" label="PIN code" issue={issues.pincode}>
            <Input {...text('pincode')} onChange={(event) => update({ pincode: event.target.value })} inputMode="numeric" maxLength={12} className={cn('tabular-nums', invalid('pincode'))} />
          </ProfileField>
          <ProfileField field="state" label="State" issue={issues.state}>
            <Input {...text('state')} onChange={(event) => update({ state: event.target.value })} list="cp-state-names" maxLength={60} />
          </ProfileField>
          <ProfileField field="country" label="Country" issue={issues.country}>
            <Input {...text('country')} onChange={(event) => update({ country: event.target.value })} maxLength={60} />
          </ProfileField>
          <datalist id="cp-state-names">
            {STATE_NAMES.map((name) => <option key={name} value={name} />)}
          </datalist>
        </SettingsSection>

        <SettingsSection title="Contacts" icon={Phone} description="One contact line on the letterhead and in email signatures." contentClassName="grid grid-cols-1 gap-3">
          <ProfileField field="phone" label="Phone" hint="As it should print; add a fax number after a · if there is one.">
            <IconInput icon={Phone} {...text('phone', true)} onChange={(event) => update({ phone: event.target.value })} maxLength={120} />
          </ProfileField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ProfileField field="email" label="Email" issue={issues.email}>
              <IconInput icon={Mail} type="email" {...text('email')} onChange={(event) => update({ email: event.target.value })} maxLength={120} />
            </ProfileField>
            <ProfileField field="website" label="Website" issue={issues.website}>
              <IconInput icon={Globe} {...text('website')} onChange={(event) => update({ website: event.target.value })} placeholder="www.example.com" maxLength={200} />
            </ProfileField>
          </div>
        </SettingsSection>
      </>
    </ProfileColumns>
  );
}
