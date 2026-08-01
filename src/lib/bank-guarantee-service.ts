"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
  type DocumentData,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  FD_COLLECTIONS,
  assignmentOutstanding,
  calculateAvailableAmount as calculateFdAvailable,
  deriveOperationalStatus as deriveFdStatus,
  type FDAssignment,
  type FixedDeposit,
} from "@/lib/fixed-deposit";
import {
  createFdAssignments,
  type AssignmentInstrumentInput,
} from "@/lib/fixed-deposit-service";
import { missingBGDocumentTypes } from "@/lib/bank-guarantee-documents";
import { loadBGSettings } from "@/lib/bank-guarantee-settings";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  calculateBgMargin,
  calculateCommission,
  financialYearForBgDate,
  roundBg,
  type BGCancellation,
  type BGRequest,
  type BGRequestStatus,
  type BankGuarantee,
} from "@/lib/bank-guarantee";

export type BGActor = {
  userId: string;
  userName: string;
  role?: string;
  organizationId: string;
  organizationName?: string;
};

export type BGRequestInput = {
  departmentId?: string;
  departmentName?: string;
  projectId: string;
  projectName: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryAddress?: string;
  beneficiaryEmail?: string;
  beneficiaryContactPerson?: string;
  beneficiaryDepartment?: string;
  beneficiaryClientCode?: string;
  beneficiaryBgFormat?: string;
  contractId?: string;
  contractReference?: string;
  tenderNumber?: string;
  contractNumber?: string;
  workOrderNumber?: string;
  contractDate?: string;
  contractCompletionDate?: string;
  defectLiabilityEndDate?: string;
  warrantyEndDate?: string;
  clientBgFormat?: string;
  contractValue: number;
  bgPercentage: number;
  existingBgAmount?: number;
  purpose: string;
  description?: string;
  currency: string;
  exchangeRate: number;
  requestedAmount: number;
  requiredIssueDate: string;
  proposedStartDate: string;
  proposedExpiryDate: string;
  proposedClaimExpiryDate: string;
  claimPeriodDays: number;
  claimPeriodType?: "DAYS" | "MONTHS" | "FIXED_DATE" | "BENEFICIARY_FORMAT";
  claimDateOverrideReason?: string;
  autoExtensionClause: boolean;
  preferredBankId: string;
  preferredBankName: string;
  bankLimitId?: string;
  preferredBranchName?: string;
  marginType: string;
  marginPercentage: number;
  fdMarginAmount?: number;
  cashMarginAmount?: number;
  otherCollateralAmount?: number;
  estimatedCommission?: number;
  estimatedGst?: number;
  estimatedOtherCharges?: number;
  debitAccountId?: string;
  remarks?: string;
};

export type BGIssuanceInput = {
  requestId: string;
  bankBgNumber: string;
  bankId: string;
  bankName: string;
  branchId?: string;
  branchName?: string;
  bankLimitId?: string;
  issueDate: string;
  effectiveDate?: string;
  startDate: string;
  expiryDate: string;
  claimExpiryDate: string;
  issuedAmount: number;
  currency: string;
  exchangeRate: number;
  marginPercentage: number;
  fdMarginAmount: number;
  cashMarginAmount: number;
  otherCollateralAmount: number;
  bankCommission: number;
  gstAmount: number;
  stampDuty: number;
  swiftCharges: number;
  courierCharges: number;
  otherCharges: number;
  debitAccountId?: string;
  originalReceived: boolean;
  originalReceivedDate?: string;
  numberOfOriginals: number;
  numberOfCopies: number;
  dispatchRequired: boolean;
  documentComplete: boolean;
  remarks?: string;
};

const now = () => Timestamp.now();
const dateValue = (value: string, label: string) => {
  const date = new Date(`${value}T12:00:00`);
  if (!value || Number.isNaN(date.getTime()))
    throw new Error(`${label} is invalid.`);
  return Timestamp.fromDate(date);
};
const optionalDate = (value?: string) =>
  value ? dateValue(value, "Date") : null;
const keyValue = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
const orgCode = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .replace(/\W/g, "")
    .slice(0, 8)
    .toUpperCase() || "ORG";
const requestFrom = (data: DocumentData, id: string) =>
  ({ id, ...data }) as BGRequest;
const guaranteeFrom = (data: DocumentData, id: string) =>
  ({ id, ...data }) as BankGuarantee;

function assertOrganization(organizationId: string, actor: BGActor) {
  if (organizationId !== actor.organizationId && actor.role !== "Super Admin")
    throw new Error("You cannot act on another organization’s Bank Guarantee.");
}

function notify(
  transaction: Transaction,
  actor: BGActor,
  input: {
    title: string;
    message: string;
    targetRoles: string[];
    pageUrl: string;
    severity?: "INFO" | "WARNING" | "CRITICAL";
    recordId?: string;
  },
) {
  transaction.set(doc(collection(db, BG_COLLECTIONS.notifications)), {
    organizationId: actor.organizationId,
    module: BG_PERMISSION_MODULE,
    type: "BANK_GUARANTEE",
    ...input,
    channels: ["IN_APP", "DASHBOARD"],
    read: false,
    status: "ACTIVE",
    createdBy: actor.userId,
    createdAt: now(),
  });
}

function audit(
  transaction: Transaction,
  actor: BGActor,
  input: {
    recordType: string;
    recordId: string;
    bgId?: string;
    requestId?: string;
    action: string;
    summary: string;
    previousValue?: unknown;
    newValue?: unknown;
    reason?: string;
    page?: string;
  },
) {
  const reference = doc(collection(db, BG_COLLECTIONS.audit));
  transaction.set(reference, {
    organizationId: actor.organizationId,
    module: BG_PERMISSION_MODULE,
    ...input,
    userId: actor.userId,
    userName: actor.userName,
    userRole: actor.role || "",
    createdAt: now(),
  });
}

function approval(
  transaction: Transaction,
  actor: BGActor,
  input: {
    requestId?: string;
    bgId?: string;
    recordType: string;
    recordId: string;
    amount: number;
    requiredRole: string;
    stage: string;
  },
) {
  const reference = doc(collection(db, BG_COLLECTIONS.approvals));
  transaction.set(reference, {
    organizationId: actor.organizationId,
    module: BG_PERMISSION_MODULE,
    ...input,
    requestedBy: actor.userId,
    requestedByName: actor.userName,
    requestedAt: now(),
    status: "PENDING",
  });
  return reference.id;
}

