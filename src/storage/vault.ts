import { clearStore, getAll, put, remove } from "./db";
import type { CopyPastable, Folder, VaultBackup } from "../types";

export const getFolders = () => getAll<Folder>("folders");
export const getCopyPastables = () => getAll<CopyPastable>("copyPastables");
export const createFolder = (folder: Folder) => put("folders", folder);
export const updateFolder = (folder: Folder) => put("folders", folder);
export const deleteFolder = (id: string) => remove("folders", id);
export const createCopyPastable = (item: CopyPastable) =>
  put("copyPastables", item);
export const updateCopyPastable = (item: CopyPastable) =>
  put("copyPastables", item);
export const deleteCopyPastable = (id: string) => remove("copyPastables", id);

export async function moveFolder(
  folder: Folder,
  parentFolderId: string | null,
) {
  await put("folders", { ...folder, parentFolderId, updatedAt: Date.now() });
}

export async function moveCopyPastable(
  item: CopyPastable,
  parentFolderId: string | null,
) {
  await put("copyPastables", {
    ...item,
    parentFolderId,
    updatedAt: Date.now(),
  });
}

export async function exportVault(): Promise<VaultBackup> {
  const [folders, copyPastables] = await Promise.all([
    getFolders(),
    getCopyPastables(),
  ]);
  return { version: 1, exportedAt: Date.now(), folders, copyPastables };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validItem(value: unknown, kind: "folder" | "file"): boolean {
  if (!isRecord(value)) return false;
  const hasBase =
    typeof value.id === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    (typeof value.parentFolderId === "string" || value.parentFolderId === null);
  return kind === "folder"
    ? hasBase && typeof value.name === "string"
    : hasBase &&
        typeof value.title === "string" &&
        typeof value.content === "string";
}

export function validateBackup(value: unknown): value is VaultBackup {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.copyPastables)
  )
    return false;
  if (
    !value.folders.every((item) => validItem(item, "folder")) ||
    !value.copyPastables.every((item) => validItem(item, "file"))
  )
    return false;
  const folders = value.folders as Folder[];
  const allItems = [...folders, ...(value.copyPastables as CopyPastable[])];
  const allIds = new Set(allItems.map((item) => item.id));
  if (allIds.size !== allItems.length) return false;
  const ids = new Set(folders.map((folder) => folder.id));
  return (
    folders.every(
      (folder) =>
        folder.parentFolderId === null || ids.has(folder.parentFolderId),
    ) &&
    (value.copyPastables as CopyPastable[]).every(
      (item) => item.parentFolderId === null || ids.has(item.parentFolderId),
    )
  );
}

export async function importVault(
  backup: VaultBackup,
  mode: "merge" | "replace",
) {
  if (mode === "replace") {
    await Promise.all([clearStore("folders"), clearStore("copyPastables")]);
  } else {
    const [folders, items] = await Promise.all([
      getFolders(),
      getCopyPastables(),
    ]);
    const existingIds = new Set([...folders, ...items].map((item) => item.id));
    if (
      [...backup.folders, ...backup.copyPastables].some((item) =>
        existingIds.has(item.id),
      )
    )
      throw new Error(
        "This backup contains IDs already in your vault. Choose Replace or remove duplicates.",
      );
  }
  await Promise.all([
    ...backup.folders.map((folder) => put("folders", folder)),
    ...backup.copyPastables.map((item) => put("copyPastables", item)),
  ]);
}
