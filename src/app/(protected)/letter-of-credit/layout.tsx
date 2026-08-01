import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import LetterOfCreditLayoutShell from '@/components/letter-of-credit/module-layout-shell';
export const metadata: Metadata = { title: 'Letter of Credit Management | SEL Live', description: 'End-to-end LC requests, limits, collateral, Hundis, payments, recoveries, and closure.' };
export default function LetterOfCreditLayout({ children }: { children: ReactNode }) { return <LetterOfCreditLayoutShell>{children}</LetterOfCreditLayoutShell>; }
