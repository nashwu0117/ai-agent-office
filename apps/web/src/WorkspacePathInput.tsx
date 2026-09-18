import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderBrowserModal, type FolderBrowserLabels } from "./FolderBrowserModal.js";

// Explicit click-to-pick dropdown instead of a native <datalist>: datalist's
// suggestion popup is inconsistent across browsers (Safari shows no visible
// affordance at all until you start typing, mobile browsers mostly ignore
// it), so a plain HTML list gave users no reliable way to "just click" a
// recent path. This renders its own always-visible toggle button + menu,
// plus a second button that opens the server-backed folder browser modal.
interface WorkspacePathInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  recentPaths: string[];
  recentPathsLabel: string;
  recentPathsEmptyHint: string;
  browseLabel: string;
  folderBrowserLabels: FolderBrowserLabels;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  required?: boolean;
}

export function WorkspacePathInput({
  id,
  value,
  onChange,
  placeholder,
  recentPaths,
  recentPathsLabel,
  recentPathsEmptyHint,
  browseLabel,
  folderBrowserLabels,
  ariaInvalid,
  ariaDescribedBy,
  required,
}: WorkspacePathInputProps) {
  const [open, setOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 220,
    transform: "none",
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const input = inputRef.current;
      if (!input) return;

      const rect = input.getBoundingClientRect();
      const viewportMargin = 8;
      const menuGap = 4;
      const desiredHeight = 220;
      const spaceBelow = window.innerHeight - rect.bottom - menuGap - viewportMargin;
      const spaceAbove = rect.top - menuGap - viewportMargin;
      const openAbove = spaceBelow < 96 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(64, Math.min(desiredHeight, openAbove ? spaceAbove : spaceBelow));

      setMenuPosition({
        top: openAbove ? rect.top - menuGap : rect.bottom + menuGap,
        left: Math.max(viewportMargin, Math.min(rect.left, window.innerWidth - rect.width - viewportMargin)),
        width: Math.min(rect.width, window.innerWidth - viewportMargin * 2),
        maxHeight,
        transform: openAbove ? "translateY(-100%)" : "none",
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="workspace-path-input" ref={containerRef}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        required={required}
        autoComplete="off"
      />
      <button
        type="button"
        className="workspace-path-toggle"
        aria-label={recentPathsLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="workspace-path-toggle-label">{recentPathsLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <button type="button" className="workspace-path-browse" aria-label={browseLabel} onClick={() => setBrowserOpen(true)}>
        <span aria-hidden="true">📁</span>
      </button>
      {browserOpen && createPortal(
        <FolderBrowserModal
          initialPath={value || undefined}
          labels={folderBrowserLabels}
          onClose={() => setBrowserOpen(false)}
          onSelect={(p) => {
            onChange(p);
            setBrowserOpen(false);
          }}
        />,
        document.body,
      )}
      {open && createPortal(
        <ul
          ref={menuRef}
          className="workspace-path-menu"
          role="listbox"
          aria-label={recentPathsLabel}
          style={menuPosition}
        >
          {recentPaths.length > 0 ? (
            recentPaths.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p === value}
                  className="workspace-path-option"
                  onClick={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  {p}
                </button>
              </li>
            ))
          ) : (
            <li className="workspace-path-empty">{recentPathsEmptyHint}</li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}
