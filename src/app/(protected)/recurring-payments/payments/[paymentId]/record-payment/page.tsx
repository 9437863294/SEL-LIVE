'use client';
import { useParams } from 'next/navigation';
import PaymentActionRedirect from '@/components/recurring-payments/payment-action-redirect';
export default function Page(){const params=useParams<{paymentId:string}>();return <PaymentActionRedirect paymentId={params?.paymentId||''} action="record-payment"/>}
