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
  calculateAvailableAmount as calculateFdAvailableAmount,
  deriveOperationalStatus as deriveFdOperationalStatus,
  type FDAssignment,
  type FixedDeposit,
} from "@/lib/fixed-deposit";
import {
  createFdAssignments,
  type AssignmentInstrumentInput,
} from "@/lib/fixed-deposit-service";
import {
  LC_COLLECTIONS,
  LC_PERMISSION_MODULE,
  calculateHundiDueDate,
  calculateOutstanding,
  calculateRequiredMargin,
  calculateUnutilized,
  derivePaymentStatus,
  financialYearForLcDate,
  type LCAuditEntry,
  type LCHundi,
  type LCRequest,
  type LetterOfCredit,
} from "@/lib/letter-of-credit";

export type LCActor = {
  userId: string;
  userName: string;
  role?: string;
  organizationId: string;
  organizationName?: string;
};

export type LCRequestInput = {
  departmentId?: string;
  departmentName?: string;
  projectId: string;
  projectName: string;
  vendorId: string;
  vendorName: string;
  vendorCode?: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseOrderAmount: number;
  existingLcAmount?: number;
  contractReference?: string;
  purpose: string;
  materialDescription: string;
  lcType: string;
  currency: string;
  requestedAmount: number;
  requiredOpeningDate: string;
  proposedExpiryDate: string;
  latestShipmentDate?: string;
  sightOrUsance: "SIGHT" | "USANCE";
  usancePeriodDays: number;
  dueDateBasis: string;
  partialShipmentAllowed: boolean;
  transshipmentAllowed: boolean;
  partialDrawingAllowed: boolean;
  tolerancePercentage: number;
  presentationPeriodDays: number;
  incoterm?: string;
  specialConditions?: string;
  preferredBankId: string;
  preferredBankName: string;
  marginType: string;
  marginPercentage: number;
  fdMarginAmount?: number;
  cashMarginAmount?: number;
  otherCollateralAmount?: number;
  estimatedCommission?: number;
  estimatedCharges?: number;
  clientRecoverable: boolean;
  expectedRecoverableAmount?: number;
  remarks?: string;
};

export type LCOpeningInput = {
  requestId: string;
  bankLcNumber: string;
  bankId: string;
  bankName: string;
  branchId?: string;
  branchName?: string;
  bankLimitId?: string;
  openingDate: string;
  effectiveDate?: string;
  openedAmount: number;
  currency: string;
  exchangeRate: number;
  expiryDate: string;
  latestShipmentDate?: string;
  presentationPeriodDays: number;
  usancePeriodDays: number;
  dueDateBasis: string;
  expectedDueDate?: string;
  marginPercentage: number;
  fdMarginAmount: number;
  cashMarginAmount: number;
  otherCollateralAmount: number;
  openingCommission: number;
  swiftCharges: number;
  handlingCharges: number;
  gstAmount: number;
  otherCharges: number;
  debitAccountId?: string;
  originalLcReceived: boolean;
  vendorInformed: boolean;
  vendorCopySentDate?: string;
  remarks?: string;
};

export type LCHundiInput = {
  lcId: string;
  hundiNumber: string;
  receiptDate: string;
  bankReceiptDate?: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  currency: string;
  claimedAmount: number;
  acceptedAmount: number;
  rejectedAmount: number;
  billOfLadingNumber?: string;
  shipmentDate?: string;
  mrrNumber?: string;
  mrrDate?: string;
  usancePeriodDays: number;
  dueDateBasis: string;
  baseDate: string;
  status: LCHundi["status"];
  discrepancyCount?: number;
  remarks?: string;
};

export type LCPaymentInput = {
  lcId: string;
  hundiId?: string;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  paymentType: string;
  debitAccountId: string;
  paymentDate: string;
  transactionReference?: string;
  utrNumber?: string;
  bankCommission: number;
  gstAmount: number;
  otherCharges: number;
  exchangeDifference?: number;
  remarks?: string;
};

const round = (value: number) => Number(Number(value || 0).toFixed(2));
const now = () => Timestamp.now();
const toTimestamp = (value: string, label: string) => {
  const parsed = new Date(`${value}T12:00:00`);
  if (!value || Number.isNaN(parsed.getTime()))
    throw new Error(`${label} is invalid.`);
  return Timestamp.fromDate(parsed);
};
const optionalTimestamp = (value?: string) =>
  value ? toTimestamp(value, "Date") : null;
const orgCode = (name: string) => {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    (initials.length > 1 ? initials : name)
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase() || "ORG"
  );
};
const uniqueKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140);

function assertOrganization(recordOrganizationId: string, actor: LCActor) {
  if (
    recordOrganizationId !== actor.organizationId &&
    actor.role !== "Super Admin"
  ) {
    throw new Error(
      "You cannot act on another organization’s Letter of Credit.",
    );
  }
}

function audit(
  transaction: Transaction,
  actor: LCActor,
  input: Omit<
    LCAuditEntry,
    | "id"
    | "organizationId"
    | "module"
    | "userId"
    | "userName"
    | "userRole"
    | "createdAt"
  >,
) {
  const reference = doc(collection(db, LC_COLLECTIONS.audit));
  transaction.set(reference, {
    organizationId: actor.organizationId,
    module: LC_PERMISSION_MODULE,
    ...input,
    userId: actor.userId,
    userName: actor.userName,
    userRole: actor.role || "",
    createdAt: now(),
  } satisfies Omit<LCAuditEntry, "id">);
}

function approval(
  transaction: Transaction,
  actor: LCActor,
  input: {
    requestId?: string;
    lcId?: string;
    recordType: string;
    recordId: string;
    amount: number;
    requiredRole: string;
    stage: string;
  },
) {
  const reference = doc(collection(db, LC_COLLECTIONS.approvals));
  transaction.set(reference, {
    organizationId: actor.organizationId,
    module: LC_PERMISSION_MODULE,
    ...input,
    requestedBy: actor.userId,
    requestedByName: actor.userName,
    requestedAt: now(),
    status: "PENDING",
  });
  return reference.id;
}

const requestFrom = (data: DocumentData, id: string) =>
  ({ id, ...data }) as LCRequest;
const creditFrom = (data: DocumentData, id: string) =>
  ({ id, ...data }) as LetterOfCredit;

