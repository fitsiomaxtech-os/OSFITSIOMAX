import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  RefreshCw,
  Salad,
  Search,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { dietConsultations, dietPatients, dietSessions, saveDietConsultationReport } from "@/lib/api";
import { to12h } from "@/lib/time";

/**
 * Diet Master View — the Nutrition Coach's own board.
 *
 * Two tabs: the consultations to work through, and the caseload behind them. It keeps the
 * Physio Master View's shape where it still applies, so a coach moving between the two
 * boards does not have to learn a second layout.
 *
 * Two things are intentionally absent, and their absence is the design rather than an
 * omission:
 *
 *   No Review tab. On the physio side reviews exist so a junior's work gets seen by a
 *   senior. One Nutrition Coach runs the whole vertical, so there is nobody above them for
 *   a review to route to. A Review tab here would be a queue that never fills.
 *
 *   No treatment-day terminology. These are check-in days against a diet plan, counted
 *   out of diet_sessions — a separate collection from `sessions`, so nothing here can be
 *   miscounted as physio treatment (see the module docstring in backend/routers/v3_diet.py).
 */

const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

// One Refresh per tab, wired to that tab's own loader. Icon-only and grey — it is the one
// control that acts rather than filters, so it should not read as another filter chip, but
// it is not the loudest thing on the board either.
const RefreshBtn = ({ onClick, busy, testid }) => (
  <Button
    onClick={onClick}
    disabled={busy}
    title="Refresh"
    aria-label="Refresh"
    className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
    data-testid={testid}
  >
    <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
  </Button>
);

const VIEW_TABS = [
  { key: "consultations", label: "Consultations", icon: Stethoscope },
  { key: "patients", label: "Patients", icon: Users },
];

// The Human Resource Master View's stage card: white and bordered, a coloured label over a
// big coloured number, and selecting one brings its own colour to the border and a wash of
// it to the card. Each tile keeps a distinct colour so the queue reads at a glance rather
// than as three identical boxes.
//
// No icon and no sub-line, matching HR. The icon repeated what the label already said in
// the space the number wanted, and the sub-line ("Not yet on a plan") was a caption on a
// word that needs none.
const StatTile = ({ label, value, color = "#64748b", onClick, active, testid }) => {
  const Tag = onClick ? "button" : "div";
  const tagProps = onClick ? { type: "button", onClick, "data-testid": testid } : { "data-testid": testid };
  return (
    <Tag
      {...tagProps}
      className={`w-full min-w-0 rounded-lg border-2 px-2 py-2 text-center transition sm:rounded-xl sm:px-4 sm:py-4 sm:text-left ${
        active ? "shadow-sm" : `border-slate-200 bg-white ${onClick ? "hover:shadow-sm" : ""}`
      }`}
      style={active ? { borderColor: color, backgroundColor: `${color}14` } : undefined}
    >
      {/* Two lines' worth of height on a phone whether the label needs it or not: "New
          Consultation" wraps where "All" and "Completed" do not, and without this its
          number would sit a line lower than its neighbours'. Desktop truncates instead. */}
      <span
        className="block min-h-[2.3em] break-words text-[9px] font-bold uppercase leading-[1.15] sm:min-h-0 sm:truncate sm:text-xs sm:tracking-wider"
        style={{ color }}
        title={label}
      >
        {label}
      </span>
      <span className="mt-0.5 block text-lg font-extrabold leading-tight sm:mt-1 sm:text-3xl" style={{ color }}>
        {value}
      </span>
    </Tag>
  );
};

// One colour per tile, so a glance at the row says which number is which.
const TILE_COLORS = { referred: "#0ea5e9", waiting: "#f59e0b", booked: "#10b981", neutral: "#64748b" };

