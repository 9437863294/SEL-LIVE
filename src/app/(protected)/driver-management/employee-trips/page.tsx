'use client';

import { useMemo } from 'react';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useDepartmentOptions, useProjectOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'tripDate', label: 'Trip Date' },
  { key: 'submittedByName', label: 'Employee' },
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'travelPurpose', label: 'Purpose' },
  { key: 'totalDistanceKm', label: 'Distance (KM)' },
  { key: 'reimbursementAmount', label: 'Reimbursement' },
  { key: 'approvalStatus', label: 'Status' },
];

export default function EmployeeTripLogPage() {
  const { can } = useAuthorization();
  const { user } = useAuth();
  const { options: projectOptions, map: projectMap } = useProjectOptions();
  const { options: departmentOptions, map: departmentMap } = useDepartmentOptions();

  const canViewLegacyAdmin =
    can('View', 'Vehicle Management.Driver Management') ||
    can('View', 'Driver Management.Trip Management');

  const canManageAll =
    can('Edit', 'Driver Management.Employee Trip Log') ||
    can('Delete', 'Driver Management.Employee Trip Log') ||
    can('Approve', 'Driver Management.Employee Trip Log') ||
    can('Edit', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Delete', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Approve', 'Vehicle Management.Employee Trip Reimbursement') ||
    canViewLegacyAdmin;

  const canViewExplicit =
    can('View', 'Driver Management.Employee Trip Log') ||
    can('View', 'Vehicle Management.Employee Trip Reimbursement') ||
    canViewLegacyAdmin;

  const canAddPermission =
    can('Add', 'Driver Management.Employee Trip Log') ||
    can('Add', 'Vehicle Management.Employee Trip Reimbursement');

  const canEditPermission =
    can('Edit', 'Driver Management.Employee Trip Log') ||
    can('Edit', 'Vehicle Management.Employee Trip Reimbursement');

  const canDeletePermission =
    can('Delete', 'Driver Management.Employee Trip Log') ||
    can('Delete', 'Vehicle Management.Employee Trip Reimbursement');

  const canImportPermission =
    can('Import', 'Driver Management.Employee Trip Log') ||
    can('Import', 'Vehicle Management.Employee Trip Reimbursement');

  const canExportPermission =
    can('Export', 'Driver Management.Employee Trip Log') ||
    can('Export', 'Vehicle Management.Employee Trip Reimbursement');

  const canUseSelfMode = Boolean(user?.id);
  const canView = canViewExplicit || canManageAll || canUseSelfMode;
  const canAdd = canAddPermission || canManageAll || canUseSelfMode;
  const canEdit = canEditPermission || canManageAll || canUseSelfMode;
  const canDelete = canDeletePermission || canManageAll;
  const canImport = canImportPermission || canManageAll;
  const canExport = canExportPermission || canManageAll;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'tripDate', label: 'Trip Date', type: 'date', required: true },
      {
        key: 'tripType',
        label: 'Trip Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Local', label: 'Local' },
          { value: 'Outstation', label: 'Outstation' },
        ],
        defaultValue: 'Local',
      },
      {
        key: 'vehicleOwnershipType',
        label: 'Vehicle Ownership',
        type: 'select',
        required: true,
        options: [
          { value: 'Personal', label: 'Personal' },
          { value: 'Family', label: 'Family' },
          { value: 'Rental', label: 'Rental' },
          { value: 'Other', label: 'Other' },
        ],
        defaultValue: 'Personal',
      },
      { key: 'vehicleNumber', label: 'Vehicle Number', type: 'text', required: true },
      { key: 'vehicleType', label: 'Vehicle Type', type: 'text', required: true },
      {
        key: 'fuelType',
        label: 'Fuel Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Petrol', label: 'Petrol' },
          { value: 'Diesel', label: 'Diesel' },
          { value: 'CNG', label: 'CNG' },
          { value: 'Electric', label: 'Electric' },
          { value: 'Hybrid', label: 'Hybrid' },
          { value: 'Other', label: 'Other' },
        ],
        defaultValue: 'Petrol',
      },
      { key: 'travelPurpose', label: 'Travel Purpose', type: 'text', required: true },
      { key: 'startLocation', label: 'Start Location', type: 'text', required: true },
      { key: 'endLocation', label: 'End Location', type: 'text', required: true },
      { key: 'startOdometerKm', label: 'Start Odometer (KM)', type: 'number', required: true, step: '0.1' },
      { key: 'endOdometerKm', label: 'End Odometer (KM)', type: 'number', required: true, step: '0.1' },
      { key: 'ratePerKm', label: 'Rate Per KM', type: 'number', required: true, step: '0.01', defaultValue: '0' },
      { key: 'parkingTollAmount', label: 'Parking / Toll', type: 'number', step: '0.01', defaultValue: '0' },
      { key: 'otherExpenseAmount', label: 'Other Expense', type: 'number', step: '0.01', defaultValue: '0' },
      { key: 'projectId', label: 'Project', type: 'select', options: projectOptions },
      { key: 'departmentId', label: 'Department', type: 'select', options: departmentOptions },
      {
        key: 'approvalStatus',
        label: 'Approval Status',
        type: 'select',
        required: true,
        options: [
          { value: 'Submitted', label: 'Submitted' },
          { value: 'Under Review', label: 'Under Review' },
          { value: 'Approved', label: 'Approved' },
          { value: 'Rejected', label: 'Rejected' },
          { value: 'Reimbursed', label: 'Reimbursed' },
        ],
        defaultValue: 'Submitted',
      },
      { key: 'supportingDocumentUrl', label: 'Supporting Document', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      { key: 'approverRemarks', label: 'Approver Remarks', type: 'textarea' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [departmentOptions, projectOptions]
  );

  return (
    <GenericCrudPage
      title="Employee Trip Reimbursement"
      description="Personal-vehicle office trip records with reimbursement tracking."
      itemName="Employee Trip"
      collectionName={VEHICLE_COLLECTIONS.employeeTrips}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="employee-trip-reimbursement"
      defaultSort={{ key: 'tripDate', direction: 'desc' }}
      onBeforeSave={(payload, currentRow) => {
        const startKm = Number(payload.startOdometerKm || 0);
        const endKm = Number(payload.endOdometerKm || 0);
        const baseDistance = endKm > startKm ? endKm - startKm : 0;
        const totalDistanceKm = Number(baseDistance.toFixed(2));
        const ratePerKm = Number(payload.ratePerKm || 0);
        const parkingTollAmount = Number(payload.parkingTollAmount || 0);
        const otherExpenseAmount = Number(payload.otherExpenseAmount || 0);
        const reimbursementAmount = Number(
          (totalDistanceKm * ratePerKm + parkingTollAmount + otherExpenseAmount).toFixed(2)
        );

        const project = projectMap[String(payload.projectId || '')];
        const department = departmentMap[String(payload.departmentId || '')];

        const submittedByUserId = String(currentRow?.submittedByUserId || user?.id || '');
        const submittedByName = String(currentRow?.submittedByName || user?.name || '');
        const submittedByEmail = String(currentRow?.submittedByEmail || user?.email || '');
        const submittedByMobile = String(currentRow?.submittedByMobile || user?.mobile || '');

        return {
          ...payload,
          totalDistanceKm,
          reimbursementAmount,
          projectName: String(project?.projectName || project?.name || ''),
          departmentName: String(department?.name || ''),
          submittedByUserId,
          submittedByName,
          submittedByEmail,
          submittedByMobile,
        };
      }}
      onAfterFetch={(rows) => {
        if (canManageAll) return rows;
        const currentUserId = String(user?.id || '');
        if (!currentUserId) return [];
        return rows.filter((row) => String(row.submittedByUserId || '') === currentUserId);
      }}
    />
  );
}
