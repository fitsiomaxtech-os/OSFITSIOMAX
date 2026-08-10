import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Salad,
  Search,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { dietCalendar, dietPatients, dietSessions, dietCompleteDay } from "@/lib/api";
import { to12h } from "@/lib/time";

/**
 * Diet Master View — the Nutrition Coach's own board.
 *
 * Deliberately the same shape as the Physio Master View, because it is the same job on a
 * different vertical: a day's list of booked visits to work through, and a caseload behind
 * it. A coach moving between the two boards should not have to learn a second layout.
 *
 * Two things are intentionally absent, and their absence is the design rather than an
 * omission:
 *
 *   No Review tab. On the physio side reviews exist so a junior's work gets seen by a
 *   senior. One Nutrition Coach runs both the diet consultation and the check-ins, so
 *   there is nobody above them for a review to route to. A Review tab here would be a
 *   queue that never fills.
 *
 *   No treatment-day terminology. These are check-in days against a diet plan, counted
 *   out of diet_sessions — a separate collection from `sessions`, so nothing here can be
 *   miscounted as physio treatment (see the module docstring in backend/routers/v3_diet.py).
 */

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shiftIso = (iso, days) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return isoOf(d); };
const weekDatesFor = (iso) => {
  const sunday = shiftIso(iso, -new Date(`${iso}T00:00:00`).getDay());
  return Array.from({ length: 7 }, (_, i) => shiftIso(sunday, i));
};
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

const VIEW_TABS = [
  { key: "checkins", label: "Check-ins", icon: Salad },
  { key: "patients", label: "Patients", icon: Users },
];

// The same summary tile the Physio board uses — count, and the filter that narrows to it,
// as one control.
const StatTile = ({ label, value, sub, icon: Icon, onClick, active, testid }) => {
  const Tag = onClick ? "button" : "div";
  const tagProps = onClick ? { type: "button", onClick, "data-testid": testid } : { "data-testid": testid };
  return (
    <Tag
      {...tagProps}
      className={`w-full rounded-xl border-2 px-3 py-2.5 text-left transition sm:px-4 sm:py-4 ${
        active ? "border-teal-600 bg-teal-50 shadow-sm" : `border-slate-200 bg-white ${onClick ? "hover:border-teal-300 hover:shadow-sm" : ""}`
      }`}
    >
      <span className={`flex items-center gap-1.5 ${active ? "text-teal-700" : "text-slate-500"}`}>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />}
        <span className="truncate text-[10px] font-bold uppercase tracking-wider sm:text-xs">{label}</span>
      </span>
      <span className={`mt-0.5 block text-2xl font-extrabold sm:mt-1 sm:text-3xl ${active ? "text-teal-700" : "text-slate-800"}`}>{value}</span>
      {sub && <span className={`mt-0.5 block text-[10px] ${active ? "text-teal-600" : "text-slate-400"}`}>{sub}</span>}
    </Tag>
  );
};