function validateRequest(input: LCRequestInput) {
  if (!input.projectId || !input.vendorId || !input.purchaseOrderId)
    throw new Error("Project, vendor, and purchase order are required.");
  if (!input.preferredBankId) throw new Error("Preferred bank is required.");
  if (Number(input.requestedAmount || 0) <= 0)
    throw new Error("Requested LC amount must be greater than zero.");
  const existing = Number(input.existingLcAmount || 0);
  if (
    Number(input.purchaseOrderAmount || 0) > 0 &&
    input.requestedAmount > input.purchaseOrderAmount - existing
  ) {
    throw new Error(
      "Requested LC amount exceeds the remaining eligible purchase-order value.",
    );
  }
  const opening = toTimestamp(
    input.requiredOpeningDate,
    "Required opening date",
  ).toDate();
  const expiry = toTimestamp(
    input.proposedExpiryDate,
    "Proposed expiry date",
  ).toDate();
  if (expiry <= opening)
    throw new Error("LC expiry date must be after the required opening date.");
  if (
    input.latestShipmentDate &&
    toTimestamp(input.latestShipmentDate, "Latest shipment date").toDate() >=
      expiry
  ) {
    throw new Error("Latest shipment date must be before the LC expiry date.");
  }
  if (
    input.sightOrUsance === "USANCE" &&
    Number(input.usancePeriodDays || 0) <= 0
  ) {
    throw new Error("Usance period is required for a Usance LC.");
  }
}

