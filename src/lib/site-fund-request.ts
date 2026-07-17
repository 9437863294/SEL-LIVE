export const SFR_COLLECTIONS = {
  projects: 'siteFundRequestProjects',
  requests: 'siteFundRequests',
} as const;

export interface SFRProject {
  id: string;
  centralProjectId: string;
  projectName: string;
  projectCode: string;
  assignedPersonId: string;
  assignedPersonName: string;
  altUserId?: string;
  altUserName?: string;
  viewerId?: string;
  viewerName?: string;
  status: 'Active' | 'Inactive';
  createdAt: any;
  updatedAt: any;
}
