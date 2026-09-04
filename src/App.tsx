import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  DragEvent,
  FormEvent,
  ReactElement,
} from "react";

import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  Link,
} from "lucide-react";
import { Folder as FolderIcon } from "lucide-react";
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

type PrioritizedCopyPastable = CopyPastable & { priority?: number };
type PrioritizedFolder = Folder & { priority?: number };
type DropMode = "before" | "inside" | "after";
type DropPreview = { targetId: string; mode: DropMode };

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
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);

  const [linkMode, setLinkMode] = useState(false);

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

  useEffect(() => {
  if (editor?.kind === "file") {
    const item = editor.item as CopyPastable | undefined;
    setLinkMode(item?.title.startsWith("/link ") ?? false);
  } else {
    setLinkMode(false);
  }
}, [editor]);

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
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (!terms.length) return [];

    return items
      .map((item) => {
        const title = item.title.toLowerCase();
        const content = item.content.toLowerCase();
        const searchable = `${title} ${content}`;

        // Every search term must appear somewhere in the result.
        if (!terms.every((term) => searchable.includes(term))) {
          return null;
        }

        let score = 0;

        for (const term of terms) {
          // Strongest signal: the title starts with the search term.
          if (title.startsWith(term)) score += 100;

          // Strong signal: the title contains the term.
          if (title.includes(term)) score += 50;

          // Content matches are useful, but rank below title matches.
          if (content.includes(term)) score += 10;
        }

        // Exact title matches should always float to the top.
        if (title === query.trim().toLowerCase()) {
          score += 1000;
        }

        return {
          item,
          score,
        };
      })
      .filter(
        (
          result,
        ): result is {
          item: CopyPastable;
          score: number;
        } => result !== null,
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.item.title.localeCompare(b.item.title),
      )
      .map(({ item }) => item);
  }, [items, query]);

  const submitEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const data = new FormData(event.currentTarget);

    // Keep the title capped even if something bypasses the HTML maxLength.
    let name = String(data.get("name") ?? "").trim();

    if (linkMode && !name.startsWith("/link ")) {
      name = `/link ${name}`;
    }

    if (!linkMode && name.startsWith("/link ")) {
      name = name.slice(6).trim();
    }

    name = name.slice(0, 30);

    const content = String(data.get("content") ?? "");

    if (!name) return;

    try {
      if (editor?.kind === "folder") {
        const existing = editor.item as Folder | undefined;

        const folder = existing
          ? {
              ...existing,
              name,
              updatedAt: timestamp(),
            }
          : {
              id: uid(),
              name,
              parentFolderId: editor.parentFolderId,
              priority: getNextPriority("folder", editor.parentFolderId),
              createdAt: timestamp(),
              updatedAt: timestamp(),
            };

        await (existing ? updateFolder(folder) : createFolder(folder));

        if (!existing && editor.parentFolderId) {
          setExpanded((current) => {
            const next = new Set(current);
            next.add(editor.parentFolderId!);
            return next;
          });
        }
      } else {
        const existing = editor?.item as CopyPastable | undefined;

        const item = existing
          ? {
              ...existing,
              title: name,
              content,
              updatedAt: timestamp(),
            }
          : {
              id: uid(),
              title: name,
              content,
              parentFolderId: editor?.parentFolderId ?? null,
              priority: getNextPriority(
                "file",
                editor?.parentFolderId ?? null,
              ),
              createdAt: timestamp(),
              updatedAt: timestamp(),
            };

        await (
          existing
            ? updateCopyPastable(item)
            : createCopyPastable(item)
        );

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
    const openSearchResult = (item: CopyPastable) => {
    // Clear the search surface first so the normal explorer becomes visible.
    setQuery("");

    // Select the actual file.
    setOpenFile(item.id);

    // Clear any folder selection because we're opening a specific item.
    setSelectedFolder(null);

    // Expand every ancestor folder so the selected result is actually
    // visible in the normal tree.
    const ancestors = new Set<string>();
    let parentId = item.parentFolderId;

    while (parentId) {
      ancestors.add(parentId);
      parentId = folderMap.get(parentId)?.parentFolderId ?? null;
    }

    setExpanded((current) => {
      const next = new Set(current);

      ancestors.forEach((id) => next.add(id));

      return next;
    });
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
          ? `Delete “${folder.name}” and its ${childCount} nested item${
              childCount === 1 ? "" : "s"
            }?`
          : `Delete “${folder.name}”?`,
      )
    ) {
      return;
    }

    try {
      for (const item of items.filter(
        (item) =>
          item.parentFolderId === folder.id ||
          descendants.some((child) => child.id === item.parentFolderId),
      )) {
        await deleteCopyPastable(item.id);
      }

      for (const child of [...descendants].sort((a, b) =>
        b.parentFolderId!.localeCompare(a.parentFolderId!),
      )) {
        await deleteFolder(child.id);
      }

      await deleteFolder(folder.id);

      setSelectedFolder(null);
      setEditor(null);

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

  const startDrag = (
    event: DragEvent,
    kind: string,
    id: string,
  ) => {
    setDropPreview(null);
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

  const readImport = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) return;

    try {
      const value: unknown = JSON.parse(await file.text());

      if (!validateBackup(value)) {
        throw new Error("That file is not a valid Browser Vault backup.");
      }

      const mode = window.confirm(
        "Choose OK to merge this backup with your vault. Choose Cancel to replace the current vault.",
      );

      await importVault(
        value as VaultBackup,
        mode ? "merge" : "replace",
      );

      await refresh();
      setNotice("Vault imported.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to import backup.",
      );
    }

    setMenuOpen(false);
  };
  const isLinkItem = (item: CopyPastable) =>
  item.title.startsWith("/link ") && item.content.trim().length > 0;

const getDisplayTitle = (item: CopyPastable) => item.title;

  // Lower priority numbers appear first. Existing vaults without a
  // priority keep their previous alphabetical order until they are reordered.
  const getPriority = (item: { priority?: number }, fallback: number) =>
    typeof item.priority === "number" ? item.priority : fallback;

  const sortByPriority = <T extends { priority?: number }>(
    values: T[],
    getName: (value: T) => string,
  ) =>
    values
      .map((value, index) => ({ value, index }))
      .sort(
        (a, b) =>
          getPriority(a.value, a.index) - getPriority(b.value, b.index) ||
          getName(a.value).localeCompare(getName(b.value)),
      )
      .map(({ value }) => value);

  const getNextPriority = (
    kind: "file" | "folder",
    parentFolderId: string | null,
  ) => {
    const siblings =
      kind === "folder"
        ? folders.filter((folder) => folder.parentFolderId === parentFolderId)
        : items.filter((item) => item.parentFolderId === parentFolderId);

    return (
      siblings.reduce(
        (max, sibling, index) =>
          Math.max(max, getPriority(sibling, index)),
        -1,
      ) + 1
    );
  };

  const persistOrder = async (
    kind: "file" | "folder",
    orderedIds: string[],
    moved?: CopyPastable | Folder,
  ) => {
    const now = timestamp();

    if (kind === "folder") {
      const byId = new Map(folders.map((folder) => [folder.id, folder]));

      await Promise.all(
        orderedIds.map((id, priority) => {
          const folder =
            moved?.id === id && "name" in moved ? moved : byId.get(id);
          if (!folder) return Promise.resolve();

          return updateFolder({
            ...folder,
            priority,
            updatedAt: now,
          } as PrioritizedFolder);
        }),
      );
    } else {
      const byId = new Map(items.map((item) => [item.id, item]));

      await Promise.all(
        orderedIds.map((id, priority) => {
          const item =
            moved?.id === id && "title" in moved ? moved : byId.get(id);
          if (!item) return Promise.resolve();

          return updateCopyPastable({
            ...item,
            priority,
            updatedAt: now,
          } as PrioritizedCopyPastable);
        }),
      );
    }
  };

  const placeItem = async (
    draggedKind: "file" | "folder",
    draggedId: string,
    targetKind: "file" | "folder",
    targetId: string,
    targetParentId: string | null,
    mode: DropMode,
  ) => {
    const dragged =
      draggedKind === "folder"
        ? folderMap.get(draggedId)
        : items.find((item) => item.id === draggedId);
    if (!dragged) return;

    const destinationParentId = mode === "inside" ? targetId : targetParentId;

    if (
      draggedKind === "folder" &&
      (destinationParentId === draggedId ||
        (destinationParentId !== null &&
          !canDrop(draggedId, destinationParentId)))
    ) {
      setNotice("A folder cannot be moved into itself or its descendants.");
      return;
    }

    if (mode === "inside" && targetKind !== "folder") return;
    if (mode !== "inside" && draggedId === targetId) return;

    const siblings =
      draggedKind === "folder"
        ? sortByPriority(
            folders.filter(
              (folder) =>
                folder.parentFolderId === destinationParentId &&
                folder.id !== draggedId,
            ),
            (folder) => folder.name,
          )
        : sortByPriority(
            items.filter(
              (item) =>
                item.parentFolderId === destinationParentId &&
                item.id !== draggedId,
            ),
            (item) => item.title,
          );

    const targetIndex = siblings.findIndex((sibling) => sibling.id === targetId);
    const insertIndex =
      mode === "inside"
        ? siblings.length
        : targetKind === draggedKind && targetIndex >= 0
          ? mode === "after"
            ? targetIndex + 1
            : targetIndex
          : mode === "after"
            ? siblings.length
            : 0;
    const orderedIds = siblings.map((sibling) => sibling.id);
    orderedIds.splice(insertIndex, 0, draggedId);

    try {
      await persistOrder(draggedKind, orderedIds, {
        ...dragged,
        parentFolderId: destinationParentId,
        updatedAt: timestamp(),
      });
      await refresh();
      if (mode === "inside") {
        setExpanded((current) => new Set(current).add(targetId));
      }
      setNotice(mode === "inside" ? "Moved into folder" : "Priority updated");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to update priority.",
      );
    }
  };

  const getDropMode = (
    event: DragEvent,
    targetKind: "file" | "folder",
    targetElement: Element,
  ): DropMode => {
    const rect = targetElement.getBoundingClientRect();
    const ratio = rect.height
      ? (event.clientY - rect.top) / rect.height
      : 0.5;

    return targetKind === "folder" && ratio >= 0.35 && ratio <= 0.65
      ? "inside"
      : ratio < 0.5
        ? "before"
        : "after";
  };

  const handleRowDrop = async (
    event: DragEvent,
    targetKind: "file" | "folder",
    targetId: string,
    targetParentId: string | null,
    targetElement: HTMLDivElement,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setDropPreview(null);

    const payload = event.dataTransfer.getData("text/plain");
    if (!payload) return;

    const [draggedKind, draggedId] = payload.split(":");
    if (
      (draggedKind !== "file" && draggedKind !== "folder") ||
      !draggedId
    ) {
      return;
    }

    await placeItem(
      draggedKind,
      draggedId,
      targetKind,
      targetId,
      targetParentId,
      getDropMode(event, targetKind, targetElement),
    );
  };

  const handleRowDragOver = (
    event: DragEvent,
    targetKind: "file" | "folder",
    targetId: string,
  ) => {
    event.preventDefault();
    setDropPreview({
      targetId,
      mode: getDropMode(event, targetKind, event.currentTarget),
    });
  };

  const dropIndicator = (targetId: string) => {
    const mode = dropPreview?.targetId === targetId ? dropPreview.mode : null;
    if (!mode) return null;

    return mode === "inside" ? (
      <span className="pointer-events-none absolute inset-0 rounded-[4px] border border-[#777] bg-[#303030]/40" />
    ) : (
      <span
        className={`pointer-events-none absolute left-1 right-1 h-px bg-[#bdbdbd] shadow-[0_0_4px_rgba(255,255,255,0.45)] ${
          mode === "before" ? "top-[-2px]" : "bottom-[-2px]"
        }`}
      />
    );
  };

  const handleRootDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDropPreview(null);

    const payload = event.dataTransfer.getData("text/plain");
    if (!payload) return;

    const [kind, id] = payload.split(":");

    try {
      if (kind === "folder") {
        const folder = folderMap.get(id);
        if (!folder || folder.parentFolderId === null) return;

        await moveFolder(folder, null);

        const rootFolders = sortByPriority(
          folders.filter(
            (candidate) =>
              candidate.parentFolderId === null && candidate.id !== id,
          ),
          (candidate) => candidate.name,
        );

        await persistOrder("folder", [
          ...rootFolders.map((candidate) => candidate.id),
          id,
        ]);
      } else if (kind === "file") {
        const item = items.find((candidate) => candidate.id === id);
        if (!item || item.parentFolderId === null) return;

        await moveCopyPastable(item, null);

        const rootItems = sortByPriority(
          items.filter(
            (candidate) =>
              candidate.parentFolderId === null && candidate.id !== id,
          ),
          (candidate) => candidate.title,
        );

        await persistOrder("file", [
          ...rootItems.map((candidate) => candidate.id),
          id,
        ]);
      } else {
        return;
      }

      await refresh();
      setNotice("Moved to root");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to move item.",
      );
    }
  };

  const renderTree = (
    parentId: string | null,
    depth = 0,
  ): ReactElement[] => {
    const childFolders = sortByPriority(
      folders.filter((folder) => folder.parentFolderId === parentId),
      (folder) => folder.name,
    );

    const childItems = sortByPriority(
      items.filter((item) => item.parentFolderId === parentId),
      (item) => item.title,
    );

    return [
      ...childFolders.flatMap((folder) => {
        const isExpanded = expanded.has(folder.id);

        return [
          <div
            key={folder.id}
            className={[
              "group relative flex min-h-[30px] items-center rounded-[4px] border border-transparent",
              "my-px text-[#b3b3b3] transition-colors duration-100",
              "hover:bg-[#242424] hover:text-[#f2f2f2]",
              selectedFolder === folder.id
                ? "border-[#3a3a3a] bg-[#292929] text-[#f2f2f2]"
                : "",
              dropPreview?.targetId === folder.id &&
                dropPreview.mode === "inside"
                ? "bg-[#303030]"
                : "",
            ].join(" ")}
            style={{ paddingLeft: 10 + depth * 18 }}
            draggable
            onDragStart={(event) =>
              startDrag(event, "folder", folder.id)
            }
            onDragOver={(event) =>
              handleRowDragOver(event, "folder", folder.id)
            }
            onDragEnd={() => setDropPreview(null)}
            onDrop={(event) =>
              void handleRowDrop(
                event,
                "folder",
                folder.id,
                folder.parentFolderId,
                event.currentTarget,
              )
            }
          >
            {dropIndicator(folder.id)}
            <button
              className="flex h-[29px] min-w-0 flex-1 items-center gap-[7px] bg-transparent text-left text-inherit"
              onClick={(event) => {
                event.stopPropagation();

                setSelectedFolder(folder.id);

                setExpanded((current) => {
                  const next = new Set(current);

                  isExpanded
                    ? next.delete(folder.id)
                    : next.add(folder.id);

                  return next;
                });
              }}
            >
              {isExpanded ? (
  <ChevronDown
    className="h-3.5 w-3.5 shrink-0 text-[#707070]"
    strokeWidth={1.8}
  />
) : (
  <ChevronRight
    className="h-3.5 w-3.5 shrink-0 text-[#707070]"
    strokeWidth={1.8}
  />
)}

<FolderIcon
  className="h-3.5 w-3.5 shrink-0 text-[#999]"
  strokeWidth={1.8}
/>

              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px]">
                {folder.name}
              </span>
            </button>

            <button
  className="mr-[3px] grid h-[23px] w-[29px] place-items-center rounded-[3px] bg-transparent text-[#707070] hover:bg-[#2a2a2a] hover:text-[#f2f2f2]"
  title="Rename folder"
  aria-label={`Rename ${folder.name}`}
  onClick={(event) => {
    event.stopPropagation();

    setEditor({
      kind: "folder",
      item: folder,
      parentFolderId: folder.parentFolderId,
    });
  }}
>
  <MoreHorizontal
    className="h-3.5 w-3.5"
    strokeWidth={1.8}
  />
</button>
          </div>,

          ...(isExpanded
            ? renderTree(folder.id, depth + 1)
            : []),
        ];
      }),

      ...childItems.flatMap((item) => {
  const linkItem = isLinkItem(item);
  const displayTitle = getDisplayTitle(item);
  const isSelected = openFile === item.id;

  return [
    <div
      key={item.id}
      className={[
        "group relative flex min-h-[30px] items-center rounded-[4px] border border-transparent",
        "my-px text-[#b3b3b3] transition-colors duration-100",
        "hover:bg-[#242424] hover:text-[#f2f2f2]",
        isSelected
          ? "border-[#3a3a3a] bg-[#292929] text-[#f2f2f2]"
          : "",
      ].join(" ")}
      style={{ paddingLeft: 28 + depth * 18 }}
      draggable
      onDragStart={(event) =>
        startDrag(event, "file", item.id)
      }
      onDragOver={(event) => handleRowDragOver(event, "file", item.id)}
      onDragEnd={() => setDropPreview(null)}
      onDrop={(event) =>
        void handleRowDrop(
          event,
          "file",
          item.id,
          item.parentFolderId,
          event.currentTarget,
        )
      }
      onClick={() => {
        setOpenFile(isSelected ? null : item.id);
      }}
    >
      {dropIndicator(item.id)}
      <div className="flex h-[29px] min-w-0 flex-1 items-center gap-[7px]">
        <FileText
          className="h-3.5 w-3.5 shrink-0 text-[#999]"
          strokeWidth={1.8}
        />

        {linkItem ? (
          <a
            href={item.content.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#b3b3b3] hover:text-[#f2f2f2] hover:underline"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {displayTitle}
          </a>
        ) : (
          <button
            type="button"
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap bg-transparent p-0 text-left text-[11px] text-[#b3b3b3] hover:text-[#f2f2f2] hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              void copyItem(item);
            }}
          >
            {displayTitle}
          </button>
        )}
      </div>

      {/* Edit + Delete only appear on hover or selection */}
      <div
        className={[
          "mr-[3px] flex shrink-0 items-center gap-[2px] transition-opacity duration-100",
          isSelected
            ? "opacity-100"
            : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
        ].join(" ")}
      >
        <button
          type="button"
          className="grid h-[23px] w-[25px] place-items-center rounded-[3px] bg-transparent text-[#707070] hover:bg-[#2a2a2a] hover:text-[#f2f2f2]"
          onClick={(event) => {
            event.stopPropagation();
            setEditor({
              kind: "file",
              item,
              parentFolderId: item.parentFolderId,
            });
          }}
          title="Edit item"
          aria-label={`Edit ${displayTitle}`}
        >
          <Pencil
            className="h-3.5 w-3.5"
            strokeWidth={1.8}
          />
        </button>

        <button
          type="button"
          className="grid h-[23px] w-[25px] place-items-center rounded-[3px] bg-transparent text-[#707070] hover:bg-[#2a2a2a] hover:text-[#d0d0d0]"
          onClick={(event) => {
            event.stopPropagation();
            void removeFile(item);
          }}
          title="Delete item"
          aria-label={`Delete ${displayTitle}`}
        >
          <Trash2
            className="h-3.5 w-3.5"
            strokeWidth={1.8}
          />
        </button>
      </div>
    </div>,

    ...(isSelected
      ? [
          <div
            className="mb-[5px] w-full rounded-b-[6px] border border-[#3a3a3a] bg-[#1b1b1b] p-3"
            key={`${item.id}-details`}
            style={{
  marginLeft: 0,
  width: "100%",
}}
          >
            <p className="m-0 whitespace-pre-wrap break-words font-mono text-[10px] leading-[1.55] text-[#a0a0a0]">
              {item.content
                ? `${item.content.slice(0, 50)}${
                    item.content.length > 50 ? "…" : ""
                  }`
                : "Empty copy-pastable"}
            </p>
          </div>,
        ]
      : []),
  ];
}),
    ];
  };

  return (
    <main className="flex min-h-[560px] max-h-[680px] w-[440px] flex-col overflow-hidden bg-[#121212] font-sans text-[#f2f2f2]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#303030] px-[18px] py-[17px]">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-[6px] border border-[#3a3a3a] bg-[#1e1e1e] text-[#f2f2f2]">
  <ShieldCheck
    className="h-4 w-4"
    strokeWidth={1.8}
  />
</span>

          <div>
            <h1 className="m-0 text-[14px] font-semibold tracking-[-0.1px]">
              Browser Vault
            </h1>

            <span className="mt-[3px] block text-[10px] text-[#808080]">
              Your reusable snippets, close at hand.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-[5px]">
          <button
  className="h-[29px] rounded-[5px] border border-[#303030] bg-[#181818] px-[9px] text-[10px] font-semibold text-[#b3b3b3] transition-colors hover:border-[#3a3a3a] hover:bg-[#242424] hover:text-[#f2f2f2]"
  onClick={() =>
    setEditor({
      kind: "folder",
      parentFolderId: selectedFolder,
    })
  }
  title="New folder"
>
  <FolderPlus
    className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]"
    strokeWidth={1.8}
  />
  <span>Folder</span>
</button>

          <button
  className="h-[29px] rounded-[5px] border border-[#3a3a3a] bg-[#292929] px-[9px] text-[10px] font-semibold text-[#f2f2f2] transition-colors hover:bg-[#242424]"
  onClick={() =>
    setEditor({
      kind: "file",
      parentFolderId: selectedFolder,
    })
  }
  title="New copy-pastable"
>
  <FilePlus
    className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]"
    strokeWidth={1.8}
  />
  <span>New</span>
