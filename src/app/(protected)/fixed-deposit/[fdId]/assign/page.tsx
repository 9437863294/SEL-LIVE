'use client';
import { useParams } from 'next/navigation';
import FDAssignmentWorkspace from '@/components/fixed-deposit/assignment-workspace';
export default function AssignFixedDepositPage() { const params = useParams<{ fdId: string }>(); return <FDAssignmentWorkspace initialFdId={params?.fdId} />; }
