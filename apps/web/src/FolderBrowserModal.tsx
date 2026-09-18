import { useCallback, useEffect, useRef, useState } from "react";
import { browseWorkspaceDirs, createWorkspaceDir, type DirEntry, type DirListing } from "./ws/client.js";

export interface FolderBrowserLabels {
  title: string;
  up: string;
  select: string;
  cancel: string;
  loading: string;
  empty: string;
  create: string;
  createPlaceholder: string;
  createPrompt: string;
}

interface FolderBrowserModalProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  labels: FolderBrowserLabels;
}

// Server-side directory browser: the browser sandbox never exposes a real
// filesystem path from a native file picker, but this app's server already
// runs with the operator's own filesystem access (see index.ts's GET
// /api/fs/dirs), so it can list real directories for the operator to click
// through and pick from directly.
export function FolderBrowserModal({ initialPath, onSelect, onClose, labels }: FolderBrowserModalProps) {
  const [levels, setLevels] = useState<DirListing[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<Array<string | null>>([]);
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const loadRoot = useCallback((target?: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    browseWorkspaceDirs(target)
      .then((listing) => {
        if (requestId !== requestIdRef.current) return;
        setLevels([listing]);
        setSelectedEntries([null]);
        setPath(listing.path);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, []);

  const openEntry = useCallback((levelIndex: number, entry: DirEntry) => {
    const requestId = ++requestIdRef.current;
    setPath(entry.path);
    setSelectedEntries((current) => {
      const next = current.slice(0, levelIndex + 1);
      next[levelIndex] = entry.path;
      return next;
    });
    setLevels((current) => current.slice(0, levelIndex + 1));
    setLoading(true);
    setError(null);

    browseWorkspaceDirs(entry.path)
      .then((listing) => {
        if (requestId !== requestIdRef.current) return;
        setLevels((current) => [...current.slice(0, levelIndex + 1), listing]);
        setSelectedEntries((current) => [...current.slice(0, levelIndex + 1), null]);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, []);

  const goUp = useCallback(() => {
    const lastLevelIndex = levels.length - 1;
    const pendingOrFailedChild = selectedEntries[lastLevelIndex];
    if (pendingOrFailedChild && path !== levels[lastLevelIndex]?.path) {
      requestIdRef.current += 1;
      setSelectedEntries((current) => {
        const next = [...current];
        next[lastLevelIndex] = null;
        return next;
      });
      setPath(levels[lastLevelIndex].path);
      setError(null);
      setLoading(false);
      return;
    }

    if (levels.length > 1) {
      const parentLevel = levels[levels.length - 2];
      requestIdRef.current += 1;
      setLevels((current) => current.slice(0, -1));
      setSelectedEntries((current) => {
        const next = current.slice(0, -1);
        next[next.length - 1] = null;
        return next;
      });
      setPath(parentLevel.path);
      setError(null);
      setLoading(false);
      return;
    }

    const parent = levels[0]?.parent;
    if (parent) loadRoot(parent);
  }, [levels, loadRoot, path, selectedEntries]);

  const handleCreate = useCallback(async () => {
    if (!path || creating) return;
    const name = newFolderName.trim();
    if (!name) {
      setError(labels.createPrompt);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createWorkspaceDir(path, name);
      setNewFolderName("");
      loadRoot(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [creating, labels.createPrompt, loadRoot, newFolderName, path]);

  useEffect(() => {
    loadRoot(initialPath);
    // Only on mount — later navigation goes through the browser callbacks, not a
    // re-run of this effect (initialPath is only meaningful as a start point).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const columns = columnsRef.current;
    if (columns && levels.length > 1) {
      columns.scrollTo({ left: columns.scrollWidth, behavior: "smooth" });
    }
  }, [levels.length]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="folder-browser-backdrop" onMouseDown={onClose}>
      <div
        className="folder-browser-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="folder-browser-heading">
          <h3 className="folder-browser-title">{labels.title}</h3>
          <button
            type="button"
            className="folder-browser-up"
            disabled={!selectedEntries[levels.length - 1] && !levels[0]?.parent && levels.length <= 1}
            onClick={goUp}
          >
            ← {labels.up}
          </button>
        </div>
        <div className="folder-browser-path" aria-live="polite">{path ?? "…"}</div>
        <form
          className="folder-browser-create"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={labels.createPlaceholder}
            aria-label={labels.createPlaceholder}
            disabled={!path || creating}
          />
          <button type="submit" disabled={!path || creating || !newFolderName.trim()}>
            {creating ? labels.loading : labels.create}
          </button>
        </form>
        {error && (
          <div className="folder-browser-status folder-browser-error" role="alert">
            {error}
          </div>
        )}
        <div className="folder-browser-columns" ref={columnsRef} aria-busy={loading}>
          {levels.map((level, levelIndex) => (
            <section className="folder-browser-column" key={level.path} aria-label={level.path}>
              <div className="folder-browser-column-title" title={level.path}>
                📁 {level.path.split(/[\\/]/).filter(Boolean).pop() ?? level.path}
              </div>
              <ul className="folder-browser-list">
                {level.entries.length === 0 ? (
                  <li className="folder-browser-empty">{labels.empty}</li>
                ) : (
                  level.entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={`folder-browser-entry${selectedEntries[levelIndex] === entry.path ? " is-selected" : ""}`}
                        aria-pressed={selectedEntries[levelIndex] === entry.path}
                        title={entry.path}
                        onClick={() => openEntry(levelIndex, entry)}
                        onDoubleClick={() => onSelect(entry.path)}
                      >
                        <span aria-hidden="true">📁</span>
                        <span>{entry.name}</span>
                        <span className="folder-browser-next" aria-hidden="true">›</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ))}
          {loading && (
            <div className="folder-browser-loading-column">
              <div className="folder-browser-status">{labels.loading}</div>
            </div>
          )}
        </div>
        <div className="folder-browser-actions">
          <button type="button" className="folder-browser-cancel" onClick={onClose}>
            {labels.cancel}
          </button>
          <button type="button" className="folder-browser-select" disabled={!path} onClick={() => path && onSelect(path)}>
            {labels.select}
          </button>
        </div>
      </div>
    </div>
  );
}
