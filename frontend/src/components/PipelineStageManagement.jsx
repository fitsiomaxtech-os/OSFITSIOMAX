import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ArrowLeft, Flag, GripVertical, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { stagesList, stagesCreate, stagesUpdate, stagesDelete, stagesReorder, resetAllLeads, resetAllPayments } from "@/lib/api";

const PALETTE = ["#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b"];

// Every pipeline Super Admin can shape, in one table. The tab strip, the dropdown and the
// card title are all derived from it, so a sixth pipeline is one entry rather than three
// separate edits that can drift apart.
//
// Recruitment is the odd one out: its records are candidates in their own collection, not
// leads, and they reference a stage by id — so renaming one here rewrites nothing and
// cannot orphan anybody.
//
// `key` is this table's own id for the tab; `type` is what the API calls the pipeline. They
// are the same for every pipeline except the Branch one, which is two lists -- the clinic
// runs an offline practice and an online one, and they do not work a lead the same way, so
// each has its own stages under one `sales` type told apart by `arm`.
const TYPES = [
  { key: "pre_sales", label: "Pre-Sales", kpi: "Pre-Sales Stages", title: "Pre-Sales", tone: "indigo", records: "Leads" },
  { key: "sales", arm: "offline", label: "Offline Branch Lead", kpi: "Offline Branch Lead Stages", title: "Offline Branch Lead", tone: "green", records: "Leads" },
  // Its own list, not a view of the one above. Renaming a stage here renames it for the
  // online arm's boards and rewrites only the online arm's leads.
  { key: "sales_online", type: "sales", arm: "online", label: "Online Branch Lead", kpi: "Online Branch Lead Stages", title: "Online Branch Lead", tone: "cyan", records: "Leads" },
  { key: "consultation", label: "Branch Consultation", kpi: "Branch Consultation Stages", title: "Branch Consultation", tone: "orange", records: "Leads" },
  { key: "head_consultation", label: "Head Consultation", kpi: "Head Consultation Stages", title: "Head Consultation", tone: "sky", records: "Leads" },
  { key: "recruitment", label: "Recruitment", kpi: "Recruitment Stages", title: "Recruitment", tone: "violet", records: "Candidates" },
  // Registrations, not leads — a dancer is nobody's patient. Ships with no stages at
  // all: the pipelines above have the shape this clinic already ran, and a Zumba class
  // has no received one, so the branch names its own with Add Stage.
  { key: "zumba", label: "Zumba", kpi: "Zumba Stages", title: "Zumba", tone: "pink", records: "Registrations" },
];

// Branch stages the boards do something with, keyed by the role the backend stamps on the
// row (see constants.SALES_STAGE_ROLES_BY_NAME). Shown as a badge so this table says which
// rows carry behaviour: the name is safe to change -- that is the point of the role -- but
// a Super Admin deleting one is removing the stage a booking lands on, and nothing on this
// screen used to hint at the difference between that row and any other.
const ROLE_LABELS = {
  appointment: "Books appointments",
  cancelled: "Frees the slot",
  rnr: "Not reached",
  portfolio: "Portfolio dialog",
  follow_up: "Appointment exit",
};

// Tailwind only ships classes it can actually see written out, so the tones are spelled in
// full rather than built as `border-${tone}-500`.
const TONE_CLASSES = {
  indigo: { border: "border-indigo-500", text: "text-indigo-600" },
  green: { border: "border-green-500", text: "text-green-600" },
  cyan: { border: "border-cyan-500", text: "text-cyan-600" },
  orange: { border: "border-orange-500", text: "text-orange-600" },
  sky: { border: "border-sky-500", text: "text-sky-600" },
  violet: { border: "border-violet-500", text: "text-violet-600" },
  pink: { border: "border-pink-500", text: "text-pink-600" },
};

