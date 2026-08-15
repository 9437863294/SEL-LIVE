/**
 * Field Control registry for the Vehicle Management module.
 *
 * Every form in the module — Vehicle Master, Insurance, PUC, Documents, Fitness, Road Tax,
 * Permit, Maintenance, Fuel (admin), Driver Master, the Insurance Workflow action dialogs, and
 * the two driver-mobile forms — is described here as a flat list of fields. An admin can, per
 * organization, override each field's label, whether it's required, and whether it's shown at
 * all — from Settings > Field Control.
 *
 * A field marked `locked: true` cannot have its `visible`/`required` overridden — only its
 * label can be customized. Fields are locked when the surrounding form has a hardcoded
 * validation guard (a submit-time `if (!value) return/throw ...` beyond the plain "required"
 * mechanism) or is the record's own identifying field (Vehicle Number, the vehicle a compliance
 * record belongs to, a Driver's own name) — hiding or optionalizing those would either let the
 * form silently produce unusable records or trap the user behind a guard for a field they can
 * no longer see.
 *
 * Not covered here (by design, same reasoning as Recurring Payments / Site Account Statement):
 * the Excel import wizards (a distinct, bulk-data-integrity mechanism with their own field list),
 * and the Vehicle Types / Trip Tracking settings screens (master-data list editors and toggles,
 * not entity forms).
 */

export type VMFormKey =
  | 'vehicleMaster'
  | 'insurance'
  | 'puc'
  | 'documents'
  | 'fitness'
  | 'roadTax'
  | 'permit'
  | 'maintenance'
  | 'fuel'
  | 'driver'
  | 'insuranceWorkflow'
  | 'driverMobileDailyStatus'
  | 'driverMobileFuel';

export interface VMFieldDef {
  key: string;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Visible/required are fixed when true — only the label can be customized. */
  locked?: boolean;
}

export interface VMFormDef {
  title: string;
  description: string;
  fields: VMFieldDef[];
}

