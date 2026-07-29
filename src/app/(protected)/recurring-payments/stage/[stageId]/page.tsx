'use client';
import { useParams } from 'next/navigation';
import RecurringWorkflowStage from '@/components/recurring-payments/workflow-stage';
export default function Page(){const params=useParams<{stageId:string}>();return <RecurringWorkflowStage stageId={params?.stageId||''}/>}
