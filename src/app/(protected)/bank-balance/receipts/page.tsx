'use client';
export const dynamic = 'force-dynamic';

import { BankTransactionLog } from '@/components/bank-balance/transaction-log';

export default function ReceiptsLogPage() {
  return <BankTransactionLog kind="receipt" />;
}