function validateRequest(input: BGRequestInput) {
  if (!input.projectId || !input.beneficiaryId || !input.preferredBankId)
    throw new Error("Project, beneficiary, and preferred bank are required.");
  if (input.requestedAmount <= 0)
    throw new Error("Requested BG amount must be greater than zero.");
  const requirement =
    input.contractValue > 0 && input.bgPercentage > 0
      ? (input.contractValue * input.bgPercentage) / 100
      : 0;
  if (
    requirement > 0 &&
    input.requestedAmount > requirement - Number(input.existingBgAmount || 0)
  )
    throw new Error(
      "Requested BG amount exceeds the balance contractual BG requirement.",
    );
  const start = dateValue(input.proposedStartDate, "Start date").toMillis();
  const expiry = dateValue(input.proposedExpiryDate, "Expiry date").toMillis();
  const claim = dateValue(
    input.proposedClaimExpiryDate,
    "Claim expiry date",
  ).toMillis();
  if (expiry <= start)
    throw new Error("Expiry date must be after the BG start date.");
  if (claim < expiry)
    throw new Error("Claim expiry date cannot be before BG expiry.");
  const contractualEndDates = [
    input.contractCompletionDate,
    input.defectLiabilityEndDate,
    input.warrantyEndDate,
  ]
    .filter(Boolean)
    .map((value) => dateValue(String(value), "Contractual end date").toMillis());
  if (
    contractualEndDates.length > 0 &&
    expiry < Math.max(...contractualEndDates)
  )
    throw new Error(
      "BG expiry must cover the contract, warranty, or defect-liability requirement.",
    );
  const calculatedClaim = expiry + Number(input.claimPeriodDays || 0) * 86400000;
  if (
    input.claimPeriodType === "DAYS" &&
    Math.abs(claim - calculatedClaim) > 86400000 &&
    !input.claimDateOverrideReason?.trim()
  )
    throw new Error("A reason is required for a manual claim-date override.");
  if (input.currency !== "INR" && input.exchangeRate <= 0)
    throw new Error("Exchange rate is required for a foreign-currency BG.");
}

export async function createBGRequest(input: BGRequestInput, actor: BGActor) {
  validateRequest(input);
  const fy = financialYearForBgDate(new Date());
  const counterId = keyValue(`${actor.organizationId}-${fy}`);
  return runTransaction(db, async (transaction) => {
    const counterRef = doc(db, BG_COLLECTIONS.counters, counterId);
    const counter = await transaction.get(counterRef);
    const sequence = Number(counter.data()?.nextSequence || 1);
    const referenceNumber = `BG/${orgCode(actor.organizationName || actor.organizationId)}/${fy}/${String(sequence).padStart(5, "0")}`;
    const requestRef = doc(collection(db, BG_COLLECTIONS.requests));
    const requiredBgAmount = roundBg(
      (input.contractValue * input.bgPercentage) / 100,
    );
    const existingBgAmount = roundBg(input.existingBgAmount || 0);
    const payload: Omit<BGRequest, "id"> = {
      organizationId: actor.organizationId,
      organizationName: actor.organizationName || "",
      referenceNumber,
      requestDate: now(),
      requestedBy: actor.userId,
      requestedByName: actor.userName,
      departmentId: input.departmentId || "",
      departmentName: input.departmentName || "",
      projectId: input.projectId,
      projectName: input.projectName,
      beneficiaryId: input.beneficiaryId,
      beneficiaryName: input.beneficiaryName,
      beneficiaryAddress: input.beneficiaryAddress || "",
      beneficiaryEmail: input.beneficiaryEmail || "",
      beneficiaryContactPerson: input.beneficiaryContactPerson || "",
      beneficiaryDepartment: input.beneficiaryDepartment || "",
      beneficiaryClientCode: input.beneficiaryClientCode || "",
      beneficiaryBgFormat: input.beneficiaryBgFormat || "",
      contractId: input.contractId || "",
      contractReference: input.contractReference || "",
      tenderNumber: input.tenderNumber || "",
      contractNumber: input.contractNumber || "",
      workOrderNumber: input.workOrderNumber || "",
      contractDate: optionalDate(input.contractDate),
      contractCompletionDate: optionalDate(input.contractCompletionDate),
      defectLiabilityEndDate: optionalDate(input.defectLiabilityEndDate),
      warrantyEndDate: optionalDate(input.warrantyEndDate),
      clientBgFormat: input.clientBgFormat || "",
      contractValue: roundBg(input.contractValue),
      bgPercentage: Number(input.bgPercentage || 0),
      requiredBgAmount,
      existingBgAmount,
      balanceBgRequirement: Math.max(
        0,
        roundBg(requiredBgAmount - existingBgAmount - input.requestedAmount),
      ),
      purpose: input.purpose,
      description: input.description || "",
      currency: input.currency,
      exchangeRate: Number(input.exchangeRate || 1),
      requestedAmount: roundBg(input.requestedAmount),
      baseCurrencyAmount: roundBg(
        input.requestedAmount * Number(input.exchangeRate || 1),
      ),
      requiredIssueDate: dateValue(
        input.requiredIssueDate,
        "Required issue date",
      ),
      proposedStartDate: dateValue(input.proposedStartDate, "Start date"),
      proposedExpiryDate: dateValue(input.proposedExpiryDate, "Expiry date"),
      proposedClaimExpiryDate: dateValue(
        input.proposedClaimExpiryDate,
        "Claim expiry date",
      ),
      claimPeriodDays: Number(input.claimPeriodDays || 0),
      claimPeriodType: input.claimPeriodType || "DAYS",
      claimDateOverrideReason: input.claimDateOverrideReason || "",
      autoExtensionClause: input.autoExtensionClause,
      preferredBankId: input.preferredBankId,
      preferredBankName: input.preferredBankName,
      bankLimitId: input.bankLimitId || "",
      preferredBranchName: input.preferredBranchName || "",
      marginType: input.marginType,
      marginPercentage: Number(input.marginPercentage || 0),
      requiredMarginAmount: calculateBgMargin(
        input.requestedAmount,
        input.marginPercentage,
      ),
      fdMarginAmount: roundBg(input.fdMarginAmount || 0),
      cashMarginAmount: roundBg(input.cashMarginAmount || 0),
      otherCollateralAmount: roundBg(input.otherCollateralAmount || 0),
      estimatedCommission: roundBg(input.estimatedCommission || 0),
      estimatedGst: roundBg(input.estimatedGst || 0),
      estimatedOtherCharges: roundBg(input.estimatedOtherCharges || 0),
      debitAccountId: input.debitAccountId || "",
      status: "DRAFT",
      approvalStatus: "DRAFT",
      workflowStage: "DRAFT",
      remarks: input.remarks || "",
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
      isDeleted: false,
    };
    transaction.set(requestRef, payload);
    transaction.set(
      counterRef,
      {
        organizationId: actor.organizationId,
        financialYear: fy,
        nextSequence: sequence + 1,
        updatedAt: now(),
      },
      { merge: true },
    );
    audit(transaction, actor, {
      recordType: "BG_REQUEST",
      recordId: requestRef.id,
      requestId: requestRef.id,
      action: "BG_REQUEST_CREATED",
      summary: `${referenceNumber} created as draft`,
      newValue: {
        amount: payload.requestedAmount,
        beneficiary: payload.beneficiaryName,
      },
      page: `/bank-guarantee/${requestRef.id}`,
    });
    return { id: requestRef.id, referenceNumber };
  });
}

