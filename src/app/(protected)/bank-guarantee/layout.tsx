import type { Metadata } from "next";
import type { ReactNode } from "react";
import BankGuaranteeLayoutShell from "@/components/bank-guarantee/module-layout-shell";

export const metadata: Metadata = {
  title: "Bank Guarantee Management | SEL Live",
  description:
    "End-to-end BG requests, limits, collateral, validity, claims, custody, cancellation, and release.",
};
export default function BankGuaranteeLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <BankGuaranteeLayoutShell>{children}</BankGuaranteeLayoutShell>;
}
