import BGIssuanceWorkspace from "@/components/bank-guarantee/issuance-workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ bgId: string }>;
}) {
  const { bgId } = await params;
  return <BGIssuanceWorkspace initialRequestId={bgId} />;
}
