'use client';
import { useParams } from 'next/navigation';
import ProfessionalRecurringWorkflowStage from '@/components/recurring-payments/professional-workflow-stage';
export default function Page(){const params=useParams<{stageId:string}>();return <ProfessionalRecurringWorkflowStage stageId={params?.stageId||''}/>}
