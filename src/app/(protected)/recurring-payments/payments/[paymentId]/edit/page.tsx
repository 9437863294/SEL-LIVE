'use client';
import { useParams } from 'next/navigation';
import PaymentEditPage from '@/components/recurring-payments/payment-edit-page';
export default function Page(){const params=useParams<{paymentId:string}>();return <PaymentEditPage paymentId={params?.paymentId||''}/>}
