"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import GenericCrudPage, {
  type CrudColumnConfig,
  type CrudFieldConfig,
} from "@/components/vehicle-management/generic-crud-page";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  formatBgCurrency,
  type BankGuarantee,
} from "@/lib/bank-guarantee";

type Kind =
  "movement" | "acknowledgements" | "documents" | "amendments" | "commissions";
const options = (values: string[]) =>
  values.map((value) => ({ value, label: bgLabel(value) }));
const money = (value: unknown) => formatBgCurrency(Number(value || 0));

export default function BGEntityWorkspace({ kind }: { kind: Kind }) {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const [guarantees, setGuarantees] = useState<BankGuarantee[]>([]);
  useEffect(() => {
    void getDocs(collection(db, BG_COLLECTIONS.guarantees)).then((snapshot) =>
      setGuarantees(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BankGuarantee)
          .filter(
            (item) =>
              user?.role === "Super Admin" ||
              item.organizationId === organizationId,
          ),
      ),
    );
  }, [organizationId, user?.role]);
  const bgField: CrudFieldConfig = useMemo(
    () => ({
      key: "bgId",
      label: "Bank Guarantee",
      type: "select",
      required: true,
      searchable: true,
      options: guarantees.map((item) => ({
        value: item.id,
        label: `${item.bankBgNumber} · ${item.beneficiaryName}`,
      })),
    }),
    [guarantees],
  );
  const config = useMemo(() => {
    const movement = {
      title: "Original BG Movement",
      description:
        "Maintain the physical chain of custody from bank receipt through beneficiary return and cancellation.",
      itemName: "BG Movement",
      collectionName: BG_COLLECTIONS.movements,
      resource: "Original BG Movement",
      fields: [
        bgField,
        {
          key: "movementType",
          label: "Movement Type",
          type: "select",
          required: true,
          options: options([
            "RECEIVED_FROM_BANK",
            "SENT_TO_HEAD_OFFICE",
            "SENT_TO_PROJECT",
            "SENT_TO_BENEFICIARY",
            "BENEFICIARY_ACKNOWLEDGED",
            "RETURNED_BY_BENEFICIARY",
            "SUBMITTED_TO_BANK",
            "ARCHIVED",
          ]),
        },
        { key: "fromLocation", label: "From Location", type: "text" },
        {
          key: "toLocation",
          label: "To Location",
          type: "text",
          required: true,
        },
        { key: "handedOverBy", label: "Handed Over By", type: "text" },
        { key: "receivedBy", label: "Received By", type: "text" },
        {
          key: "dispatchDate",
          label: "Dispatch Date",
          type: "date",
          required: true,
        },
        { key: "courierName", label: "Courier", type: "text" },
        { key: "trackingNumber", label: "Tracking Number", type: "text" },
        {
          key: "expectedDeliveryDate",
          label: "Expected Delivery",
          type: "date",
        },
        { key: "actualDeliveryDate", label: "Actual Delivery", type: "date" },
        {
          key: "acknowledgementReceived",
          label: "Acknowledgement",
          type: "select",
          options: options(["NO", "YES"]),
        },
        {
          key: "currentCustodian",
          label: "Current Custodian",
          type: "text",
          required: true,
        },
        { key: "documentUrl", label: "Movement Document", type: "file" },
        { key: "remarks", label: "Remarks", type: "textarea" },
      ],
      columns: [
        { key: "bgNumber", label: "BG Number" },
        { key: "movementType", label: "Movement" },
        { key: "fromLocation", label: "From" },
        { key: "toLocation", label: "To" },
        { key: "dispatchDate", label: "Dispatch" },
        { key: "trackingNumber", label: "Tracking" },
        { key: "currentCustodian", label: "Custodian" },
      ] as CrudColumnConfig[],
    };
    const acknowledgements = {
      title: "Beneficiary Acknowledgement",
      description:
        "Track delivery, acceptance, objections, and revised BG requirements.",
      itemName: "BG Acknowledgement",
      collectionName: BG_COLLECTIONS.acknowledgements,
      resource: "Beneficiary Acknowledgement",
      fields: [
        bgField,
        { key: "dispatchDate", label: "Dispatch Date", type: "date" },
        { key: "deliveryDate", label: "Delivery Date", type: "date" },
        { key: "receivedBy", label: "Received By", type: "text" },
        { key: "designation", label: "Designation", type: "text" },
        {
          key: "acknowledgementNumber",
          label: "Acknowledgement Number",
          type: "text",
        },
        {
          key: "acknowledgementDate",
          label: "Acknowledgement Date",
          type: "date",
        },
        {
          key: "acceptedWithoutObjection",
          label: "Accepted Without Objection",
          type: "select",
          options: options(["YES", "NO"]),
        },
        {
          key: "objectionDescription",
          label: "Objection Description",
          type: "textarea",
        },
        {
          key: "revisedBgRequired",
          label: "Revised BG Required",
          type: "select",
          options: options(["NO", "YES"]),
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          required: true,
          options: options([
            "NOT_DISPATCHED",
            "DISPATCHED",
            "DELIVERED",
            "ACKNOWLEDGEMENT_AWAITED",
            "ACCEPTED",
            "OBJECTION_RAISED",
            "REVISED_BG_SUBMITTED",
            "COMPLETED",
          ]),
        },
        {
          key: "supportingDocument",
          label: "Supporting Document",
          type: "file",
        },
      ],
      columns: [
        { key: "bgNumber", label: "BG Number" },
        { key: "beneficiaryName", label: "Beneficiary" },
        { key: "dispatchDate", label: "Dispatch" },
        { key: "deliveryDate", label: "Delivery" },
        { key: "acknowledgementNumber", label: "Acknowledgement" },
        { key: "status", label: "Status" },
      ] as CrudColumnConfig[],
    };
    const amendments = {
      title: "BG Amendments",
      description:
        "Record amount, validity, beneficiary, wording, bank, currency, and contractual amendments as separate events.",
      itemName: "BG Amendment",
      collectionName: BG_COLLECTIONS.amendments,
      resource: "Extension & Amendment",
      fields: [
        bgField,
        {
          key: "amendmentNumber",
          label: "Amendment Number",
          type: "text",
          required: true,
        },
        {
          key: "amendmentType",
          label: "Amendment Type",
          type: "select",
          required: true,
          options: options([
            "AMOUNT_INCREASE",
            "AMOUNT_REDUCTION",
            "VALIDITY_EXTENSION",
            "CLAIM_PERIOD_CHANGE",
            "BENEFICIARY_NAME_CHANGE",
            "BENEFICIARY_ADDRESS_CHANGE",
            "PROJECT_REFERENCE_CHANGE",
            "CONTRACT_REFERENCE_CHANGE",
            "WORDING_CHANGE",
            "PURPOSE_CHANGE",
            "BANK_CHANGE",
            "CURRENCY_CHANGE",
            "OTHER",
          ]),
        },
        { key: "existingValue", label: "Existing Value", type: "text" },
        {
          key: "proposedValue",
          label: "Proposed Value",
          type: "text",
          required: true,
        },
        { key: "reason", label: "Reason", type: "textarea", required: true },
        { key: "financialImpact", label: "Financial Impact", type: "number" },
        { key: "limitImpact", label: "Limit Impact", type: "number" },
        { key: "marginImpact", label: "Margin Impact", type: "number" },
        { key: "commission", label: "Commission", type: "number" },
        { key: "bankSubmissionDate", label: "Bank Submission", type: "date" },
        {
          key: "bankConfirmationDate",
          label: "Bank Confirmation",
          type: "date",
        },
        { key: "effectiveDate", label: "Effective Date", type: "date" },
        {
          key: "beneficiaryAcknowledged",
          label: "Beneficiary Acknowledged",
          type: "select",
          options: options(["NO", "YES"]),
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          required: true,
          options: options([
            "DRAFT",
            "PENDING_APPROVAL",
            "APPROVED",
            "SUBMITTED_TO_BANK",
            "BANK_CONFIRMED",
            "COMPLETED",
            "REJECTED",
            "CANCELLED",
          ]),
        },
        { key: "documentUrl", label: "Amendment Document", type: "file" },
      ],
      columns: [
        { key: "bgNumber", label: "BG Number" },
        { key: "amendmentNumber", label: "Amendment" },
        { key: "amendmentType", label: "Type" },
        { key: "existingValue", label: "Existing" },
        { key: "proposedValue", label: "Proposed" },
        { key: "commission", label: "Commission", formatter: money },
        { key: "status", label: "Status" },
      ] as CrudColumnConfig[],
    };
    const documents = {
      title: "BG Document Management",
      description:
        "Versioned request, contract, approval, bank, collateral, dispatch, amendment, invocation, cancellation, and release evidence.",
      itemName: "BG Document",
      collectionName: BG_COLLECTIONS.documents,
      resource: "Document Management",
      fields: [
        bgField,
        {
          key: "documentType",
          label: "Document Type",
          type: "select",
          required: true,
          options: options([
            "REQUEST",
            "TENDER",
            "CONTRACT",
            "APPROVAL",
            "BANK_APPLICATION",
            "BG_COPY",
            "COMMISSION",
            "MARGIN",
            "DISPATCH",
            "ACKNOWLEDGEMENT",
            "EXTENSION",
            "AMENDMENT",
            "INVOCATION",
            "CANCELLATION",
            "RELEASE",
            "OTHER",
          ]),
        },
        {
          key: "documentUrl",
          label: "Document File",
          type: "file",
          required: true,
        },
        {
          key: "version",
          label: "Version",
          type: "number",
          defaultValue: "1",
        },
        { key: "documentDate", label: "Document Date", type: "date" },
        { key: "referenceNumber", label: "Reference Number", type: "text" },
        { key: "remarks", label: "Remarks", type: "textarea" },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: options(["ACTIVE", "ARCHIVED"]),
        },
      ],
      columns: [
        { key: "bgNumber", label: "BG Number" },
        { key: "documentType", label: "Type" },
        { key: "version", label: "Version" },
        { key: "documentDate", label: "Document Date" },
        { key: "referenceNumber", label: "Reference" },
        { key: "status", label: "Status" },
      ] as CrudColumnConfig[],
    };
    const commissions = {
      title: "Commission Reconciliation",
      description:
        "Compare internal calculations against bank debits, queries, refunds, and accepted differences.",
      itemName: "BG Commission",
      collectionName: BG_COLLECTIONS.commissions,
      resource: "Commission Reconciliation",
      fields: [
        bgField,
        {
          key: "commissionType",
          label: "Commission Type",
          type: "select",
          required: true,
          options: options([
            "OPENING",
            "EXTENSION",
            "AMENDMENT",
            "PROCESSING",
            "OTHER",
          ]),
        },
        {
          key: "calculationFromDate",
          label: "From Date",
          type: "date",
          required: true,
        },
        {
          key: "calculationToDate",
          label: "To Date",
          type: "date",
          required: true,
        },
        {
          key: "calculationBasis",
          label: "Basis",
          type: "select",
          options: options(["DAILY", "MONTHLY", "QUARTERLY_OR_PART", "MANUAL"]),
        },
        { key: "bgAmount", label: "BG Amount", type: "number", required: true },
        { key: "commissionRate", label: "Annual Rate %", type: "number" },
        {
          key: "calculatedCommission",
          label: "Internal Commission",
          type: "number",
          required: true,
        },
        {
          key: "bankChargedCommission",
          label: "Bank Commission",
          type: "number",
          required: true,
        },
        { key: "gstAmount", label: "GST", type: "number" },
        { key: "otherCharges", label: "Other Charges", type: "number" },
        { key: "differenceAmount", label: "Difference", type: "number" },
        {
          key: "reconciliationStatus",
          label: "Reconciliation Status",
          type: "select",
          required: true,
          options: options([
            "MATCHED",
            "OVERCHARGED",
            "UNDERCHARGED",
            "UNDER_REVIEW",
            "REFUND_REQUESTED",
            "REFUND_RECEIVED",
            "ACCEPTED",
          ]),
        },
        {
          key: "bankAdviceReference",
          label: "Bank Advice Reference",
          type: "text",
        },
        { key: "bankAdviceUrl", label: "Bank Advice", type: "file" },
        { key: "transactionDate", label: "Transaction Date", type: "date" },
        { key: "remarks", label: "Remarks", type: "textarea" },
      ],
      columns: [
        { key: "bgNumber", label: "BG Number" },
        { key: "bankName", label: "Bank" },
        { key: "commissionType", label: "Type" },
        { key: "calculatedCommission", label: "Internal", formatter: money },
        { key: "bankChargedCommission", label: "Bank", formatter: money },
        { key: "differenceAmount", label: "Difference", formatter: money },
        { key: "reconciliationStatus", label: "Status" },
      ] as CrudColumnConfig[],
    };
    return { movement, acknowledgements, documents, amendments, commissions }[
      kind
    ];
  }, [bgField, kind]);
  const canView = can("View", `${BG_PERMISSION_MODULE}.${config.resource}`),
    canAdd = can(
      kind === "documents" ? "Upload" : "Add",
      `${BG_PERMISSION_MODULE}.${config.resource}`,
    ),
    canEdit = can(
      kind === "documents" ? "Archive" : "Edit",
      `${BG_PERMISSION_MODULE}.${config.resource}`,
    );
  return (
    <GenericCrudPage
      title={config.title}
      description={config.description}
      itemName={config.itemName}
      collectionName={config.collectionName}
      fields={config.fields as CrudFieldConfig[]}
      columns={config.columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={false}
      canExport={canView}
      exportFileName={`bg-${kind}`}
      uploadPathPrefix={`organizations/${organizationId}/bank-guarantees`}
      onAfterFetch={(rows) =>
        rows.filter(
          (row) =>
            user?.role === "Super Admin" ||
            row.organizationId === organizationId,
        )
      }
      onBeforeSave={(payload) => {
        const bg = guarantees.find((item) => item.id === payload.bgId);
        const patch: Record<string, unknown> = {
          ...payload,
          organizationId,
          bgNumber: bg?.bankBgNumber || "",
          beneficiaryName: bg?.beneficiaryName || "",
          projectName: bg?.projectName || "",
          bankId: bg?.bankId || "",
          bankName: bg?.bankName || "",
          updatedBy: user?.id || "",
          updatedByName: user?.name || "",
        };
        if (kind === "commissions") {
          const difference =
            Number(payload.bankChargedCommission || 0) -
            Number(payload.calculatedCommission || 0);
          patch.differenceAmount = difference;
          if (!payload.reconciliationStatus)
            patch.reconciliationStatus =
              difference === 0
                ? "MATCHED"
                : difference > 0
                  ? "OVERCHARGED"
                  : "UNDERCHARGED";
        }
        return patch;
      }}
      onAfterSave={async ({ payload }) => {
        const bg = guarantees.find((item) => item.id === payload.bgId);
        if (!bg) return;
        if (kind === "movement")
          await updateDoc(doc(db, BG_COLLECTIONS.guarantees, bg.id), {
            currentCustodian: payload.currentCustodian,
            originalDispatched: [
              "SENT_TO_PROJECT",
              "SENT_TO_BENEFICIARY",
            ].includes(payload.movementType),
            originalReturned:
              payload.movementType === "RETURNED_BY_BENEFICIARY",
            updatedAt: new Date(),
          });
        if (
          kind === "acknowledgements" &&
          ["ACCEPTED", "COMPLETED"].includes(payload.status)
        )
          await updateDoc(doc(db, BG_COLLECTIONS.guarantees, bg.id), {
            beneficiaryAcknowledged: true,
            updatedAt: new Date(),
          });
      }}
    />
  );
}
