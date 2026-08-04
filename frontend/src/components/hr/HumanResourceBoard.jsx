import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  FileText,
  IdCard,
  IndianRupee,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { MilkDateInput, MilkTimeInput } from "@/components/ui/milk-calendar";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { StageTab } from "@/components/ui/stage-tab";
import { CandidatePullButton } from "@/components/hr/CandidatePullButton";
import { CandidateSheetPanel } from "@/components/hr/CandidateSheetPanel";
import { RecruitmentStagesPanel } from "@/components/hr/RecruitmentStagesPanel";
import { HRBoard } from "@/components/hr/HRBoard";
import { to12h } from "@/lib/time";
import {
  recruitmentBoard,
  recruitmentCreateCandidate,
  recruitmentUpdateCandidate,
  recruitmentMoveCandidate,
  recruitmentScheduleInterview,
  recruitmentRecordOffer,
  recruitmentAddNote,
  recruitmentDeleteCandidate,
} from "@/lib/api";

// The Human Resource Master View: one board for the whole recruitment process, from a CV
// landing to someone joining.
//
// Indigo rather than the clinical sky/teal — HR is the one board here that isn't about a
// patient, and the colour is the quickest way to know which OS you are looking at.
//
// Stage names are never written down in this file. Every stage arrives from the API with
// its own id and colour, and a candidate is moved by id — so HR can rename "Screening" to
// anything and nothing in here needs changing.

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const money = (n) =>
  n || n === 0 ? `Rs.${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";

const prettyDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const sinceDays = (iso) => {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
};

const emptyCandidate = {
  full_name: "",
  phone: "",
  email: "",
  position: "",
  department: "",
  location: "",
  experience_years: "",
  current_ctc: "",
  expected_ctc: "",
  source: "Walk-in",
  resume_url: "",
  notes: "",
};

// What this board is for, in three parts: the candidates you work today, the people already
// employed, and the plumbing that feeds and shapes the pipeline.
const VIEWS = [
  { key: "pipeline", label: "Candidates", icon: Users },
  { key: "employees", label: "Employee Manage", icon: IdCard },
  { key: "sources", label: "Source Manage", icon: FileSpreadsheet },
];

// The four cards are the board's filter, the same way the Head Physio's cards are. Each
// one answers a question HR actually asks, not just "how many rows are there".
const CARDS = [
  { key: "all", label: "Candidates", icon: Users, hint: "Everyone on record" },
  { key: "in_process", label: "In Process", icon: Clock, hint: "Not yet joined or rejected" },
  { key: "interviews", label: "Interviews Today", icon: CalendarClock, hint: "Scheduled for today" },
  { key: "closed", label: "Closed", icon: CheckCircle2, hint: "Joined or rejected" },
];

export const HumanResourceBoard = ({ user }) => {
  const [board, setBoard] = useState({ stages: [], candidates: [], summary: {}, sources: [], interview_modes: [] });
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  // The sheet connections are setup, not day-to-day work, so they sit behind their own
  // view rather than above the pipeline where they'd be scrolled past every morning.
  const [view, setView] = useState("pipeline");
  const [dateFilter, setDateFilter] = useState({ key: null, label: "", from: null, to: null });
  const [sortDir, setSortDir] = useState("newest");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await recruitmentBoard();
      setBoard(data);
      // Keep an open candidate card in sync with what just came back, so a stage move or a
      // new note shows in the popup without closing and reopening it.
      setSelected((prev) => (prev ? (data.candidates || []).find((c) => c.id === prev.id) || null : null));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the recruitment board");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stages = board.stages || [];
  const finalIds = useMemo(() => new Set(stages.filter((s) => s.is_final).map((s) => s.id)), [stages]);
  const today = todayIso();

  // Card, stage pill, date, search then sort narrow the same list, in that order.
  const rows = useMemo(() => {
    let list = board.candidates || [];
    if (card === "in_process") list = list.filter((c) => !finalIds.has(c.stage_id));
    else if (card === "closed") list = list.filter((c) => finalIds.has(c.stage_id));
    else if (card === "interviews") list = list.filter((c) => (c.interview || {}).interview_date === today);

    if (stageFilter !== "all") list = list.filter((c) => c.stage_id === stageFilter);

    if (dateFilter?.from && dateFilter?.to) {
      const from = dateFilter.from.getTime();
      const to = dateFilter.to.getTime();
      list = list.filter((c) => {
        const t = new Date(c.created_at || 0).getTime();
        return Number.isFinite(t) && t >= from && t <= to;
      });
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        [c.full_name, c.phone, c.email, c.position, c.department]
          .some((f) => String(f || "").toLowerCase().includes(q)),
      );
    }

    // Copy before sorting — the board's own array is the source for every other count.
    return [...list].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return sortDir === "newest" ? tb - ta : ta - tb;
    });
  }, [board.candidates, card, stageFilter, search, finalIds, today, dateFilter, sortDir]);

  const counts = useMemo(() => {
    const list = board.candidates || [];
    return {
      all: list.length,
      in_process: list.filter((c) => !finalIds.has(c.stage_id)).length,
      interviews: list.filter((c) => (c.interview || {}).interview_date === today).length,
      closed: list.filter((c) => finalIds.has(c.stage_id)).length,
    };
  }, [board.candidates, finalIds, today]);

  return (
    <div className="space-y-4 pb-24 md:pb-6" data-testid="hr-recruitment-board">
      {/* The board's three jobs. Candidates is the daily one and stays first; the other two
          are administration and sit behind it rather than beside the pipeline, where they
          were scrolled past every morning.

          Plain tabs on a rule, matching the Super Admin nav — this is top-level navigation,
          and a segmented control reads as a filter on the thing below it. On a phone the
          same three live in the bottom bar instead, thumb-high. */}
      <div className="hidden flex-wrap gap-2 border-b border-slate-200 pb-2 md:flex" data-testid="hr-view-switch">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                view === v.key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`hr-view-${v.key}`}
            >
              <Icon className="h-4 w-4" /> {v.label}
            </button>
          );
        })}
      </div>

      {view === "employees" && (
        <div data-testid="hr-employee-manage">
          <HRBoard />
        </div>
      )}

      {view === "sources" && (
        <SourceManageView
          stageCount={stages.length}
          onImported={() => { load(); setView("pipeline"); }}
          onStagesChanged={load}
        />
      )}

      {view === "pipeline" && (
      <>
      {/* Summary cards — also the filter. Horizontal scroll on a phone rather than a 2x2
          grid, so the row reads as one control instead of four tiles. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0" data-testid="hr-summary-cards">
        {CARDS.map((c) => {
          const Icon = c.icon;
          const active = card === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => { setCard(c.key); setStageFilter("all"); }}
              title={c.hint}
              className={`w-[8.5rem] shrink-0 rounded-xl border-2 px-3 py-2.5 text-left transition sm:w-auto sm:px-4 sm:py-4 ${
                active ? "border-indigo-600 bg-indigo-50 shadow-sm" : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm"
              }`}
              data-testid={`hr-card-${c.key}`}
            >
              <span className={`flex items-center gap-1.5 ${active ? "text-indigo-700" : "text-slate-500"}`}>
                <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                <span className="truncate text-[10px] font-bold uppercase tracking-wider sm:text-xs">{c.label}</span>
              </span>
              <span className={`mt-0.5 block text-2xl font-extrabold sm:mt-1 sm:text-3xl ${active ? "text-indigo-700" : "text-slate-800"}`}>
                {counts[c.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* The same StageTab the Branch Leads and Consultations boards use, so a stage reads
          identically wherever you meet it: a soft tint of its own colour when idle, solid
          when selected, name above count.

          Reused rather than restyled to match — a copy would drift the first time that one
          is touched. It is driven by stage id here (candidates reference an id, not a
          name), which is why the bar is laid out locally instead of using StageTabBar.
          Lexend is set on the wrapper so it inherits without touching the shared
          component, which Branch Admin also renders. */}
      <div
        className="-mx-1 rounded-xl border border-slate-200 bg-white p-1"
        style={{ fontFamily: "Lexend, sans-serif" }}
        data-testid="hr-stage-pills"
      >
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:flex lg:flex-nowrap">
          <StageTab
            label="All Stages"
            count={counts.all}
            active={stageFilter === "all"}
            onClick={() => setStageFilter("all")}
            color="#0ea5e9"
            testid="hr-stage-pill-all"
            gridded
          />
          {stages.map((s) => (
            <StageTab
              key={s.id}
              label={s.name}
              count={s.count ?? 0}
              active={stageFilter === s.id}
              onClick={() => setStageFilter(stageFilter === s.id ? "all" : s.id)}
              color={s.color || "#64748b"}
              testid={`hr-stage-pill-${s.id}`}
              gridded
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email or position..."
            className="min-w-0 flex-1 border-0 p-0 text-sm outline-none placeholder:text-slate-400"
            data-testid="hr-search-input"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filters by when the candidate was added, which is what "0d / 19d" in the Age
              column counts from — the two answer the same question. */}
          <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="hr-date-filter" />

          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "newest" ? "oldest" : "newest"))}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            title="Sort by when the candidate was added"
            data-testid="hr-sort-toggle"
          >
            <ArrowUpDown className="h-4 w-4 shrink-0 text-slate-400" />
            {sortDir === "newest" ? "Newest first" : "Oldest first"}
          </button>

          <Button
            onClick={() => setShowAdd(true)}
            className="hidden h-10 shrink-0 bg-indigo-600 text-white hover:bg-indigo-700 sm:inline-flex"
            data-testid="hr-add-candidate-button"
          >
            <UserPlus className="mr-1.5 h-4 w-4" /> Add Candidate
          </Button>

          <CandidatePullButton onPulled={load} />
        </div>
      </div>

      <CandidateList rows={rows} onOpen={setSelected} loading={loading} />

      {/* On a phone the header button is a scroll away by the time you've read the list.
          Sits above the bottom bar rather than on top of it. */}
      <button
        type="button"
        onClick={() => setShowAdd(true)}
        className="fixed bottom-20 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg sm:hidden"
        aria-label="Add candidate"
        data-testid="hr-add-candidate-fab"
      >
        <Plus className="h-6 w-6" />
      </button>
      </>
      )}

      {/* Same three destinations as the desktop tabs above, from the one VIEWS array so
          the two surfaces can't drift apart. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-200 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.06)] md:hidden" data-testid="hr-bottom-nav">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium leading-tight ${
                active ? "text-indigo-600" : "text-slate-400"
              }`}
              data-testid={`hr-nav-${v.key}`}
            >
              <Icon className="h-5 w-5" />
              {v.label}
            </button>
          );
        })}
      </nav>

      {showAdd && (
        <AddCandidateModal
          sources={board.sources || []}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}

      {selected && (
        <CandidateModal
          candidate={selected}
          stages={stages}
          modes={board.interview_modes || []}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
};


/** Where candidates come from, and the shape they move through — the two halves of the
    pipeline's plumbing, kept side by side because they are usually set up together and
    then rarely touched again. */
const SourceManageView = ({ stageCount, onImported, onStagesChanged }) => {
  const [sub, setSub] = useState("sheets");
  return (
    <div className="space-y-4" data-testid="hr-source-manage">
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 sm:max-w-md" data-testid="hr-source-subtabs">
        {[
          { key: "sheets", label: "Google Sheets", icon: FileSpreadsheet },
          { key: "stages", label: `Manage Stage (${stageCount})`, icon: SlidersHorizontal },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition sm:text-sm ${
                sub === t.key ? "bg-white text-indigo-600 shadow" : "text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`hr-source-sub-${t.key}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {sub === "sheets" && <CandidateSheetPanel onImported={onImported} />}
      {sub === "stages" && <RecruitmentStagesPanel onChanged={onStagesChanged} />}
    </div>
  );
};


/** Table from tablet up; the same rows as cards on a phone, where six columns can only
    scroll sideways past the ones that matter. */
const CandidateList = ({ rows, onOpen, loading }) => {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 px-3 py-14 text-center text-sm text-slate-400" data-testid="hr-list-empty">
        {loading ? "Loading candidates..." : "No candidates here yet."}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2 sm:hidden" data-testid="hr-list-mobile">
        {rows.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c)}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left"
            data-testid={`hr-card-row-${c.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-800">{c.full_name}</p>
                <p className="truncate text-xs text-slate-500">{c.position || "Position not set"}</p>
              </div>
              <StagePill candidate={c} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span>{c.phone}</span>
              {c.experience_years ? <span>· {c.experience_years} yrs</span> : null}
              {c.expected_ctc ? <span>· exp {money(c.expected_ctc)}</span> : null}
              {(c.interview || {}).interview_date ? (
                <span className="font-semibold text-amber-600">
                  · {prettyDate(c.interview.interview_date)} {to12h(c.interview.interview_time)}
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block" data-testid="hr-list-desktop">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Candidate</th>
                <th className="px-4 py-2.5 font-semibold">Position</th>
                <th className="px-4 py-2.5 font-semibold">Contact</th>
                <th className="px-4 py-2.5 font-semibold">Experience</th>
                <th className="px-4 py-2.5 font-semibold">Expected</th>
                <th className="px-4 py-2.5 font-semibold">Stage</th>
                <th className="px-4 py-2.5 font-semibold">Interview</th>
                <th className="px-4 py-2.5 font-semibold">Age</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const age = sinceDays(c.created_at);
                return (
                  <tr
                    key={c.id}
                    onClick={() => onOpen(c)}
                    className="cursor-pointer hover:bg-slate-50"
                    data-testid={`hr-row-${c.id}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{c.full_name}</p>
                      <p className="text-[11px] text-slate-400">{c.source || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.position || "—"}
                      {c.department ? <span className="block text-[11px] text-slate-400">{c.department}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.phone}
                      {c.email ? <span className="block truncate text-[11px] text-slate-400">{c.email}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.experience_years ? `${c.experience_years} yrs` : "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{money(c.expected_ctc)}</td>
                    <td className="px-4 py-3"><StagePill candidate={c} /></td>
                    <td className="px-4 py-3 text-slate-500">
                      {(c.interview || {}).interview_date
                        ? <span className="whitespace-nowrap">{prettyDate(c.interview.interview_date)} {to12h(c.interview.interview_time)}</span>
                        : "—"}
                    </td>
                    {/* How long they have been sitting in the pipeline — the number that
                        makes a stalled candidate obvious without opening anything. */}
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold ${age > 14 ? "text-red-500" : age > 7 ? "text-amber-500" : "text-slate-400"}`}>
                        {age === null ? "—" : `${age}d`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-slate-300" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};


const StagePill = ({ candidate }) => (
  <span
    className="inline-flex shrink-0 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold"
    style={{
      color: candidate.stage_color,
      borderColor: `${candidate.stage_color}55`,
      backgroundColor: `${candidate.stage_color}14`,
    }}
    data-testid={`hr-stage-badge-${candidate.id}`}
  >
    {candidate.stage_name}
  </span>
);


const Field = ({ label, children, className = "" }) => (
  <div className={className}>
    <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
    {children}
  </div>
);


const AddCandidateModal = ({ sources, onClose, onSaved }) => {
  const [form, setForm] = useState(emptyCandidate);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.full_name.trim() || !form.phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    setBusy(true);
    try {
      // Blank number fields must go as null, not "" — the API types them as floats.
      await recruitmentCreateCandidate({
        ...form,
        experience_years: form.experience_years === "" ? null : Number(form.experience_years),
        current_ctc: form.current_ctc === "" ? null : Number(form.current_ctc),
        expected_ctc: form.expected_ctc === "" ? null : Number(form.expected_ctc),
      });
      toast.success("Candidate added");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add this candidate");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="hr-add-modal">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-white">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            <p className="text-base font-semibold">Add Candidate</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="hr-add-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Full Name *"><Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="e.g. Ramya Raju" data-testid="hr-add-name" /></Field>
          <Field label="Phone *"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" data-testid="hr-add-phone" /></Field>
          <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" data-testid="hr-add-email" /></Field>
          <Field label="Position Applied For"><Input value={form.position} onChange={(e) => set("position", e.target.value)} placeholder="e.g. Physiotherapist" data-testid="hr-add-position" /></Field>
          <Field label="Department"><Input value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="e.g. Clinical" data-testid="hr-add-department" /></Field>
          <Field label="Location"><Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Anna Nagar" data-testid="hr-add-location" /></Field>
          <Field label="Experience (years)"><Input type="number" min="0" step="0.5" value={form.experience_years} onChange={(e) => set("experience_years", e.target.value)} data-testid="hr-add-experience" /></Field>
          <Field label="Source">
            <select
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              data-testid="hr-add-source"
            >
              {(sources.length ? sources : ["Walk-in"]).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Current CTC (annual)"><Input type="number" min="0" value={form.current_ctc} onChange={(e) => set("current_ctc", e.target.value)} placeholder="0" data-testid="hr-add-current-ctc" /></Field>
          <Field label="Expected CTC (annual)"><Input type="number" min="0" value={form.expected_ctc} onChange={(e) => set("expected_ctc", e.target.value)} placeholder="0" data-testid="hr-add-expected-ctc" /></Field>
          <Field label="Resume Link" className="sm:col-span-2"><Input value={form.resume_url} onChange={(e) => set("resume_url", e.target.value)} placeholder="Drive / Dropbox link" data-testid="hr-add-resume" /></Field>
          <Field label="Notes" className="sm:col-span-2">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Anything worth remembering about this candidate..."
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              data-testid="hr-add-notes"
            />
          </Field>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3 backdrop-blur">
          <Button variant="outline" onClick={onClose} data-testid="hr-add-cancel">Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-indigo-600 text-white hover:bg-indigo-700" data-testid="hr-add-save">
            {busy ? "Saving..." : "Add Candidate"}
          </Button>
        </div>
      </div>
    </div>
  );
};


const CandidateModal = ({ candidate, stages, modes, onClose, onChanged }) => {
  const [tab, setTab] = useState("process");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [remark, setRemark] = useState("");
  const [note, setNote] = useState("");
  const [interview, setInterview] = useState({
    interview_date: (candidate.interview || {}).interview_date || todayIso(),
    interview_time: (candidate.interview || {}).interview_time || "10:00",
    mode: (candidate.interview || {}).mode || "In-person",
    panel: (candidate.interview || {}).panel || "",
    notes: (candidate.interview || {}).notes || "",
  });
  const [offer, setOffer] = useState({
    offered_ctc: (candidate.offer || {}).offered_ctc ?? "",
    joining_date: (candidate.offer || {}).joining_date || "",
    notes: (candidate.offer || {}).notes || "",
  });

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      await onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "That did not go through");
    }
    setBusy(false);
  };

  const move = (stage) => run(
    () => recruitmentMoveCandidate(candidate.id, { stage_id: stage.id, remark: remark.trim() }),
    `Moved to ${stage.name}`,
  ).then(() => setRemark(""));

  const removeCandidate = () => {
    if (!window.confirm(`Remove ${candidate.full_name} from the pipeline? This cannot be undone.`)) return;
    run(() => recruitmentDeleteCandidate(candidate.id), "Candidate removed").then(onClose);
  };

  const history = [...(candidate.history || [])].reverse();
  const age = sinceDays(candidate.created_at);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="hr-candidate-modal">
      <div className="flex max-h-[95vh] h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{candidate.full_name}</p>
            <p className="truncate text-xs text-white/80">
              {candidate.position || "Position not set"}
              {candidate.department ? ` · ${candidate.department}` : ""}
              {age !== null ? ` · ${age} days in pipeline` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-[5px] bg-white/20 px-2 py-1 text-[11px] font-bold">{candidate.stage_name}</span>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="hr-candidate-close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-slate-200 px-3 pt-2">
          {[
            { key: "process", label: "Recruitment Process" },
            { key: "details", label: "Details" },
            { key: "history", label: `History (${history.length})` },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-t-md px-3 py-2 text-xs font-bold transition sm:text-sm ${
                tab === t.key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`hr-candidate-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "process" && (
            <div className="space-y-5" data-testid="hr-candidate-process">
              {/* The pipeline as a track, so where they are and what is left both read at
                  a glance. Past stages fill in; the current one is solid. */}
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Pipeline</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {stages.map((s) => {
                    const here = s.id === candidate.stage_id;
                    const passed = s.order < (candidate.stage_order ?? 0) && !s.is_final;
                    return (
                      <span
                        key={s.id}
                        className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
                        style={here
                          ? { backgroundColor: s.color, borderColor: s.color, color: "#fff" }
                          : passed
                            ? { backgroundColor: `${s.color}22`, borderColor: `${s.color}55`, color: s.color }
                            : { borderColor: "#e2e8f0", color: "#94a3b8" }}
                        data-testid={`hr-track-${s.id}`}
                      >
                        {s.name}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Move to Stage</p>
                <Input
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="Remark for this move (optional — required in spirit when rejecting)"
                  className="mb-2"
                  data-testid="hr-move-remark"
                />
                <div className="flex flex-wrap gap-2">
                  {stages.filter((s) => s.id !== candidate.stage_id).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy}
                      onClick={() => move(s)}
                      className="rounded-md border px-3 py-2 text-xs font-bold transition hover:shadow-sm disabled:opacity-50"
                      style={{ borderColor: `${s.color}77`, color: s.color }}
                      data-testid={`hr-move-to-${s.id}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <CalendarClock className="h-3.5 w-3.5" /> Interview
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date">
                    <MilkDateInput
                      value={interview.interview_date}
                      accent="sky"
                      onChange={(e) => setInterview({ ...interview, interview_date: e.target.value })}
                      data-testid="hr-interview-date"
                    />
                  </Field>
                  <Field label="Time">
                    <MilkTimeInput
                      value={interview.interview_time}
                      accent="sky"
                      onChange={(e) => setInterview({ ...interview, interview_time: e.target.value })}
                      data-testid="hr-interview-time"
                    />
                  </Field>
                  <Field label="Mode">
                    <select
                      value={interview.mode}
                      onChange={(e) => setInterview({ ...interview, mode: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                      data-testid="hr-interview-mode"
                    >
                      {(modes.length ? modes : ["In-person"]).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="Panel / Interviewer">
                    <Input value={interview.panel} onChange={(e) => setInterview({ ...interview, panel: e.target.value })} placeholder="Who is taking it" data-testid="hr-interview-panel" />
                  </Field>
                </div>
                <Button
                  onClick={() => run(() => recruitmentScheduleInterview(candidate.id, interview), "Interview scheduled")}
                  disabled={busy}
                  className="mt-3 bg-indigo-600 text-white hover:bg-indigo-700"
                  data-testid="hr-interview-save"
                >
                  {candidate.interview ? "Update Interview" : "Schedule Interview"}
                </Button>
                {candidate.interview && (
                  <p className="mt-2 text-xs text-slate-500" data-testid="hr-interview-current">
                    Currently: <span className="font-semibold text-slate-700">
                      {prettyDate(candidate.interview.interview_date)} · {to12h(candidate.interview.interview_time)} · {candidate.interview.mode}
                      {candidate.interview.panel ? ` · ${candidate.interview.panel}` : ""}
                    </span>
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <IndianRupee className="h-3.5 w-3.5" /> Offer
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Offered CTC (annual)">
                    <Input type="number" min="0" value={offer.offered_ctc} onChange={(e) => setOffer({ ...offer, offered_ctc: e.target.value })} placeholder="0" data-testid="hr-offer-ctc" />
                  </Field>
                  <Field label="Joining Date">
                    <MilkDateInput
                      value={offer.joining_date}
                      accent="teal"
                      onChange={(e) => setOffer({ ...offer, joining_date: e.target.value })}
                      data-testid="hr-offer-joining-date"
                    />
                  </Field>
                </div>
                <Button
                  onClick={() => run(
                    () => recruitmentRecordOffer(candidate.id, {
                      ...offer,
                      offered_ctc: offer.offered_ctc === "" ? null : Number(offer.offered_ctc),
                    }),
                    "Offer recorded",
                  )}
                  disabled={busy}
                  variant="outline"
                  className="mt-3 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  data-testid="hr-offer-save"
                >
                  Record Offer
                </Button>
                {candidate.offer && (
                  <p className="mt-2 text-xs text-slate-500" data-testid="hr-offer-current">
                    Currently: <span className="font-semibold text-slate-700">
                      {money(candidate.offer.offered_ctc)}
                      {candidate.offer.joining_date ? ` · joins ${prettyDate(candidate.offer.joining_date)}` : ""}
                    </span>
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Add a Note</p>
                <div className="flex gap-2">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened in the last conversation..." data-testid="hr-note-input" />
                  <Button
                    onClick={() => run(() => recruitmentAddNote(candidate.id, note), "Note added").then(() => setNote(""))}
                    disabled={busy || !note.trim()}
                    variant="outline"
                    data-testid="hr-note-save"
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tab === "details" && editing && (
            <EditDetails
              candidate={candidate}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={(patch) => run(
                () => recruitmentUpdateCandidate(candidate.id, patch),
                "Candidate updated",
              ).then(() => setEditing(false))}
            />
          )}

          {tab === "details" && !editing && (
            <div className="space-y-4" data-testid="hr-candidate-details">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  data-testid="hr-candidate-edit"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit Details
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail icon={Phone} label="Phone" value={candidate.phone} />
                <Detail icon={Mail} label="Email" value={candidate.email} />
                <Detail icon={Briefcase} label="Position" value={candidate.position} />
                <Detail icon={Users} label="Department" value={candidate.department} />
                <Detail icon={MapPin} label="Location" value={candidate.location} />
                <Detail icon={Clock} label="Experience" value={candidate.experience_years ? `${candidate.experience_years} years` : ""} />
                <Detail icon={IndianRupee} label="Current CTC" value={candidate.current_ctc ? money(candidate.current_ctc) : ""} />
                <Detail icon={IndianRupee} label="Expected CTC" value={candidate.expected_ctc ? money(candidate.expected_ctc) : ""} />
                <Detail icon={FileText} label="Source" value={candidate.source} />
                <Detail icon={Clock} label="Added" value={candidate.created_at ? prettyDate(candidate.created_at.slice(0, 10)) : ""} />
              </div>

              {candidate.resume_url && (
                <a
                  href={candidate.resume_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
                  data-testid="hr-resume-link"
                >
                  <FileText className="h-4 w-4" /> Open Resume
                </a>
              )}

              {candidate.notes && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{candidate.notes}</p>
                </div>
              )}

              {candidate.rejected_reason && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wider text-red-400">Closing Remark</p>
                  <p className="text-sm text-red-700">{candidate.rejected_reason}</p>
                </div>
              )}

              <button
                type="button"
                onClick={removeCandidate}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
                data-testid="hr-candidate-delete"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove from pipeline
              </button>
            </div>
          )}

          {tab === "history" && (
            <div data-testid="hr-candidate-history">
              {history.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-3">
                  {history.map((h, i) => (
                    <li key={`${h.at}-${i}`} className="flex gap-3">
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{h.action}</p>
                        {h.detail && <p className="text-sm text-slate-600">{h.detail}</p>}
                        <p className="text-[11px] text-slate-400">
                          {h.by} · {h.at ? new Date(h.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


/** Correcting what was typed at intake — a wrong phone number otherwise makes the whole
    record dead weight. Stage, interview and offer are not here on purpose: those are moves
    in the process, and they belong on the Recruitment Process tab where they leave a
    history entry behind. */
const EditDetails = ({ candidate, busy, onCancel, onSave }) => {
  const [form, setForm] = useState({
    full_name: candidate.full_name || "",
    phone: candidate.phone || "",
    email: candidate.email || "",
    position: candidate.position || "",
    department: candidate.department || "",
    location: candidate.location || "",
    experience_years: candidate.experience_years ?? "",
    current_ctc: candidate.current_ctc ?? "",
    expected_ctc: candidate.expected_ctc ?? "",
    resume_url: candidate.resume_url || "",
    notes: candidate.notes || "",
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const save = () => {
    if (!form.full_name.trim() || !form.phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    // The API drops nulls rather than writing them, so a cleared number simply stays as
    // it was — sending "" instead would fail float validation.
    onSave({
      ...form,
      experience_years: form.experience_years === "" ? null : Number(form.experience_years),
      current_ctc: form.current_ctc === "" ? null : Number(form.current_ctc),
      expected_ctc: form.expected_ctc === "" ? null : Number(form.expected_ctc),
    });
  };

  return (
    <div className="space-y-4" data-testid="hr-candidate-edit-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full Name *"><Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} data-testid="hr-edit-name" /></Field>
        <Field label="Phone *"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="hr-edit-phone" /></Field>
        <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="hr-edit-email" /></Field>
        <Field label="Position"><Input value={form.position} onChange={(e) => set("position", e.target.value)} data-testid="hr-edit-position" /></Field>
        <Field label="Department"><Input value={form.department} onChange={(e) => set("department", e.target.value)} data-testid="hr-edit-department" /></Field>
        <Field label="Location"><Input value={form.location} onChange={(e) => set("location", e.target.value)} data-testid="hr-edit-location" /></Field>
        <Field label="Experience (years)"><Input type="number" min="0" step="0.5" value={form.experience_years} onChange={(e) => set("experience_years", e.target.value)} data-testid="hr-edit-experience" /></Field>
        <Field label="Current CTC"><Input type="number" min="0" value={form.current_ctc} onChange={(e) => set("current_ctc", e.target.value)} data-testid="hr-edit-current-ctc" /></Field>
        <Field label="Expected CTC"><Input type="number" min="0" value={form.expected_ctc} onChange={(e) => set("expected_ctc", e.target.value)} data-testid="hr-edit-expected-ctc" /></Field>
        <Field label="Resume Link"><Input value={form.resume_url} onChange={(e) => set("resume_url", e.target.value)} data-testid="hr-edit-resume" /></Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            data-testid="hr-edit-notes"
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} data-testid="hr-edit-cancel">Cancel</Button>
        <Button onClick={save} disabled={busy} className="bg-indigo-600 text-white hover:bg-indigo-700" data-testid="hr-edit-save">
          {busy ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
};


const Detail = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="truncate text-sm font-medium text-slate-800">{value || "—"}</p>
    </div>
  </div>
);

export default HumanResourceBoard;