export async function submitBGRequest(requestId: string, actor: BGActor) {
  const [settings, documentSnapshot] = await Promise.all([
    loadBGSettings(actor.organizationId),
    getDocs(
      query(
        collection(db, BG_COLLECTIONS.documents),
        where("requestId", "==", requestId),
      ),
    ),
  ]);
  const missingDocuments = missingBGDocumentTypes(
    settings.mandatoryRequestDocuments,
    documentSnapshot.docs.map((item) => item.data()),
  );
  if (missingDocuments.length)
    throw new Error(
      `Upload required request documents: ${missingDocuments.join(", ")}.`,
    );
  return runTransaction(db, async (transaction) => {
    const ref = doc(db, BG_COLLECTIONS.requests, requestId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("BG request was not found.");
    const request = requestFrom(snapshot.data(), snapshot.id);
    assertOrganization(request.organizationId, actor);
    if (!["DRAFT", "RETURNED", "REJECTED"].includes(request.status))
      throw new Error("Only a draft or returned request can be submitted.");
    const approvalId = approval(transaction, actor, {
      requestId,
      recordType: "BG_REQUEST",
      recordId: requestId,
      amount: request.requestedAmount,
      requiredRole: "Project User",
      stage: "PROJECT_VERIFICATION",
    });
    transaction.update(ref, {
      status: "PENDING_PROJECT_APPROVAL",
      approvalStatus: "PENDING",
      workflowStage: "PROJECT_VERIFICATION",
      approvalId,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "BG_REQUEST",
      recordId: requestId,
      requestId,
      action: "BG_REQUEST_SUBMITTED",
      summary: `${request.referenceNumber} submitted`,
      previousValue: { status: request.status },
      newValue: { status: "PENDING_PROJECT_APPROVAL" },
      page: "/bank-guarantee/approvals",
    });
    notify(transaction, actor, {
      title: "BG request pending project verification",
      message: `${request.referenceNumber} is ready for project verification.`,
      targetRoles: ["Project User", "Project Head"],
      pageUrl: "/bank-guarantee/approvals",
      recordId: requestId,
    });
  });
}

export async function decideBGRequest(
  requestId: string,
  action: "APPROVE" | "REJECT" | "RETURN" | "ON_HOLD",
  comments: string,
  actor: BGActor,
) {
  if (action !== "APPROVE" && !comments.trim())
    throw new Error("Decision remarks are required.");
  const settings = await loadBGSettings(actor.organizationId);
  return runTransaction(db, async (transaction) => {
    const requestRef = doc(db, BG_COLLECTIONS.requests, requestId);
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists()) throw new Error("BG request was not found.");
    const request = requestFrom(snapshot.data(), snapshot.id);
    assertOrganization(request.organizationId, actor);
    if (request.createdBy === actor.userId && actor.role !== "Super Admin")
      throw new Error("You cannot approve your own BG request.");
    if (!request.status.startsWith("PENDING_"))
      throw new Error("This BG request is not pending a decision.");
    const limitRef =
      request.bankLimitId && action === "APPROVE"
        ? doc(db, BG_COLLECTIONS.bankLimits, request.bankLimitId)
        : null;
    const limitSnapshot = limitRef ? await transaction.get(limitRef) : null;
    if (request.approvalId)
      transaction.update(
        doc(db, BG_COLLECTIONS.approvals, request.approvalId),
        {
          status:
            action === "ON_HOLD"
              ? "ON_HOLD"
              : action === "RETURN"
                ? "RETURNED"
                : action === "REJECT"
                  ? "REJECTED"
                  : "APPROVED",
          decidedBy: actor.userId,
          decidedByName: actor.userName,
          decidedAt: now(),
          comments,
        },
      );
    if (action !== "APPROVE") {
      const status: BGRequestStatus =
        action === "REJECT"
          ? "REJECTED"
          : action === "RETURN"
            ? "RETURNED"
            : request.status;
      transaction.update(requestRef, {
        status,
        approvalStatus: action === "REJECT" ? "REJECTED" : "RETURNED",
        workflowStage: action === "ON_HOLD" ? "ON_HOLD" : "DRAFT",
        approvalComments: comments,
        updatedAt: now(),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
      });
      audit(transaction, actor, {
        recordType: "BG_REQUEST",
        recordId: requestId,
        requestId,
        action: `BG_REQUEST_${action}`,
        summary: `${request.referenceNumber}: ${action}`,
        reason: comments,
        page: "/bank-guarantee/approvals",
      });
      return status;
    }
    let status: BGRequestStatus = "APPROVED";
    let stage = "APPROVED_FOR_ISSUANCE";
    let role = "";
    if (request.status === "PENDING_PROJECT_APPROVAL") {
      status = "PENDING_COMMERCIAL_APPROVAL";
      stage = "COMMERCIAL_VERIFICATION";
      role = "Commercial User";
    } else if (request.status === "PENDING_COMMERCIAL_APPROVAL") {
      status = "PENDING_FINANCE_APPROVAL";
      stage = "FINANCE_VERIFICATION";
      role = "Finance Manager";
    } else if (request.status === "PENDING_FINANCE_APPROVAL") {
      const threshold = [...settings.approvalThresholds]
        .sort((a, b) => a.amount - b.amount)
        .find((item) => request.requestedAmount <= item.amount);
      const exceptionRole =
        request.currency !== settings.baseCurrency || request.marginType === "NONE"
          ? "Director Finance"
          : "";
      const configuredRole = threshold?.role || "Managing Director";
      if (
        exceptionRole ||
        !["Finance Executive", "Finance Manager"].includes(configuredRole)
      ) {
        status = "PENDING_DIRECTOR_APPROVAL";
        stage = "DIRECTOR_APPROVAL";
        role = exceptionRole || configuredRole;
      }
    }
    if (status === "APPROVED" && limitRef && limitSnapshot?.exists()) {
      const limit = limitSnapshot.data();
      const available =
        Number(limit.sanctionedAmount || 0) +
        Number(limit.temporaryLimit || 0) -
        Number(limit.utilizedAmount || 0) -
        Number(limit.reservedAmount || 0);
      if (available < request.requestedAmount && !limit.overrideApproved)
        throw new Error(`Available bank limit is only ${roundBg(available)}.`);
    }
    const nextApprovalId =
      status === "APPROVED"
        ? ""
        : approval(transaction, actor, {
            requestId,
            recordType: "BG_REQUEST",
            recordId: requestId,
            amount: request.requestedAmount,
            requiredRole: role,
            stage,
          });
    let reservationId = "";
    if (status === "APPROVED" && limitRef && limitSnapshot?.exists()) {
      const reservationRef = doc(
        collection(db, BG_COLLECTIONS.limitReservations),
      );
      reservationId = reservationRef.id;
      const expiry = new Date();
      expiry.setDate(
        expiry.getDate() + Math.max(1, settings.reservationExpiryDays),
      );
      transaction.set(reservationRef, {
        organizationId: actor.organizationId,
        bankLimitId: request.bankLimitId,
        bankId: request.preferredBankId,
        requestId,
        instrumentType: "BG",
        amount: request.requestedAmount,
        reservedAt: now(),
        expiryDate: Timestamp.fromDate(expiry),
        status: "ACTIVE",
        createdBy: actor.userId,
        createdByName: actor.userName,
      });
      const limit = limitSnapshot.data();
      transaction.update(limitRef, {
        reservedAmount: roundBg(
          Number(limit.reservedAmount || 0) + request.requestedAmount,
        ),
        availableAmount: Math.max(
          0,
          roundBg(
            Number(limit.sanctionedAmount || 0) +
              Number(limit.temporaryLimit || 0) -
              Number(limit.utilizedAmount || 0) -
              Number(limit.reservedAmount || 0) -
              request.requestedAmount,
          ),
        ),
        updatedAt: now(),
        updatedBy: actor.userId,
      });
    }
    transaction.update(requestRef, {
      status,
      approvalStatus: status === "APPROVED" ? "APPROVED" : "PENDING",
      workflowStage: stage,
      approvalId: nextApprovalId,
      limitReservationId: reservationId,
      approvedBy:
        status === "APPROVED" ? actor.userId : request.approvedBy || "",
      approvedByName:
        status === "APPROVED" ? actor.userName : request.approvedByName || "",
      approvedAt: status === "APPROVED" ? now() : request.approvedAt || null,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "BG_REQUEST",
      recordId: requestId,
      requestId,
      action:
        status === "APPROVED"
          ? "BG_REQUEST_APPROVED"
          : "BG_REQUEST_STAGE_APPROVED",
      summary: `${request.referenceNumber} advanced to ${status}`,
      reason: comments,
      page: "/bank-guarantee/approvals",
    });
    notify(transaction, actor, {
      title:
        status === "APPROVED"
          ? "BG request approved for issuance"
          : `BG request pending ${role}`,
      message: `${request.referenceNumber} advanced to ${status}.`,
      targetRoles:
        status === "APPROVED" ? ["Finance Executive", "Finance Manager"] : [role],
      pageUrl:
        status === "APPROVED"
          ? `/bank-guarantee/${requestId}/issue`
          : "/bank-guarantee/approvals",
      recordId: requestId,
    });
    return status;
  });
}

