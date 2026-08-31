import { useEffect, useRef, useState } from "react";
import { Building2, Headphones, Stethoscope, Activity, Salad, UserRound, ChevronDown, ChevronUp, Search, Users, X, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  getDoctors, bmPreSalesMembers, getLeads, hrUsers,
  getBranchBoard, getLeadTransferEligibility, transferLeadBranch,
} from "@/lib/api";
import { BranchAdminBoard } from "@/components/BranchAdminBoard";
import { HeadPhysioBoard } from "@/components/HeadPhysioBoard";
import { PhysioBoard } from "@/components/PhysioBoard";
import { DietBoard } from "@/components/DietBoard";
import { PreSalesCRM } from "@/components/PreSalesCRM";
import { ClientPortalPreview } from "@/components/ClientPortalPreview";
import { BranchManagementBoard } from "@/components/branch/BranchManagementBoard";

// Same helper BranchManagementBoard.jsx, PreSalesCRM.jsx, MarketingBoard.jsx and
// BranchStoreBoard.jsx each already carry their own copy of.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

// Anna Nagar is the flagship branch every Super Admin lands on first, so every
// Operations tab opens there instead of an empty "pick a branch" prompt. Falls back to
// the first offline branch (same sort order the picker itself uses) if Anna Nagar isn't
// in the list yet.
const findDefaultBranchId = (branches) => {
  const list = branches || [];
  const annaNagar = list.find((b) => /anna\s*nagar/i.test(b.branch_name || ""));
  if (annaNagar) return annaNagar.id;
  const sorted = [...list].sort((a, b) => {
    const onlineDiff = Number(isOnlineVertical(a.vertical)) - Number(isOnlineVertical(b.vertical));
    if (onlineDiff !== 0) return onlineDiff;
    return (a.branch_name || "").localeCompare(b.branch_name || "");
  });
  return sorted[0]?.id || "";
};

const OPERATIONS_TABS = [
  { key: "pre_sales", label: "Pre Sales", icon: Headphones },
  { key: "branch", label: "Branch", icon: Building2 },
  { key: "consultant", label: "Consultant", icon: Stethoscope },
  { key: "physio", label: "Physio", icon: Activity },
  { key: "nutritionist", label: "Nutritionist", icon: Salad },
  { key: "client", label: "Client", icon: UserRound },
];

/**
 * Same pill row every Operations tab picks a branch from — offline branches first
 * (alphabetical), online ones trail (alphabetical among themselves), matching how
 * Branch Wise already sorts. One shared component rather than each tab styling its own,
 * so a branch reads the same way regardless of which team you're looking at it through.
 */
const OperationsBranchPicker = ({ branches, selectedId, onSelect, testid }) => {
  const sorted = [...(branches || [])].sort((a, b) => {
    const onlineDiff = Number(isOnlineVertical(a.vertical)) - Number(isOnlineVertical(b.vertical));
    if (onlineDiff !== 0) return onlineDiff;
    return (a.branch_name || "").localeCompare(b.branch_name || "");
  });
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2" data-testid={testid}>
      {sorted.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onSelect(b.id)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            selectedId === b.id ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
          data-testid={`${testid}-${b.id}`}
        >
          <Building2 className="h-3.5 w-3.5" /> {b.branch_name}
        </button>
      ))}
      {sorted.length === 0 && <p className="px-2 py-1.5 text-sm text-slate-400">No branches yet.</p>}
    </div>
  );
};

const EmptyPrompt = ({ text, testid }) => (
  <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center" data-testid={testid}>
    <ChevronUp className="mx-auto h-5 w-5 text-sky-500 motion-safe:animate-bounce" />
    <p className="mt-1 text-sm font-semibold text-slate-600">{text}</p>
  </div>
);

// ---------- Branch tab: pick a branch, see that branch admin's full board ----------

