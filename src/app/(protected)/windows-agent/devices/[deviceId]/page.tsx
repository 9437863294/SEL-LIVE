import { DeviceDetail } from '@/components/windows-agent/devices';

export default async function Page({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  return <DeviceDetail deviceId={deviceId} />;
}