export async function cancelBGRequest(
  requestId: string,
  reason: string,
  actor: BGActor,
) {
  if (!reason.trim()) throw new Error("Cancellation reason is required.");
  return runTransaction(db, async (transaction) => {
    const ref = doc(db, BG_COLLECTIONS.requests, requestId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("BG request was not found.");
    const request = requestFrom(snapshot.data(), snapshot.id);
    assertOrganization(request.organizationId, actor);
    if (request.status === "ISSUED")
      throw new Error("An issued BG must use the cancellation workflow.");
    transaction.update(ref, {
      status: "CANCELLED",
      approvalStatus: "REJECTED",
      cancellationReason: reason,
      cancelledBy: actor.userId,
      cancelledAt: now(),
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "BG_REQUEST",
      recordId: requestId,
      requestId,
      action: "BG_REQUEST_CANCELLED",
      summary: `${request.referenceNumber} cancelled`,
      reason,
      page: `/bank-guarantee/${requestId}`,
    });
  });
}

export async function reserveBGFdMargin(
  input: Omit<AssignmentInstrumentInput, "instrumentType" | "reserveOnly"> & {
    requestId: string;
  },
  actor: BGActor,
) {
  return createFdAssignments(
    {
      ...input,
      instrumentType: "BG",
      instrumentId: input.requestId,
      reserveOnly: true,
    },
    actor,
  );
}

export async function issueBankGuarantee(
  input: BGIssuanceInput,
  actor: BGActor,
) {
  const [reservationsSnap, settings, documentSnapshot] = await Promise.all([
    getDocs(
      query(
        collection(db, FD_COLLECTIONS.assignments),
        where("instrumentId", "==", input.requestId),
      ),
    ),
    loadBGSettings(actor.organizationId),
    getDocs(
      query(
        collection(db, BG_COLLECTIONS.documents),
        where("requestId", "==", input.requestId),
      ),
    ),
  ]);
  const requestDocuments = documentSnapshot.docs.filter(
    (item) =>
      item.data().organizationId === actor.organizationId &&
      item.data().status !== "ARCHIVED",
  );
  const missingDocuments = missingBGDocumentTypes(
    settings.mandatoryIssuanceDocuments,
    requestDocuments.map((item) => item.data()),
  );
  if (missingDocuments.length)
    throw new Error(
      `Upload required issuance documents: ${missingDocuments.join(", ")}.`,
    );
  const reservations = reservationsSnap.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as FDAssignment)
    .filter((item) =>
      ["RESERVED", "PENDING_APPROVAL", "ACTIVE", "PARTIALLY_RELEASED"].includes(
        item.status,
      ),
    );
  return runTransaction(db, async (transaction) => {
    const requestRef = doc(db, BG_COLLECTIONS.requests, input.requestId);
    const uniqueRef = doc(
      db,
      BG_COLLECTIONS.uniqueKeys,
      keyValue(`${actor.organizationId}-${input.bankId}-${input.bankBgNumber}`),
    );
    const bgRef = doc(collection(db, BG_COLLECTIONS.guarantees));
    const limitRef = input.bankLimitId
      ? doc(db, BG_COLLECTIONS.bankLimits, input.bankLimitId)
      : null;
    const assignmentRefs = reservations.map((item) =>
      doc(db, FD_COLLECTIONS.assignments, item.id),
    );
    const fdRefs = Array.from(
      new Map(
        reservations.map((item) => [
          item.fdId,
          doc(db, FD_COLLECTIONS.deposits, item.fdId),
        ]),
      ).values(),
    );
    const [requestSnap, duplicate, limitSnap, assignmentSnaps, fdSnaps] =
      await Promise.all([
        transaction.get(requestRef),
        transaction.get(uniqueRef),
        limitRef ? transaction.get(limitRef) : Promise.resolve(null),
        Promise.all(assignmentRefs.map((ref) => transaction.get(ref))),
        Promise.all(fdRefs.map((ref) => transaction.get(ref))),
      ]);
    if (!requestSnap.exists())
      throw new Error("Approved BG request was not found.");
    if (duplicate.exists())
      throw new Error("Bank BG number already exists for this bank.");
    const request = requestFrom(requestSnap.data(), requestSnap.id);
    assertOrganization(request.organizationId, actor);
    if (request.status !== "APPROVED")
      throw new Error("Only a fully approved BG request can be issued.");
    const issueDate = dateValue(input.issueDate, "Issue date"),
      startDate = dateValue(input.startDate, "Start date"),
      expiry = dateValue(input.expiryDate, "Expiry date"),
      claimExpiry = dateValue(input.claimExpiryDate, "Claim expiry date");
    if (
      expiry.toMillis() <= issueDate.toMillis() ||
      expiry.toMillis() <= startDate.toMillis()
    )
      throw new Error("Expiry must be after issue and start dates.");
    if (claimExpiry.toMillis() < expiry.toMillis())
      throw new Error("Claim expiry cannot be before BG expiry.");
    if (input.issuedAmount <= 0 || input.issuedAmount > request.requestedAmount)
      throw new Error("Issued amount cannot exceed the approved amount.");
    const requiredMargin = calculateBgMargin(
      input.issuedAmount,
      input.marginPercentage,
    );
    const assignedFd = reservations.reduce(
      (sum, item) => sum + assignmentOutstanding(item),
      0,
    );
    if (
      ["FD", "COMBINED"].includes(request.marginType) &&
      input.fdMarginAmount > assignedFd
    )
      throw new Error(
        `FD margin shortfall. Reserved ${roundBg(assignedFd)}; required ${input.fdMarginAmount}.`,
      );
    if (
      settings.requireMarginBeforeIssuance &&
      request.marginType !== "NONE" &&
      input.fdMarginAmount +
        input.cashMarginAmount +
        input.otherCollateralAmount <
        requiredMargin
    )
      throw new Error(
        `Margin shortfall of ${roundBg(requiredMargin - input.fdMarginAmount - input.cashMarginAmount - input.otherCollateralAmount)}.`,
      );
    if (limitRef && limitSnap?.exists()) {
      const limit = limitSnap.data();
      const available =
        Number(limit.sanctionedAmount || 0) +
        Number(limit.temporaryLimit || 0) -
        Number(limit.utilizedAmount || 0) -
        Math.max(
          0,
          Number(limit.reservedAmount || 0) - request.requestedAmount,
        );
      if (available < input.issuedAmount && !limit.overrideApproved)
        throw new Error(`Available bank limit is ${roundBg(available)}.`);
    }
    const baseCurrencyAmount = roundBg(
      input.issuedAmount * Number(input.exchangeRate || 1),
    );
    const totalCharges = roundBg(
      input.bankCommission +
        input.gstAmount +
        input.stampDuty +
        input.swiftCharges +
        input.courierCharges +
        input.otherCharges,
    );
    const payload: Omit<BankGuarantee, "id"> = {
      organizationId: actor.organizationId,
      organizationName:
        actor.organizationName || request.organizationName || "",
      requestId: request.id,
      requestReference: request.referenceNumber,
      internalReferenceNumber: request.referenceNumber,
      bankBgNumber: input.bankBgNumber.trim(),
      bankId: input.bankId,
      bankName: input.bankName,
      branchId: input.branchId || "",
      branchName: input.branchName || "",
      bankLimitId: input.bankLimitId || "",
      beneficiaryId: request.beneficiaryId,
      beneficiaryName: request.beneficiaryName,
      projectId: request.projectId,
      projectName: request.projectName,
      contractId: request.contractId || "",
      contractReference: request.contractReference || "",
      purpose: request.purpose,
      currency: input.currency,
      exchangeRate: Number(input.exchangeRate || 1),
      originalAmount: roundBg(input.issuedAmount),
      currentAmount: roundBg(input.issuedAmount),
      baseCurrencyAmount,
      issueDate,
      effectiveDate: optionalDate(input.effectiveDate),
      startDate,
      originalExpiryDate: expiry,
      currentExpiryDate: expiry,
      originalClaimExpiryDate: claimExpiry,
      currentClaimExpiryDate: claimExpiry,
      claimPeriodDays: request.claimPeriodDays,
      autoExtensionClause: request.autoExtensionClause,
      marginPercentage: Number(input.marginPercentage || 0),
      requiredMarginAmount: requiredMargin,
      fdMarginAmount: roundBg(input.fdMarginAmount),
      cashMarginAmount: roundBg(input.cashMarginAmount),
      otherCollateralAmount: roundBg(input.otherCollateralAmount),
      openingCommission: roundBg(input.bankCommission),
      extensionCommission: 0,
      amendmentCommission: 0,
      internalCommission: roundBg(
        request.estimatedCommission || input.bankCommission,
      ),
      bankCommission: roundBg(input.bankCommission),
      commissionDifference: roundBg(
        input.bankCommission -
          Number(request.estimatedCommission || input.bankCommission),
      ),
      gstAmount: roundBg(input.gstAmount),
      otherCharges: roundBg(
        input.stampDuty +
          input.swiftCharges +
          input.courierCharges +
          input.otherCharges,
      ),
      totalCharges,
      originalReceived: input.originalReceived,
      originalReceivedDate: optionalDate(input.originalReceivedDate),
      numberOfOriginals: Number(input.numberOfOriginals || 0),
      numberOfCopies: Number(input.numberOfCopies || 0),
      originalDispatched: !input.dispatchRequired,
      beneficiaryAcknowledged: false,
      originalReturned: false,
      currentCustodian: input.originalReceived ? "Finance" : "Bank",
      invocationAmount: 0,
      marginReleasedAmount: 0,
      status: "ACTIVE",
      extensionDecision: "NO_ACTION_YET",
      bankCancellationConfirmed: false,
      closureDate: null,
      documentComplete: missingDocuments.length === 0,
      debitAccountId: input.debitAccountId || "",
      remarks: input.remarks || "",
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
      isDeleted: false,
    };
    transaction.set(bgRef, payload);
    transaction.set(uniqueRef, {
      organizationId: actor.organizationId,
      bankId: input.bankId,
      bankBgNumber: input.bankBgNumber.trim(),
      bgId: bgRef.id,
      createdAt: now(),
    });
    transaction.update(requestRef, {
      status: "ISSUED",
      workflowStage: "ISSUED",
      bgId: bgRef.id,
      bankBgNumber: input.bankBgNumber.trim(),
      issuedAt: now(),
      updatedAt: now(),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
    });
    requestDocuments.forEach((documentRow) =>
      transaction.update(documentRow.ref, {
        bgId: bgRef.id,
        updatedAt: now(),
      }),
    );
    if (request.limitReservationId)
      transaction.update(
        doc(
          db,
          BG_COLLECTIONS.limitReservations,
          String(request.limitReservationId),
        ),
        {
          status: "CONVERTED",
          bgId: bgRef.id,
          convertedAt: now(),
          convertedBy: actor.userId,
        },
      );
    if (limitRef && limitSnap?.exists()) {
      const limit = limitSnap.data();
      const utilized = roundBg(
          Number(limit.utilizedAmount || 0) + input.issuedAmount,
        ),
        bgUtilized = roundBg(
          Number(limit.bgUtilizedAmount || 0) + input.issuedAmount,
        ),
        reserved = Math.max(
          0,
          roundBg(Number(limit.reservedAmount || 0) - request.requestedAmount),
        );
      transaction.update(limitRef, {
        utilizedAmount: utilized,
        bgUtilizedAmount: bgUtilized,
        reservedAmount: reserved,
        availableAmount: Math.max(
          0,
          roundBg(
            Number(limit.sanctionedAmount || 0) +
              Number(limit.temporaryLimit || 0) -
              utilized -
              reserved,
          ),
        ),
        updatedAt: now(),
        updatedBy: actor.userId,
      });
    }
    const fdById = new Map(
      fdSnaps
        .filter((item) => item.exists())
        .map((item) => [
          item.id,
          { id: item.id, ...item.data() } as FixedDeposit,
        ]),
    );
    assignmentSnaps.forEach((assignmentSnap, index) => {
      if (!assignmentSnap.exists()) return;
      const assignment = {
        id: assignmentSnap.id,
        ...assignmentSnap.data(),
      } as FDAssignment;
      const fd = fdById.get(assignment.fdId);
      if (!fd)
        throw new Error(`Linked FD ${assignment.fdNumber} no longer exists.`);
      const amount = assignmentOutstanding(assignment);
      const wasReserved = ["RESERVED", "PENDING_APPROVAL"].includes(
        assignment.status,
      );
      const reserved = Math.max(
          0,
          roundBg(Number(fd.reservedAmount || 0) - (wasReserved ? amount : 0)),
        ),
        bgUsed = roundBg(
          Number(fd.bgUtilizedAmount || 0) + (wasReserved ? amount : 0),
        ),
        available = calculateFdAvailable(
          fd.eligibleValue,
          bgUsed,
          fd.lcUtilizedAmount,
          reserved,
        );
      const computed = {
        ...fd,
        reservedAmount: reserved,
        bgUtilizedAmount: bgUsed,
        availableAmount: available,
        totalUtilizedAmount: roundBg(bgUsed + fd.lcUtilizedAmount + reserved),
      };
      transaction.update(assignmentRefs[index], {
        instrumentId: bgRef.id,
        instrumentNumber: input.bankBgNumber.trim(),
        status: "ACTIVE",
        activeAmount: amount,
        approvalId: "",
        updatedBy: actor.userId,
        updatedByName: actor.userName,
        updatedAt: now(),
      });
      transaction.update(doc(db, FD_COLLECTIONS.deposits, fd.id), {
        reservedAmount: reserved,
        bgUtilizedAmount: bgUsed,
        availableAmount: available,
        totalUtilizedAmount: computed.totalUtilizedAmount,
        status: deriveFdStatus(computed),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
        updatedAt: now(),
      });
    });
    if (input.cashMarginAmount > 0)
      transaction.set(doc(collection(db, BG_COLLECTIONS.cashMargins)), {
        organizationId: actor.organizationId,
        bgId: bgRef.id,
        bgNumber: input.bankBgNumber.trim(),
        bankId: input.bankId,
        bankName: input.bankName,
        amount: roundBg(input.cashMarginAmount),
        blockDate: issueDate,
        releaseDate: null,
        status: "BLOCKED",
        createdBy: actor.userId,
        createdByName: actor.userName,
        createdAt: now(),
      });
    const commissionRef = doc(collection(db, BG_COLLECTIONS.commissions));
    transaction.set(commissionRef, {
      organizationId: actor.organizationId,
      bgId: bgRef.id,
      bgNumber: input.bankBgNumber.trim(),
      bankId: input.bankId,
      bankName: input.bankName,
      commissionType: "OPENING",
      calculationFromDate: issueDate,
      calculationToDate: expiry,
      calculationBasis: "MANUAL",
      bgAmount: input.issuedAmount,
      commissionRate: 0,
      calculatedCommission: roundBg(
        request.estimatedCommission || input.bankCommission,
      ),
      bankChargedCommission: roundBg(input.bankCommission),
      gstAmount: roundBg(input.gstAmount),
      otherCharges: roundBg(
        input.stampDuty +
          input.swiftCharges +
          input.courierCharges +
          input.otherCharges,
      ),
      differenceAmount: roundBg(
        input.bankCommission -
          Number(request.estimatedCommission || input.bankCommission),
      ),
      reconciliationStatus:
        input.bankCommission ===
        Number(request.estimatedCommission || input.bankCommission)
          ? "MATCHED"
          : input.bankCommission >
              Number(request.estimatedCommission || input.bankCommission)
            ? "OVERCHARGED"
            : "UNDERCHARGED",
      createdAt: now(),
      createdBy: actor.userId,
    });
    audit(transaction, actor, {
      recordType: "BG",
      recordId: bgRef.id,
      bgId: bgRef.id,
      requestId: request.id,
      action: "BG_ISSUED",
      summary: `${input.bankBgNumber} issued for ${request.beneficiaryName}`,
      newValue: {
        amount: input.issuedAmount,
        expiry: input.expiryDate,
        claimExpiry: input.claimExpiryDate,
      },
      page: `/bank-guarantee/${bgRef.id}`,
    });
    notify(transaction, actor, {
      title: "Bank Guarantee issued",
      message: `${input.bankBgNumber} was issued for ${request.beneficiaryName}.`,
      targetRoles: [
        "Finance Manager",
        "Project User",
        "Commercial User",
      ],
      pageUrl: `/bank-guarantee/${bgRef.id}`,
      recordId: bgRef.id,
    });
    return bgRef.id;
  });
}