/**
 * Branch Transfer — moving one patient from the branch on screen to another.
 *
 * Two windows and a gap between them, which the backend enforces and this only reports:
 * a lead nobody has booked a consultation for yet, and a patient already in treatment at
 * Physio Assign. Everything between the two is refused, because a booked consultation sits
 * on a named Head Physio's calendar here and a part-collected Treatment Fee would leave its
 * installments split across two branches' books.
 *
 * The dialog is deliberately slow at the last step. A transfer releases booked treatment
 * days and moves a patient off the board their branch admin is working, so the eligible
 * list is only the first half of it — picking someone loads what the move would actually
 * cost, and the button that does it says the cost out loud.
 */
const BranchTransferDialog = ({ branches, fromBranchId, onClose }) => {
  const [leads, setLeads] = useState(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [toBranchId, setToBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [done, setDone] = useState(null);

  const fromBranch = (branches || []).find((b) => b.id === fromBranchId);

  useEffect(() => {
    let cancelled = false;
    getBranchBoard(fromBranchId)
      .then((d) => { if (!cancelled) setLeads(d?.leads || []); })
      .catch(() => { if (!cancelled) setLeads([]); });
    return () => { cancelled = true; };
  }, [fromBranchId]);

  // The same two windows the backend gates on, so the list offers only what it would
  // accept. Read off consultation_stage alone: null is a lead nobody has booked yet, and
  // Physio Assign is one already in treatment.
  const transferable = (leads || []).filter((l) => {
    const stage = l.consultation_stage;
    return stage == null || stage === "Physio Assign";
  });
  const q = search.trim().toLowerCase();
  const shown = q
    ? transferable.filter((l) => `${l.name || ""} ${l.phone || ""} ${l.patient_number || ""}`.toLowerCase().includes(q))
    : transferable;

  const pick = (lead) => {
    setPicked(lead);
    setEligibility(null);
    setToBranchId("");
    setReason("");
    getLeadTransferEligibility(lead.id).then(setEligibility).catch(() => setEligibility(null));
  };

  const submit = async () => {
    if (!toBranchId) { toast.error("Pick the branch to transfer to"); return; }
    setTransferring(true);
    try {
      const res = await transferLeadBranch(picked.id, { to_branch_id: toBranchId, reason });
      setDone({ ...res, name: picked.name });
      toast.success(res.message);
      // The list this came from is now one patient shorter. Refetched rather than spliced
      // so a second transfer in the same sitting reads the board as it now stands.
      getBranchBoard(fromBranchId).then((d) => setLeads(d?.leads || [])).catch(() => {});
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Transfer failed");
    }
    setTransferring(false);
  };

  const destinations = (branches || []).filter((b) => b.id !== fromBranchId);
  const toBranch = destinations.find((b) => b.id === toBranchId);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="ops-branch-transfer-dialog">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold">
            <ArrowLeftRight className="h-4 w-4 text-indigo-600" />
            Branch Transfer
            {fromBranch && <span className="text-sm font-normal text-slate-500">from {fromBranch.branch_name}</span>}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="ops-branch-transfer-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {done ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4" data-testid="ops-branch-transfer-done">
              <p className="text-sm font-semibold text-emerald-800">{done.name} — {done.message}</p>
              <ul className="mt-2 space-y-1 text-xs text-emerald-700">
                {done.sessions_released > 0 && (
                  <li>{done.sessions_released} booked treatment day{done.sessions_released === 1 ? "" : "s"} released — the new branch books the rest.</li>
                )}
                {done.sessions_kept > 0 && (
                  <li>{done.sessions_kept} completed day{done.sessions_kept === 1 ? "" : "s"} stay on the record, with the physio who ran them.</li>
                )}
                <li>Rs.{done.revenue_left_behind} stays in {fromBranch?.branch_name || "this branch"}'s book.</li>
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setDone(null); setPicked(null); setEligibility(null); }} data-testid="ops-branch-transfer-again">
                  Transfer another
                </Button>
                <Button size="sm" onClick={onClose} data-testid="ops-branch-transfer-finish">Done</Button>
              </div>
            </div>
          ) : !picked ? (
            <>
              <p className="text-xs leading-relaxed text-slate-500">
                A patient can be transferred before their consultation is booked, or once treatment
                has started at Physio Assign. In between — a consultation booked on this branch's
                Head Physio calendar, or a Treatment Fee part-collected — they stay put.
              </p>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, phone or patient number"
                  className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm outline-none focus:border-indigo-400"
                  data-testid="ops-branch-transfer-search"
                />
              </div>
              {leads === null ? (
                <p className="py-8 text-center text-sm text-slate-400">Loading this branch's patients…</p>
              ) : shown.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400" data-testid="ops-branch-transfer-empty">
                  {transferable.length === 0
                    ? "Nobody at this branch is in a transferable state right now."
                    : "No patient here matches that search."}
                </p>
              ) : (
                <div className="mt-3 space-y-1.5" data-testid="ops-branch-transfer-list">
                  {shown.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => pick(l)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-left hover:border-indigo-300 hover:bg-indigo-50/40"
                      data-testid={`ops-branch-transfer-lead-${l.id}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{l.name || "—"}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {l.patient_number || l.phone || "—"}
                          {l.consultation_stage === "Physio Assign" && l.assigned_physio_name ? ` · with ${l.assigned_physio_name}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        l.consultation_stage === "Physio Assign" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {l.consultation_stage === "Physio Assign" ? "In treatment" : "Lead"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => { setPicked(null); setEligibility(null); }}
                className="text-xs font-medium text-indigo-600 hover:underline"
                data-testid="ops-branch-transfer-back"
              >
                ← Back to the list
              </button>
              <p className="mt-2 text-base font-semibold text-slate-800">{picked.name || "—"}</p>
              <p className="text-xs text-slate-500">{picked.patient_number || picked.phone || "—"}</p>

              {!eligibility ? (
                <p className="py-6 text-center text-sm text-slate-400">Checking what this move would cost…</p>
              ) : !eligibility.can_transfer ? (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700" data-testid="ops-branch-transfer-blocked">
                  {eligibility.blocked_reason}
                </p>
              ) : (
                <>
                  {/* What the move costs, before it is made rather than in the toast after. */}
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="ops-branch-transfer-impact">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">What this move does</p>
                    <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
                      {eligibility.sessions_to_release > 0 ? (
                        <li>
                          <b>{eligibility.sessions_to_release}</b> booked treatment day{eligibility.sessions_to_release === 1 ? "" : "s"}
                          {eligibility.current_physio_name ? ` with ${eligibility.current_physio_name}` : ""} will be released. The new branch books them again there.
                        </li>
                      ) : (
                        <li>No treatment days are booked, so nothing is released.</li>
                      )}
                      {eligibility.sessions_completed > 0 && (
                        <li><b>{eligibility.sessions_completed}</b> completed day{eligibility.sessions_completed === 1 ? "" : "s"} stay on the record and still count toward the course.</li>
                      )}
                      <li>
                        <b>Rs.{eligibility.revenue_staying_behind}</b> already collected stays in {fromBranch?.branch_name || "this branch"}'s book.
                        Anything collected from here on belongs to the new branch.
                      </li>
                      <li>The Patient Number stays <b>{eligibility.patient_number || "—"}</b>, so receipts already issued still find them.</li>
                    </ul>
                  </div>

                  <label className="mt-3 block text-xs font-semibold text-slate-600">Transfer to</label>
                  <select
                    value={toBranchId}
                    onChange={(e) => setToBranchId(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-indigo-400"
                    data-testid="ops-branch-transfer-destination"
                  >
                    <option value="">Choose a branch…</option>
                    {destinations.map((b) => (
                      <option key={b.id} value={b.id}>{b.branch_name}</option>
                    ))}
                  </select>

                  <label className="mt-3 block text-xs font-semibold text-slate-600">Reason <span className="font-normal text-slate-400">(optional, kept on the record)</span></label>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. patient moved house"
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-indigo-400"
                    data-testid="ops-branch-transfer-reason"
                  />

                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose} data-testid="ops-branch-transfer-cancel">Cancel</Button>
                    <Button
                      className="bg-indigo-600 text-white hover:bg-indigo-700"
                      disabled={!toBranchId || transferring}
                      onClick={submit}
                      data-testid="ops-branch-transfer-submit"
                    >
                      {transferring
                        ? "Transferring…"
                        : toBranch
                          ? `Transfer to ${toBranch.branch_name}`
                          : "Transfer"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const OperationsBranchTab = ({ branches, actingUser }) => {
  const [selectedId, setSelectedId] = useState("");
  const [showManager, setShowManager] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  useEffect(() => {
    if (!selectedId && branches && branches.length) setSelectedId(findDefaultBranchId(branches));
  }, [branches, selectedId]);
  return (
    <div className="space-y-4" data-testid="ops-branch-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <OperationsBranchPicker branches={branches} selectedId={selectedId} onSelect={setSelectedId} testid="ops-branch-picker" />
        {/* Opens Branches & Verticals' MANAGER page in a dialog right here rather than
            switching the top nav to Branches & Verticals — this stays "Operations" the
            whole time it's open, closed with the same click that would otherwise be a
            back button. */}
        {selectedId && (
          <div className="flex shrink-0 items-center gap-2">
            {/* Moving a patient between branches is a Super Admin act and lives here rather
                than on the branch's own board: the branch losing the patient — and the
                revenue already collected from them — should not be the one deciding it. */}
            <Button
              variant="outline"
              className="h-9 gap-2 border-indigo-200 px-3 text-indigo-700 hover:bg-indigo-50"
              onClick={() => setShowTransfer(true)}
              data-testid="ops-branch-transfer-btn"
            >
              <ArrowLeftRight className="h-4 w-4" /> Branch Transfer
            </Button>
            <Button
              className="h-9 gap-2 bg-indigo-600 px-3 text-white hover:bg-indigo-700"
              onClick={() => setShowManager(true)}
              data-testid="ops-branch-goto-manager-btn"
            >
              <Users className="h-4 w-4" /> Branch Manager
            </Button>
          </div>
        )}
      </div>
      {selectedId ? (
        <BranchAdminBoard key={selectedId} branchId={selectedId} embedded />
      ) : (
        <EmptyPrompt text="Pick a branch above to open its full board" testid="ops-branch-empty" />
      )}
      {showTransfer && selectedId && (
        <BranchTransferDialog
          branches={branches}
          fromBranchId={selectedId}
          onClose={() => setShowTransfer(false)}
        />
      )}
      {showManager && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="ops-branch-manager-dialog">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="inline-flex items-center gap-2 text-base font-semibold"><Users className="h-4 w-4 text-indigo-600" />Branch Manager</h3>
              <button onClick={() => setShowManager(false)} className="text-slate-400 hover:text-slate-600" data-testid="ops-branch-manager-close"><X className="h-4 w-4" /></button>
            </div>
            <div className="overflow-y-auto p-5">
              <BranchManagementBoard actingUser={actingUser} initialTab="creation" lockTab />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- Consultant tab: pick a branch, see its Consultants' board ----------
//
// The dropdown here is read-only, unlike Physio/Nutritionist below — a Consultant (Head
// Physio) covers every branch by default rather than belonging to one, and HeadPhysioBoard
// shows one shared queue for the whole branch rather than a view filtered to one person, so
// picking a different name wouldn't change anything below it. It's here purely so the branch
// a Super Admin has assigned a Consultant to (Branches & Verticals > that branch > Assign
// Head Physio) is visible at a glance, the same names HeadPhysioBoard is already showing
// the combined queue for.
const OperationsConsultantTab = ({ branches, actingUser }) => {
  const [selectedId, setSelectedId] = useState("");
  // Every CONSULTANT login, org-wide — filtered to the picked branch below rather than
  // fetched per-branch. The `doctors` collection's branch_id doesn't track this (a Head
  // Physio doctor profile isn't branch-scoped there), so the source of truth is the same
  // users.branch_ids Roles & Credentials now assigns a CONSULTANT from.
  const [allConsultants, setAllConsultants] = useState([]);
  const [selectedConsultantId, setSelectedConsultantId] = useState("");
  useEffect(() => {
    if (!selectedId && branches && branches.length) setSelectedId(findDefaultBranchId(branches));
  }, [branches, selectedId]);

  // Every consultant role, not the one slug: the desk is `consultant`/`online_consultant`
  // plus the two retired slugs migrate_consultant_roles has not necessarily reached, and
  // naming any one of them leaves consultants missing from this picker with nothing on
  // screen to say why. /hr/users reads a comma-separated list as a family — see
  // list_users in backend/routers/v3_hr.py. Kept in step with HEAD_PHYSIO_ROLES in
  // backend/deps.py.
  useEffect(() => {
    hrUsers({ role: "consultant,online_consultant,head_physio,online_head_physio" })
      .then(setAllConsultants)
      .catch(() => setAllConsultants([]));
  }, []);

  // Relevant to the picked branch: posted to it.
  //
  // A Consultant covering every branch by default used to be the other half of this, and
  // org_wide was how the row said so. It is always false now — a Consultant is posted to
  // chosen branches like every other desk — so what is left is the branch match, and an
  // unposted Consultant appears under no branch rather than under all of them. The flag is
  // still read so a row from a server mid-deploy is not misfiled.
  const consultants = selectedId
    ? allConsultants.filter((u) => u.org_wide || (u.branches || []).some((b) => b.id === selectedId))
    : [];
  useEffect(() => {
    setSelectedConsultantId(consultants[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, allConsultants.length]);

  return (
    <div className="space-y-4" data-testid="ops-consultant-tab">
      <div className="flex flex-wrap items-center gap-3">
        <OperationsBranchPicker branches={branches} selectedId={selectedId} onSelect={setSelectedId} testid="ops-consultant-picker" />
        {/* Named, because a bare box reading "Yamini" next to a row of branch pills does
              not say what it is choosing — it could as easily be a filter on the branch
              list. The label carries the accessible name too: this select had none at all,
              so a screen reader announced it as an unlabelled combo box.

              Inline rather than stacked above, so it lines up with the pills beside it
              instead of making the row two lines tall. */}
        {selectedId && (
          <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white pl-3 pr-1" title="The board below always shows this branch's whole Consultant queue, whichever name is picked here">
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Select Consultant
            </span>
            <span className="relative">
              <select
                value={selectedConsultantId}
                onChange={(e) => setSelectedConsultantId(e.target.value)}
                aria-label="Select Consultant"
                className="h-8 min-w-[160px] appearance-none rounded-md border-0 bg-transparent pl-1 pr-7 text-sm font-medium text-slate-800 outline-none"
                data-testid="ops-consultant-person-select"
              >
                {consultants.length === 0 ? (
                  <option value="">No Consultant assigned to this branch</option>
                ) : (
                  consultants.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </span>
          </label>
        )}
      </div>
      {selectedId ? (
        <HeadPhysioBoard key={`${selectedId}-hp`} branchId={selectedId} user={actingUser} />
      ) : (
        <EmptyPrompt text="Pick a branch above to see its Consultants" testid="ops-consultant-empty" />
      )}
    </div>
  );
};

// ---------- Physio / Nutritionist: branch -> employee dropdown -> their own board ----------
//
// Same shape Branch Control already uses for its Physio View, just generalised to any
// profile_type the doctors collection carries (physio, nutrition_coach) and to whichever
// board that profile owns (PhysioBoard, DietBoard).

const OperationsPersonTab = ({ branches, profileType, personLabel, boardTestid, renderBoard }) => {
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [people, setPeople] = useState([]);
  const [selectedPersonId, setSelectedPersonId] = useState("");

  useEffect(() => {
    if (!selectedBranchId && branches && branches.length) setSelectedBranchId(findDefaultBranchId(branches));
  }, [branches, selectedBranchId]);

  useEffect(() => {
    setSelectedPersonId("");
    if (!selectedBranchId) { setPeople([]); return; }
    getDoctors({ branch_id: selectedBranchId })
      .then((rows) => {
        const filtered = (rows || []).filter((d) => d.profile_type === profileType);
        setPeople(filtered);
        setSelectedPersonId(filtered[0]?.id || "");
      })
      .catch(() => setPeople([]));
  }, [selectedBranchId, profileType]);

  return (
    <div className="space-y-4" data-testid={boardTestid}>
      <div className="flex flex-wrap items-center gap-3">
        <OperationsBranchPicker branches={branches} selectedId={selectedBranchId} onSelect={setSelectedBranchId} testid={`${boardTestid}-branch-picker`} />
        {selectedBranchId && (
          <div className="relative">
            <select
              value={selectedPersonId}
              onChange={(e) => setSelectedPersonId(e.target.value)}
              className="h-10 min-w-[220px] appearance-none rounded-md border border-slate-200 bg-white px-3 pr-8 text-sm"
              data-testid={`${boardTestid}-person-select`}
            >
              <option value="">{`— Select a ${personLabel} —`}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              {people.length === 0 && <option value="" disabled>{`No ${personLabel.toLowerCase()}s in this branch yet`}</option>}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        )}
      </div>

      {!selectedBranchId ? (
        <EmptyPrompt text="Pick a branch above" testid={`${boardTestid}-empty-branch`} />
      ) : selectedPersonId ? (
        renderBoard(selectedPersonId)
      ) : (
        <EmptyPrompt text={`Pick a ${personLabel.toLowerCase()} above to open their board`} testid={`${boardTestid}-empty-person`} />
      )}
    </div>
  );
};

// ---------- Pre Sales tab: branch -> rep dropdown -> their own leads ----------

const OperationsPreSalesTab = ({ branches, actingUser }) => {
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [reps, setReps] = useState([]);
  const [selectedRepId, setSelectedRepId] = useState("");

  useEffect(() => {
    if (!selectedBranchId && branches && branches.length) setSelectedBranchId(findDefaultBranchId(branches));
  }, [branches, selectedBranchId]);

  useEffect(() => {
    setSelectedRepId("");
    if (!selectedBranchId) { setReps([]); return; }
    bmPreSalesMembers(selectedBranchId)
      .then((rows) => {
        setReps(rows);
        setSelectedRepId(rows?.[0]?.id || "");
      })
      .catch(() => setReps([]));
  }, [selectedBranchId]);

  return (
    <div className="space-y-4" data-testid="ops-presales-tab">
      <div className="flex flex-wrap items-center gap-3">
        <OperationsBranchPicker branches={branches} selectedId={selectedBranchId} onSelect={setSelectedBranchId} testid="ops-presales-branch-picker" />
        {selectedBranchId && (
          <div className="relative">
            <select
              value={selectedRepId}
              onChange={(e) => setSelectedRepId(e.target.value)}
              className="h-10 min-w-[220px] appearance-none rounded-md border border-slate-200 bg-white px-3 pr-8 text-sm"
              data-testid="ops-presales-person-select"
            >
              <option value="">— Select a Pre Sales rep —</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
              {reps.length === 0 && <option value="" disabled>No Pre Sales reps for this branch yet</option>}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        )}
      </div>

      {!selectedBranchId ? (
        <EmptyPrompt text="Pick a branch above" testid="ops-presales-empty-branch" />
      ) : selectedRepId ? (
        // super_admin role so this gets the full desktop table (KPIs, Handled By, the
        // works) — assignedUserId narrows that same table to just this rep's own leads,
        // rather than trading it for a smaller, separately-built view.
        <PreSalesCRM
          key={selectedRepId}
          role="super_admin"
          currentUser={actingUser}
          branchId={selectedBranchId}
          assignedUserId={selectedRepId}
          embedded
        />
      ) : (
        <EmptyPrompt text="Pick a Pre Sales rep above to see their leads" testid="ops-presales-empty-person" />
      )}
    </div>
  );
};

// A branch's client list can run into the hundreds, unlike the Physio/Nutritionist/Pre
// Sales dropdowns above (a handful of staff each) — so this one gets its own search box
// rather than the plain <select> those use, matching the searchable employee picker
// HR Admin's Create User already has.
const SearchableClientSelect = ({ clients, selectedId, onSelect, testid }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const selected = clients.find((c) => c.id === selectedId);
  const currentLabel = selected ? `${selected.name}${selected.phone ? ` — ${selected.phone}` : ""}` : "— Select a client —";

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter((c) => `${c.name || ""} ${c.phone || ""}`.toLowerCase().includes(q))
    : clients;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 min-w-[220px] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm"
        data-testid={testid}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 min-w-[260px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg" data-testid={`${testid}-list`}>
          <div className="relative border-b border-slate-100 p-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client..."
              className="h-8 w-full rounded-md border border-slate-200 pl-8 pr-2 text-xs outline-none focus:border-sky-400"
              data-testid={`${testid}-search`}
            />
          </div>
          <div className="max-h-60 space-y-1 overflow-y-auto p-1.5">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c.id); setOpen(false); }}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-xs font-medium ${selectedId === c.id ? "bg-sky-50 text-sky-700" : "text-slate-700 hover:bg-slate-50"}`}
                data-testid={`${testid}-option-${c.id}`}
              >
                {c.name}{c.phone ? ` — ${c.phone}` : ""}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-slate-400">
                {clients.length === 0 ? "No clients for this branch yet" : "No clients match."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- Client tab: branch -> client list -> their history ----------

const OperationsClientTab = ({ branches }) => {
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");

  useEffect(() => {
    if (!selectedBranchId && branches && branches.length) setSelectedBranchId(findDefaultBranchId(branches));
  }, [branches, selectedBranchId]);

  useEffect(() => {
    setSelectedClientId("");
    if (!selectedBranchId) { setClients([]); return; }
    getLeads({ branch_id: selectedBranchId })
      .then((rows) => {
        setClients(rows);
        setSelectedClientId(rows?.[0]?.id || "");
      })
      .catch(() => setClients([]));
  }, [selectedBranchId]);

  return (
    <div className="space-y-4" data-testid="ops-client-tab">
      <div className="flex flex-wrap items-center gap-3">
        <OperationsBranchPicker branches={branches} selectedId={selectedBranchId} onSelect={setSelectedBranchId} testid="ops-client-branch-picker" />
        {selectedBranchId && (
          <SearchableClientSelect clients={clients} selectedId={selectedClientId} onSelect={setSelectedClientId} testid="ops-client-select" />
        )}
      </div>

      {!selectedBranchId ? (
        <EmptyPrompt text="Pick a branch above" testid="ops-client-empty-branch" />
      ) : !selectedClientId ? (
        <EmptyPrompt text="Pick a client above to see their portal" testid="ops-client-empty-person" />
      ) : (
        <ClientPortalPreview key={selectedClientId} leadId={selectedClientId} />
      )}
    </div>
  );
};

/**
 * Operations — Super Admin's own view of every team, one designation at a time. Each tab
 * is the same board that person or branch already has, reached the way Branches &
 * Verticals > Branch Control already reaches a Branch Admin/Consultant/Physio's board
 * (and Branch Wise reaches a branch's): pick a branch, then (where the role is branch-
 * scoped rather than org-wide) an employee, and see exactly what they'd see, with full
 * control, no separate login needed.
 */
export const OperationsBoard = ({ actingUser, branches = [], initialTab = "pre_sales" }) => {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="space-y-4" data-testid="operations-board">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="operations-tabs">
        {OPERATIONS_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              data-testid={`operations-tab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "pre_sales" && <OperationsPreSalesTab branches={branches} actingUser={actingUser} />}
      {tab === "branch" && <OperationsBranchTab branches={branches} actingUser={actingUser} />}
      {tab === "consultant" && <OperationsConsultantTab branches={branches} actingUser={actingUser} />}
      {tab === "physio" && (
        <OperationsPersonTab
          branches={branches}
          profileType="physio"
          personLabel="Physio"
          boardTestid="ops-physio-tab"
          renderBoard={(physioId) => <PhysioBoard key={physioId} physioId={physioId} />}
        />
      )}
      {tab === "nutritionist" && (
        <OperationsPersonTab
          branches={branches}
          profileType="nutrition_coach"
          personLabel="Nutritionist"
          boardTestid="ops-nutritionist-tab"
          renderBoard={(coachId) => <DietBoard key={coachId} coachId={coachId} />}
        />
      )}
      {tab === "client" && <OperationsClientTab branches={branches} />}
    </div>
  );
};

export default OperationsBoard;
