import { clearStore, getAll, put, remove } from "./db";
import type { CopyPastable, Folder, VaultBackup } from "../types";

type VaultItem = Folder | CopyPastable;

function isValidPriority(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function normalizePriorities<T extends VaultItem>(
  values: T[],
  getName: (value: T) => string,
): T[] {
  const normalized = [...values];
  const groups = new Map<string | null, T[]>();

  for (const value of values) {
    const group = groups.get(value.parentFolderId) ?? [];
    group.push(value);
    groups.set(value.parentFolderId, group);
  }

  for (const group of groups.values()) {
    const priorities = group.map((value) => value.priority);
    const hasUniquePriorities =
      priorities.every(isValidPriority) &&
      new Set(priorities).size === priorities.length;

    if (hasUniquePriorities) continue;

    const ordered = [...group].sort((a, b) => {
      const aPriority = isValidPriority(a.priority)
        ? a.priority
        : Number.MAX_SAFE_INTEGER;
      const bPriority = isValidPriority(b.priority)
        ? b.priority
        : Number.MAX_SAFE_INTEGER;

      return (
        aPriority - bPriority ||
        getName(a).localeCompare(getName(b)) ||
        a.id.localeCompare(b.id)
      );
    });

    ordered.forEach((value, priority) => {
      const index = normalized.findIndex((candidate) => candidate.id === value.id);
      normalized[index] = { ...value, priority };
    });
  }

  return normalized;
}

async function getNormalized<T extends VaultItem>(
  storeName: "folders" | "copyPastables",
  getName: (value: T) => string,
): Promise<T[]> {
  const values = await getAll<T>(storeName);
  const normalized = normalizePriorities(values, getName);
  const changed = normalized.filter(
    (value, index) => value.priority !== values[index]?.priority,
  );

  if (changed.length) {
    await Promise.all(changed.map((value) => put(storeName, value)));
  }

  return normalized;
}

async function nextPriority(
  kind: "folder" | "file",
  parentFolderId: string | null,
  excludeId?: string,
): Promise<number> {
  const siblings =
    kind === "folder"
      ? (await getFolders()).filter(
          (folder) =>
            folder.parentFolderId === parentFolderId && folder.id !== excludeId,
        )
      : (await getCopyPastables()).filter(
          (item) =>
            item.parentFolderId === parentFolderId && item.id !== excludeId,
        );

  return (
    siblings.reduce(
      (maximum, sibling) =>
        Math.max(maximum, isValidPriority(sibling.priority) ? sibling.priority : -1),
      -1,
    ) + 1
  );
}

export const getFolders = () =>
  getNormalized<Folder>("folders", (folder) => folder.name);
export const getCopyPastables = () =>
  getNormalized<CopyPastable>("copyPastables", (item) => item.title);
export async function createFolder(folder: Folder) {
  await put("folders", {
    ...folder,
    priority:
      isValidPriority(folder.priority)
        ? folder.priority
        : await nextPriority("folder", folder.parentFolderId),
  });
}
export async function updateFolder(folder: Folder) {
  await put("folders", {
    ...folder,
    priority:
      isValidPriority(folder.priority)
        ? folder.priority
        : await nextPriority("folder", folder.parentFolderId, folder.id),
  });
}
export const deleteFolder = (id: string) => remove("folders", id);
export async function createCopyPastable(item: CopyPastable) {
  await put("copyPastables", {
    ...item,
    priority:
      isValidPriority(item.priority)
        ? item.priority
        : await nextPriority("file", item.parentFolderId),
  });
}
export async function updateCopyPastable(item: CopyPastable) {
  await put("copyPastables", {
    ...item,
    priority:
      isValidPriority(item.priority)
        ? item.priority
        : await nextPriority("file", item.parentFolderId, item.id),
  });
}
export const deleteCopyPastable = (id: string) => remove("copyPastables", id);

export async function moveFolder(
  folder: Folder,
  parentFolderId: string | null,
) {
  await put("folders", {
    ...folder,
    parentFolderId,
    priority: await nextPriority("folder", parentFolderId, folder.id),
    updatedAt: Date.now(),
  });
}

export async function moveCopyPastable(
  item: CopyPastable,
  parentFolderId: string | null,
) {
  await put("copyPastables", {
    ...item,
    parentFolderId,
    priority: await nextPriority("file", parentFolderId, item.id),
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
  const hasCompatiblePriority =
    !("priority" in value) || typeof value.priority === "number";
  return kind === "folder"
    ? hasBase && hasCompatiblePriority && typeof value.name === "string"
    : hasBase &&
        hasCompatiblePriority &&
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
  const folders = normalizePriorities(backup.folders, (folder) => folder.name);
  const copyPastables = normalizePriorities(
    backup.copyPastables,
    (item) => item.title,
  );

  if (mode === "replace") {
    await Promise.all([clearStore("folders"), clearStore("copyPastables")]);
  } else {
    const [folders, items] = await Promise.all([
      getFolders(),
      getCopyPastables(),
    ]);
    const existingIds = new Set([...folders, ...items].map((item) => item.id));
    if (
      [...folders, ...copyPastables].some((item) =>
        existingIds.has(item.id),
      )
    )
      throw new Error(
        "This backup contains IDs already in your vault. Choose Replace or remove duplicates.",
      );
  }
  await Promise.all([
    ...folders.map((folder) => put("folders", folder)),
    ...copyPastables.map((item) => put("copyPastables", item)),
  ]);
}
