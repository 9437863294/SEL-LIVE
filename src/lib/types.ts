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
