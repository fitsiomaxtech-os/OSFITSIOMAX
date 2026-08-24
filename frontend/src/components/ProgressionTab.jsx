import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { closeCaseSheet, leadProgression, uploadLeadDocument, verifyLeadDocument } from "@/lib/api";

/**
 * PROGRESSION — the proof a course of treatment actually delivered something.
 *
 * Four things are gathered as the course runs, and the case sheet cannot be closed until
 * every one of them is both uploaded and verified. Reported per requirement rather than as
 * a single count, because "3 of 4" tells a physio to go hunting; naming the missing one
 * tells them what to do next.
 *
 * Three states, not two. "Uploaded, not yet checked" is the state a branch has to act on,
 * and folding it into Pending would hide the work that is waiting on somebody.
 *
 * Uploading and verifying are deliberately different jobs: the physio delivering the course
 * gathers the clips, and the branch or the consultant confirms them. A case sheet that one
 * person could close by uploading four files and ticking them off themselves would prove
 * nothing, which is the whole reason for asking.
 */

const STATUS = {
  completed: { label: "Completed", icon: CheckCircle2, chip: "bg-emerald-100 text-emerald-700", ring: "border-emerald-200" },
  uploaded: { label: "Awaiting check", icon: Clock, chip: "bg-amber-100 text-amber-700", ring: "border-amber-200" },
  pending: { label: "Pending", icon: AlertCircle, chip: "bg-slate-100 text-slate-500", ring: "border-slate-200" },
};

export function ProgressionTab({ leadId, canUpload = true, canVerify = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState(null);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      setData(await leadProgression(leadId));
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const upload = async (kind, file) => {
    if (!file) return;
    setBusyKind(kind);
    try {
      await uploadLeadDocument(leadId, file, "", kind);
      toast.success("Uploaded — it needs checking before it counts");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    }
    setBusyKind(null);
  };

  const verify = async (docId, verified) => {
    setBusyKind(docId);
    try {
      await verifyLeadDocument(leadId, docId, verified);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't change that");
    }
    setBusyKind(null);
  };

  const close = async () => {
    if (!window.confirm("Close this case sheet? Everything required is in and checked.")) return;
    setClosing(true);
    try {
      await closeCaseSheet(leadId);
      toast.success("Case sheet closed");
      await load();
    } catch (e) {
      // The server names what is still missing, so it is shown rather than replaced with a
      // generic failure — it is the only thing that says what to do next.
      toast.error(e?.response?.data?.detail || "Couldn't close the case sheet");
    }
    setClosing(false);
  };

  if (loading) return <p className="py-10 text-center text-sm text-slate-400">Loading progression…</p>;
  if (!data) return <p className="py-10 text-center text-sm text-slate-400">Couldn't load this patient's progression.</p>;

  const closed = data.case_sheet_closed;

  return (
    <div className="space-y-3" data-testid="progression-tab">
      {/* Where the case sheet stands, before any single requirement is read. */}
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
        closed ? "border-slate-200 bg-slate-50" : data.can_close ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
      }`} data-testid="progression-summary">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Case Sheet</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800">
            {closed
              ? `Closed${data.case_sheet_closed_by ? ` by ${data.case_sheet_closed_by}` : ""}`
              : `${data.completed} of ${data.total} completed`}
          </p>
          {!closed && data.outstanding?.length > 0 && (
            <p className="mt-0.5 text-[11px] text-amber-700">Still waiting on: {data.outstanding.join(", ")}</p>
          )}
        </div>
        {!closed && canVerify && (
          <Button
            size="sm"
            disabled={!data.can_close || closing}
            title={data.can_close ? undefined : "Every requirement has to be uploaded and verified first"}
            className={data.can_close ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-100 text-slate-400"}
            onClick={close}
            data-testid="progression-close"
          >
            <Lock className="mr-1.5 h-3.5 w-3.5" />
            {closing ? "Closing…" : "Close Case Sheet"}
          </Button>
        )}
        {closed && (
          <span className="flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            <Lock className="h-3 w-3" /> Closed
          </span>
        )}
      </div>

      {(data.requirements || []).map((req) => {
        const meta = STATUS[req.status] || STATUS.pending;
        const Icon = meta.icon;
        return (
          <div key={req.kind} className={`rounded-xl border bg-white p-4 ${meta.ring}`} data-testid={`progression-${req.kind}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
                <Icon className={`h-4 w-4 shrink-0 ${req.status === "completed" ? "text-emerald-600" : req.status === "uploaded" ? "text-amber-600" : "text-slate-400"}`} />
                <span className="truncate">{req.label}</span>
              </p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
            </div>

            {req.documents?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {req.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
                    <span className="min-w-0 truncate text-xs text-slate-600" title={d.original_name || d.label}>
                      {d.original_name || d.label || "File"}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {d.verified ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" /> Verified{d.verified_by ? ` · ${d.verified_by}` : ""}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-600">Not checked</span>
                      )}
                      {canVerify && (
                        <button
                          type="button"
                          onClick={() => verify(d.id, !d.verified)}
                          disabled={busyKind === d.id}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium ${d.verified ? "text-slate-500 hover:bg-slate-200" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                          data-testid={`progression-verify-${d.id}`}
                        >
                          {d.verified ? "Undo" : "Verify"}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Closed means closed: nothing more is filed against a case sheet that has
                been signed off, or the thing it was signed off against changes afterwards. */}
            {canUpload && !closed && (
              <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5" />
                {busyKind === req.kind ? "Uploading…" : req.documents?.length ? "Add another" : "Upload"}
                <input
                  type="file"
                  className="hidden"
                  accept={req.kind === "progress_review" ? "image/*,application/pdf" : "video/*,image/*"}
                  disabled={busyKind === req.kind}
                  onChange={(e) => { upload(req.kind, e.target.files?.[0]); e.target.value = ""; }}
                  data-testid={`progression-upload-${req.kind}`}
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ProgressionTab;
