'use client';
import { useParams } from 'next/navigation';
import RecurringMasterDetailPage from '@/components/recurring-payments/master-detail-page';
export default function Page(){const params=useParams<{masterId:string}>();return <RecurringMasterDetailPage masterId={params?.masterId||''}/>}
