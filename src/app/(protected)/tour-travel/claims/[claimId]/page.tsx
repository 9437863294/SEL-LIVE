'use client';
import { useParams } from 'next/navigation';
import ClaimDetail from '@/components/tour-travel/claim-detail';
export default function Page(){const params=useParams<{claimId:string}>();return <ClaimDetail claimId={params?.claimId||''}/>}
