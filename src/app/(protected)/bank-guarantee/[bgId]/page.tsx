import BGDetailPage from "@/components/bank-guarantee/detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ bgId: string }>;
}) {
  const { bgId } = await params;
  return <BGDetailPage id={bgId} />;
}
