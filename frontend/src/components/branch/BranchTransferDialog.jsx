import { useEffect, useState } from "react";
import { Building2, Loader2, Lock, TriangleAlert, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { branchTransfer, branchTransferPreview } from "@/lib/api";

/**
 * Branch Transfer — moving one patient from the branch they are at to another one.
 *
 * Opened from two places, because there are exactly two moments a transfer is allowed and
 * they live on different boards: a raw lead still sitting on its branch's opening stage
 * (Branch Leads > the lead's own card) and a patient who has reached Physio Assign
 * (Consultations > that stage's panel). One component rather than two lookalikes, so the
 * warning a Super Admin reads before releasing a patient's physio says the same thing
 * whichever board they got here from.
 *
 * The server is the authority on both halves of this. Whether the patient is in a window
 * is asked for on open and re-checked on submit — a dialog can sit open while somebody at
 * the branch books the consultation it was opened on — and the branches offered are the
 * ones the server sent, which already exclude the branch the patient is at.
 *
 * @param lead      the patient. Only `id` and `name` are read; everything else on screen
 *                  comes from the preview, so this never disagrees with the server.
 * @param onDone    called after a successful transfer. The patient has left the branch
 *                  whose board this was opened from, so the caller should close whatever
 *                  popup it was in and reload — the row is not there any more.
 */
export const BranchTransferDialog = ({ lead, onClose, onDone }) => {
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    branchTransferPreview(lead.id)
      .then((res) => { if (!cancelled) setPreview(res); })
      .catch((e) => { if (!cancelled) setLoadError(e?.response?.data?.detail || "Could not check this patient's transfer status"); });
    return () => { cancelled = true; };
  }, [lead.id]);

  const submit = async () => {
    if (!toBranchId || saving) return;
    setSaving(true);
    try {
      const res = await branchTransfer(lead.id, { to_branch_id: toBranchId, reason });
      toast.success(res.message || "Patient transferred");
      onDone?.(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not transfer this patient");
      setSaving(false);
    }
  };

  const destinations = preview?.destinations || [];
  // What the branch being left keeps. Named and totalled rather than left to a general
  // reassurance: the fear behind "can I transfer this patient" is usually about the money,
  // and a figure answers it where a sentence about policy does not.
  const staying = Object.values(preview?.revenue_stays_here || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const bookings = preview?.open_bookings || {};
  const staff = preview?.releases_staff || [];
  // Named counts rather than one number: a Super Admin is agreeing to these specific
  // bookings disappearing off named calendars, and "4 bookings" does not say whose.
  const releases = [
    [bookings.appointments, "consultation appointment", "consultation appointments"],
    [bookings.sessions, "booked treatment day", "booked treatment days"],
    [bookings.rehab_sessions, "booked rehab day", "booked rehab days"],
    [bookings.diet_sessions, "booked diet check-in", "booked diet check-ins"],
  ].filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      data-testid="branch-transfer-dialog-overlay"
    >
      <div className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:max-w-lg" data-testid="branch-transfer-dialog">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold leading-tight text-slate-900">Branch Transfer</h3>
              <p className="mt-0.5 truncate text-xs text-slate-500" data-testid="branch-transfer-subject">
                {lead.name}
                {preview?.patient_number ? ` · ${preview.patient_number}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
            data-testid="branch-transfer-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/40 px-5 py-4">
          {!preview && !loadError && (
            <p className="flex items-center gap-2 py-6 text-sm text-slate-500" data-testid="branch-transfer-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking this patient…
            </p>
          )}

          {loadError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700" data-testid="branch-transfer-load-error">
              {loadError}
            </p>
          )}

          {/* Refused. The reason is the whole content: it names the stage the patient is on
              and what to finish first, which is the only thing worth showing here — a
              branch picker under it would just be a button that always fails. */}
          {preview && !preview.eligible && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5" data-testid="branch-transfer-blocked">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <Lock className="h-4 w-4 shrink-0" /> This patient can't be transferred right now
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-800">{preview.explanation}</p>
            </div>
          )}

          {preview?.eligible && (
            <>
              <p className="text-xs leading-relaxed text-slate-600" data-testid="branch-transfer-window">
                {preview.explanation}
              </p>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Transfer to
                </label>
                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2" data-testid="branch-transfer-destinations">
                  {destinations.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setToBranchId(b.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                        toBranchId === b.id ? "bg-indigo-600 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
                      }`}
                      data-testid={`branch-transfer-destination-${b.id}`}
                    >
                      <Building2 className="h-4 w-4 shrink-0" />
                      <span className="truncate">{b.branch_name}</span>
                      {b.city && (
                        <span className={`ml-auto shrink-0 text-[11px] ${toBranchId === b.id ? "text-indigo-100" : "text-slate-400"}`}>
                          {b.city}
                        </span>
                      )}
                    </button>
                  ))}
                  {destinations.length === 0 && (
                    <p className="px-3 py-2 text-sm text-slate-400">There is no other branch to transfer to.</p>
                  )}
                </div>
              </div>

              {/* What the branch is agreeing to lose. Drawn only when there is something to
                  lose, so a raw lead — which holds nothing — gets a short dialog rather
                  than a warning box reading "0 appointments will be cancelled". */}
              {(releases.length > 0 || staff.length > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" data-testid="branch-transfer-releases">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-900">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> This releases
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-amber-800">
                    {staff.length > 0 && (
                      <li>
                        <span className="font-semibold">{staff.join(", ")}</span> — they work at this
                        branch, so the receiving Branch Admin assigns their own.
                      </li>
                    )}
                    {releases.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
              )}

              {/* Said plainly rather than left to be discovered in a report months later.
                  It is the one thing about a transfer that surprises people. */}
              <p className="text-[11px] leading-relaxed text-slate-500" data-testid="branch-transfer-revenue-note">
                {staying > 0 ? (
                  <>
                    <span className="font-semibold text-slate-700">
                      Rs.{Math.round(staying).toLocaleString("en-IN")}
                    </span>{" "}
                    already collected stays on {preview.from_branch_name || "this branch"}'s books.{" "}
                  </>
                ) : (
                  <>Anything already collected stays on {preview.from_branch_name || "this branch"}'s books. </>
                )}
                Completed sessions and the patient's number stay as they are; only what is collected
                from now on counts at the new branch.
              </p>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="branch-transfer-reason">
                  Reason <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                </label>
                <Input
                  id="branch-transfer-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. patient has moved house"
                  data-testid="branch-transfer-reason"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="branch-transfer-cancel">
            {preview && !preview.eligible ? "Close" : "Cancel"}
          </Button>
          {preview?.eligible && (
            <Button
              onClick={submit}
              disabled={!toBranchId || saving}
              className="gap-2 bg-indigo-600 text-white hover:bg-indigo-700"
              data-testid="branch-transfer-confirm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
              {saving ? "Transferring…" : "Transfer Patient"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BranchTransferDialog;
