import { EmployeeActivity } from '@/components/windows-agent/activity';

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <EmployeeActivity userId={userId} />;
}
