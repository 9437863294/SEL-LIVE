'use client';
import { useParams } from 'next/navigation';
import RecurringPaymentDetailPage from '@/components/recurring-payments/payment-detail-page';
export default function Page(){const params=useParams<{paymentId:string}>();return <RecurringPaymentDetailPage paymentId={params?.paymentId||''}/>}
