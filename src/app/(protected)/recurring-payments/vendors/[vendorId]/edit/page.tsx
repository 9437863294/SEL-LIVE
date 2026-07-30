'use client';
import { useParams } from 'next/navigation';import VendorFormPage from '@/components/recurring-payments/vendor-form-page';
export default function Page(){const params=useParams<{vendorId:string}>();return <VendorFormPage vendorId={params?.vendorId||''}/>}