export const VM_FORM_REGISTRY: Record<VMFormKey, VMFormDef> = {
  vehicleMaster: {
    title: 'Vehicle Master',
    description: 'The Add/Edit Vehicle form under Vehicle Master.',
    fields: [
      { key: 'vehicleNumber', defaultLabel: 'Vehicle Number', defaultRequired: true, locked: true },
      { key: 'vehicleType', defaultLabel: 'Vehicle Type', defaultRequired: true },
      { key: 'vehicleCategory', defaultLabel: 'Vehicle Category', defaultRequired: true },
      { key: 'brand', defaultLabel: 'Brand', defaultRequired: true },
      { key: 'model', defaultLabel: 'Model', defaultRequired: true },
      { key: 'yearOfManufacture', defaultLabel: 'Year Of Manufacture', defaultRequired: true },
      { key: 'fuelType', defaultLabel: 'Fuel Type', defaultRequired: true },
      { key: 'chassisNumber', defaultLabel: 'Chassis Number', defaultRequired: true },
      { key: 'engineNumber', defaultLabel: 'Engine Number', defaultRequired: true },
      { key: 'ownershipType', defaultLabel: 'Ownership Type', defaultRequired: true },
      { key: 'purchaseDate', defaultLabel: 'Purchase Date', defaultRequired: false },
      { key: 'purchaseValue', defaultLabel: 'Purchase Value', defaultRequired: false },
      { key: 'currentStatus', defaultLabel: 'Current Status', defaultRequired: false },
      { key: 'currentOdometerKm', defaultLabel: 'Current Odometer (KM)', defaultRequired: true },
      { key: 'vehicleStatus', defaultLabel: 'Vehicle Status', defaultRequired: true },
      { key: 'assignedDepartmentId', defaultLabel: 'Assigned Department', defaultRequired: false },
      { key: 'assignedProjectId', defaultLabel: 'Assigned Project', defaultRequired: false },
      { key: 'assignedDriverId', defaultLabel: 'Assigned Driver', defaultRequired: false },
      { key: 'complianceRuleMode', defaultLabel: 'Compliance Rule Mode', defaultRequired: true },
      { key: 'requireInsurance', defaultLabel: 'Insurance Required', defaultRequired: false },
      { key: 'requirePuc', defaultLabel: 'PUC Required', defaultRequired: false },
      { key: 'requireFitness', defaultLabel: 'Fitness Required', defaultRequired: false },
      { key: 'requireRoadTax', defaultLabel: 'Road Tax Required', defaultRequired: false },
      { key: 'requirePermit', defaultLabel: 'Permit Required', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  insurance: {
    title: 'Insurance',
    description: 'The Add/Edit/Renew Policy form on the Insurance page.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle Number', defaultRequired: true, locked: true },
      { key: 'insuranceCompany', defaultLabel: 'Insurance Company', defaultRequired: true },
      { key: 'policyNumber', defaultLabel: 'Policy Number', defaultRequired: true },
      { key: 'policyType', defaultLabel: 'Policy Type', defaultRequired: true },
      { key: 'startDate', defaultLabel: 'Start Date', defaultRequired: true },
      { key: 'expiryDate', defaultLabel: 'Expiry Date', defaultRequired: true },
      { key: 'premiumAmount', defaultLabel: 'Premium Amount', defaultRequired: true },
      { key: 'idvValue', defaultLabel: 'IDV Value', defaultRequired: false },
      { key: 'agentName', defaultLabel: 'Agent Name', defaultRequired: false },
      { key: 'agentContact', defaultLabel: 'Agent Contact', defaultRequired: false },
      { key: 'certificateDocumentUrl', defaultLabel: 'Document Upload', defaultRequired: true },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  puc: {
    title: 'PUC',
    description: 'The Add/Edit/Renew Certificate form on the PUC page.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle Number', defaultRequired: true, locked: true },
      { key: 'pucCertificateNumber', defaultLabel: 'PUC Certificate Number', defaultRequired: true },
      { key: 'issueDate', defaultLabel: 'Issue Date', defaultRequired: true },
      { key: 'expiryDate', defaultLabel: 'Expiry Date', defaultRequired: true },
      { key: 'testingCenterName', defaultLabel: 'Testing Center Name', defaultRequired: true },
      { key: 'amountPaid', defaultLabel: 'Amount Paid', defaultRequired: true },
      { key: 'certificateDocumentUrl', defaultLabel: 'Certificate Upload', defaultRequired: true },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  documents: {
    title: 'Documents',
    description: 'The Add/Edit Document form on the Documents page.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true, locked: true },
      { key: 'documentType', defaultLabel: 'Document Type', defaultRequired: true },
      { key: 'documentNumber', defaultLabel: 'Document Number', defaultRequired: true },
      { key: 'issuingAuthority', defaultLabel: 'Issuing Authority', defaultRequired: false },
      { key: 'issueDate', defaultLabel: 'Issue Date', defaultRequired: false },
      { key: 'expiryDate', defaultLabel: 'Expiry Date', defaultRequired: false },
      { key: 'fileUrl', defaultLabel: 'Document File', defaultRequired: true },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  fitness: {
    title: 'Fitness Certificate',
    description: 'The Add/Edit Fitness Certificate form.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true, locked: true },
      { key: 'isMandatory', defaultLabel: 'Mandatory', defaultRequired: false },
      { key: 'fitnessCertificateNumber', defaultLabel: 'Fitness Certificate Number', defaultRequired: true },
      { key: 'issueDate', defaultLabel: 'Issue Date', defaultRequired: true },
      { key: 'expiryDate', defaultLabel: 'Expiry Date', defaultRequired: true },
      { key: 'rtoName', defaultLabel: 'RTO Name', defaultRequired: true },
      { key: 'amountPaid', defaultLabel: 'Amount Paid', defaultRequired: true },
      { key: 'certificateDocumentUrl', defaultLabel: 'Certificate Document', defaultRequired: true },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  roadTax: {
    title: 'Road Tax',
    description: 'The Add/Edit Road Tax form.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true, locked: true },
      { key: 'taxType', defaultLabel: 'Tax Type', defaultRequired: true },
      { key: 'taxPeriod', defaultLabel: 'Tax Period', defaultRequired: true },
      { key: 'paymentDate', defaultLabel: 'Payment Date', defaultRequired: true },
      { key: 'validTill', defaultLabel: 'Valid Till', defaultRequired: true },
      { key: 'amountPaid', defaultLabel: 'Amount Paid', defaultRequired: true },
      { key: 'penaltyAmount', defaultLabel: 'Penalty Amount', defaultRequired: false },
      { key: 'receiptNumber', defaultLabel: 'Receipt Number', defaultRequired: true },
      { key: 'receiptDocumentUrl', defaultLabel: 'Receipt Document', defaultRequired: true },
      { key: 'paymentMode', defaultLabel: 'Payment Mode', defaultRequired: false },
      { key: 'transactionReference', defaultLabel: 'Transaction Reference', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  permit: {
    title: 'Permit',
    description: 'The Add/Edit Permit form.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true, locked: true },
      { key: 'isMandatory', defaultLabel: 'Mandatory', defaultRequired: false },
      { key: 'permitType', defaultLabel: 'Permit Type', defaultRequired: true },
      { key: 'permitNumber', defaultLabel: 'Permit Number', defaultRequired: true },
      { key: 'validFrom', defaultLabel: 'Valid From', defaultRequired: true },
      { key: 'validTill', defaultLabel: 'Valid Till', defaultRequired: true },
      { key: 'issuingAuthority', defaultLabel: 'Issuing Authority', defaultRequired: true },
      { key: 'amountPaid', defaultLabel: 'Amount Paid', defaultRequired: true },
      { key: 'permitDocumentUrl', defaultLabel: 'Permit Document', defaultRequired: true },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  maintenance: {
    title: 'Maintenance',
    description: 'The Add/Edit Maintenance Log form.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true, locked: true },
      { key: 'maintenanceType', defaultLabel: 'Maintenance Type', defaultRequired: true },
      { key: 'serviceDate', defaultLabel: 'Service Date', defaultRequired: true },
      { key: 'serviceDoneDate', defaultLabel: 'Service Done Date', defaultRequired: false },
      { key: 'odometerReadingKm', defaultLabel: 'Odometer Reading (KM)', defaultRequired: true },
      { key: 'garageName', defaultLabel: 'Garage Name', defaultRequired: true },
      { key: 'garageContactNumber', defaultLabel: 'Garage Contact Number', defaultRequired: false },
      { key: 'workDescription', defaultLabel: 'Work Description', defaultRequired: true },
      { key: 'partsReplaced', defaultLabel: 'Parts Replaced', defaultRequired: false },
      { key: 'labourCost', defaultLabel: 'Labour Cost', defaultRequired: true },
      { key: 'partsCost', defaultLabel: 'Parts Cost', defaultRequired: true },
      { key: 'otherCharges', defaultLabel: 'Other Charges', defaultRequired: false },
      { key: 'nextServiceDate', defaultLabel: 'Next Service Date', defaultRequired: false },
      { key: 'nextServiceKm', defaultLabel: 'Next Service (KM)', defaultRequired: false },
      { key: 'invoiceNumber', defaultLabel: 'Invoice Number', defaultRequired: false },
      { key: 'jobCardNumber', defaultLabel: 'Job Card Number', defaultRequired: false },
      { key: 'invoiceDocumentUrl', defaultLabel: 'Invoice Document', defaultRequired: true },
      { key: 'approvalStatus', defaultLabel: 'Approval Status', defaultRequired: false },
      { key: 'approvedBy', defaultLabel: 'Approved By', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  fuel: {
    title: 'Fuel (Office Entry)',
    description: 'The Add/Edit Fuel Log form used by admins/office staff.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true, locked: true },
      { key: 'fuelDate', defaultLabel: 'Fuel Date', defaultRequired: true },
      { key: 'fillType', defaultLabel: 'Fill Type', defaultRequired: true },
      { key: 'quantityLiters', defaultLabel: 'Quantity (Liters)', defaultRequired: true },
      { key: 'ratePerUnit', defaultLabel: 'Rate Per Unit', defaultRequired: true },
      { key: 'odometerReadingKm', defaultLabel: 'Odometer Reading (KM)', defaultRequired: true },
      { key: 'previousOdometerReadingKm', defaultLabel: 'Previous Odometer Reading (KM)', defaultRequired: false },
      { key: 'fuelStationName', defaultLabel: 'Fuel Station Name', defaultRequired: true },
      { key: 'fuelStationCity', defaultLabel: 'Fuel Station City', defaultRequired: false },
      { key: 'billNumber', defaultLabel: 'Bill Number', defaultRequired: false },
      { key: 'billUploadUrl', defaultLabel: 'Bill Upload', defaultRequired: true },
      { key: 'paymentMode', defaultLabel: 'Payment Mode', defaultRequired: false },
      { key: 'transactionReference', defaultLabel: 'Transaction Reference', defaultRequired: false },
      { key: 'fuelStatus', defaultLabel: 'Fuel Status', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  driver: {
    title: 'Driver Master',
    description: 'The Add/Edit Driver form.',
    fields: [
      { key: 'driverName', defaultLabel: 'Driver Name', defaultRequired: true, locked: true },
      { key: 'linkedUserId', defaultLabel: 'Linked User', defaultRequired: false },
      { key: 'mobileNumber', defaultLabel: 'Mobile Number', defaultRequired: true },
      { key: 'alternateNumber', defaultLabel: 'Alternate Number', defaultRequired: false },
      { key: 'emergencyContactName', defaultLabel: 'Emergency Contact Name', defaultRequired: false },
      { key: 'emergencyContactNumber', defaultLabel: 'Emergency Contact Number', defaultRequired: false },
      { key: 'bloodGroup', defaultLabel: 'Blood Group', defaultRequired: false },
      { key: 'experienceYears', defaultLabel: 'Experience (Years)', defaultRequired: false },
      { key: 'licenseNumber', defaultLabel: 'License Number', defaultRequired: true },
      { key: 'licenseClass', defaultLabel: 'License Class', defaultRequired: false },
      { key: 'licenseExpiryDate', defaultLabel: 'License Expiry Date', defaultRequired: true },
      { key: 'address', defaultLabel: 'Address', defaultRequired: true },
      { key: 'assignedVehicleId', defaultLabel: 'Assigned Vehicle', defaultRequired: false },
      { key: 'ownVehicleNumber', defaultLabel: 'Own Vehicle Number', defaultRequired: true },
      { key: 'ownVehicleType', defaultLabel: 'Own Vehicle Type', defaultRequired: true },
      { key: 'ownFuelType', defaultLabel: 'Own Vehicle Fuel Type', defaultRequired: true },
      { key: 'joiningDate', defaultLabel: 'Joining Date', defaultRequired: true },
      { key: 'status', defaultLabel: 'Status', defaultRequired: true },
      { key: 'licenseDocumentUrl', defaultLabel: 'License Document', defaultRequired: true },
      { key: 'driverPhotoUrl', defaultLabel: 'Driver Photo', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  insuranceWorkflow: {
    title: 'Insurance Workflow Actions',
    description: 'The "Take Action" and "Reassign Task" controls on the Insurance Expiry Workflow page. Most fields are locked because the workflow step\'s own configuration already decides when they\'re required.',
    fields: [
      { key: 'selectedAction', defaultLabel: 'Action', defaultRequired: true, locked: true },
      { key: 'proposedPremiumText', defaultLabel: 'Proposed renewal premium', defaultRequired: false },
      { key: 'supportingDocument', defaultLabel: 'Supporting Document', defaultRequired: false, locked: true },
      { key: 'comment', defaultLabel: 'Comment', defaultRequired: false, locked: true },
      { key: 'reassignUserId', defaultLabel: 'Reassign to', defaultRequired: true, locked: true },
    ],
  },
  driverMobileDailyStatus: {
    title: 'Driver Daily Status',
    description: 'The driver-facing Daily Status entry form.',
    fields: [
      { key: 'statusDate', defaultLabel: 'Date', defaultRequired: true },
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true },
      { key: 'shiftStartTime', defaultLabel: 'Shift Start Time', defaultRequired: false },
      { key: 'shiftEndTime', defaultLabel: 'Shift End Time', defaultRequired: false },
      { key: 'openingOdometerKm', defaultLabel: 'Opening Odometer (KM)', defaultRequired: false },
      { key: 'closingOdometerKm', defaultLabel: 'Closing Odometer (KM)', defaultRequired: false },
      { key: 'openingFuelLiters', defaultLabel: 'Opening Fuel (Liters)', defaultRequired: false },
      { key: 'closingFuelLiters', defaultLabel: 'Closing Fuel (Liters)', defaultRequired: false },
      { key: 'totalTrips', defaultLabel: 'Total Trips', defaultRequired: false },
      { key: 'runningStatus', defaultLabel: 'Running Status', defaultRequired: true },
      { key: 'routeSummary', defaultLabel: 'Route Summary', defaultRequired: false },
      { key: 'issuesReported', defaultLabel: 'Issues Reported', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
  driverMobileFuel: {
    title: 'Driver Fuel Entry',
    description: 'The driver-facing Fuel Entry form. Quantity, rate and odometer are locked because the form has its own greater-than-zero check for each.',
    fields: [
      { key: 'vehicleId', defaultLabel: 'Vehicle', defaultRequired: true },
      { key: 'fuelDate', defaultLabel: 'Date', defaultRequired: true },
      { key: 'fuelStationName', defaultLabel: 'Fuel Station Name', defaultRequired: true },
      { key: 'quantityLiters', defaultLabel: 'Quantity (Liters)', defaultRequired: true, locked: true },
      { key: 'ratePerUnit', defaultLabel: 'Rate Per Unit', defaultRequired: true, locked: true },
      { key: 'odometerReadingKm', defaultLabel: 'Odometer Reading (KM)', defaultRequired: true, locked: true },
      { key: 'previousOdometerReadingKm', defaultLabel: 'Previous Odometer Reading (KM)', defaultRequired: false },
      { key: 'billNumber', defaultLabel: 'Bill Number', defaultRequired: false },
      { key: 'billFile', defaultLabel: 'Bill Upload', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
    ],
  },
};

export const VM_FORM_KEYS = Object.keys(VM_FORM_REGISTRY) as VMFormKey[];
