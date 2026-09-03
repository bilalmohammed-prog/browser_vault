import type { CopyPastable, Folder } from "../types";

const DB_NAME = "BrowserVault";
const DB_VERSION = 1;

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open vault storage."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("folders"))
        database.createObjectStore("folders", { keyPath: "id" });
      if (!database.objectStoreNames.contains("copyPastables"))
        database.createObjectStore("copyPastables", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

export async function getAll<T>(
  storeName: "folders" | "copyPastables",
): Promise<T[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll();
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to read vault storage."));
    request.onsuccess = () => resolve(request.result as T[]);
  });
}

export async function put<T extends Folder | CopyPastable>(
  storeName: "folders" | "copyPastables",
  value: T,
) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .put(value);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to save this item."));
    request.onsuccess = () => resolve();
  });
}

export async function remove(
  storeName: "folders" | "copyPastables",
  id: string,
) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .delete(id);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to delete this item."));
    request.onsuccess = () => resolve();
  });
}

export async function clearStore(storeName: "folders" | "copyPastables") {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .clear();
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to clear vault storage."));
    request.onsuccess = () => resolve();
  });
}
