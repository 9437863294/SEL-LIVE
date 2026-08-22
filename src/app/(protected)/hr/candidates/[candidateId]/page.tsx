'use client';
import { useParams } from 'next/navigation';
import CandidateDetail from '@/components/hr/candidate-detail';
export default function Page(){const params=useParams<{candidateId:string}>();return <CandidateDetail candidateId={params?.candidateId||''}/>}