export async function createBGExtension(
  input: {
    bgId: string;
    proposedExpiryDate: string;
    proposedClaimExpiryDate: string;
    reason: string;
    clientRequestReference?: string;
    additionalMarginAmount: number;
    additionalCommission: number;
    gstAmount: number;
    otherCharges: number;
  },
  actor: BGActor,
) {
  return runTransaction(db, async (transaction) => {
    const bgRef = doc(db, BG_COLLECTIONS.guarantees, input.bgId);
    const snapshot = await transaction.get(bgRef);
    if (!snapshot.exists()) throw new Error("Bank Guarantee was not found.");
    const bg = guaranteeFrom(snapshot.data(), snapshot.id);
    assertOrganization(bg.organizationId, actor);
    const expiry = dateValue(input.proposedExpiryDate, "Proposed expiry date"),
      claim = dateValue(input.proposedClaimExpiryDate, "Proposed claim expiry");
    if (expiry.toMillis() <= bg.currentExpiryDate.toMillis())
      throw new Error("New expiry must be later than the current expiry.");
    if (claim.toMillis() < expiry.toMillis())
      throw new Error("Claim expiry cannot be before the new expiry.");
    const extensionRef = doc(collection(db, BG_COLLECTIONS.extensions));
    const approvalId = approval(transaction, actor, {
      bgId: bg.id,
      recordType: "BG_EXTENSION",
      recordId: extensionRef.id,
      amount: bg.currentAmount,
      requiredRole: "Finance Manager",
      stage: "EXTENSION_APPROVAL",
    });
    transaction.set(extensionRef, {
      organizationId: actor.organizationId,
      bgId: bg.id,
      bgNumber: bg.bankBgNumber,
      extensionReference: `${bg.internalReferenceNumber}/EXT/${Date.now().toString().slice(-6)}`,
      requestDate: now(),
      previousExpiryDate: bg.currentExpiryDate,
      proposedExpiryDate: expiry,
      approvedExpiryDate: null,
      previousClaimExpiryDate: bg.currentClaimExpiryDate,
      proposedClaimExpiryDate: claim,
      approvedClaimExpiryDate: null,
      reason: input.reason,
      clientRequestReference: input.clientRequestReference || "",
      additionalMarginAmount: roundBg(input.additionalMarginAmount),
      additionalCommission: roundBg(input.additionalCommission),
      gstAmount: roundBg(input.gstAmount),
      otherCharges: roundBg(input.otherCharges),
      beneficiaryAcknowledged: false,
      status: "PENDING_APPROVAL",
      approvalId,
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
    });
    transaction.update(bgRef, {
      status: "EXTENSION_PENDING",
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "BG_EXTENSION",
      recordId: extensionRef.id,
      bgId: bg.id,
      action: "BG_EXTENSION_REQUESTED",
      summary: `Extension requested for ${bg.bankBgNumber}`,
      newValue: {
        expiry: input.proposedExpiryDate,
        claimExpiry: input.proposedClaimExpiryDate,
      },
      reason: input.reason,
      page: "/bank-guarantee/extensions",
    });
    return extensionRef.id;
  });
}

