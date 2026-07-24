import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, User, Plus, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getBranches,
  getBranchBoard,
  getDoctors,
  listConsultAppointments,
  getConsultAvailability,
  createConsultAppointment,
  updateConsultAppointment,
  cancelConsultAppointment,
} from "@/lib/api";

// weekly_hours is keyed mon..sun; JS getDay() is 0=Sun..6=Sat.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Monday that starts the week containing `date`.
const mondayOf = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
};

const emptyDraft = () => ({ patient_name: "", doctor_id: "", date: iso(new Date()), time: "" });

// The branch Calendar reflects the working hours + holidays configured by Super Admin
// in Branch Management, and lets the Branch Admin book / edit / cancel consultation
// appointments between a client and a Head Physio.
export const BranchCalendarPanel = ({ branchId }) => {
  const [branch, setBranch] = useState(null);
  const [leads, setLeads] = useState([]);
  const [headPhysios, setHeadPhysios] = useState([]);
  const [appts, setAppts] = useState([]);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState("schedule");

  // Booking / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [avail, setAvail] = useState(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [branches, board, doctors, apptRes] = await Promise.all([
        getBranches(),
        getBranchBoard(branchId),
        getDoctors({ branch_id: branchId }),
        listConsultAppointments(branchId),
      ]);
      setBranch((branches || []).find((b) => b.id === branchId) || null);
      setLeads(board?.leads || []);
      setHeadPhysios((doctors || []).filter((d) => d.profile_type === "head_physio"));
      setAppts(apptRes?.appointments || []);
    } catch { /* silent — panel just shows an empty schedule */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const weekly = branch?.weekly_hours || {};
  const holidays = branch?.holidays || [];

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }),
    [weekStart],
  );

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
  const shiftWeek = (delta) => { const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7); setWeekStart(d); };
  const rangeLabel = `${MONTHS[days[0].getMonth()]} ${days[0].getDate()} – ${MONTHS[days[6].getMonth()]} ${days[6].getDate()}, ${days[6].getFullYear()}`;

  // ---- Booking modal ----
  const fetchAvail = useCallback(async (date, doctorId) => {
    if (!date || !doctorId) { setAvail(null); return; }
    setAvailLoading(true);
    try { setAvail(await getConsultAvailability(branchId, date, doctorId)); }
    catch { setAvail(null); }
    setAvailLoading(false);
  }, [branchId]);

  useEffect(() => {
    if (!modalOpen) return;
    fetchAvail(draft.date, draft.doctor_id);
  }, [modalOpen, draft.date, draft.doctor_id, fetchAvail]);

  const openCreate = (date) => {
    setEditingId(null);
    setDraft({ patient_name: "", doctor_id: headPhysios[0]?.id || "", date: date || iso(new Date()), time: "" });
    setModalOpen(true);
  };
  const openEdit = (a) => {
    setEditingId(a.id);
    setDraft({ patient_name: a.patient_name || a.lead_name || "", doctor_id: a.doctor_id, date: a.appointment_date, time: a.appointment_time });
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditingId(null); setAvail(null); };

  const timeOptions = useMemo(() => {
    const slots = avail?.open ? [...(avail.slots || [])] : [];
    // When editing, the appointment's own time is "booked" by itself — keep it selectable.
    if (editingId && draft.time && !slots.includes(draft.time)) slots.push(draft.time);
    return slots.sort();
  }, [avail, editingId, draft.time]);

  const submit = async () => {
    if (!draft.patient_name.trim()) { toast.error("Enter the patient name"); return; }
    if (!draft.doctor_id) { toast.error("Select a Head Physio"); return; }
    if (!draft.date) { toast.error("Pick a date"); return; }
    if (!draft.time) { toast.error("Pick an available time"); return; }
    setSaving(true);
    try {
      if (editingId) {
        await updateConsultAppointment(editingId, { patient_name: draft.patient_name.trim(), doctor_id: draft.doctor_id, date: draft.date, time: draft.time });
        toast.success("Appointment updated");
      } else {
        await createConsultAppointment(branchId, { patient_name: draft.patient_name.trim(), doctor_id: draft.doctor_id, date: draft.date, time: draft.time });
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
        <Button onClick={() => openCreate()} className="bg-sky-600 hover:bg-sky-700" data-testid="cal-book-btn">
          <Plus className="mr-1.5 h-4 w-4" />Book Consultation
        </Button>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="cal-subtabs">
        <button type="button" onClick={() => setSubTab("schedule")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${subTab === "schedule" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`} data-testid="cal-subtab-schedule">
          <CalendarIcon className="h-4 w-4" />Schedule
        </button>
        <button type="button" onClick={() => setSubTab("upcoming")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${subTab === "upcoming" ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`} data-testid="cal-subtab-upcoming">
          <Clock className="h-4 w-4" />Upcoming Appointments
        </button>
      </div>

      {subTab === "schedule" ? (
      <>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)} data-testid="cal-prev-week"><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => setWeekStart(mondayOf(new Date()))} data-testid="cal-this-week">This Week</Button>
        <Button size="sm" variant="outline" onClick={() => shiftWeek(1)} data-testid="cal-next-week"><ChevronRight className="h-4 w-4" /></Button>
      </div>

      <p className="text-sm font-semibold text-slate-600" data-testid="cal-range-label">{rangeLabel}</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7" data-testid="cal-week-grid">
        {days.map((d) => {
          const dateStr = iso(d);
          const dowIdx = d.getDay();
          const cfg = weekly[DAY_KEYS[dowIdx]];
          const isHoliday = holidays.includes(dateStr);
          const isOpen = cfg ? cfg.is_open !== false : true;
          const isToday = dateStr === todayIso;
          const dayAppts = apptsByDate[dateStr] || [];
          const dayLeadAppts = leadApptsByDate[dateStr] || [];
          const bookable = !isHoliday && isOpen;
          return (
            <div
              key={dateStr}
              className={`flex min-h-[170px] flex-col overflow-hidden rounded-lg border ${isToday ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"} bg-white`}
              data-testid={`cal-day-${dateStr}`}
            >
              <div className={`flex items-center justify-between px-2 py-1.5 ${isHoliday ? "bg-rose-50" : isOpen ? "bg-slate-50" : "bg-slate-100"}`}>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-500">{DAY_LABELS[dowIdx]}</p>
                  <p className={`text-sm font-bold ${isToday ? "text-sky-700" : "text-slate-700"}`}>{d.getDate()}</p>
                </div>
                {bookable && (
                  <button type="button" onClick={() => openCreate(dateStr)} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-sky-600" title="Book consultation" data-testid={`cal-day-add-${dateStr}`}>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex-1 space-y-1.5 p-1.5">
                {isHoliday ? (
                  <p className="rounded-md bg-rose-50 px-2 py-1 text-center text-[11px] font-semibold text-rose-500">Holiday</p>
                ) : !isOpen ? (
                  <p className="rounded-md bg-slate-50 px-2 py-1 text-center text-[11px] font-medium text-slate-400">Closed</p>
                ) : (
                  <>
                    <p className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
                      <Clock className="h-3 w-3" />{cfg?.open || "09:00"}–{cfg?.close || "20:00"}
                    </p>
                    {dayAppts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => openEdit(a)}
                        className="block w-full rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-left hover:border-violet-300 hover:bg-violet-100"
                        data-testid={`cal-appt-${a.id}`}
                      >
                        <p className="text-[11px] font-bold text-violet-700">{a.appointment_time || "--:--"}</p>
                        <p className="truncate text-[11px] font-medium text-slate-700" title={a.patient_name}>{a.patient_name || a.lead_name || "—"}</p>
                        {a.doctor_name && <p className="flex items-center gap-0.5 truncate text-[10px] text-slate-400"><User className="h-2.5 w-2.5" />{a.doctor_name}</p>}
                      </button>
                    ))}
                    {dayLeadAppts.map((a) => (
                      <div key={a.id} className="rounded-md border border-sky-100 bg-sky-50/60 px-2 py-1" data-testid={`cal-lead-appt-${a.id}`}>
                        <p className="text-[11px] font-bold text-sky-600">{a.appointment_time || "--:--"}</p>
                        <p className="truncate text-[11px] text-slate-600" title={a.name}>{a.name || "—"}</p>
                      </div>
                    ))}
                    {dayAppts.length === 0 && dayLeadAppts.length === 0 && (
                      <p className="pt-2 text-center text-[10px] text-slate-300">No appointments</p>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>
      ) : (
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
                      <span className="text-xs font-bold text-violet-700">{a.appointment_time || "--:--"}</span>
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

      {/* Booking / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" data-testid="cal-booking-modal" onMouseDown={closeModal}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">{editingId ? "Edit Consultation" : "Book Consultation"}</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600" data-testid="cal-modal-close"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Patient Name</label>
                <Input value={draft.patient_name} onChange={(e) => setDraft((p) => ({ ...p, patient_name: e.target.value }))} placeholder="Client name" data-testid="cal-modal-patient" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Head Physio</label>
                <select
                  value={draft.doctor_id}
                  onChange={(e) => setDraft((p) => ({ ...p, doctor_id: e.target.value, time: "" }))}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  data-testid="cal-modal-physio"
                >
                  <option value="">-- select a Head Physio --</option>
                  {headPhysios.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
                {headPhysios.length === 0 && <p className="mt-1 text-[11px] text-amber-600">No Head Physios assigned to this branch yet — ask HR/Super Admin.</p>}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
                <Input type="date" value={draft.date} onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value, time: "" }))} data-testid="cal-modal-date" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Time {availLoading && <span className="text-slate-400">· checking availability…</span>}</label>
                {avail && !avail.open ? (
                  <p className="rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-500" data-testid="cal-modal-closed">{avail.reason || "The branch is closed on this date."}</p>
                ) : (
                  <select
                    value={draft.time}
                    onChange={(e) => setDraft((p) => ({ ...p, time: e.target.value }))}
                    disabled={!draft.doctor_id || !draft.date || availLoading}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm disabled:opacity-50"
                    data-testid="cal-modal-time"
                  >
                    <option value="">{timeOptions.length ? "-- select an available time --" : "No available times"}</option>
                    {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                {avail?.open && <p className="mt-1 text-[11px] text-slate-400">Working hours {avail.open_time}–{avail.close_time}. Already-booked times are hidden.</p>}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              {editingId ? (
                <Button variant="outline" onClick={cancelAppt} disabled={saving} className="border-rose-200 text-rose-600 hover:bg-rose-50" data-testid="cal-modal-cancel-appt">
                  Cancel Appointment
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={closeModal} disabled={saving} data-testid="cal-modal-dismiss">Close</Button>
                <Button onClick={submit} disabled={saving} className="bg-sky-600 hover:bg-sky-700" data-testid="cal-modal-save">
                  {saving ? "Saving…" : editingId ? "Save Changes" : "Confirm Booking"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
