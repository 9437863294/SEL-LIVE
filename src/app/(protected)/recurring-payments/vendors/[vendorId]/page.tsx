'use client';
import { useParams } from 'next/navigation';import VendorDetailPage from '@/components/recurring-payments/vendor-detail-page';
export default function Page(){const params=useParams<{vendorId:string}>();return <VendorDetailPage vendorId={params?.vendorId||''}/>}
