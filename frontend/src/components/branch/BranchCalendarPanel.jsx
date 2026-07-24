import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, User, Plus, X, Pencil, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { BranchDetailPage } from "@/components/branch/BranchDetailPage";
import {
  getBranches,
  getBranchBoard,
  getAvailableExperts,
  listConsultAppointments,
  createConsultAppointment,
  updateConsultAppointment,
  cancelConsultAppointment,
} from "@/lib/api";

// weekly_hours is keyed mon..sun; JS getDay() is 0=Sun..6=Sat.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 24h "HH:MM" -> 12h "h:MM AM/PM" for display only (stored/sent values stay 24h).
const to12h = (t) => {
  if (!t || !t.includes(":")) return t || "--:--";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
};

const emptyDraft = () => ({ patient_name: "", doctor_id: "", date: iso(new Date()), time: "10:00", notes: "", cancelled: false });

// The branch Calendar reflects the working hours + holidays configured by Super Admin
// in Branch Management, and lets the Branch Admin book / edit / cancel consultation
// appointments between a client and a Head Physio.
export const BranchCalendarPanel = ({ branchId }) => {
  const [branch, setBranch] = useState(null);
  const [leads, setLeads] = useState([]);
  const [appts, setAppts] = useState([]);
  const [monthDate, setMonthDate] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState("schedule");

  // Booking / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [experts, setExperts] = useState([]);
  const [expertsLoading, setExpertsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [branches, board, apptRes] = await Promise.all([
        getBranches(),
        getBranchBoard(branchId),
        listConsultAppointments(branchId),
      ]);
      setBranch((branches || []).find((b) => b.id === branchId) || null);
      setLeads(board?.leads || []);
      setAppts(apptRes?.appointments || []);
    } catch { /* silent — panel just shows an empty schedule */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const weekly = branch?.weekly_hours || {};
  const holidays = branch?.holidays || [];

  const monthCells = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDow = new Date(year, month, 1).getDay();  // 0 Sun..6 Sat
    const lead = firstDow === 0 ? 6 : firstDow - 1;       // Monday-based leading blanks
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [monthDate]);

  // Consultation appointments grouped by date (the schedulable, editable events).
  const apptsByDate = useMemo(() => {
    const map = {};
    (appts || []).forEach((a) => { (map[a.appointment_date] = map[a.appointment_date] || []).push(a); });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.appointment_time || "").localeCompare(b.appointment_time || "")));
    return map;
  }, [appts]);

  // Lead branch appointments (read-only overlay), grouped by date.
  const leadApptsByDate = useMemo(() => {
    const map = {};
    (leads || []).forEach((l) => { if (l.appointment_date) (map[l.appointment_date] = map[l.appointment_date] || []).push(l); });
    return map;
  }, [leads]);

  const upcomingGroups = useMemo(() => {
    const today = iso(new Date());
    const map = {};
    (appts || []).forEach((a) => { if (a.appointment_date >= today) (map[a.appointment_date] = map[a.appointment_date] || []).push(a); });
    const dates = Object.keys(map).sort();
    dates.forEach((d) => map[d].sort((a, b) => (a.appointment_time || "").localeCompare(b.appointment_time || "")));
    return dates.map((d) => ({ date: d, items: map[d] }));
  }, [appts]);

  const todayIso = iso(new Date());
  const shiftMonth = (delta) => setMonthDate((prev) => { const d = new Date(prev); d.setMonth(d.getMonth() + delta); return d; });
  const thisMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonthDate(d); };
  const monthLabel = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // ---- Booking / edit modal — Appointment Date & Time flow (matches Branch Leads) ----
  const fetchExperts = useCallback(async (date) => {
    if (!date) { setExperts([]); return; }
    setExpertsLoading(true);
    try { const res = await getAvailableExperts(branchId, date); setExperts(res?.experts || []); }
    catch { setExperts([]); }
    setExpertsLoading(false);
  }, [branchId]);

  useEffect(() => {
    if (!modalOpen) return;
    fetchExperts(draft.date);
  }, [modalOpen, draft.date, fetchExperts]);

  const openCreate = (date) => {
    setEditingId(null);
    setDraft({ patient_name: "", doctor_id: "", date: date || iso(new Date()), time: "10:00", notes: "", cancelled: false });
    setModalOpen(true);
  };
  const openEdit = (a) => {
    setEditingId(a.id);
    setDraft({ patient_name: a.patient_name || a.lead_name || "", doctor_id: a.doctor_id, date: a.appointment_date, time: a.appointment_time, notes: a.notes || "", cancelled: false });
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditingId(null); setExperts([]); };

  const submit = async () => {
    if (!draft.patient_name.trim()) { toast.error("Enter the patient name"); return; }
    if (!draft.date || !draft.time) { toast.error("Date and time are required"); return; }
    if (editingId && draft.cancelled) { await cancelAppt(); return; }
    if (!draft.doctor_id) { toast.error("Please select an expert"); return; }
    setSaving(true);
    try {
      const payload = { patient_name: draft.patient_name.trim(), doctor_id: draft.doctor_id, date: draft.date, time: draft.time, notes: draft.notes };
      if (editingId) {
        await updateConsultAppointment(editingId, payload);
        toast.success("Appointment updated");
      } else {
        await createConsultAppointment(branchId, payload);
        toast.success("Consultation booked");
      }
      closeModal();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save appointment");
    }
    setSaving(false);
  };

  const cancelAppt = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await cancelConsultAppointment(editingId);
      toast.success("Appointment cancelled");
      closeModal();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not cancel");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4" data-testid="branch-calendar-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><CalendarIcon className="h-6 w-6 text-sky-600" /> Calendar</h2>
          <p className="text-sm text-slate-500">Schedule consultations between clients and Head Physios, based on the branch working hours set in Branch Management.</p>
        </div>
        {subTab !== "manager" && (
          <Button onClick={() => openCreate()} className="bg-sky-600 hover:bg-sky-700" data-testid="cal-book-btn">
            <Plus className="mr-1.5 h-4 w-4" />Book Consultation
          </Button>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="cal-subtabs">
        <button type="button" onClick={() => setSubTab("schedule")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${subTab === "schedule" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`} data-testid="cal-subtab-schedule">
          <CalendarIcon className="h-4 w-4" />Schedule
        </button>
        <button type="button" onClick={() => setSubTab("manager")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${subTab === "manager" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`} data-testid="cal-subtab-manager">
          <UserCog className="h-4 w-4" />Manager
        </button>
        <button type="button" onClick={() => setSubTab("upcoming")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${subTab === "upcoming" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`} data-testid="cal-subtab-upcoming">
          <Clock className="h-4 w-4" />Upcoming Appointments
        </button>
      </div>

      {subTab === "schedule" && (
      <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold text-slate-700" data-testid="cal-month-label">{monthLabel}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => shiftMonth(-1)} data-testid="cal-prev-month"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={thisMonth} data-testid="cal-this-month">This Month</Button>
          <Button size="sm" variant="outline" onClick={() => shiftMonth(1)} data-testid="cal-next-month"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Weekday headers (desktop) */}
      <div className="hidden grid-cols-7 gap-2 sm:grid" data-testid="cal-weekday-headers">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
          <p key={w} className="text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">{w}</p>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7" data-testid="cal-month-grid">
        {monthCells.map((d, idx) => {
          if (!d) return <div key={`empty-${idx}`} className="hidden rounded-lg border border-transparent sm:block" />;
          const dateStr = iso(d);
          const dowIdx = d.getDay();
          const cfg = weekly[DAY_KEYS[dowIdx]];
          const isHoliday = holidays.includes(dateStr);
          const isOpen = cfg ? cfg.is_open !== false : true;
          const isToday = dateStr === todayIso;
          const dayAppts = apptsByDate[dateStr] || [];
          const dayLeadAppts = leadApptsByDate[dateStr] || [];
          const bookable = !isHoliday && isOpen;
          const shown = dayAppts.slice(0, 3);
          const moreCount = dayAppts.length - shown.length;
          return (
            <div
              key={dateStr}
              className={`flex min-h-[104px] flex-col overflow-hidden rounded-lg border ${isToday ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"} ${isHoliday ? "bg-rose-50/40" : isOpen ? "bg-white" : "bg-slate-50"}`}
              data-testid={`cal-day-${dateStr}`}
            >
              <div className="flex items-center justify-between px-2 py-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase text-slate-400 sm:hidden">{DAY_LABELS[dowIdx]}</span>
                  <span className={`text-sm font-bold ${isToday ? "text-sky-700" : "text-slate-700"}`}>{d.getDate()}</span>
                </div>
                {bookable && (
                  <button type="button" onClick={() => openCreate(dateStr)} className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-sky-600" title="Book consultation" data-testid={`cal-day-add-${dateStr}`}>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex-1 space-y-1 px-1.5 pb-1.5">
                {isHoliday ? (
                  <p className="rounded bg-rose-100/70 px-1.5 py-0.5 text-center text-[10px] font-semibold text-rose-500">Holiday</p>
                ) : !isOpen ? (
                  <p className="rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-slate-400">Closed</p>
                ) : (
                  <>
                    {shown.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => openEdit(a)}
                        className="block w-full truncate rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-left text-[10px] font-medium text-violet-700 hover:bg-violet-100"
                        title={`${to12h(a.appointment_time)} · ${a.patient_name || a.lead_name || ""}${a.doctor_name ? " · " + a.doctor_name : ""}`}
                        data-testid={`cal-appt-${a.id}`}
                      >
                        <span className="font-bold">{to12h(a.appointment_time)}</span> {a.patient_name || a.lead_name || "—"}
                      </button>
                    ))}
                    {moreCount > 0 && <p className="px-1 text-[10px] font-medium text-slate-400">+{moreCount} more</p>}
                    {dayLeadAppts.slice(0, 2).map((a) => (
                      <div key={a.id} className="truncate rounded border border-sky-100 bg-sky-50/60 px-1.5 py-0.5 text-[10px] text-slate-500" title={`${to12h(a.appointment_time)} · ${a.name || ""}`} data-testid={`cal-lead-appt-${a.id}`}>
                        <span className="font-semibold text-sky-600">{to12h(a.appointment_time)}</span> {a.name || "—"}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}

      {subTab === "manager" && (
        <BranchDetailPage branchId={branchId} readOnly />
      )}

      {subTab === "upcoming" && (
      <div className="space-y-4" data-testid="cal-upcoming-list">
        {upcomingGroups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">No upcoming consultations. Use “Book Consultation” to schedule one.</p>
        ) : (
          upcomingGroups.map((g) => (
            <div key={g.date} data-testid={`cal-upcoming-${g.date}`}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {new Date(g.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
              </p>
              <div className="space-y-1.5">
                {g.items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => openEdit(a)}
                    className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-sky-300 hover:bg-sky-50/40"
                    data-testid={`cal-upcoming-appt-${a.id}`}
                  >
                    <div className="flex w-16 shrink-0 flex-col items-center rounded-md bg-violet-50 py-1">
                      <Clock className="h-3 w-3 text-violet-500" />
                      <span className="text-xs font-bold text-violet-700">{to12h(a.appointment_time)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800" title={a.patient_name}>{a.patient_name || a.lead_name || "—"}</p>
                      {a.doctor_name && <p className="flex items-center gap-1 truncate text-xs text-slate-500"><User className="h-3 w-3" />{a.doctor_name}</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Scheduled</span>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      )}

      {loading && <p className="text-center text-xs text-slate-400">Loading…</p>}
      {!loading && !branch && (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
          No branch schedule found. Ask a Super Admin to set working hours &amp; holidays in Branch Management.
        </p>
      )}

      {/* Appointment Date & Time modal — same format/flow as Branch Leads */}
      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }} data-testid="cal-booking-modal">
          <div className="max-h-[90vh] w-full max-w-md overflow-hidden overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-teal-500 to-cyan-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                <p className="text-base font-semibold">Appointment Date &amp; Time</p>
              </div>
              <button onClick={closeModal} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cal-modal-close"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Patient Name *</label>
                <Input value={draft.patient_name} onChange={(e) => setDraft((p) => ({ ...p, patient_name: e.target.value }))} placeholder="Client name" data-testid="cal-modal-patient" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
                <Input type="date" value={draft.date} onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))} data-testid="cal-modal-date" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                <Input type="time" value={draft.time} onChange={(e) => setDraft((p) => ({ ...p, time: e.target.value }))} data-testid="cal-modal-time" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Experts *</label>
                <p className="mb-1.5 text-[11px] text-slate-400">Showing experts available on this date.</p>
                {expertsLoading ? (
                  <p className="text-xs text-slate-400">Checking availability...</p>
                ) : experts.length === 0 ? (
                  <p className="text-xs text-slate-400">No experts available on this date.</p>
                ) : (
                  <div className="space-y-1.5">
                    {experts.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, doctor_id: doc.id }))}
                        className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left ${draft.doctor_id === doc.id ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                        data-testid={`cal-modal-expert-${doc.id}`}
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">{doc.full_name?.charAt(0) || "E"}</div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{doc.full_name}</p>
                          <p className="text-[10px] text-slate-400">{doc.specialization || doc.profile_type || "Expert"}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Notes</label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  placeholder="Optional notes about the appointment..."
                  value={draft.notes}
                  onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                  data-testid="cal-modal-notes"
                />
              </div>
              {editingId && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={draft.cancelled} onChange={(e) => setDraft((p) => ({ ...p, cancelled: e.target.checked }))} data-testid="cal-modal-cancel-toggle" />
                  Cancelled
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={closeModal} disabled={saving} data-testid="cal-modal-dismiss">Cancel</Button>
              <Button className="bg-teal-600 text-white hover:bg-teal-700" onClick={submit} disabled={saving} data-testid="cal-modal-save">
                {saving ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
