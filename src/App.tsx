import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent, ReactElement } from "react";
import type { CopyPastable, Folder, VaultBackup } from "./types";
import {
  createCopyPastable,
  createFolder,
  deleteCopyPastable,
  deleteFolder,
  exportVault,
  getCopyPastables,
  getFolders,
  importVault,
  moveCopyPastable,
  moveFolder,
  updateCopyPastable,
  updateFolder,
  validateBackup,
} from "./storage/vault";

type EditorState = {
  kind: "file" | "folder";
  item?: CopyPastable | Folder;
  parentFolderId: string | null;
};
const uid = () => crypto.randomUUID();
const timestamp = () => Date.now();

export default function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<CopyPastable[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      const [nextFolders, nextItems] = await Promise.all([
        getFolders(),
        getCopyPastables(),
      ]);
      setFolders(nextFolders);
      setItems(nextItems);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to load your vault.",
      );
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const getPath = (parentId: string | null) => {
    const path: string[] = [];
    let current = parentId;
    while (current) {
      const folder = folderMap.get(current);
      if (!folder) break;
      path.unshift(folder.name);
      current = folder.parentFolderId;
    }
    return path;
  };
  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return items
      .filter((item) =>
        `${item.title} ${item.content}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [items, query]);

  const submitEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const content = String(data.get("content") ?? "");
    if (!name) return;
    try {
      if (editor?.kind === "folder") {
        const existing = editor.item as Folder | undefined;
        const folder = existing
          ? { ...existing, name, updatedAt: timestamp() }
          : {
              id: uid(),
              name,
              parentFolderId: editor.parentFolderId,
              createdAt: timestamp(),
              updatedAt: timestamp(),
            };
        await (existing ? updateFolder(folder) : createFolder(folder));
        if (!existing)
          setExpanded((current) =>
            new Set(current).add(editor.parentFolderId ?? ""),
          );
      } else {
        const existing = editor?.item as CopyPastable | undefined;
        const item = existing
          ? { ...existing, title: name, content, updatedAt: timestamp() }
          : {
              id: uid(),
              title: name,
              content,
              parentFolderId: editor?.parentFolderId ?? null,
              createdAt: timestamp(),
              updatedAt: timestamp(),
            };
        await (existing ? updateCopyPastable(item) : createCopyPastable(item));
        setOpenFile(item.id);
      }
      setEditor(null);
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to save changes.",
      );
    }
  };

  const removeFile = async (item: CopyPastable) => {
    if (!window.confirm(`Delete “${item.title}”?`)) return;
    try {
      await deleteCopyPastable(item.id);
      setOpenFile(null);
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to delete item.",
      );
    }
  };
  const removeFolder = async (folder: Folder) => {
    const descendants = folders.filter((candidate) => {
      let parent = candidate.parentFolderId;
      while (parent) {
        if (parent === folder.id) return true;
        parent = folderMap.get(parent)?.parentFolderId ?? null;
      }
      return false;
    });
    const childCount =
      descendants.length +
      items.filter((item) => {
        let parent = item.parentFolderId;
        while (parent) {
          if (parent === folder.id) return true;
          parent = folderMap.get(parent)?.parentFolderId ?? null;
        }
        return false;
      }).length;
    if (
      !window.confirm(
        childCount
          ? `Delete “${folder.name}” and its ${childCount} nested item${childCount === 1 ? "" : "s"}?`
          : `Delete “${folder.name}”?`,
      )
    )
      return;
    try {
      for (const item of items.filter(
        (item) =>
          item.parentFolderId === folder.id ||
          descendants.some((child) => child.id === item.parentFolderId),
      ))
        await deleteCopyPastable(item.id);
      for (const child of [...descendants].sort((a, b) =>
        b.parentFolderId!.localeCompare(a.parentFolderId!),
      ))
        await deleteFolder(child.id);
      await deleteFolder(folder.id);
      setSelectedFolder(null);
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to delete folder.",
      );
    }
  };

  const copyItem = async (item: CopyPastable) => {
    try {
      await navigator.clipboard.writeText(item.content);
      setNotice("Copied!");
    } catch {
      setNotice("Clipboard access failed. Try again from the extension popup.");
    }
  };
  const canDrop = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return false;
    let parent = folderMap.get(targetId)?.parentFolderId;
    while (parent) {
      if (parent === draggedId) return false;
      parent = folderMap.get(parent)?.parentFolderId;
    }
    return true;
  };
  const dropOn = async (event: DragEvent, parentFolderId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = event.dataTransfer.getData("text/plain");
    if (!payload) return;
    const [kind, id] = payload.split(":");
    try {
      if (kind === "folder") {
        if (parentFolderId && !canDrop(id, parentFolderId))
          return setNotice("A folder cannot be moved into itself.");
        const folder = folderMap.get(id);
        if (folder) await moveFolder(folder, parentFolderId);
      } else {
        const item = items.find((candidate) => candidate.id === id);
        if (item) await moveCopyPastable(item, parentFolderId);
      }
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to move item.",
      );
    }
  };
  const startDrag = (event: DragEvent, kind: string, id: string) => {
    event.dataTransfer.setData("text/plain", `${kind}:${id}`);
    event.dataTransfer.effectAllowed = "move";
  };

  const downloadExport = async () => {
    try {
      const backup = await exportVault();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "browser-vault-backup.json";
      link.click();
      URL.revokeObjectURL(url);
      setMenuOpen(false);
    } catch {
      setNotice("Unable to export your vault.");
    }
  };
  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!validateBackup(value))
        throw new Error("That file is not a valid Browser Vault backup.");
      const mode = window.confirm(
        "Choose OK to merge this backup with your vault. Choose Cancel to replace the current vault.",
      );
      await importVault(value as VaultBackup, mode ? "merge" : "replace");
      await refresh();
      setNotice("Vault imported.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to import backup.",
      );
    }
    setMenuOpen(false);
  };

  const renderTree = (parentId: string | null, depth = 0): ReactElement[] => {
    const childFolders = folders
      .filter((folder) => folder.parentFolderId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const childItems = items
      .filter((item) => item.parentFolderId === parentId)
      .sort((a, b) => a.title.localeCompare(b.title));
    return [
      ...childFolders.flatMap((folder) => {
        const isExpanded = expanded.has(folder.id);
        return [
          <div
            key={folder.id}
            className={`tree-row folder-row ${selectedFolder === folder.id ? "selected" : ""}`}
            style={{ paddingLeft: 10 + depth * 18 }}
            draggable
            onDragStart={(event) => startDrag(event, "folder", folder.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void dropOn(event, folder.id)}
          >
            <button
              className="tree-main"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedFolder(folder.id);
                setExpanded((current) => {
                  const next = new Set(current);
                  isExpanded ? next.delete(folder.id) : next.add(folder.id);
                  return next;
                });
              }}
            >
              <span className="chevron">{isExpanded ? "⌄" : "›"}</span>
              <span className="icon folder-icon">▰</span>
              <span className="tree-label">{folder.name}</span>
            </button>
            <button
              className="row-action"
              title="Rename folder"
              onClick={(event) => {
                event.stopPropagation();
                setEditor({
                  kind: "folder",
                  item: folder,
                  parentFolderId: folder.parentFolderId,
                });
              }}
            >
              •••
            </button>
          </div>,
          ...(isExpanded ? renderTree(folder.id, depth + 1) : []),
        ];
      }),
      ...childItems.flatMap((item) => [
        <div
          key={item.id}
          className={`tree-row file-row ${openFile === item.id ? "active" : ""}`}
          style={{ paddingLeft: 28 + depth * 18 }}
          draggable
          onDragStart={(event) => startDrag(event, "file", item.id)}
        >
          <button
            className="tree-main"
            onClick={(event) => {
              event.stopPropagation();
              setOpenFile(openFile === item.id ? null : item.id);
            }}
          >
            <span className="icon file-icon">▤</span>
            <span className="tree-label">{item.title}</span>
          </button>
        </div>,
        ...(openFile === item.id
          ? [
              <div
                className="details"
                key={`${item.id}-details`}
                style={{ marginLeft: 28 + depth * 18 }}
              >
                <div className="detail-title">{item.title}</div>
                <p>{item.content || "Empty copy-pastable"}</p>
                <div className="detail-actions">
                  <button
                    onClick={() => void copyItem(item)}
                    title="Copy content"
                  >
                    ↗ <span>Copy</span>
                  </button>
                  <button
                    onClick={() =>
                      setEditor({
                        kind: "file",
                        item,
                        parentFolderId: item.parentFolderId,
                      })
                    }
                    title="Edit item"
                  >
                    ✎ <span>Edit</span>
                  </button>
                  <button
                    className="danger"
                    onClick={() => void removeFile(item)}
                    title="Delete item"
                  >
                    × <span>Delete</span>
                  </button>
                </div>
              </div>,
            ]
          : []),
      ]),
    ];
  };

  return (
    <main className="app-shell">
      <header>
        <div className="brand">
          <span className="brand-mark">◇</span>
          <div>
            <h1>Browser Vault</h1>
            <span className="subtitle">
              Your reusable snippets, close at hand.
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="header-button"
            onClick={() =>
              setEditor({ kind: "folder", parentFolderId: selectedFolder })
            }
            title="New folder"
          >
            + <span>Folder</span>
          </button>
          <button
            className="primary-button"
            onClick={() =>
              setEditor({ kind: "file", parentFolderId: selectedFolder })
            }
            title="New copy-pastable"
          >
            ▤ <span>New</span>
          </button>
          <div className="menu-wrap">
            <button
              className="icon-button"
              onClick={() => setMenuOpen(!menuOpen)}
              title="Vault settings"
            >
              •••
            </button>
            {menuOpen && (
              <div className="menu">
                <button onClick={() => void downloadExport()}>
                  ↓ Export Vault
                </button>
                <button onClick={() => importInput.current?.click()}>
                  ↑ Import Vault
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <section className="search-area">
        <label className="search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search snippets..."
          />
          <kbd>⌘ K</kbd>
        </label>
        {query && (
          <span className="result-count">
            {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
          </span>
        )}
      </section>
      <section
        className="explorer"
        onClick={() => setSelectedFolder(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void dropOn(event, null)}
      >
        {query ? (
          searchResults.length ? (
            searchResults.map((item) => (
              <div className="search-result" key={item.id}>
                <button
                  className="tree-main"
                  onClick={() => {
                    setQuery("");
                    setOpenFile(item.id);
                  }}
                >
                  <span className="icon file-icon">▤</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {getPath(item.parentFolderId).join(" / ") || "Root"}
                    </small>
                  </span>
                </button>
              </div>
            ))
          ) : (
            <div className="empty">
              <span>⌕</span>
              <strong>No matching snippets</strong>
              <small>Try a different title or phrase.</small>
            </div>
          )
        ) : folders.length || items.length ? (
          renderTree(null)
        ) : (
          <div className="empty">
            <span className="empty-mark">◇</span>
            <strong>Your vault is ready</strong>
            <small>Create a folder or your first copy-pastable.</small>
          </div>
        )}
      </section>
      <footer>
        <span>
          <i className="status-dot" /> Stored locally in this browser
        </span>
        <span>
          {folders.length} folders · {items.length} snippets
        </span>
      </footer>
      {notice && <div className="toast">{notice}</div>}
      <input
        ref={importInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(event) => void readImport(event)}
      />
      {editor && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditor(null);
          }}
        >
          <form
            className="editor"
            onSubmit={(event) => void submitEditor(event)}
          >
            <div className="editor-head">
              <span className="eyebrow">
                {editor.item ? "UPDATE" : "NEW"}{" "}
                {editor.kind === "file" ? "COPY-PASTABLE" : "FOLDER"}
              </span>
              <button
                type="button"
                className="close"
                onClick={() => setEditor(null)}
              >
                ×
              </button>
            </div>
            <label>
              {editor.kind === "file" ? "Title" : "Folder name"}
              <input
                name="name"
                autoFocus
                defaultValue={
                  editor.item
                    ? ((editor.item as CopyPastable | Folder).title ??
                      (editor.item as Folder).name)
                    : ""
                }
                placeholder={
                  editor.kind === "file"
                    ? "e.g. Pull request summary"
                    : "e.g. Engineering"
                }
              />
            </label>
            {editor.kind === "file" && (
              <label>
                Content
                <textarea
                  name="content"
                  defaultValue={
                    (editor.item as CopyPastable | undefined)?.content ?? ""
                  }
                  placeholder="Paste the reusable text here..."
                  rows={7}
                />
              </label>
            )}
            <div className="editor-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Save {editor.kind === "file" ? "snippet" : "folder"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