export async function completeBGExtension(extensionId: string, actor: BGActor) {
  return runTransaction(db, async (transaction) => {
    const extRef = doc(db, BG_COLLECTIONS.extensions, extensionId);
    const extSnap = await transaction.get(extRef);
    if (!extSnap.exists()) throw new Error("BG extension was not found.");
    const extension = { id: extSnap.id, ...extSnap.data() } as Record<
      string,
      any
    >;
    const bgRef = doc(db, BG_COLLECTIONS.guarantees, String(extension.bgId));
    const bgSnap = await transaction.get(bgRef);
    if (!bgSnap.exists()) throw new Error("Bank Guarantee was not found.");
    const bg = guaranteeFrom(bgSnap.data(), bgSnap.id);
    assertOrganization(bg.organizationId, actor);
    if (
      !["APPROVED", "AMENDMENT_RECEIVED", "ACKNOWLEDGEMENT_PENDING"].includes(
        String(extension.status),
      )
    )
      throw new Error(
        "Extension must be approved and the bank amendment received.",
      );
    const expiry = extension.approvedExpiryDate || extension.proposedExpiryDate,
      claim =
        extension.approvedClaimExpiryDate || extension.proposedClaimExpiryDate;
    transaction.update(bgRef, {
      currentExpiryDate: expiry,
      currentClaimExpiryDate: claim,
      extensionCommission: roundBg(
        bg.extensionCommission + Number(extension.additionalCommission || 0),
      ),
      bankCommission: roundBg(
        bg.bankCommission + Number(extension.additionalCommission || 0),
      ),
      totalCharges: roundBg(
        bg.totalCharges +
          Number(extension.additionalCommission || 0) +
          Number(extension.gstAmount || 0) +
          Number(extension.otherCharges || 0),
      ),
      status: "ACTIVE",
      extensionDecision: "EXTENSION_COMPLETED",
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    transaction.update(extRef, {
      status: "COMPLETED",
      completedBy: actor.userId,
      completedByName: actor.userName,
      completedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "BG_EXTENSION",
      recordId: extensionId,
      bgId: bg.id,
      action: "BG_EXTENSION_COMPLETED",
      summary: `${bg.bankBgNumber} extended`,
      previousValue: { expiry: bg.currentExpiryDate },
      newValue: { expiry, claimExpiry: claim },
      page: `/bank-guarantee/${bg.id}`,
    });
  });
}

export async function createBGInvocation(
  input: {
    bgId: string;
    noticeNumber: string;
    noticeDate: string;
    receivedDate: string;
    claimType: "PARTIAL" | "FULL";
    claimedAmount: number;
    claimReason: string;
    legalReviewRequired: boolean;
    projectResponse?: string;
    commercialResponse?: string;
    legalOpinion?: string;
    financeResponse?: string;
    bankReference?: string;
  },
  actor: BGActor,
) {
  return runTransaction(db, async (transaction) => {
    const bgRef = doc(db, BG_COLLECTIONS.guarantees, input.bgId);
    const snapshot = await transaction.get(bgRef);
    if (!snapshot.exists()) throw new Error("Bank Guarantee was not found.");
    const bg = guaranteeFrom(snapshot.data(), snapshot.id);
    assertOrganization(bg.organizationId, actor);
    const received = dateValue(input.receivedDate, "Notice received date");
    if (received.toMillis() > bg.currentClaimExpiryDate.toMillis())
      throw new Error("Invocation notice is outside the BG claim period.");
    if (input.claimedAmount <= 0 || input.claimedAmount > bg.currentAmount)
      throw new Error("Claimed amount cannot exceed the current BG amount.");
    const ref = doc(collection(db, BG_COLLECTIONS.invocations));
    transaction.set(ref, {
      organizationId: actor.organizationId,
      bgId: bg.id,
      bgNumber: bg.bankBgNumber,
      beneficiaryName: bg.beneficiaryName,
      noticeNumber: input.noticeNumber,
      noticeDate: dateValue(input.noticeDate, "Notice date"),
      receivedDate: received,
      claimType: input.claimType,
      claimedAmount: roundBg(input.claimedAmount),
      claimReason: input.claimReason,
      claimWithinValidity: true,
      legalReviewRequired: input.legalReviewRequired,
      projectResponse: input.projectResponse || "",
      commercialResponse: input.commercialResponse || "",
      legalOpinion: input.legalOpinion || "",
      financeResponse: input.financeResponse || "",
      bankReference: input.bankReference || "",
      settlementAmount: 0,
      settlementDate: null,
      status: "NOTICE_RECEIVED",
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
    });
    transaction.update(bgRef, {
      invocationAmount: roundBg(bg.invocationAmount + input.claimedAmount),
      status: "INVOCATION_NOTICE_RECEIVED",
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "BG_INVOCATION",
      recordId: ref.id,
      bgId: bg.id,
      action: "BG_INVOCATION_RECEIVED",
      summary: `Invocation notice received for ${bg.bankBgNumber}`,
      newValue: {
        claimedAmount: input.claimedAmount,
        noticeNumber: input.noticeNumber,
      },
      reason: input.claimReason,
      page: "/bank-guarantee/invocations",
    });
    return ref.id;
  });
}

export async function requestBGCancellation(
  input: {
    bgId: string;
    reason: string;
    projectCompletionConfirmed: boolean;
    clientReleaseReceived: boolean;
    originalBgReturned: boolean;
    noClaimConfirmationReceived: boolean;
    bankSubmissionDate?: string;
    bankReference?: string;
    fdReleaseAmount: number;
    cashMarginReleaseAmount: number;
    otherCollateralReleaseAmount: number;
    remarks?: string;
  },
  actor: BGActor,
) {
  const invocationSnapshot = await getDocs(
    query(
      collection(db, BG_COLLECTIONS.invocations),
      where("bgId", "==", input.bgId),
    ),
  );
  const openInvocation = invocationSnapshot.docs.some(
    (entry) => !["SETTLED", "CLOSED"].includes(String(entry.data().status)),
  );
  if (openInvocation)
    throw new Error(
      "BG cancellation is blocked while an invocation remains open.",
    );
  return runTransaction(db, async (transaction) => {
    const bgRef = doc(db, BG_COLLECTIONS.guarantees, input.bgId);
    const snapshot = await transaction.get(bgRef);
    if (!snapshot.exists()) throw new Error("Bank Guarantee was not found.");
    const bg = guaranteeFrom(snapshot.data(), snapshot.id);
    assertOrganization(bg.organizationId, actor);
    const cancellationRef = doc(collection(db, BG_COLLECTIONS.cancellations));
    const approvalId = approval(transaction, actor, {
      bgId: bg.id,
      recordType: "BG_CANCELLATION",
      recordId: cancellationRef.id,
      amount: bg.currentAmount,
      requiredRole: "Finance Manager",
      stage: "CANCELLATION_APPROVAL",
    });
    transaction.set(cancellationRef, {
      organizationId: actor.organizationId,
      bgId: bg.id,
      bgNumber: bg.bankBgNumber,
      requestDate: now(),
      reason: input.reason,
      projectCompletionConfirmed: input.projectCompletionConfirmed,
      clientReleaseReceived: input.clientReleaseReceived,
      originalBgReturned: input.originalBgReturned,
      noClaimConfirmationReceived: input.noClaimConfirmationReceived,
      bankSubmissionDate: optionalDate(input.bankSubmissionDate),
      bankReference: input.bankReference || "",
      bankConfirmationDate: null,
      cancellationEffectiveDate: null,
      fdReleaseAmount: roundBg(input.fdReleaseAmount),
      cashMarginReleaseAmount: roundBg(input.cashMarginReleaseAmount),
      otherCollateralReleaseAmount: roundBg(input.otherCollateralReleaseAmount),
      status: "PENDING_APPROVAL",
      approvalId,
      remarks: input.remarks || "",
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
    });
    transaction.update(bgRef, {
      status: "CANCELLATION_REQUESTED",
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "BG_CANCELLATION",
      recordId: cancellationRef.id,
      bgId: bg.id,
      action: "BG_CANCELLATION_REQUESTED",
      summary: `Cancellation requested for ${bg.bankBgNumber}`,
      reason: input.reason,
      page: "/bank-guarantee/cancellations",
    });
    return cancellationRef.id;
  });
}

export async function completeBGCancellation(
  cancellationId: string,
  input: {
    bankConfirmationDate: string;
    cancellationEffectiveDate: string;
    bankReference: string;
    comments?: string;
    authorizedOverride?: boolean;
  },
  actor: BGActor,
) {
  const cancellationSnapshot = await getDoc(
    doc(db, BG_COLLECTIONS.cancellations, cancellationId),
  );
  if (!cancellationSnapshot.exists())
    throw new Error("BG cancellation was not found.");
  const cancellation = {
    id: cancellationSnapshot.id,
    ...cancellationSnapshot.data(),
  } as BGCancellation;
  const [assignmentSnapshot, cashSnapshot, invocationSnapshot] =
    await Promise.all([
      getDocs(
        query(
          collection(db, FD_COLLECTIONS.assignments),
          where("instrumentId", "==", cancellation.bgId),
        ),
      ),
      getDocs(
        query(
          collection(db, BG_COLLECTIONS.cashMargins),
          where("bgId", "==", cancellation.bgId),
        ),
      ),
      getDocs(
        query(
          collection(db, BG_COLLECTIONS.invocations),
          where("bgId", "==", cancellation.bgId),
        ),
      ),
    ]);
  const assignments = assignmentSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as FDAssignment)
    .filter((item) => ACTIVE_ASSIGNMENT_STATUSES.includes(item.status));
  const cashMargins = cashSnapshot.docs.filter(
    (entry) => entry.data().status === "BLOCKED",
  );
  const openInvocation = invocationSnapshot.docs.some(
    (entry) => !["SETTLED", "CLOSED"].includes(String(entry.data().status)),
  );
  return runTransaction(db, async (transaction) => {
    const cancelRef = doc(db, BG_COLLECTIONS.cancellations, cancellationId),
      bgRef = doc(db, BG_COLLECTIONS.guarantees, cancellation.bgId);
    const fdRefs = Array.from(
      new Map(
        assignments.map((item) => [
          item.fdId,
          doc(db, FD_COLLECTIONS.deposits, item.fdId),
        ]),
      ).values(),
    );
    const [cancelCurrent, bgSnap, fdSnaps] = await Promise.all([
      transaction.get(cancelRef),
      transaction.get(bgRef),
      Promise.all(fdRefs.map((ref) => transaction.get(ref))),
    ]);
    if (!cancelCurrent.exists() || !bgSnap.exists())
      throw new Error("BG or cancellation request no longer exists.");
    const bg = guaranteeFrom(bgSnap.data(), bgSnap.id);
    assertOrganization(bg.organizationId, actor);
    const limitRef = bg.bankLimitId
      ? doc(db, BG_COLLECTIONS.bankLimits, bg.bankLimitId)
      : null;
    const limitSnap = limitRef ? await transaction.get(limitRef) : null;
    if (openInvocation)
      throw new Error(
        "Cancellation is blocked while an invocation remains open.",
      );
    if (
      (!cancellation.clientReleaseReceived ||
        !cancellation.originalBgReturned) &&
      !input.authorizedOverride
    )
      throw new Error(
        "Beneficiary release and original BG return are required.",
      );
    if (!input.bankReference.trim() || !input.bankConfirmationDate)
      throw new Error("Bank cancellation confirmation is mandatory.");
    const fdById = new Map(
      fdSnaps
        .filter((item) => item.exists())
        .map((item) => [
          item.id,
          { id: item.id, ...item.data() } as FixedDeposit,
        ]),
    );
    assignments.forEach((assignment) => {
      const fd = fdById.get(assignment.fdId);
      if (!fd) return;
      const amount = assignmentOutstanding(assignment),
        bgUsed = Math.max(0, roundBg(fd.bgUtilizedAmount - amount)),
        available = calculateFdAvailable(
          fd.eligibleValue,
          bgUsed,
          fd.lcUtilizedAmount,
          fd.reservedAmount,
        );
      const computed = {
        ...fd,
        bgUtilizedAmount: bgUsed,
        availableAmount: available,
        totalUtilizedAmount: roundBg(
          bgUsed + fd.lcUtilizedAmount + fd.reservedAmount,
        ),
      };
      transaction.update(doc(db, FD_COLLECTIONS.assignments, assignment.id), {
        status: "RELEASED",
        releasedAmount: roundBg(
          Number(assignment.releasedAmount || 0) + amount,
        ),
        activeAmount: 0,
        actualReleaseDate: dateValue(
          input.cancellationEffectiveDate,
          "Cancellation date",
        ),
        releaseReference: input.bankReference,
        releasedBy: actor.userId,
        releasedByName: actor.userName,
        updatedAt: now(),
      });
      transaction.update(doc(db, FD_COLLECTIONS.deposits, fd.id), {
        bgUtilizedAmount: bgUsed,
        availableAmount: available,
        totalUtilizedAmount: computed.totalUtilizedAmount,
        status: deriveFdStatus(computed),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
        updatedAt: now(),
      });
    });
    cashMargins.forEach((entry) =>
      transaction.update(entry.ref, {
        status: "RELEASED",
        releaseDate: dateValue(
          input.cancellationEffectiveDate,
          "Cancellation date",
        ),
        releaseReference: input.bankReference,
        releasedBy: actor.userId,
        releasedByName: actor.userName,
        updatedAt: now(),
      }),
    );
    if (limitRef && limitSnap?.exists()) {
      const limit = limitSnap.data(),
        utilized = Math.max(
          0,
          roundBg(Number(limit.utilizedAmount || 0) - bg.currentAmount),
        ),
        bgUsed = Math.max(
          0,
          roundBg(Number(limit.bgUtilizedAmount || 0) - bg.currentAmount),
        );
      transaction.update(limitRef, {
        utilizedAmount: utilized,
        bgUtilizedAmount: bgUsed,
        availableAmount: Math.max(
          0,
          roundBg(
            Number(limit.sanctionedAmount || 0) +
              Number(limit.temporaryLimit || 0) -
              utilized -
              Number(limit.reservedAmount || 0),
          ),
        ),
        updatedAt: now(),
        updatedBy: actor.userId,
      });
    }
    transaction.update(bgRef, {
      status: "CLOSED",
      bankCancellationConfirmed: true,
      closureDate: dateValue(
        input.cancellationEffectiveDate,
        "Cancellation date",
      ),
      originalReturned: cancellation.originalBgReturned,
      marginReleasedAmount: roundBg(
        bg.fdMarginAmount + bg.cashMarginAmount + bg.otherCollateralAmount,
      ),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    transaction.update(cancelRef, {
      status: "COMPLETED",
      bankConfirmationDate: dateValue(
        input.bankConfirmationDate,
        "Bank confirmation date",
      ),
      cancellationEffectiveDate: dateValue(
        input.cancellationEffectiveDate,
        "Cancellation date",
      ),
      bankReference: input.bankReference,
      approvedBy: actor.userId,
      approvedByName: actor.userName,
      approvedAt: now(),
      completedAt: now(),
      comments: input.comments || "",
    });
    if (cancellation.approvalId)
      transaction.update(
        doc(db, BG_COLLECTIONS.approvals, cancellation.approvalId),
        {
          status: "APPROVED",
          decidedBy: actor.userId,
          decidedByName: actor.userName,
          decidedAt: now(),
          comments: input.comments || "",
        },
      );
    audit(transaction, actor, {
      recordType: "BG_CANCELLATION",
      recordId: cancellationId,
      bgId: bg.id,
      action: "BG_CLOSED",
      summary: `${bg.bankBgNumber} cancelled, limit and collateral released`,
      previousValue: { status: bg.status },
      newValue: { status: "CLOSED", fdAssignmentsReleased: assignments.length },
      reason: input.comments || cancellation.reason,
      page: `/bank-guarantee/${bg.id}`,
    });
  });
}

export const calculateBGCommission = (
  amount: number,
  rate: number,
  from: string,
  to: string,
  basis: string,
  minimum = 0,
) =>
  calculateCommission(
    amount,
    rate,
    new Date(`${from}T12:00:00`),
    new Date(`${to}T12:00:00`),
    basis,
    minimum,
  );