</button>

          <div className="relative">
            <button
              className="h-[29px] rounded-[5px] border border-[#303030] bg-[#181818] px-[9px] text-[13px] tracking-wider text-[#b3b3b3] transition-colors hover:border-[#3a3a3a] hover:bg-[#242424] hover:text-[#f2f2f2]"
              onClick={() => setMenuOpen(!menuOpen)}
              title="Vault settings"
            >
  <MoreHorizontal
    className="h-4 w-4"
    strokeWidth={1.8}
  />
</button>

            {menuOpen && (
              <div className="absolute right-0 top-[34px] z-10 w-[155px] rounded-[6px] border border-[#3a3a3a] bg-[#1e1e1e] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.45)]">
                <button
  className="flex w-full items-center gap-2 rounded px-[9px] py-2 text-left text-[10px] text-[#b3b3b3] hover:bg-[#242424] hover:text-[#f2f2f2]"
  onClick={() => void downloadExport()}
>
  <Download
    className="h-3.5 w-3.5"
    strokeWidth={1.8}
  />
  <span>Export Vault</span>
</button>

                <button
  className="flex w-full items-center gap-2 rounded px-[9px] py-2 text-left text-[10px] text-[#b3b3b3] hover:bg-[#242424] hover:text-[#f2f2f2]"
  onClick={() => importInput.current?.click()}
>
  <Upload
    className="h-3.5 w-3.5"
    strokeWidth={1.8}
  />
  <span>Import Vault</span>
</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Search */}
      <section className="px-4 pb-[9px] pt-3">
        <label
          className={[
            "flex h-8 items-center gap-2 rounded-[5px] border bg-[#181818] px-[10px] text-[#808080]",
            "transition-[border-color,box-shadow,background-color] duration-150",
            query
              ? "border-[#454545] bg-[#1b1b1b] shadow-[0_0_0_2px_rgba(255,255,255,0.025)]"
              : "border-[#303030]",
            "focus-within:border-[#4a4a4a] focus-within:bg-[#1b1b1b]",
          ].join(" ")}
        >
          <Search
  className="h-3.5 w-3.5 shrink-0"
  strokeWidth={1.8}
/>

                    <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search snippets..."
            aria-label="Search snippets"
            className="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-[#f2f2f2] outline-none placeholder:text-[#606060]"
          />

                    {query && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-[3px] text-[#606060] transition-colors hover:bg-[#292929] hover:text-[#b3b3b3]"
              onClick={() => setQuery("")}
            >
              <X
                className="h-3 w-3"
                strokeWidth={2}
              />
            </button>
          )}
        </label>

            
      </section>

      {/* Explorer */}
      <section
        className="min-h-[350px] flex-1 overflow-y-auto px-2 pb-4 pt-[7px] [scrollbar-color:#333_#121212] [scrollbar-width:thin]"
        onClick={() => setSelectedFolder(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void handleRootDrop(event)}
      >
        {query ? (
          searchResults.length ? (
                        searchResults.map((item) => (
              <div
                className="px-[5px] py-px"
                key={item.id}
              >
                <button
                  type="button"
                  className="group flex min-h-[52px] w-full items-center gap-[9px] rounded-[5px] px-[8px] py-[7px] text-left transition-colors duration-100 hover:bg-[#242424]"
                  onClick={() => openSearchResult(item)}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] border border-[#303030] bg-[#181818] text-[#888] transition-colors group-hover:border-[#3a3a3a] group-hover:text-[#b3b3b3]">
                    <FileText
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                  </span>

                  <span className="min-w-0 flex-1">
                    <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium text-[#f2f2f2]">
                      {item.title}
                    </strong>

                    <small className="mt-[2px] block overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-[#707070]">
                      {item.content.replace(/\s+/g, " ").trim() ||
                        "Empty copy-pastable"}
                    </small>

                    <small className="mt-[2px] block overflow-hidden text-ellipsis whitespace-nowrap text-[8px] text-[#555]">
                      {getPath(item.parentFolderId).join(" / ") ||
                        "Root"}
                    </small>
                  </span>

                  <ChevronRight
                    className="h-3 w-3 shrink-0 text-[#4f4f4f] transition-transform duration-100 group-hover:translate-x-0.5 group-hover:text-[#808080]"
                    strokeWidth={1.8}
                  />
                </button>
              </div>
            ))
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-[#b3b3b3]">
              <span className="mb-[13px] grid h-10 w-10 place-items-center rounded-lg border border-[#303030] bg-[#181818] text-[#999]">
  <Search
    className="h-5 w-5"
    strokeWidth={1.8}
  />
</span>

              <strong className="text-[12px] text-[#f2f2f2]">
                No matching snippets
              </strong>

              <small className="mt-[5px] text-[10px] text-[#808080]">
                Try a different title or phrase.
              </small>
            </div>
          )
        ) : folders.length || items.length ? (
          renderTree(null)
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-[#b3b3b3]">
            <span className="mb-[13px] grid h-10 w-10 place-items-center rounded-lg border border-[#303030] bg-[#181818] text-[#999]">
  <ShieldCheck
    className="h-5 w-5"
    strokeWidth={1.8}
  />
</span>

            <strong className="text-[12px] text-[#f2f2f2]">
              Your vault is ready
            </strong>

            <small className="mt-[5px] text-[10px] text-[#808080]">
              Create a folder or your first copy-pastable.
            </small>
          </div>
        )}


      </section>

      {/* Footer */}
      <footer className="flex justify-between border-t border-[#303030] px-[17px] py-[10px] font-mono text-[9px] text-[#808080]">
        <span>
          <i className="mr-[5px] inline-block h-1.5 w-1.5 rounded-full bg-[#707070]" />
          Stored locally in this browser
        </span>

        <span>
          {folders.length} folders · {items.length} snippets
        </span>
      </footer>

      {/* Toast */}
      {notice && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 rounded-[5px] border border-[#3a3a3a] bg-[#1e1e1e] px-3 py-2 text-[10px] text-[#f2f2f2] shadow-[0_8px_20px_rgba(0,0,0,0.45)]">
          {notice}
        </div>
      )}

      <input
        ref={importInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(event) => void readImport(event)}
      />

      {/* Editor */}
      {editor && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-black/80"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditor(null);
            }
          }}
        >
          <form
            className="w-[380px] rounded-[8px] border border-[#3a3a3a] bg-[#1e1e1e] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
            onSubmit={(event) =>
              void submitEditor(event)
            }
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.6px] text-[#b3b3b3]">
                {editor.item ? "UPDATE" : "NEW"}{" "}
                {editor.kind === "file"
                  ? "COPY-PASTABLE"
                  : "FOLDER"}
              </span>

    
            </div>

            {editor.kind === "file" ? (
              /*
               * Single writing surface.
               *
               * The title and textarea remain separate HTML controls,
               * but visually they belong to the same card.
               */

  <div className="relative w-full rounded-[7px] border border-[#303030] bg-[#181818] p-4">
  <button
    type="button"
    onClick={() => setLinkMode((current) => !current)}
    className={[
      "absolute right-4 top-4 inline-flex h-[25px] items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium transition-colors",
      linkMode
        ? "border-[#4a4a4a] bg-[#292929] text-[#f2f2f2]"
        : "border-[#303030] bg-[#1e1e1e] text-[#888] hover:border-[#3a3a3a] hover:bg-[#242424] hover:text-[#f2f2f2]",
    ].join(" ")}
  >
    <Link
      className="h-3 w-3"
      strokeWidth={1.8}
    />

    <span>Link</span>

    {linkMode && (
      <X
        className="ml-0.5 h-3 w-3"
        strokeWidth={2}
      />
    )}
  </button>

  <input
    name="name"
                  autoComplete="off"
                  maxLength={30}
                  autoFocus
                  defaultValue={
                    (editor.item as CopyPastable | undefined)
                      ?.title ?? ""
                  }
                  placeholder="Untitled copy-pastable"
                  className="block w-full border-0 bg-transparent p-0 text-[18px] font-semibold text-[#f2f2f2] outline-none placeholder:text-[#606060]"
                />

                <textarea
                  name="content"
                  defaultValue={
                    (editor.item as CopyPastable | undefined)
                      ?.content ?? ""
                  }
                  placeholder="Start typing your reusable text..."
                  rows={9}
                  className="mt-3 block min-h-[220px] w-full resize-none scrollbar-none border-0 bg-transparent p-0 text-[12px] leading-[1.6] text-[#f2f2f2] outline-none placeholder:text-[#606060]"
                />
              </div>
            ) : (
              <label className="block text-[10px] text-[#b3b3b3]">
                Folder name

                <input
                  name="name"
                  autoComplete="off"
                  maxLength={30}
                  autoFocus
                  defaultValue={
                    (editor.item as Folder | undefined)
                      ?.name ?? ""
                  }
                  placeholder="e.g. Engineering"
                  className="mt-[6px] block w-full rounded border border-[#303030] bg-[#181818] px-[10px] py-[9px] text-[11px] text-[#f2f2f2] outline-none placeholder:text-[#606060] focus:border-[#3a3a3a]"
                />
              </label>
            )}

            <div className="mt-4 flex justify-between gap-[7px]">
  {editor.kind === "folder" && editor.item ? (
    <button
      type="button"
      className="flex h-[29px] items-center gap-1.5 rounded-[5px] border border-[#303030] bg-[#181818] px-[9px] text-[10px] font-semibold text-[#b3b3b3] hover:border-[#3a3a3a] hover:bg-[#242424] hover:text-[#f2f2f2]"
      onClick={() => void removeFolder(editor.item as Folder)}
    >
      <Trash2
        className="h-3.5 w-3.5"
        strokeWidth={1.8}
      />
      Delete
    </button>
  ) : (
    <span />
  )}

  <div className="flex gap-[7px]">
    <button
      type="button"
      className="h-[29px] rounded-[5px] border border-[#303030] bg-[#181818] px-[9px] text-[10px] font-semibold text-[#b3b3b3] hover:border-[#3a3a3a] hover:bg-[#242424] hover:text-[#f2f2f2]"
      onClick={() => setEditor(null)}
    >
      Cancel
    </button>

    <button
      className="h-[29px] rounded-[5px] border border-[#3a3a3a] bg-[#292929] px-[9px] text-[10px] font-semibold text-[#f2f2f2] hover:bg-[#242424]"
      type="submit"
    >
      Save{" "}
      {editor.kind === "file"
        ? "snippet"
        : "folder"}
    </button>
  </div>
</div>
          </form>
        </div>
      )}
    </main>
  );
}