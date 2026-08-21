'use client';
import { useParams } from 'next/navigation';
import ClaimVerify from '@/components/tour-travel/claim-verify';
export default function Page(){const params=useParams<{claimId:string}>();return <ClaimVerify claimId={params?.claimId||''}/>}
