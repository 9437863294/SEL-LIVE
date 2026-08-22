'use client';
import { useParams } from 'next/navigation';
import RequirementForm from '@/components/hr/requirement-form';
export default function Page(){const params=useParams<{requirementId:string}>();return <RequirementForm requirementId={params?.requirementId||''}/>}
