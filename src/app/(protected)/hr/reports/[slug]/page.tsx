'use client';
import { useParams } from 'next/navigation';
import ReportsHub from '@/components/hr/reports-hub';
export default function Page(){const params=useParams<{slug:string}>();return <ReportsHub slug={params?.slug||''}/>}
