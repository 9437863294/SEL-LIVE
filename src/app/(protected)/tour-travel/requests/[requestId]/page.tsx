'use client';
import { useParams } from 'next/navigation';
import TourRequestDetail from '@/components/tour-travel/tour-request-detail';
export default function Page(){const params=useParams<{requestId:string}>();return <TourRequestDetail requestId={params?.requestId||''}/>}
