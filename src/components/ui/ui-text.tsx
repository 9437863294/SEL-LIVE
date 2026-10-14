'use client'

import { useUiText } from '@/hooks/use-company-profile'
import type { UiTextKey } from '@/lib/company-profile'

/**
 * One company UI label as text, for components that are not client components themselves
 * (ui/table.tsx renders in server components too, so it cannot call `useUiText()`).
 */
export function UiTextLabel({ textKey, fallback }: { textKey: UiTextKey; fallback?: string }) {
  const t = useUiText()
  return <>{t(textKey, fallback)}</>
}