export const DietBoard = ({ coachId } = {}) => {
  const [activeTab, setActiveTab] = useState("consultations");
  const [consultCount, setConsultCount] = useState(0);
  const [patientsCount, setPatientsCount] = useState(0);
  const badgeFor = { consultations: consultCount, patients: patientsCount };

  const [toolbarSlot, setToolbarSlot] = useState(null);
  const slotFor = (key) => (activeTab === key ? toolbarSlot : null);

  return (
    <div className="space-y-3 pb-20 md:pb-0" data-testid="diet-board-root">
      {/* Filled-pill tabs on a rule, the same control the Human Resource Master View uses.
          This is top-level navigation between three different jobs, and a filled pill says
          "you are here" more plainly than an underline does. Kept in emerald rather than
          HR's indigo so the vertical is still identifiable at a glance. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4 md:border-b md:border-slate-200 md:pb-2" data-testid="diet-view-bar">
        <div className="hidden flex-wrap items-center gap-2 md:flex" data-testid="diet-view-tabs">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            const count = badgeFor[tab.key] || 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
                data-testid={`diet-view-tab-${tab.key}`}
              >
                <Icon className="h-4 w-4" /> {tab.label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div ref={setToolbarSlot} className="flex flex-wrap items-center gap-2" data-testid="diet-view-toolbar" />
      </div>

      <div style={{ display: activeTab === "consultations" ? "block" : "none" }}>
        <ConsultationsTab coachId={coachId} onCountChange={setConsultCount} toolbarSlot={slotFor("consultations")} />
      </div>
      <div style={{ display: activeTab === "patients" ? "block" : "none" }}>
        <PatientsTab coachId={coachId} onCountChange={setPatientsCount} toolbarSlot={slotFor("patients")} />
      </div>

      {/* Phones only — the tab strip above is desk-only. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-600 bg-slate-500 pb-[env(safe-area-inset-bottom)] md:hidden" data-testid="diet-bottom-nav">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            const count = badgeFor[tab.key] || 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${isActive ? "text-white" : "text-slate-200"}`}
                data-testid={`diet-bottom-tab-${tab.key}`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {count > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * Diet Consultations — who is coming in, and who has already been seen.
 *
 * The list is everyone the Head Physio referred: `diet_recommended`, set when they chose
 * the patient's plan. That flag is the referral, so this queue and that decision cannot
 * disagree.
 *
 * Patients who already have a plan stay in the list, marked, rather than dropping out. A
 * coach needs to see what they have done as much as what is waiting, and a queue that
 * empties itself leaves no way to check the day back.
 */
function ConsultationsTab({ coachId, onCountChange, toolbarSlot }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("pending");
  const [reportFor, setReportFor] = useState(null); // the patient whose report is open

  // A callback rather than an inline effect, so the toolbar's Refresh has something to
  // call. The Patients tab was already shaped this way.
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await dietConsultations(coachId)).patients || []); }
    catch { setRows([]); }
    setLoading(false);
  }, [coachId]);

  useEffect(() => { load(); }, [load]);

  // Completed means the coach has written the consultation up, not that a slot was booked.
  // A consultation booked for next week has not happened, and a card counting it as done
  // would say so on the day it was booked. The written report is also what the patient
  // reads in their own portal, so it is the point at which the coach's work exists.
  //
  // The two split the list between them, so New Consultation + Completed is always All.
  const pending = rows.filter((r) => !r.diet_consultation_report);
  const done = rows.filter((r) => r.diet_consultation_report);

  // The badge counts outstanding work, so it falls to zero as the coach writes them up
  // rather than holding at the referral total.
  useEffect(() => { onCountChange?.(pending.length); }, [pending.length, onCountChange]);

  const visible = (filter === "done" ? done : filter === "all" ? rows : pending)
    .filter((r) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (r.lead_name || "").toLowerCase().includes(q) || (r.phone || "").includes(q);
    });

  // One row on every width. The search used to be w-full, which on a phone left the Refresh
  // no room and wrapped it onto a line of its own; it now takes the space left over beside
  // the button instead. min-w-0 so it can actually shrink — a flex item defaults to its
  // content's width and would push the button off the edge.
  const toolbar = (
    <div className="flex w-full items-center gap-2 sm:w-auto" data-testid="diet-consult-toolbar">
      <div className="relative min-w-0 flex-1 sm:w-[260px] sm:flex-none">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient..." className="h-10 pl-9" data-testid="diet-consult-search" />
      </div>
      <RefreshBtn onClick={load} busy={loading} testid="diet-consult-refresh" />
    </div>
  );

  return (
    <div data-testid="diet-consultations-tab">
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}

      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile label="All" value={rows.length} color={TILE_COLORS.referred} onClick={() => setFilter("all")} active={filter === "all"} testid="diet-consult-stat-all" />
        <StatTile label="New Consultation" value={pending.length} color={TILE_COLORS.waiting} onClick={() => setFilter("pending")} active={filter === "pending"} testid="diet-consult-stat-waiting" />
        <StatTile label="Completed" value={done.length} color={TILE_COLORS.booked} onClick={() => setFilter("done")} active={filter === "done"} testid="diet-consult-stat-seen" />
      </div>


      {loading ? (
        <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center">
          <Stethoscope className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <p className="text-sm text-slate-400">
            {filter === "done"
              ? "Nothing written up yet. A consultation counts as completed once its report is saved."
              : "Nothing outstanding. The branch books a Diet Consultation from the patient's card in Consultations."}
          </p>
        </div>
      ) : (
        <ConsultationList rows={visible} onOpen={setReportFor} />
      )}

      {reportFor && (
        <DietReportModal
          patient={reportFor}
          onClose={() => setReportFor(null)}
          onSaved={(text) => {
            setRows((prev) => prev.map((r) => (r.lead_id === reportFor.lead_id
              ? { ...r, diet_consultation_report: text } : r)));
            setReportFor(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The Diet Consultation report — what the coach concluded, and the thing the patient then
 * reads in their own Client Portal.
 *
 * One report per patient, replaced rather than appended to: it is the current plan, not a
 * log. The per-visit notes belong on each check-in day.
 */
function DietReportModal({ patient, onClose, onSaved }) {
  const [text, setText] = useState(patient.diet_consultation_report || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) { toast.error("Write the report before saving"); return; }
    setSaving(true);
    try {
      await saveDietConsultationReport(patient.lead_id, text.trim());
      toast.success("Diet Consultation report saved");
      onSaved(text.trim());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save the report");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3" data-testid="diet-report-modal">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <Salad className="h-4 w-4 text-orange-500" /> Diet Consultation Report
            </p>
            <p className="truncate text-[11px] text-slate-400">{patient.lead_name}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="diet-report-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 overflow-y-auto px-4 py-3">
          <p className="text-[11px] text-slate-500">
            The patient reads this in their Client Portal, so write it to them: what the
            plan is, and what to follow.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="Assessment, the diet plan, what to avoid, what to follow between check-ins..."
            className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-orange-400"
            data-testid="diet-report-text"
          />
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
          <Button variant="outline" className="flex-1 text-xs" onClick={onClose} data-testid="diet-report-cancel">
            Cancel
          </Button>
          <Button
            className="flex-[2] bg-orange-500 text-xs hover:bg-orange-600"
            onClick={save}
            disabled={saving || !text.trim()}
            data-testid="diet-report-save"
          >
            {saving ? "Saving..." : patient.diet_consultation_report ? "Update Report" : "Save Report"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A status pill in the Human Resource Master View's shape — a bordered chip tinted with
    its own colour, rather than a solid block. */
const StatusPill = ({ label, color, testid }) => (
  <span
    className="inline-flex shrink-0 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold"
    style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
    data-testid={testid}
  >
    {label}
  </span>
);

/**
 * The consultation queue as a table from tablet up, and the same rows as cards on a phone
 * — the Human Resource Master View's list, which is the pattern the OS uses wherever a
 * queue has more than two facts per row.
 *
 * As stacked cards, the phone number, the appointment and the check-in count were run into
 * one grey line separated by dots, so nothing lined up between rows and a coach scanning
 * for "who am I seeing on the 17th" had to read every row in full. In columns the same
 * facts sit under a heading that names them.
 */
const ConsultationList = ({ rows, onOpen }) => (
  <>
    <div className="space-y-2 sm:hidden" data-testid="diet-consult-list-mobile">
      {rows.map((p) => (
        <button
          key={p.lead_id}
          type="button"
          onClick={() => onOpen(p)}
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left"
          data-testid={`diet-consult-${p.lead_id}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-800">{p.lead_name}</p>
              <p className="truncate text-xs text-slate-500">{p.phone || "—"}</p>
            </div>
            {p.booked
              ? <StatusPill label="BOOKED" color={TILE_COLORS.booked} />
              : <StatusPill label="WAITING" color={TILE_COLORS.waiting} />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {p.consultation_decision === "consultation_treatment" && (
              <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">+ TREATMENT</span>
            )}
            {p.appointment_date && (
              <span className="font-semibold text-emerald-600">
                {fmtDate(p.appointment_date)}{p.appointment_time ? ` ${to12h(p.appointment_time)}` : ""}
              </span>
            )}
            {p.total_days > 0 && <span>· {p.completed_days}/{p.total_days} check-ins</span>}
            {p.diet_consultation_report
              ? <span className="font-semibold text-emerald-600">· report written</span>
              : <span className="text-slate-400">· no report yet</span>}
          </div>
        </button>
      ))}
    </div>

    <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block" data-testid="diet-consult-list-desktop">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-500 text-left text-[10px] uppercase tracking-wider text-white">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Patient</th>
              <th className="px-4 py-2.5 font-semibold">Contact</th>
              <th className="px-4 py-2.5 font-semibold">Plan</th>
              <th className="px-4 py-2.5 font-semibold">Diet Consultation</th>
              <th className="px-4 py-2.5 font-semibold">Check-ins</th>
              <th className="px-4 py-2.5 font-semibold">Report</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.lead_id} onClick={() => onOpen(p)} className="cursor-pointer hover:bg-slate-50" data-testid={`diet-consult-${p.lead_id}`}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{p.lead_name}</p>
                  {p.patient_number && <p className="font-mono text-[11px] text-slate-400">{p.patient_number}</p>}
                </td>
                <td className="px-4 py-3 text-slate-600">{p.phone || "—"}</td>
                {/* Whether this patient is also on a physio course — it changes how a diet
                    plan should be pitched, and the coach sees it nowhere else. */}
                <td className="px-4 py-3">
                  {p.consultation_decision === "consultation_treatment"
                    ? <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">+ TREATMENT</span>
                    : <span className="text-[11px] text-slate-400">Diet only</span>}
                </td>
                {/* The DIET consultation's own date and time, not the Head Physio's. */}
                <td className="px-4 py-3 text-slate-600">
                  {p.appointment_date
                    ? <span className="whitespace-nowrap">{fmtDate(p.appointment_date)}{p.appointment_time ? ` at ${to12h(p.appointment_time)}` : ""}</span>
                    : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {p.total_days > 0 ? `${p.completed_days}/${p.total_days}` : "—"}
                </td>
                {/* Who has been written up. The report is what the patient reads in their
                    own portal, so an unwritten one is work still outstanding. */}
                <td className="px-4 py-3">
                  {p.diet_consultation_report
                    ? <StatusPill label="WRITTEN" color={TILE_COLORS.booked} />
                    : <span className="text-[11px] text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  {p.booked
                    ? <StatusPill label="BOOKED" color={TILE_COLORS.booked} testid={`diet-consult-status-${p.lead_id}`} />
                    : <StatusPill label="AWAITING BOOKING" color={TILE_COLORS.waiting} testid={`diet-consult-status-${p.lead_id}`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </>
);

function PatientsTab({ coachId, onCountChange, toolbarSlot }) {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyTab, setHistoryTab] = useState("ongoing");
  const [openLead, setOpenLead] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPatients((await dietPatients(coachId)).patients || []); }
    catch { /* silent */ }
    setLoading(false);
  }, [coachId]);

  useEffect(() => { load(); }, [load]);

  const isDone = (p) => p.total_days > 0 && p.remaining_days === 0;
  const ongoing = patients.filter((p) => !isDone(p));
  const completed = patients.filter(isDone);
  const visible = historyTab === "completed" ? completed : ongoing;

  useEffect(() => { onCountChange?.(ongoing.length); }, [ongoing.length, onCountChange]);

  // This tab has no search or filter of its own, so its toolbar is the Refresh alone —
  // still portaled into the shared slot, so the button sits in the same place on both
  // tabs rather than moving when you switch.
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" data-testid="diet-patients-toolbar">
      <RefreshBtn onClick={load} busy={loading} testid="diet-patients-refresh" />
    </div>
  );

  return (
    <div data-testid="diet-patients-tab">
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}

      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {[{ key: "ongoing", label: "Ongoing", count: ongoing.length }, { key: "completed", label: "Completed", count: completed.length }].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setHistoryTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${historyTab === t.key ? "bg-emerald-100 text-emerald-700" : "text-slate-500 hover:bg-slate-50"}`}
            data-testid={`diet-history-${t.key}`}
          >
            {t.label} <span className="text-[10px] text-slate-400">({t.count})</span>
          </button>
        ))}
      </div>

      {visible.length === 0 && !loading ? (
        <div className="py-16 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <p className="text-sm text-slate-400">{historyTab === "completed" ? "No completed diet plans yet" : "No patients assigned yet"}</p>
        </div>
      ) : (
        <PatientList rows={visible} onOpen={setOpenLead} />
      )}

      {openLead && <PatientDaysModal patient={openLead} onClose={() => setOpenLead(null)} />}
    </div>
  );
}

/** The caseload in the same list the queue uses: table from tablet up, cards on a phone.
    The progress bar survives into the table as a column of its own — it is the one thing
    on this board that answers "how far through is this patient" without arithmetic. */
const PatientList = ({ rows, onOpen }) => {
  const pct = (p) => (p.total_days > 0 ? (p.completed_days / p.total_days) * 100 : 0);
  return (
    <>
      <div className="space-y-2 sm:hidden" data-testid="diet-patient-list-mobile">
        {rows.map((p) => (
          <button
            key={p.lead_id}
            type="button"
            onClick={() => onOpen(p)}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left"
            data-testid={`diet-patient-${p.lead_id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-800">{p.lead_name}</p>
                <p className="truncate text-xs text-slate-500">{p.phone || "—"}</p>
              </div>
              <span className="shrink-0 text-sm font-bold text-emerald-600">{p.completed_days}/{p.total_days}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct(p)}%` }} />
            </div>
          </button>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block" data-testid="diet-patient-list-desktop">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-500 text-left text-[10px] uppercase tracking-wider text-white">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Patient</th>
                <th className="px-4 py-2.5 font-semibold">Contact</th>
                <th className="px-4 py-2.5 font-semibold">Next Check-in</th>
                <th className="px-4 py-2.5 font-semibold">Progress</th>
                <th className="px-4 py-2.5 font-semibold">Done</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr
                  key={p.lead_id}
                  onClick={() => onOpen(p)}
                  className="cursor-pointer hover:bg-slate-50"
                  data-testid={`diet-patient-${p.lead_id}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{p.lead_name}</p>
                    {p.diet_stage && <p className="text-[11px] text-slate-400">{p.diet_stage}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.phone || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.next_day?.slot_time
                      ? <span className="whitespace-nowrap">{fmtDate((p.next_day.slot_time || "").slice(0, 10))} at {to12h((p.next_day.slot_time || "").slice(11, 16))}</span>
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct(p)}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-emerald-600">{p.completed_days}/{p.total_days}</span>
                  </td>
                  <td className="px-4 py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-slate-300" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

const PatientDaysModal = ({ patient, onClose }) => {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    dietSessions(patient.lead_id)
      .then((r) => setDays(r.days || []))
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [patient.lead_id]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="diet-patient-modal">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-emerald-600 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{patient.lead_name}</p>
            <p className="text-xs text-white/80">{patient.completed_days} of {patient.total_days} check-ins done</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
          ) : days.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No check-in days booked yet.</p>
          ) : (
            <div className="space-y-2">
              {days.map((d) => {
                const done = d.status === "completed";
                return (
                  <div key={d.id} className={`rounded-lg border p-3 ${done ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-700">Day {d.day_number}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {done ? "Completed" : "Upcoming"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {fmtDate((d.slot_time || "").slice(0, 10))} · {to12h((d.slot_time || "").slice(11, 16))}
                      {d.weight_kg != null ? ` · ${d.weight_kg} kg` : ""}
                    </p>
                    {d.coach_remarks && <p className="mt-1 text-xs text-slate-600">“{d.coach_remarks}”</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DietBoard;
