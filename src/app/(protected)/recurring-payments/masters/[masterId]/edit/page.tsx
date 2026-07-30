'use client';
import { useParams } from 'next/navigation';
import RecurringMasterFormPage from '@/components/recurring-payments/master-form-page';
export default function Page(){const params=useParams<{masterId:string}>();return <RecurringMasterFormPage masterId={params?.masterId||''}/>}
