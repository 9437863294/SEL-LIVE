'use client';

/**
 * The words every module shares — Save, Cancel, Delete, the delete confirmation, signature
 * captions… (`labels` of the company profile). A blank field falls back to the default.
 */

import { RotateCcw, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PreviewCollapsed, usePreviewVisible } from '@/components/appearance/controls';
import { cn } from '@/lib/utils';
import { SignatureBlock } from '@/components/shared/company-letterhead';
import {
  CompanyPartFrame,
  DialogPreview,
  Field,
  PreviewCard,
  useCompanyProfilePart,
} from '@/components/appearance/company-profile-part';
import { UI_TEXT_DEFAULTS, UI_TEXT_HINTS, UI_TEXT_KEYS, type CompanyProfile, type UiTextKey } from '@/lib/company-profile';

const pickLabels = (profile: CompanyProfile) => profile.labels;
const applyLabels = (stored: CompanyProfile, draft: CompanyProfile): CompanyProfile => ({ ...stored, labels: draft.labels });

export function CompanyTextLabels() {
  const editor = useCompanyProfilePart({ pick: pickLabels, apply: applyLabels, savedMessage: 'Every module now uses the new wording.' });
  const { readOnly, canEdit, preview, setDraft } = editor;
  const [showPreview, setShowPreview] = usePreviewVisible('company-labels');
  const setLabel = (key: UiTextKey, value: string) => setDraft((current) => ({ ...current, labels: { ...current.labels, [key]: value } }));

  return (
    <CompanyPartFrame
      editor={editor}
      title="Text labels"
      description="The words shared by every module. A blank field falls back to the default."
      icon={Type}
      saveLabel={preview.labels.save}
    >
      {(draft) => (
        <div className={cn('grid grid-cols-1 gap-4', showPreview && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]')}>
          {showPreview ? null : (
            <PreviewCollapsed title="Labels preview" note="Buttons, search, empty states, a dialog and the signature block in the unsaved labels." onShow={() => setShowPreview(true)} />
          )}
          <Card className="min-w-0">
            <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-base">Labels</CardTitle>
                <CardDescription className="text-xs">Each default is shown as the field&apos;s name.</CardDescription>
              </div>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => setDraft((current) => ({ ...current, labels: { ...UI_TEXT_DEFAULTS } }))}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />Reset all
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {UI_TEXT_KEYS.map((key) => (
                <Field key={key} label={UI_TEXT_DEFAULTS[key]} hint={UI_TEXT_HINTS[key] ?? `Key: ${key}`}>
                  <div className="flex gap-1">
                    <Input value={draft.labels[key]} onChange={(e) => setLabel(key, e.target.value)} disabled={readOnly} maxLength={key === 'confirmDeleteDescription' ? 300 : 120} />
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        title="Reset to default"
                        aria-label={`Reset “${UI_TEXT_DEFAULTS[key]}” to default`}
                        disabled={draft.labels[key] === UI_TEXT_DEFAULTS[key]}
                        onClick={() => setLabel(key, UI_TEXT_DEFAULTS[key])}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Field>
              ))}
            </CardContent>
          </Card>
          {showPreview ? (
          <PreviewCard title="Labels preview" onHide={() => setShowPreview(false)}>
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['save', 'cancel', 'edit', 'add', 'export', 'print', 'refresh'] as const).map((key) => (
                  <Button key={key} size="sm" variant={key === 'save' ? 'default' : 'outline'} type="button">{preview.labels[key]}</Button>
                ))}
              </div>
              <Input placeholder={`${preview.labels.search}…`} readOnly />
              <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">{preview.labels.noRecords}</p>
              <DialogPreview dialogs={preview.design.dialogs} labels={preview.labels} />
              <div className="keep-light rounded-lg border bg-white p-3 text-slate-900">
                <SignatureBlock profile={preview} className="mt-0" />
              </div>
            </div>
          </PreviewCard>
          ) : null}
        </div>
      )}
    </CompanyPartFrame>
  );
}
