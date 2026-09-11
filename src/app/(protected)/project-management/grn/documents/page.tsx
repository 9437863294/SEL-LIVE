"use client";

/**
 * The GRN document register.
 *
 * A wrapper over the shared supply-document screens: MDCC, DI, GRN and MVAC differ in vocabulary
 * rather than behaviour, so the stage definition supplies the wording and the shared component
 * supplies the logic. See project-management-supply-ledger.ts for the quantity rules.
 */

import { SupplyDocumentRegister } from "@/components/project-management/supply-document-screens";

export default function GRNDocumentsPage() {
  return <SupplyDocumentRegister stage="grn" />;
}
