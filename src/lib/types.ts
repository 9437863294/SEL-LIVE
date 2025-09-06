





export type Module = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  icon: string;
};

export type Department = {
  id:string;
  name: string;
  head: string;
  status: 'Active' | 'Inactive';
};

export type Project = {
  id: string;
  projectName: string;
  siteCode: string;
  projectSite: string;
  projectDivision: string;
  location: string;
  siteInCharge: string;
  status: 'Active' | 'Inactive';
};

export type Employee = {
    id: string;
    employeeId: string;
    name: string;
    email: string;
    phone: string;
    department: string;
    designation: string;
    status: 'Active' | 'Inactive';
};

export type User = {
    id: string;
    name: string;
    email: string;
    mobile: string;
    role: string; // Changed from 'Admin' | 'User' to string to support dynamic roles
    status: 'Active' | 'Inactive';
    photoURL?: string;
};

export type Role = {
  id: string;
  name: string;
  permissions: Record<string, string[]>;
};

export type WorkingHours = {
  [key: string]: {
    isWorkDay: boolean;
    startTime: string;
    endTime: string;
  }
};

export type Holiday = {
  id: string;
  name: string;
  date: string;
};

export type ActionLog = {
  action: string;
  comment: string;
  userId: string;
  userName: string;
  timestamp: any; // Firestore Server Timestamp
  stepName: string;
};

export type Requisition = {
  id: string;
  requisitionId: string;
  projectId: string;
  departmentId: string;
  amount: number;
  description: string;
  raisedBy: string;
  raisedById: string;
  status: 'Pending' | 'In Progress' | 'Approved' | 'Rejected' | 'Completed';
  stage: string;
  date: string;
  createdAt: any; // Firestore Timestamp
  currentStepId?: string | null;
  assignedToId?: string | null;
  deadline?: any; // Firestore Timestamp
  history: ActionLog[];
};

export type SerialNumberConfig = {
  prefix: string;
  format: string;
  suffix: string;
  startingIndex: number;
};

export type AmountBasedCondition = {
  id: string;
  type: 'Below' | 'Between' | 'Above';
  amount1: number;
  amount2?: number;
  userId: string;
};

export type WorkflowStep = {
  id: string;
  name: string;
  tat: number; // Turnaround time in hours
  assignmentType: 'User-based' | 'Project-based' | 'Department-based' | 'Amount-based';
  assignedTo: string[] | Record<string, string> | AmountBasedCondition[];
  actions: string[];
  upload: 'Required' | 'Not Required' | 'Optional';
};

export type PositionDetail = {
    id: number;
    category: string;
    value: number;
    effectiveFrom: string;
    effectiveTo: string | null;
};

export type EmployeePosition = {
    employeeId: number;
    categoryList: PositionDetail[];
};