export async function createLCRequest(input: LCRequestInput, actor: LCActor) {
  validateRequest(input);
  const requestDate = new Date();
  const financialYear = financialYearForLcDate(requestDate);
  const counterId = uniqueKey(`${actor.organizationId}-${financialYear}`);
  return runTransaction(db, async (transaction) => {
    const counterReference = doc(db, LC_COLLECTIONS.counters, counterId);
    const counterSnapshot = await transaction.get(counterReference);
    const sequence = Number(counterSnapshot.data()?.nextSequence || 1);
    const referenceNumber = `LC/${orgCode(actor.organizationName || actor.organizationId)}/${financialYear}/${String(sequence).padStart(5, "0")}`;
    const requestReference = doc(collection(db, LC_COLLECTIONS.requests));
    const requiredMarginAmount = calculateRequiredMargin(
      input.requestedAmount,
      input.marginPercentage,
    );
    const existingLcAmount = round(input.existingLcAmount || 0);
    const payload: Omit<LCRequest, "id"> = {
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
      vendorId: input.vendorId,
      vendorName: input.vendorName,
      vendorCode: input.vendorCode || "",
      purchaseOrderId: input.purchaseOrderId,
      purchaseOrderNumber: input.purchaseOrderNumber,
      purchaseOrderAmount: round(input.purchaseOrderAmount),
      existingLcAmount,
      balancePoValue: Math.max(
        0,
        round(
          input.purchaseOrderAmount - existingLcAmount - input.requestedAmount,
        ),
      ),
      contractReference: input.contractReference || "",
      purpose: input.purpose,
      materialDescription: input.materialDescription,
      lcType: input.lcType,
      currency: input.currency,
      requestedAmount: round(input.requestedAmount),
      requiredOpeningDate: toTimestamp(
        input.requiredOpeningDate,
        "Required opening date",
      ),
      proposedExpiryDate: toTimestamp(
        input.proposedExpiryDate,
        "Proposed expiry date",
      ),
      latestShipmentDate: optionalTimestamp(input.latestShipmentDate),
      sightOrUsance: input.sightOrUsance,
      usancePeriodDays: Number(input.usancePeriodDays || 0),
      dueDateBasis: input.dueDateBasis,
      partialShipmentAllowed: input.partialShipmentAllowed,
      transshipmentAllowed: input.transshipmentAllowed,
      partialDrawingAllowed: input.partialDrawingAllowed,
      tolerancePercentage: Number(input.tolerancePercentage || 0),
      presentationPeriodDays: Number(input.presentationPeriodDays || 0),
      incoterm: input.incoterm || "",
      specialConditions: input.specialConditions || "",
      preferredBankId: input.preferredBankId,
      preferredBankName: input.preferredBankName,
      marginType: input.marginType,
      marginPercentage: Number(input.marginPercentage || 0),
      requiredMarginAmount,
      fdMarginAmount: round(input.fdMarginAmount || 0),
      cashMarginAmount: round(input.cashMarginAmount || 0),
      otherCollateralAmount: round(input.otherCollateralAmount || 0),
      estimatedCommission: round(input.estimatedCommission || 0),
      estimatedCharges: round(input.estimatedCharges || 0),
      clientRecoverable: input.clientRecoverable,
      expectedRecoverableAmount: round(input.expectedRecoverableAmount || 0),
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
    transaction.set(requestReference, payload);
    transaction.set(
      counterReference,
      {
        organizationId: actor.organizationId,
        financialYear,
        nextSequence: sequence + 1,
        updatedAt: now(),
      },
      { merge: true },
    );
    audit(transaction, actor, {
      recordType: "LC_REQUEST",
      recordId: requestReference.id,
      requestId: requestReference.id,
      action: "LC_REQUEST_CREATED",
      summary: `${referenceNumber} created as draft`,
      newValue: {
        requestedAmount: payload.requestedAmount,
        vendorName: payload.vendorName,
        bankName: payload.preferredBankName,
      },
      page: `/letter-of-credit/${requestReference.id}`,
    });
    return { id: requestReference.id, referenceNumber };
  });
}

export async function submitLCRequest(requestId: string, actor: LCActor) {
  return runTransaction(db, async (transaction) => {
    const reference = doc(db, LC_COLLECTIONS.requests, requestId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("LC request was not found.");
    const request = requestFrom(snapshot.data(), snapshot.id);
    assertOrganization(request.organizationId, actor);
    if (!["DRAFT", "RETURNED", "REJECTED"].includes(request.status))
      throw new Error("Only a draft or returned request can be submitted.");
    const approvalId = approval(transaction, actor, {
      requestId,
      recordType: "LC_REQUEST",
      recordId: requestId,
      amount: request.requestedAmount,
      requiredRole: "Commercial User",
      stage: "COMMERCIAL_VERIFICATION",
    });
    transaction.update(reference, {
      status: "PENDING_COMMERCIAL_APPROVAL",
      approvalStatus: "PENDING",
      workflowStage: "COMMERCIAL_VERIFICATION",
      approvalId,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "LC_REQUEST",
      recordId: requestId,
      requestId,
      action: "LC_REQUEST_SUBMITTED",
      summary: `${request.referenceNumber} submitted for verification`,
      previousValue: { status: request.status },
      newValue: { status: "PENDING_COMMERCIAL_APPROVAL" },
      page: "/letter-of-credit/approvals",
    });
  });
}

export async function cancelLCRequest(
  requestId: string,
  reason: string,
  actor: LCActor,
) {
  if (!reason.trim()) throw new Error("Cancellation reason is required.");
  return runTransaction(db, async (transaction) => {
    const reference = doc(db, LC_COLLECTIONS.requests, requestId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("LC request was not found.");
    const request = requestFrom(snapshot.data(), snapshot.id);
    assertOrganization(request.organizationId, actor);
    if (request.status === "OPENED")
      throw new Error(
        "An opened LC must use the controlled closure/cancellation workflow.",
      );
    transaction.update(reference, {
      status: "CANCELLED",
      approvalStatus: "REJECTED",
      cancellationReason: reason,
      cancelledBy: actor.userId,
      cancelledAt: now(),
      updatedAt: now(),
    });
    if (request.approvalId)
      transaction.update(
        doc(db, LC_COLLECTIONS.approvals, request.approvalId),
        {
          status: "CANCELLED",
          decidedBy: actor.userId,
          decidedByName: actor.userName,
          decidedAt: now(),
          comments: reason,
        },
      );
    audit(transaction, actor, {
      recordType: "LC_REQUEST",
      recordId: requestId,
      requestId,
      action: "LC_REQUEST_CANCELLED",
      summary: `${request.referenceNumber} cancelled`,
      previousValue: { status: request.status },
      newValue: { status: "CANCELLED" },
      reason,
      page: `/letter-of-credit/${requestId}`,
    });
  });
}

export async function decideLCRequest(
  requestId: string,
  action: "APPROVE" | "REJECT" | "RETURN" | "ON_HOLD",
  comments: string,
  actor: LCActor,
) {
  if (action !== "APPROVE" && !comments.trim())
    throw new Error("Decision remarks are required.");
  return runTransaction(db, async (transaction) => {
    const reference = doc(db, LC_COLLECTIONS.requests, requestId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("LC request was not found.");
    const request = requestFrom(snapshot.data(), snapshot.id);
    assertOrganization(request.organizationId, actor);
    if (request.createdBy === actor.userId && actor.role !== "Super Admin")
      throw new Error("You cannot approve your own LC request.");
    if (!request.status.startsWith("PENDING_"))
      throw new Error("This request is not pending a decision.");

    if (request.approvalId) {
      transaction.update(
        doc(db, LC_COLLECTIONS.approvals, request.approvalId),
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
    }

    if (action !== "APPROVE") {
      const status =
        action === "REJECT"
          ? "REJECTED"
          : action === "ON_HOLD"
            ? request.status
            : "RETURNED";
      transaction.update(reference, {
        status,
        approvalStatus: action === "REJECT" ? "REJECTED" : "RETURNED",
        workflowStage: action === "ON_HOLD" ? "ON_HOLD" : "DRAFT",
        approvalComments: comments,
        updatedBy: actor.userId,
        updatedByName: actor.userName,
        updatedAt: now(),
      });
      audit(transaction, actor, {
        recordType: "LC_REQUEST",
        recordId: requestId,
        requestId,
        action: `LC_REQUEST_${action}`,
        summary: `${request.referenceNumber}: ${action.replaceAll("_", " ")}`,
        previousValue: { status: request.status },
        newValue: { status },
        reason: comments,
        page: "/letter-of-credit/approvals",
      });
      return status;
    }

    let nextStatus: LCRequest["status"] = "APPROVED";
    let nextStage = "COMPLETED";
    let nextRole = "";
    if (request.status === "PENDING_COMMERCIAL_APPROVAL") {
      nextStatus = "PENDING_PROJECT_APPROVAL";
      nextStage = "PROJECT_VERIFICATION";
      nextRole = "Project User";
    } else if (request.status === "PENDING_PROJECT_APPROVAL") {
      nextStatus = "PENDING_FINANCE_APPROVAL";
      nextStage = "FINANCE_VERIFICATION";
      nextRole = "Finance Manager";
    } else if (
      request.status === "PENDING_FINANCE_APPROVAL" &&
      (request.requestedAmount > 1_000_000 || request.lcType === "FOREIGN")
    ) {
      nextStatus = "PENDING_DIRECTOR_APPROVAL";
      nextStage = "DIRECTOR_APPROVAL";
      nextRole = "Director Finance";
    }
    const nextApprovalId =
      nextStatus === "APPROVED"
        ? ""
        : approval(transaction, actor, {
            requestId,
            recordType: "LC_REQUEST",
            recordId: requestId,
            amount: request.requestedAmount,
            requiredRole: nextRole,
            stage: nextStage,
          });
    transaction.update(reference, {
      status: nextStatus,
      approvalStatus: nextStatus === "APPROVED" ? "APPROVED" : "PENDING",
      workflowStage: nextStage,
      approvalId: nextApprovalId,
      approvedBy:
        nextStatus === "APPROVED" ? actor.userId : request.approvedBy || "",
      approvedByName:
        nextStatus === "APPROVED"
          ? actor.userName
          : request.approvedByName || "",
      approvedAt:
        nextStatus === "APPROVED" ? now() : request.approvedAt || null,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "LC_REQUEST",
      recordId: requestId,
      requestId,
      action:
        nextStatus === "APPROVED"
          ? "LC_REQUEST_APPROVED"
          : "LC_REQUEST_STAGE_APPROVED",
      summary: `${request.referenceNumber} advanced to ${nextStatus.replaceAll("_", " ")}`,
      previousValue: { status: request.status },
      newValue: { status: nextStatus },
      reason: comments,
      page: "/letter-of-credit/approvals",
    });
    return nextStatus;
  });
}

export async function reserveLCFdMargin(
  input: Omit<AssignmentInstrumentInput, "instrumentType" | "reserveOnly"> & {
    requestId: string;
  },
  actor: LCActor,
) {
  return createFdAssignments(
    {
      ...input,
      instrumentType: "LC",
      instrumentId: input.requestId,
      reserveOnly: true,
    },
    actor,
  );
}

export async function openLetterOfCredit(
  input: LCOpeningInput,
  actor: LCActor,
) {
  const requestReference = doc(db, LC_COLLECTIONS.requests, input.requestId);
  const reservationSnapshot = await getDocs(
    query(
      collection(db, FD_COLLECTIONS.assignments),
      where("instrumentId", "==", input.requestId),
    ),
  );
  const reservations = reservationSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as FDAssignment)
    .filter((item) => ["RESERVED", "PENDING_APPROVAL"].includes(item.status));

  return runTransaction(db, async (transaction) => {
    const uniqueReference = doc(
      db,
      LC_COLLECTIONS.uniqueKeys,
      uniqueKey(
        `${actor.organizationId}-${input.bankId}-${input.bankLcNumber}`,
      ),
    );
    const creditReference = doc(collection(db, LC_COLLECTIONS.credits));
    const limitReference = input.bankLimitId
      ? doc(db, LC_COLLECTIONS.bankLimits, input.bankLimitId)
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
    const [
      requestSnapshot,
      duplicateSnapshot,
      limitSnapshot,
      assignmentSnapshots,
      fdSnapshots,
    ] = await Promise.all([
      transaction.get(requestReference),
      transaction.get(uniqueReference),
      limitReference ? transaction.get(limitReference) : Promise.resolve(null),
      Promise.all(
        assignmentRefs.map((reference) => transaction.get(reference)),
      ),
      Promise.all(fdRefs.map((reference) => transaction.get(reference))),
    ]);
    if (!requestSnapshot.exists())
      throw new Error("Approved LC request was not found.");
    if (duplicateSnapshot.exists())
      throw new Error("Bank LC number already exists for this bank.");
    const request = requestFrom(requestSnapshot.data(), requestSnapshot.id);
    assertOrganization(request.organizationId, actor);
    if (request.status !== "APPROVED")
      throw new Error("Only a fully approved LC request can be opened.");
    const openingDate = toTimestamp(input.openingDate, "Opening date");
    const expiryDate = toTimestamp(input.expiryDate, "Expiry date");
    if (expiryDate.toMillis() <= openingDate.toMillis())
      throw new Error("Expiry date must be after opening date.");
    if (
      input.latestShipmentDate &&
      toTimestamp(
        input.latestShipmentDate,
        "Latest shipment date",
      ).toMillis() >= expiryDate.toMillis()
    )
      throw new Error("Latest shipment date must be before expiry date.");
    if (input.openedAmount <= 0 || input.openedAmount > request.requestedAmount)
      throw new Error(
        "Opened amount must be positive and cannot exceed the approved amount.",
      );
    const requiredMarginAmount = calculateRequiredMargin(
      input.openedAmount,
      input.marginPercentage,
    );
    const assignedFdAmount = reservations.reduce(
      (sum, item) => sum + assignmentOutstanding(item),
      0,
    );
    if (
      ["FD", "COMBINED"].includes(request.marginType) &&
      input.fdMarginAmount > assignedFdAmount
    )
      throw new Error(
        `FD margin shortfall. Reserved ${assignedFdAmount}; required FD margin ${input.fdMarginAmount}.`,
      );
    const totalMargin =
      input.fdMarginAmount +
      input.cashMarginAmount +
      input.otherCollateralAmount;
    if (request.marginType !== "NONE" && totalMargin < requiredMarginAmount)
      throw new Error(
        `Margin shortfall of ${round(requiredMarginAmount - totalMargin)}.`,
      );

    if (limitReference && limitSnapshot?.exists()) {
      const limit = limitSnapshot.data();
      const available =
        Number(limit.sanctionedAmount || 0) +
        Number(limit.temporaryLimit || 0) -
        Number(limit.utilizedAmount || 0) -
        Number(limit.reservedAmount || 0);
      if (available < input.openedAmount && !limit.overrideApproved)
        throw new Error(`Available LC bank limit is ${round(available)}.`);
    }

    const baseCurrencyAmount = round(
      input.openedAmount * (input.exchangeRate || 1),
    );
    const totalCharges = round(
      input.openingCommission +
        input.swiftCharges +
        input.handlingCharges +
        input.gstAmount +
        input.otherCharges,
    );
    const expectedDueDate = input.expectedDueDate
      ? toTimestamp(input.expectedDueDate, "Expected due date")
      : null;
    const payload: Omit<LetterOfCredit, "id"> & Record<string, unknown> = {
      organizationId: actor.organizationId,
      organizationName:
        actor.organizationName || request.organizationName || "",
      requestId: request.id,
      requestReference: request.referenceNumber,
      internalReferenceNumber: request.referenceNumber,
      bankLcNumber: input.bankLcNumber.trim(),
      bankId: input.bankId,
      bankName: input.bankName,
      bankLimitId: input.bankLimitId || "",
      branchId: input.branchId || "",
      branchName: input.branchName || "",
      vendorId: request.vendorId,
      vendorName: request.vendorName,
      projectId: request.projectId,
      projectName: request.projectName,
      purchaseOrderId: request.purchaseOrderId,
      purchaseOrderNumber: request.purchaseOrderNumber,
      lcType: request.lcType,
      currency: input.currency,
      exchangeRate: Number(input.exchangeRate || 1),
      openedAmount: round(input.openedAmount),
      baseCurrencyAmount,
      openingDate,
      effectiveDate: optionalTimestamp(input.effectiveDate),
      expiryDate,
      latestShipmentDate: optionalTimestamp(input.latestShipmentDate),
      presentationPeriodDays: Number(input.presentationPeriodDays || 0),
      usancePeriodDays: Number(input.usancePeriodDays || 0),
      dueDateBasis: input.dueDateBasis,
      expectedDueDate,
      actualDueDate: null,
      totalClaimedAmount: 0,
      totalAcceptedAmount: 0,
      totalRejectedAmount: 0,
      totalPaidAmount: 0,
      outstandingAmount: 0,
      unutilizedAmount: round(input.openedAmount),
      marginPercentage: Number(input.marginPercentage || 0),
      requiredMarginAmount,
      fdMarginAmount: round(input.fdMarginAmount),
      cashMarginAmount: round(input.cashMarginAmount),
      otherCollateralAmount: round(input.otherCollateralAmount),
      openingCommission: round(input.openingCommission),
      amendmentCommission: 0,
      otherBankCharges: round(
        input.swiftCharges + input.handlingCharges + input.otherCharges,
      ),
      gstAmount: round(input.gstAmount),
      totalCharges,
      internalCommission: round(
        request.estimatedCommission || input.openingCommission,
      ),
      bankCommission: round(input.openingCommission),
      commissionDifference: round(
        input.openingCommission -
          Number(request.estimatedCommission || input.openingCommission),
      ),
      clientRecoverable: request.clientRecoverable,
      recoverableAmount: round(request.expectedRecoverableAmount || 0),
      recoveredAmount: 0,
      balanceRecoverable: round(request.expectedRecoverableAmount || 0),
      status: "HUNDI_AWAITED",
      paymentStatus: "NOT_DUE",
      bankClosureConfirmed: false,
      documentComplete: false,
      debitAccountId: input.debitAccountId || "",
      originalLcReceived: input.originalLcReceived,
      vendorInformed: input.vendorInformed,
      vendorCopySentDate: optionalTimestamp(input.vendorCopySentDate),
      remarks: input.remarks || "",
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
      isDeleted: false,
    };
    transaction.set(creditReference, payload);
    transaction.set(uniqueReference, {
      organizationId: actor.organizationId,
      bankId: input.bankId,
      bankLcNumber: input.bankLcNumber.trim(),
      lcId: creditReference.id,
      createdAt: now(),
    });
    transaction.update(requestReference, {
      status: "OPENED",
      workflowStage: "OPENED",
      lcId: creditReference.id,
      bankLcNumber: input.bankLcNumber.trim(),
      openedAt: now(),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    if (limitReference && limitSnapshot?.exists()) {
      const limit = limitSnapshot.data();
      const utilizedAmount = round(
        Number(limit.utilizedAmount || 0) + input.openedAmount,
      );
      const lcUtilizedAmount = round(
        Number(limit.lcUtilizedAmount || 0) + input.openedAmount,
      );
      const reservedAmount = Math.max(
        0,
        round(Number(limit.reservedAmount || 0) - request.requestedAmount),
      );
      transaction.update(limitReference, {
        utilizedAmount,
        lcUtilizedAmount,
        reservedAmount,
        availableAmount: Math.max(
          0,
          round(
            Number(limit.sanctionedAmount || 0) +
              Number(limit.temporaryLimit || 0) -
              utilizedAmount -
              reservedAmount,
          ),
        ),
        updatedAt: now(),
        updatedBy: actor.userId,
      });
    }

    const fdById = new Map(
      fdSnapshots
        .filter((item) => item.exists())
        .map((item) => [
          item.id,
          { id: item.id, ...item.data() } as FixedDeposit,
        ]),
    );
    assignmentSnapshots.forEach((assignmentSnapshot, index) => {
      if (!assignmentSnapshot.exists()) return;
      const assignment = {
        id: assignmentSnapshot.id,
        ...assignmentSnapshot.data(),
      } as FDAssignment;
      const fd = fdById.get(assignment.fdId);
      if (!fd)
        throw new Error(`Linked FD ${assignment.fdNumber} no longer exists.`);
      const amount = assignmentOutstanding(assignment);
      const nextReserved = Math.max(
        0,
        round(Number(fd.reservedAmount || 0) - amount),
      );
      const nextLc = round(Number(fd.lcUtilizedAmount || 0) + amount);
      const nextAvailable = calculateFdAvailableAmount(
        fd.eligibleValue,
        fd.bgUtilizedAmount,
        nextLc,
        nextReserved,
      );
      const computedFd = {
        ...fd,
        reservedAmount: nextReserved,
        lcUtilizedAmount: nextLc,
        availableAmount: nextAvailable,
        totalUtilizedAmount: round(fd.bgUtilizedAmount + nextLc + nextReserved),
      };
      transaction.update(assignmentRefs[index], {
        instrumentId: creditReference.id,
        instrumentNumber: input.bankLcNumber.trim(),
        status: "ACTIVE",
        activeAmount: amount,
        approvalId: "",
        updatedBy: actor.userId,
        updatedByName: actor.userName,
        updatedAt: now(),
      });
      transaction.update(doc(db, FD_COLLECTIONS.deposits, fd.id), {
        reservedAmount: nextReserved,
        lcUtilizedAmount: nextLc,
        availableAmount: nextAvailable,
        totalUtilizedAmount: computedFd.totalUtilizedAmount,
        status: deriveFdOperationalStatus(computedFd),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
        updatedAt: now(),
      });
    });
    audit(transaction, actor, {
      recordType: "LC",
      recordId: creditReference.id,
      lcId: creditReference.id,
      requestId: request.id,
      action: "LC_OPENED",
      summary: `${input.bankLcNumber} opened for ${request.vendorName}`,
      newValue: {
        openedAmount: input.openedAmount,
        requiredMarginAmount,
        bankName: input.bankName,
      },
      page: `/letter-of-credit/${creditReference.id}`,
    });
    return creditReference.id;
  });
}

export async function createLCHundi(input: LCHundiInput, actor: LCActor) {
  return runTransaction(db, async (transaction) => {
    const lcReference = doc(db, LC_COLLECTIONS.credits, input.lcId);
    const lcSnapshot = await transaction.get(lcReference);
    if (!lcSnapshot.exists())
      throw new Error("Letter of Credit was not found.");
    const lc = creditFrom(lcSnapshot.data(), lcSnapshot.id);
    assertOrganization(lc.organizationId, actor);
    if (["CLOSED", "CANCELLED"].includes(lc.status))
      throw new Error("A closed or cancelled LC cannot receive a Hundi.");
    if (input.claimedAmount <= 0 || input.claimedAmount > lc.unutilizedAmount)
      throw new Error(
        `Claimed amount cannot exceed the LC unutilised amount of ${lc.unutilizedAmount}.`,
      );
    if (input.acceptedAmount + input.rejectedAmount > input.claimedAmount)
      throw new Error(
        "Accepted and rejected amounts cannot exceed claimed amount.",
      );
    const dueDate = calculateHundiDueDate(
      input.baseDate,
      input.usancePeriodDays,
    );
    if (!dueDate) throw new Error("A valid due-date base date is required.");
    const hundiReference = doc(collection(db, LC_COLLECTIONS.hundis));
    const payload: Omit<LCHundi, "id"> = {
      organizationId: actor.organizationId,
      lcId: lc.id,
      lcNumber: lc.bankLcNumber,
      hundiNumber: input.hundiNumber.trim(),
      receiptDate: toTimestamp(input.receiptDate, "Hundi receipt date"),
      bankReceiptDate: optionalTimestamp(input.bankReceiptDate),
      invoiceNumber: input.invoiceNumber.trim(),
      invoiceDate: toTimestamp(input.invoiceDate, "Invoice date"),
      invoiceAmount: round(input.invoiceAmount),
      currency: input.currency,
      claimedAmount: round(input.claimedAmount),
      acceptedAmount: round(input.acceptedAmount),
      rejectedAmount: round(input.rejectedAmount),
      paidAmount: 0,
      billOfLadingNumber: input.billOfLadingNumber || "",
      shipmentDate: optionalTimestamp(input.shipmentDate),
      mrrNumber: input.mrrNumber || "",
      mrrDate: optionalTimestamp(input.mrrDate),
      usancePeriodDays: Number(input.usancePeriodDays || 0),
      dueDateBasis: input.dueDateBasis,
      baseDate: toTimestamp(input.baseDate, "Due-date base date"),
      calculatedDueDate: toTimestamp(dueDate, "Calculated due date"),
      approvedDueDate: toTimestamp(dueDate, "Approved due date"),
      status: input.status,
      discrepancyCount: Number(input.discrepancyCount || 0),
      remarks: input.remarks || "",
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
      updatedAt: now(),
    };
    transaction.set(hundiReference, payload);
    const totalClaimed = round(lc.totalClaimedAmount + input.claimedAmount);
    const totalAccepted = round(lc.totalAcceptedAmount + input.acceptedAmount);
    const totalRejected = round(lc.totalRejectedAmount + input.rejectedAmount);
    const outstandingAmount = calculateOutstanding(
      totalAccepted,
      lc.totalPaidAmount,
    );
    const unutilizedAmount = calculateUnutilized(
      lc.openedAmount,
      totalAccepted,
    );
    const hasDiscrepancy = input.discrepancyCount && input.discrepancyCount > 0;
    transaction.update(lcReference, {
      totalClaimedAmount: totalClaimed,
      totalAcceptedAmount: totalAccepted,
      totalRejectedAmount: totalRejected,
      outstandingAmount,
      unutilizedAmount,
      actualDueDate: payload.approvedDueDate,
      paymentStatus: derivePaymentStatus(
        payload.approvedDueDate,
        outstandingAmount,
      ),
      status: hasDiscrepancy
        ? "DISCREPANCY"
        : input.acceptedAmount > 0
          ? "ACCEPTED"
          : "HUNDI_RECEIVED",
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "HUNDI",
      recordId: hundiReference.id,
      lcId: lc.id,
      action: "HUNDI_RECORDED",
      summary: `${input.hundiNumber} recorded against ${lc.bankLcNumber}`,
      newValue: {
        claimedAmount: input.claimedAmount,
        acceptedAmount: input.acceptedAmount,
        dueDate,
      },
      page: "/letter-of-credit/hundis",
    });
    return hundiReference.id;
  });
}

export async function recordLCPayment(input: LCPaymentInput, actor: LCActor) {
  return runTransaction(db, async (transaction) => {
    const lcReference = doc(db, LC_COLLECTIONS.credits, input.lcId);
    const hundiReference = input.hundiId
      ? doc(db, LC_COLLECTIONS.hundis, input.hundiId)
      : null;
    const [lcSnapshot, hundiSnapshot] = await Promise.all([
      transaction.get(lcReference),
      hundiReference ? transaction.get(hundiReference) : Promise.resolve(null),
    ]);
    if (!lcSnapshot.exists())
      throw new Error("Letter of Credit was not found.");
    const lc = creditFrom(lcSnapshot.data(), lcSnapshot.id);
    assertOrganization(lc.organizationId, actor);
    if (input.paidAmount <= 0 || input.paidAmount > lc.outstandingAmount)
      throw new Error(
        `Payment must be positive and cannot exceed outstanding amount ${lc.outstandingAmount}.`,
      );
    const hundi = hundiSnapshot?.exists()
      ? ({ id: hundiSnapshot.id, ...hundiSnapshot.data() } as LCHundi)
      : null;
    if (
      hundi &&
      input.paidAmount >
        Math.max(0, hundi.acceptedAmount - Number(hundi.paidAmount || 0))
    )
      throw new Error("Payment exceeds the selected Hundi balance.");
    const paymentReference = doc(collection(db, LC_COLLECTIONS.payments));
    const netDebitAmount = round(
      input.paidAmount +
        input.bankCommission +
        input.gstAmount +
        input.otherCharges +
        Number(input.exchangeDifference || 0),
    );
    transaction.set(paymentReference, {
      organizationId: actor.organizationId,
      lcId: lc.id,
      lcNumber: lc.bankLcNumber,
      hundiId: hundi?.id || "",
      hundiNumber: hundi?.hundiNumber || "",
      vendorName: lc.vendorName,
      projectName: lc.projectName,
      dueDate: toTimestamp(input.dueDate, "Due date"),
      dueAmount: round(input.dueAmount),
      approvedAmount: round(input.paidAmount),
      paidAmount: round(input.paidAmount),
      paymentType: input.paymentType,
      debitAccountId: input.debitAccountId,
      paymentDate: toTimestamp(input.paymentDate, "Payment date"),
      transactionReference: input.transactionReference || "",
      utrNumber: input.utrNumber || "",
      bankCommission: round(input.bankCommission),
      gstAmount: round(input.gstAmount),
      otherCharges: round(input.otherCharges),
      exchangeDifference: round(input.exchangeDifference || 0),
      netDebitAmount,
      status: "PAID",
      remarks: input.remarks || "",
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
      updatedAt: now(),
    });
    const totalPaidAmount = round(lc.totalPaidAmount + input.paidAmount);
    const outstandingAmount = calculateOutstanding(
      lc.totalAcceptedAmount,
      totalPaidAmount,
    );
    transaction.update(lcReference, {
      totalPaidAmount,
      outstandingAmount,
      paymentStatus: outstandingAmount <= 0 ? "PAID" : "PARTIALLY_PAID",
      status: outstandingAmount <= 0 ? "PAID" : "PARTIALLY_PAID",
      bankCommission: round(lc.bankCommission + input.bankCommission),
      totalCharges: round(
        lc.totalCharges +
          input.bankCommission +
          input.gstAmount +
          input.otherCharges,
      ),
      commissionDifference: round(
        lc.bankCommission + input.bankCommission - lc.internalCommission,
      ),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    if (hundi && hundiReference) {
      const paidAmount = round(
        Number(hundi.paidAmount || 0) + input.paidAmount,
      );
      transaction.update(hundiReference, {
        paidAmount,
        status: paidAmount >= hundi.acceptedAmount ? "PAID" : "ACCEPTED",
        updatedAt: now(),
      });
    }
    audit(transaction, actor, {
      recordType: "PAYMENT",
      recordId: paymentReference.id,
      lcId: lc.id,
      action: "LC_PAYMENT_RECORDED",
      summary: `${input.paidAmount} paid against ${lc.bankLcNumber}`,
      previousValue: { outstandingAmount: lc.outstandingAmount },
      newValue: {
        totalPaidAmount,
        outstandingAmount,
        utrNumber: input.utrNumber || "",
      },
      page: "/letter-of-credit/payments",
    });
    return paymentReference.id;
  });
}

export async function applyLCAmendment(amendmentId: string, actor: LCActor) {
  return runTransaction(db, async (transaction) => {
    const amendmentReference = doc(db, LC_COLLECTIONS.amendments, amendmentId);
    const amendmentSnapshot = await transaction.get(amendmentReference);
    if (!amendmentSnapshot.exists())
      throw new Error("LC amendment was not found.");
    const amendment = {
      id: amendmentSnapshot.id,
      ...amendmentSnapshot.data(),
    } as Record<string, any>;
    const lcReference = doc(db, LC_COLLECTIONS.credits, String(amendment.lcId));
    const lcSnapshot = await transaction.get(lcReference);
    if (!lcSnapshot.exists())
      throw new Error("Letter of Credit was not found.");
    const lc = creditFrom(lcSnapshot.data(), lcSnapshot.id);
    assertOrganization(lc.organizationId, actor);
    if (!["APPROVED", "BANK_CONFIRMED"].includes(String(amendment.status)))
      throw new Error(
        "Amendment must be approved and bank-confirmed before completion.",
      );
    const patch: Record<string, unknown> = {
      status: lc.status,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    };
    const newValue = amendment.proposedValue;
    if (
      amendment.amendmentType === "AMOUNT_INCREASE" ||
      amendment.amendmentType === "AMOUNT_REDUCTION"
    ) {
      const openedAmount = Number(newValue);
      if (
        !Number.isFinite(openedAmount) ||
        openedAmount < lc.totalAcceptedAmount
      )
        throw new Error("Amended LC amount cannot be below accepted drawings.");
      patch.openedAmount = round(openedAmount);
      patch.unutilizedAmount = calculateUnutilized(
        openedAmount,
        lc.totalAcceptedAmount,
      );
      patch.requiredMarginAmount = calculateRequiredMargin(
        openedAmount,
        lc.marginPercentage,
      );
    } else if (amendment.amendmentType === "VALIDITY_EXTENSION")
      patch.expiryDate = toTimestamp(String(newValue), "New expiry date");
    else if (amendment.amendmentType === "SHIPMENT_EXTENSION")
      patch.latestShipmentDate = toTimestamp(
        String(newValue),
        "New shipment date",
      );
    else if (amendment.amendmentType === "USANCE_CHANGE")
      patch.usancePeriodDays = Number(newValue);
    else if (amendment.amendmentType === "MARGIN_CHANGE")
      patch.marginPercentage = Number(newValue);
    patch.amendmentCommission = round(
      lc.amendmentCommission + Number(amendment.additionalCommission || 0),
    );
    patch.totalCharges = round(
      lc.totalCharges +
        Number(amendment.additionalCommission || 0) +
        Number(amendment.additionalCharges || 0),
    );
    transaction.update(lcReference, patch);
    transaction.update(amendmentReference, {
      status: "COMPLETED",
      completedBy: actor.userId,
      completedByName: actor.userName,
      completedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "AMENDMENT",
      recordId: amendmentId,
      lcId: lc.id,
      action: "LC_AMENDMENT_COMPLETED",
      summary: `${amendment.amendmentType} completed for ${lc.bankLcNumber}`,
      previousValue: { value: amendment.existingValue },
      newValue: { value: amendment.proposedValue },
      reason: amendment.reason || "",
      page: "/letter-of-credit/amendments",
    });
  });
}

export async function requestLCClosure(
  lcId: string,
  input: {
    closureReason: string;
    bankClosureConfirmed: boolean;
    closureEffectiveDate: string;
    fdReleaseAmount: number;
    cashMarginRelease: number;
    bankConfirmationReference?: string;
    remarks?: string;
  },
  actor: LCActor,
) {
  return runTransaction(db, async (transaction) => {
    const lcReference = doc(db, LC_COLLECTIONS.credits, lcId);
    const lcSnapshot = await transaction.get(lcReference);
    if (!lcSnapshot.exists())
      throw new Error("Letter of Credit was not found.");
    const lc = creditFrom(lcSnapshot.data(), lcSnapshot.id);
    assertOrganization(lc.organizationId, actor);
    if (lc.outstandingAmount > 0)
      throw new Error(
        "LC cannot be closed while accepted liability remains unpaid.",
      );
    const closureReference = doc(collection(db, LC_COLLECTIONS.closures));
    const approvalId = approval(transaction, actor, {
      lcId,
      recordType: "LC_CLOSURE",
      recordId: closureReference.id,
      amount: lc.openedAmount,
      requiredRole: "Finance Manager",
      stage: "CLOSURE_APPROVAL",
    });
    transaction.set(closureReference, {
      organizationId: actor.organizationId,
      lcId,
      lcNumber: lc.bankLcNumber,
      closureRequestDate: now(),
      closureReason: input.closureReason,
      totalLcAmount: lc.openedAmount,
      totalClaimed: lc.totalClaimedAmount,
      totalAccepted: lc.totalAcceptedAmount,
      totalPaid: lc.totalPaidAmount,
      unutilizedLcAmount: lc.unutilizedAmount,
      outstandingLiability: lc.outstandingAmount,
      vendorSettlementStatus: "PENDING_VERIFICATION",
      bankClosureConfirmed: input.bankClosureConfirmed,
      closureEffectiveDate: toTimestamp(
        input.closureEffectiveDate,
        "Closure effective date",
      ),
      fdReleaseAmount: round(input.fdReleaseAmount),
      cashMarginRelease: round(input.cashMarginRelease),
      bankConfirmationReference: input.bankConfirmationReference || "",
      remarks: input.remarks || "",
      status: "PENDING_APPROVAL",
      approvalId,
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now(),
    });
    transaction.update(lcReference, {
      status: "CLOSURE_PENDING",
      bankClosureConfirmed: input.bankClosureConfirmed,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    audit(transaction, actor, {
      recordType: "CLOSURE",
      recordId: closureReference.id,
      lcId,
      action: "LC_CLOSURE_REQUESTED",
      summary: `Closure requested for ${lc.bankLcNumber}`,
      newValue: {
        bankClosureConfirmed: input.bankClosureConfirmed,
        fdReleaseAmount: input.fdReleaseAmount,
      },
      reason: input.closureReason,
      page: "/letter-of-credit/closures",
    });
    return closureReference.id;
  });
}

export async function completeLCClosure(
  closureId: string,
  comments: string,
  actor: LCActor,
) {
  const closureSnapshot = await getDoc(
    doc(db, LC_COLLECTIONS.closures, closureId),
  );
  if (!closureSnapshot.exists())
    throw new Error("LC closure request was not found.");
  const closure = {
    id: closureSnapshot.id,
    ...closureSnapshot.data(),
  } as Record<string, any>;
  const assignmentsSnapshot = await getDocs(
    query(
      collection(db, FD_COLLECTIONS.assignments),
      where("instrumentId", "==", String(closure.lcId)),
    ),
  );
  const assignments = assignmentsSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as FDAssignment)
    .filter((item) => ACTIVE_ASSIGNMENT_STATUSES.includes(item.status));
  return runTransaction(db, async (transaction) => {
    const closureReference = doc(db, LC_COLLECTIONS.closures, closureId);
    const lcReference = doc(db, LC_COLLECTIONS.credits, String(closure.lcId));
    const approvalReference = closure.approvalId
      ? doc(db, LC_COLLECTIONS.approvals, String(closure.approvalId))
      : null;
    const fdRefs = Array.from(
      new Map(
        assignments.map((item) => [
          item.fdId,
          doc(db, FD_COLLECTIONS.deposits, item.fdId),
        ]),
      ).values(),
    );
    const [closureCurrent, lcSnapshot, fdSnapshots] = await Promise.all([
      transaction.get(closureReference),
      transaction.get(lcReference),
      Promise.all(fdRefs.map((reference) => transaction.get(reference))),
    ]);
    if (!closureCurrent.exists() || !lcSnapshot.exists())
      throw new Error("LC or closure request no longer exists.");
    const lc = creditFrom(lcSnapshot.data(), lcSnapshot.id);
    const limitReference = lc.bankLimitId
      ? doc(db, LC_COLLECTIONS.bankLimits, lc.bankLimitId)
      : null;
    const limitSnapshot = limitReference
      ? await transaction.get(limitReference)
      : null;
    assertOrganization(lc.organizationId, actor);
    if (lc.outstandingAmount > 0)
      throw new Error("LC still has an outstanding payment liability.");
    if (!closure.bankClosureConfirmed && actor.role !== "Super Admin")
      throw new Error("Bank closure confirmation is mandatory.");
    const fdById = new Map(
      fdSnapshots
        .filter((item) => item.exists())
        .map((item) => [
          item.id,
          { id: item.id, ...item.data() } as FixedDeposit,
        ]),
    );
    assignments.forEach((assignment) => {
      const fd = fdById.get(assignment.fdId);
      if (!fd) return;
      const amount = assignmentOutstanding(assignment);
      const nextLc = Math.max(0, round(fd.lcUtilizedAmount - amount));
      const nextAvailable = calculateFdAvailableAmount(
        fd.eligibleValue,
        fd.bgUtilizedAmount,
        nextLc,
        fd.reservedAmount,
      );
      const computedFd = {
        ...fd,
        lcUtilizedAmount: nextLc,
        availableAmount: nextAvailable,
        totalUtilizedAmount: round(
          fd.bgUtilizedAmount + nextLc + fd.reservedAmount,
        ),
      };
      transaction.update(doc(db, FD_COLLECTIONS.assignments, assignment.id), {
        status: "RELEASED",
        releasedAmount: round(Number(assignment.releasedAmount || 0) + amount),
        activeAmount: 0,
        actualReleaseDate: closure.closureEffectiveDate || now(),
        releaseReference: closure.bankConfirmationReference || comments,
        releasedBy: actor.userId,
        releasedByName: actor.userName,
        updatedAt: now(),
      });
      transaction.update(doc(db, FD_COLLECTIONS.deposits, fd.id), {
        lcUtilizedAmount: nextLc,
        availableAmount: nextAvailable,
        totalUtilizedAmount: computedFd.totalUtilizedAmount,
        status: deriveFdOperationalStatus(computedFd),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
        updatedAt: now(),
      });
    });
    if (limitReference && limitSnapshot?.exists()) {
      const limit = limitSnapshot.data();
      const utilizedAmount = Math.max(
        0,
        round(Number(limit.utilizedAmount || 0) - lc.openedAmount),
      );
      const lcUtilizedAmount = Math.max(
        0,
        round(Number(limit.lcUtilizedAmount || 0) - lc.openedAmount),
      );
      transaction.update(limitReference, {
        utilizedAmount,
        lcUtilizedAmount,
        availableAmount: Math.max(
          0,
          round(
            Number(limit.sanctionedAmount || 0) +
              Number(limit.temporaryLimit || 0) -
              utilizedAmount -
              Number(limit.reservedAmount || 0),
          ),
        ),
        updatedBy: actor.userId,
        updatedAt: now(),
      });
    }
    transaction.update(lcReference, {
      status: "CLOSED",
      closureDate: closure.closureEffectiveDate || now(),
      bankClosureConfirmed: true,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: now(),
    });
    transaction.update(closureReference, {
      status: "COMPLETED",
      approvedBy: actor.userId,
      approvedByName: actor.userName,
      approvedAt: now(),
      completedAt: now(),
      comments,
    });
    if (approvalReference)
      transaction.update(approvalReference, {
        status: "APPROVED",
        decidedBy: actor.userId,
        decidedByName: actor.userName,
        decidedAt: now(),
        comments,
      });
    audit(transaction, actor, {
      recordType: "CLOSURE",
      recordId: closureId,
      lcId: lc.id,
      action: "LC_CLOSED",
      summary: `${lc.bankLcNumber} closed and collateral released`,
      previousValue: { status: lc.status },
      newValue: { status: "CLOSED", releasedAssignments: assignments.length },
      reason: comments || closure.closureReason || "",
      page: `/letter-of-credit/${lc.id}`,
    });
  });
}
