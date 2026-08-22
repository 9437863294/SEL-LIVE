'use client';
import { useParams } from 'next/navigation';
import RequirementWorkspace from '@/components/hr/requirement-workspace';
export default function Page(){const params=useParams<{requirementId:string}>();return <RequirementWorkspace requirementId={params?.requirementId||''}/>}
