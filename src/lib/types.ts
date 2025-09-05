
export type Module = {
  id: string;
  title: string;
  content: string;
  tags: string[];
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
