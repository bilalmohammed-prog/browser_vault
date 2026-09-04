export type Folder = {
  id: string;
  name: string;
  title?: never;
  parentFolderId: string | null;
  priority?: number;
  createdAt: number;
  updatedAt: number;
};

export type CopyPastable = {
  id: string;
  title: string;
  content: string;
  parentFolderId: string | null;
  priority?: number;
  createdAt: number;
  updatedAt: number;
};

export type VaultBackup = {
  version: 1;
  exportedAt: number;
  folders: Folder[];
  copyPastables: CopyPastable[];
};