export const PipelineStageManagement = ({ onBack }) => {
  const [type, setType] = useState("pre_sales");
  const [stages, setStages] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", color: "#6366f1", is_final: false });
  const [resetting, setResetting] = useState(false);
  const [resettingPayments, setResettingPayments] = useState(false);

  // The tab being looked at, resolved once: `type` is this table's tab id, and for the
  // Branch pair it is not the same string as the pipeline's API type — both tabs are
  // `sales`, told apart by the arm.
  const active = TYPES.find((t) => t.key === type) || TYPES[0];
  const apiType = active.type || active.key;
  const arm = active.arm;

  // One request, for the pipeline being looked at. It used to fetch all five and keep only
  // the active list, the other four existing solely to put a count in a tab label — with
  // the counts gone so is the reason, so a load and every pipeline switch costs one call
  // instead of five.
  const load = useCallback(async () => {
    setStages(await stagesList(apiType, arm));
  }, [apiType, arm]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Stage name required"); return; }
    try {
      if (editing) {
        await stagesUpdate(editing.id, form);
        toast.success("Stage updated");
      } else {
        await stagesCreate({ ...form, type: apiType, arm });
        toast.success("Stage created");
      }
      setShowAdd(false); setEditing(null); setForm({ name: "", color: "#6366f1", is_final: false });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  const startEdit = (s) => { setEditing(s); setForm({ name: s.name, color: s.color, is_final: !!s.is_final }); setShowAdd(true); };

  const remove = async (s) => {
    if (!window.confirm(`Delete stage "${s.name}"?`)) return;
    try { await stagesDelete(s.id); toast.success("Stage deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const move = async (s, dir) => {
    const idx = stages.findIndex((x) => x.id === s.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= stages.length) return;
    const items = stages.map((x, i) => ({ id: x.id, order: i }));
    [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
    items.forEach((x, i) => { x.order = i; });
    await stagesReorder(items);
    load();
  };

  const handleResetAllLeads = async () => {
    const step1 = window.confirm(
      "Reset EVERY lead in the whole OS back to a fresh, unassigned New Leads state?\n\n" +
      "This keeps each lead's name/phone/contact info, but clears their stage, branch, " +
      "consultation, physio assignment, packages, fees, and follow-ups — and permanently " +
      "deletes all sessions, weekly assessments, package recommendations, appointments, " +
      "patient view links, and activity history.\n\nThis cannot be undone."
    );
    if (!step1) return;
    const step2 = window.confirm("Are you absolutely sure? Type OK to confirm this final, irreversible reset.");
    if (!step2) return;
    setResetting(true);
    try {
      const res = await resetAllLeads();
      toast.success(
        `Reset ${res.leads_reset} leads. Deleted ${res.sessions_deleted} sessions, ` +
        `${res.weekly_assessments_deleted} assessments, ${res.appointments_deleted} appointments, ` +
        `${res.lead_activity_deleted} activity entries.`
      );
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    }
    setResetting(false);
  };

  const handleResetAllPayments = async () => {
    const step1 = window.confirm(
      "Wipe EVERY payment recorded anywhere in the OS?\n\n" +
      "Patients keep their stage, branch, packages and prices, but every fee paid is cleared " +
      "and reads as owed again. Zumba and Fitness payments are cleared. Store sales are deleted " +
      "and their stock put back. Expenses, petty cash, cash handovers, opening cash, closing " +
      "balances, closed books, payslips, payroll runs, and HR advance/expense claims are " +
      "permanently deleted. Receipt numbers restart.\n\nThis cannot be undone."
    );
    if (!step1) return;
    // Typed rather than a second OK: two confirm boxes in a row are clicked through on
    // reflex, and this one erases the books.
    const typed = window.prompt('Type RESET PAYMENTS to confirm this final, irreversible reset.');
    if ((typed || "").trim() !== "RESET PAYMENTS") {
      if (typed !== null) toast.error("Nothing was reset — the confirmation text didn't match");
      return;
    }
    setResettingPayments(true);
    try {
      const res = await resetAllPayments();
      const cashRows = Object.values(res.cash_book_deleted || {}).reduce((sum, n) => sum + n, 0);
      toast.success(
        `Cleared payments on ${res.leads_cleared} leads, ${res.zumba_registrations_cleared} Zumba and ` +
        `${res.fitness_registrations_cleared} Fitness registrations. Deleted ${res.payments_deleted} collections, ` +
        `${res.store_sales_deleted} store sales, ${cashRows} cash book entries, ${res.payslips_deleted} payslips.`
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    }
    setResettingPayments(false);
  };

  return (
    <div className="space-y-5" data-testid="pipeline-stages-page">
      {/* Heading removed with the others. The back link and Add Stage keep the row, so
          it still reads left-to-right as "where you came from" then "what you can do". */}
      {/* One row at every width. Stacked on a phone this put the back link on a line of
          its own above a full-bleed sky button, which read as a banner rather than as
          "where you came from" then "what you can do". */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="stages-back-btn"><ArrowLeft className="h-4 w-4 mr-1" />Settings</Button>
        <Button onClick={() => { setEditing(null); setForm({ name: "", color: PALETTE[Math.floor(Math.random() * PALETTE.length)], is_final: false }); setShowAdd(true); }} className="shrink-0 bg-sky-600 hover:bg-sky-700" data-testid="stages-add-btn"><Plus className="h-4 w-4 mr-1" />Add Stage</Button>
      </div>

      {/* A dropdown on a phone: five pipelines two-across left the fifth alone on a third
          row. Desktop keeps the five-up bar.

          Neither carries a stage count any more. The number belonged to the pipeline
          rather than to the choice, and the list below states it by simply being the
          list — a tab reading "Pre-Sales (4)" above four visible rows said it twice. */}
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 sm:hidden"
        data-testid="stages-tab-select"
      >
        {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>

      {/* One column per pipeline, counted from TYPES rather than written as a number: at a
          fixed five the sixth (Zumba) wrapped onto a row of its own, reading as a stray
          rather than as the last of six. A seventh pipeline should not need this line edited
          again -- adding it to TYPES is the whole change. */}
      <div
        className="hidden gap-2 rounded-lg bg-slate-100 p-1 sm:grid"
        style={{ gridTemplateColumns: `repeat(${TYPES.length}, minmax(0, 1fr))` }}
      >
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={`rounded-md py-2 text-sm font-semibold ${type === t.key ? `bg-white shadow ${TONE_CLASSES[t.tone].text}` : "text-slate-500"}`}
            data-testid={`stages-tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card data-testid="stages-list-card">
        <CardHeader><CardTitle className="text-base">{active.title} Pipeline Stages</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Order</th><th>Color</th><th>Stage Name</th><th>{active.records}</th><th>Final</th><th>Actions</th></tr></thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={s.id} className="border-t border-slate-100" data-testid={`stages-row-${s.id}`}>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-slate-300" />
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">{i + 1}</span>
                      <button onClick={() => move(s, -1)} disabled={i === 0} className="text-xs text-slate-400 disabled:opacity-30" data-testid={`stages-up-${s.id}`}>▲</button>
                      <button onClick={() => move(s, 1)} disabled={i === stages.length - 1} className="text-xs text-slate-400 disabled:opacity-30" data-testid={`stages-down-${s.id}`}>▼</button>
                    </div>
                  </td>
                  <td><span className="inline-block h-3 w-3 rounded-full" style={{ background: s.color }} /></td>
                  <td className="font-medium" style={{ color: s.color }}>
                    {s.name}
                    {/* The Branch pipeline holds both Lead Control modes' opening stages at
                        once, so it lists two entry stages and an RNR that most branches
                        never see. Without this the pair reads as an accidental duplicate. */}
                    {s.applies_to ? (
                      <span className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-slate-500">
                        {s.applies_to === "branch_admin" ? "Branch Admin only" : "Pre Sales only"}
                      </span>
                    ) : null}
                    {/* A stage the boards act on rather than merely list. Renaming it is
                        safe -- the behaviour is pinned to the role, not to the name -- but
                        deleting it is not, and neither is assuming the branch will still
                        recognise the position under a name that means something else. Said
                        here because from this table one row looks much like another. */}
                    {ROLE_LABELS[s.role] ? (
                      <span
                        className="ml-2 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-amber-700"
                        title={`The branch boards act on this stage (${ROLE_LABELS[s.role]}). Renaming it is safe; deleting it is not.`}
                      >
                        {ROLE_LABELS[s.role]}
                      </span>
                    ) : null}
                  </td>
                  <td><span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded border border-slate-200 px-2 text-xs">{s.lead_count || 0}</span></td>
                  <td>{s.is_final ? <Flag className="h-4 w-4 text-green-500" /> : null}</td>
                  <td className="space-x-2">
                    <button onClick={() => startEdit(s)} className="text-blue-500 hover:text-blue-700" data-testid={`stages-edit-${s.id}`}><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(s)} className="text-red-500 hover:text-red-700" data-testid={`stages-delete-${s.id}`}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
              {stages.length === 0 && <tr><td colSpan="6" className="py-6 text-center text-slate-400">No stages yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-red-200" data-testid="danger-zone-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-700">
            <AlertTriangle className="h-4 w-4" /> Danger Zone
          </CardTitle>
        </CardHeader>
        {/* The two resets side by side, one row on desktop and stacked on a phone. Each box is a
            column whose description takes the slack, so both buttons sit on the same line
            however much longer one description runs than the other. */}
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">Reset all leads to a fresh state</p>
            <p className="mt-1 flex-1 text-xs text-red-700">
              For testing only. Keeps every lead's name, phone and contact info, but resets stage,
              branch, consultation, physio assignment, packages and fees back to New Leads —
              and permanently deletes all sessions, weekly assessments, package recommendations,
              appointments, patient view links, and activity history. Cannot be undone.
            </p>
            <Button
              variant="outline"
              className="mt-3 self-start border-red-300 text-red-700 hover:bg-red-100"
              onClick={handleResetAllLeads}
              disabled={resetting}
              data-testid="reset-all-leads-btn"
            >
              <Trash2 className="mr-1 h-4 w-4" /> {resetting ? "Resetting..." : "Reset All Leads"}
            </Button>
          </div>
          <div className="flex flex-col rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">Reset all payments to a fresh state</p>
            <p className="mt-1 flex-1 text-xs text-red-700">
              For clearing test money before go-live. Keeps every lead, registration, stage, package
              and price, but clears every fee paid (Consultation, Treatment, Diet, Diet Chart, Rehab,
              installments, Zumba, Fitness) so it reads as owed again. Deletes store sales and puts their
              stock back, and permanently deletes expenses, petty cash, cash handovers, opening cash,
              closing balances, closed books, payslips, payroll runs, and HR advance/expense claims.
              Receipt numbers restart. Cannot be undone.
            </p>
            <Button
              variant="outline"
              className="mt-3 self-start border-red-300 text-red-700 hover:bg-red-100"
              onClick={handleResetAllPayments}
              disabled={resettingPayments}
              data-testid="reset-all-payments-btn"
            >
              <Trash2 className="mr-1 h-4 w-4" /> {resettingPayments ? "Resetting..." : "Reset All Payments"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showAdd && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" data-testid="stages-dialog">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">{editing ? "Edit Stage" : "Add Stage"}</h3>
            <Input placeholder="Stage name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="stages-form-name" />
            <div>
              <p className="mb-1 text-xs text-slate-500">Color</p>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, color: c })} className={`h-7 w-7 rounded-full border-2 ${form.color === c ? "border-slate-900 ring-2 ring-offset-1" : "border-transparent"}`} style={{ background: c }} data-testid={`stages-form-color-${c}`} />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.is_final} onChange={(e) => setForm({ ...form, is_final: e.target.checked })} data-testid="stages-form-final" />Mark as Final stage</label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }} className="flex-1" data-testid="stages-form-cancel">Cancel</Button>
              <Button onClick={submit} className="flex-1" data-testid="stages-form-submit">{editing ? "Save" : "Create"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelineStageManagement;
