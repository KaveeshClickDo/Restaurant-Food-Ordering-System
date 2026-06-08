"use client";

import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  /** Controls visibility — render the dialog only when true. */
  open: boolean;
  /** Short header line, e.g. "Delete table?". */
  title: string;
  /** Body text. Can be a string or arbitrary JSX (for line breaks, emphasis). */
  message: React.ReactNode;
  /** Label on the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label on the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Visual tone — `"danger"` paints the confirm button red (delete / void /
   * cancel-with-impact), `"primary"` paints it blue (less alarming actions
   * like "Send email").
   */
  tone?: "danger" | "primary";
  /** Set true while the confirm action is in flight — disables both buttons. */
  busy?: boolean;
  /** Fired when the user clicks Confirm. */
  onConfirm: () => void;
  /** Fired when the user clicks Cancel, the close button, the backdrop, or hits Escape. */
  onCancel: () => void;
}

/**
 * Reusable yes/no confirmation modal.
 *
 * Use this for destructive or impactful actions that don't have a natural
 * place to render an inline confirmation panel (e.g. a Settings tab that
 * triggers a delete from a dropdown menu). For row-based lists, an inline
 * panel inside the row is usually nicer — see WaitersPanel for an example.
 *
 * The parent owns the open/busy state. Typical wiring:
 *
 * ```tsx
 * const [confirmOpen, setConfirmOpen] = useState(false);
 * const { busy, run } = useInflight();
 *
 * async function doDelete() {
 *   await run(async () => {
 *     await fetch(`/api/admin/foo/${id}`, { method: "DELETE" });
 *     setConfirmOpen(false);
 *   });
 * }
 *
 * <ConfirmDialog
 *   open={confirmOpen}
 *   title="Delete this item?"
 *   message="This cannot be undone."
 *   tone="danger"
 *   confirmLabel="Delete"
 *   busy={busy}
 *   onConfirm={doDelete}
 *   onCancel={() => setConfirmOpen(false)}
 * />
 * ```
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Esc-to-cancel for keyboard users.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700 disabled:bg-red-900"
      : "bg-orange-500 hover:bg-orange-600 disabled:bg-orange-900";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => { if (!busy) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 border-b border-gray-800">
          <div
            className={`w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center ${
              tone === "danger" ? "bg-red-500/15" : "bg-orange-500/15"
            }`}
          >
            <AlertTriangle
              size={18}
              className={tone === "danger" ? "text-red-400" : "text-orange-400"}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="confirm-dialog-title" className="text-white font-bold text-base leading-tight">
              {title}
            </h2>
            <div className="text-gray-400 text-sm mt-1.5 leading-relaxed">{message}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-gray-500 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex justify-end gap-2 p-4 bg-gray-950/40">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 text-sm font-bold text-white rounded-lg transition disabled:cursor-not-allowed ${confirmClass}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
