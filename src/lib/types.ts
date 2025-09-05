export type Module = {
  id: string;
  title: string;
  content: string;
  tags: string[];
};

export type Department = {
  id: string;
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
    role: 'Admin' | 'User';
    status: 'Active' | 'Inactive';
};