export const DietBoard = ({ coachId } = {}) => {
  const [activeTab, setActiveTab] = useState("checkins");
  const [checkinCount, setCheckinCount] = useState(0);
  const [patientsCount, setPatientsCount] = useState(0);
  const badgeFor = { checkins: checkinCount, patients: patientsCount };

  const [toolbarSlot, setToolbarSlot] = useState(null);
  const slotFor = (key) => (activeTab === key ? toolbarSlot : null);

  return (
    <div className="space-y-3 pb-20 md:pb-0" data-testid="diet-board-root">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-4 md:border-b md:border-slate-200" data-testid="diet-view-bar">
        <div className="hidden items-center gap-1 overflow-x-auto md:flex" data-testid="diet-view-tabs">
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
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  active ? "border-emerald-500 text-emerald-700" : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
                data-testid={`diet-view-tab-${tab.key}`}
              >
                <Icon className="h-4 w-4" /> {tab.label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div ref={setToolbarSlot} className="flex flex-wrap items-center gap-2 md:pb-1.5" data-testid="diet-view-toolbar" />
      </div>

      <div style={{ display: activeTab === "checkins" ? "block" : "none" }}>
        <CheckinsTab coachId={coachId} onCountChange={setCheckinCount} toolbarSlot={slotFor("checkins")} />
      </div>
      <div style={{ display: activeTab === "patients" ? "block" : "none" }}>
        <PatientsTab coachId={coachId} onCountChange={setPatientsCount} />
      </div>

      {/* Phones only — the tab strip above is desk-only. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" data-testid="diet-bottom-nav">
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
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${isActive ? "text-emerald-600" : "text-slate-400"}`}
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

function CheckinsTab({ coachId, onCountChange, toolbarSlot }) {
  const todayIso = isoOf(new Date());
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [weekAnchor, setWeekAnchor] = useState(todayIso);
  const [rowFilter, setRowFilter] = useState("all");
  const [completing, setCompleting] = useState(null); // the day being written up
  const [filterValue, setFilterValue] = useState(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(); to.setHours(23, 59, 59, 999);
    return { key: "today", label: "Today", from, to };
  });

  const stripDates = useMemo(() => weekDatesFor(weekAnchor), [weekAnchor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // One request per month the visible week touches — a Sun-Sat week can straddle two.
      const months = [...new Set(stripDates.map((d) => d.slice(0, 7)))];
      const results = await Promise.all(
        months.map((m) => dietCalendar(Number(m.slice(5, 7)), Number(m.slice(0, 4)), coachId)),
      );
      setDays(results.flatMap((r) => r.days || []));
    } catch { /* silent */ }
    setLoading(false);
  }, [coachId, stripDates.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const countFor = (date) => days.filter((d) => (d.slot_time || "").startsWith(date)).length;

  const inRange = useCallback((iso) => {
    if (!filterValue) return true;
    return iso >= isoOf(filterValue.from) && iso <= isoOf(filterValue.to);
  }, [filterValue]);

  const stats = useMemo(() => {
    const rows = days.filter((d) => inRange((d.slot_time || "").slice(0, 10)));
    const completed = rows.filter((d) => d.status === "completed").length;
    return { total: rows.length, completed, pending: rows.length - completed };
  }, [days, inRange]);

  // The badge counts what is still outstanding, so it falls to zero as the coach works
  // through the day rather than holding at the day's total.
  useEffect(() => { onCountChange?.(stats.pending); }, [stats.pending, onCountChange]);

  const visible = useMemo(() => {
    let rows = days.filter((d) => (d.slot_time || "").startsWith(selectedDate));
    if (rowFilter === "completed") rows = rows.filter((d) => d.status === "completed");
    else if (rowFilter === "pending") rows = rows.filter((d) => d.status !== "completed");
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((d) => (d.lead_name || "").toLowerCase().includes(q));
    }
    // Outstanding first, done last — the same ordering the treatment day list uses, so a
    // finished visit never sits above one still to do.
    const done = rows.filter((d) => d.status === "completed");
    const todo = rows.filter((d) => d.status !== "completed");
    const bySlot = (a, b) => (a.slot_time || "").localeCompare(b.slot_time || "");
    return [...todo.sort(bySlot), ...done.sort(bySlot)];
  }, [days, selectedDate, rowFilter, search]);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" data-testid="diet-checkins-toolbar">
      {searchOpen ? (
        <div className="relative w-full sm:w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient..." className="h-10 pl-9 pr-9" data-testid="diet-search" />
          <button type="button" onClick={() => { setSearchOpen(false); setSearch(""); }} className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setSearchOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" data-testid="diet-search-open">
          <Search className="h-4 w-4" />
        </button>
      )}
      <DateFilterPopover
        value={filterValue}
        onChange={(next) => {
          setFilterValue(next);
          // A preset covering a single day moves the week strip there too — there is no
          // ambiguity about which day was meant.
          if (next && isoOf(next.from) === isoOf(next.to)) { setSelectedDate(isoOf(next.from)); setWeekAnchor(isoOf(next.from)); }
        }}
        testid="diet-date-filter"
        centered
      />
    </div>
  );

  return (
    <div data-testid="diet-checkins-tab">
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}

      <div className="mb-4" data-testid="diet-summary">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{filterValue ? filterValue.label : "Overall"}</p>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile icon={Calendar} label="Check-ins" value={stats.total} onClick={() => setRowFilter("all")} active={rowFilter === "all"} testid="diet-stat-total" />
          <StatTile
            icon={CheckCircle2} label="Completed" value={stats.completed}
            sub={stats.total ? `${Math.round((stats.completed / stats.total) * 100)}% done` : null}
            onClick={() => setRowFilter(rowFilter === "completed" ? "all" : "completed")} active={rowFilter === "completed"} testid="diet-stat-completed"
          />
          <StatTile icon={Clock} label="Pending" value={stats.pending} sub="Days left" onClick={() => setRowFilter(rowFilter === "pending" ? "all" : "pending")} active={rowFilter === "pending"} testid="diet-stat-pending" />
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3" data-testid="diet-week-strip">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => setWeekAnchor((a) => shiftIso(a, -7))} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
          <p className="text-xs font-semibold text-slate-600">
            {new Date(`${weekAnchor}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
          <button type="button" onClick={() => setWeekAnchor((a) => shiftIso(a, 7))} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {stripDates.map((date, i) => {
            const isSelected = date === selectedDate;
            const n = countFor(date);
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`rounded-lg py-2 text-center transition ${isSelected ? "bg-emerald-600 text-white" : "hover:bg-slate-50"}`}
                data-testid={`diet-strip-${date}`}
              >
                <p className={`text-[10px] font-medium ${isSelected ? "text-white/80" : "text-slate-400"}`}>{DAY_LETTERS[i]}</p>
                <p className="text-sm font-bold">{parseInt(date.split("-")[2], 10)}</p>
                <p className={`text-[10px] ${isSelected ? "text-white/80" : "text-slate-400"}`}>{n || ""}</p>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 && !loading ? (
        <div className="py-16 text-center">
          <Salad className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <p className="text-sm text-slate-400">No check-ins on this day.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((d) => {
            const done = d.status === "completed";
            return (
              <div key={d.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`} data-testid={`diet-day-${d.id}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {to12h((d.slot_time || "").slice(11, 16))}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{d.lead_name}</p>
                    <p className="text-[11px] text-slate-500">Day {d.day_number} of {d.total_days}{d.weight_kg != null ? ` · ${d.weight_kg} kg` : ""}</p>
                  </div>
                </div>
                {done ? (
                  <span className="shrink-0 rounded-md bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">DONE</span>
                ) : (
                  <Button size="sm" className="shrink-0 bg-emerald-600 text-xs text-white hover:bg-emerald-700" onClick={() => setCompleting(d)} data-testid={`diet-complete-${d.id}`}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Complete
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {completing && (
        <CompleteDayModal day={completing} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); load(); }} />
      )}
    </div>
  );
}

/** Writing up a check-in: how it went, and the weight, which is the one number a diet
 *  plan is actually steered by. Both optional — a coach who only ticks the visit off
 *  should not be blocked, and a forced field would just collect junk. */
const CompleteDayModal = ({ day, onClose, onDone }) => {
  const [remarks, setRemarks] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await dietCompleteDay(day.id, {
        coach_remarks: remarks,
        weight_kg: weight === "" ? null : Number(weight),
      });
      toast.success("Check-in completed");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not complete the check-in");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid="diet-complete-modal">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-emerald-600 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{day.lead_name}</p>
            <p className="text-xs text-white/80">Day {day.day_number} of {day.total_days}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Weight (kg)</label>
            <Input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 74.5" data-testid="diet-weight" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Notes</label>
            <textarea
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              placeholder="How is the patient getting on with the plan?"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              data-testid="diet-remarks"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={submit} disabled={saving} data-testid="diet-complete-submit">
            {saving ? "Saving..." : "Complete Check-in"}
          </Button>
        </div>
      </div>
    </div>
  );
};

function PatientsTab({ coachId, onCountChange }) {
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

  return (
    <div data-testid="diet-patients-tab">
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
        <div className="space-y-3">
          {visible.map((p) => (
            <button
              key={p.lead_id}
              type="button"
              onClick={() => setOpenLead(p)}
              className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:shadow-sm"
              data-testid={`diet-patient-${p.lead_id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{p.lead_name}</p>
                  <p className="text-[11px] text-slate-500">{p.phone || "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold text-emerald-600">{p.completed_days}/{p.total_days}</p>
                  <p className="text-[10px] text-slate-400">check-ins</p>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.total_days > 0 ? (p.completed_days / p.total_days) * 100 : 0}%` }} />
              </div>
            </button>
          ))}
        </div>
      )}

      {openLead && <PatientDaysModal patient={openLead} onClose={() => setOpenLead(null)} />}
    </div>
  );
}

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
