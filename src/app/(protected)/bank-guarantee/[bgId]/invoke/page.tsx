import { redirect } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ bgId: string }>;
}) {
  const { bgId } = await params;
  redirect(`/bank-guarantee/invocations?bgId=${bgId}`);
}
