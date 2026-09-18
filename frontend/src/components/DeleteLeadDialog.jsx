import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { deleteLead } from "@/lib/api";

/**
 * The one way a lead — a patient — is deleted, wherever the button sits.
 *
 * Pre-Sales calls it a lead and Branch Admin's Patients panel calls it a patient, but it is
 * the same record and the same permanent DELETE /leads/{id}: the row and everything that
 * points back at it (activity, follow-ups, Consultant and Physio's boards, portal access,
 * every fee on file). Both used to ask in their own way — a plain confirm here, a typed
 * DELETE there — which meant two answers to "what happens when I delete this?". One
 * dialog, one wording, one call.
 *
 * `noun` only changes the words; nothing about what is deleted depends on it.
 */
export function DeleteLeadDialog({ lead, noun = "lead", onClose, onDeleted, extraWarning }) {
  const [deleting, setDeleting] = useState(false);
  if (!lead) return null;

  const confirm = async () => {
    setDeleting(true);
    try {
      await deleteLead(lead.id);
      toast.success(`Deleted ${lead.name || noun}`);
      onDeleted(lead.id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="delete-lead-dialog">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100">
            <Trash2 className="h-5 w-5 text-rose-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900" data-testid="delete-lead-title">
              Delete {noun}?
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              This will permanently delete <b className="text-slate-700">{lead.name || `this ${noun}`}</b> along with its
              activity history and follow-ups. This cannot be undone.
            </p>
            {extraWarning && <p className="mt-1 text-xs text-rose-600">{extraWarning}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={deleting} data-testid="delete-lead-cancel">
            Cancel
          </Button>
          <Button onClick={confirm} disabled={deleting} className="bg-rose-600 hover:bg-rose-700" data-testid="delete-lead-confirm">
            {deleting ? "Deleting..." : "Yes, Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
