import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarPlus, CheckCircle2, RefreshCw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { StatTile } from "@/components/ui/stat-tile";
import { unscheduledSessions, scheduleSession, getDoctorCalendar } from "@/lib/api";
import { to12h } from "@/lib/time";

/**
 * Treatment days an absence left without a date.
 *
 * When a patient misses a day, the Physio marks it absent and every later day steps down
 * into the slot in front of it, so the course stays on times the physio actually published.
 * The last day then has nowhere to go, and it lands here — the Branch Admin books the days
 * onto the physio's calendar in the first place, and this is the same act done once more.
 *
 * It is a queue rather than a notice because a day sitting in it is a day of treatment the
 * patient has paid for and is not being given. Nothing else in the OS is watching for that.
 */

const longDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

const shortDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
};

/**
 * Pick a published slot for one dateless day.
 *
 * Only shows what the physio has opened and has room in — the server refuses anything else,
 * and offering a time it will reject is a worse answer than not offering it. Past dates are
 * dropped for the same reason a missed day is being rebooked at all: it has to be a day the
 * patient can still attend.
 */
function SlotPicker({ session, onClose, onBooked }) {
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pickedDate, setPickedDate] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getDoctorCalendar(session.physio_id)
      .then((data) => { if (!cancelled) setCalendar(data); })
      .catch(() => { if (!cancelled) { setCalendar(null); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.physio_id]);

  const capacity = calendar?.slot_capacity || 1;

  // Open slots from today on, grouped by the day they fall on. A slot already holding as
  // many patients as the physio takes is left out rather than shown greyed: this list is
  // short and a row of dead buttons reads as the calendar being empty.
  const byDate = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const out = {};
    for (const slot of calendar?.slots || []) {
      const [day, time] = String(slot).split("T");
      if (!day || !time || day < today) continue;
      if ((calendar?.occupancy?.[slot] || 0) >= capacity) continue;
      (out[day] = out[day] || []).push(time);
    }
    for (const day of Object.keys(out)) out[day].sort();
    return out;
  }, [calendar, capacity]);

  const dates = useMemo(() => Object.keys(byDate).sort(), [byDate]);

  const book = async (slot) => {
    setSaving(true);
    try {
      await scheduleSession(session.id, slot);
      toast.success(`Day ${session.session_number} booked for ${shortDate(slot.split("T")[0])}`);
      onBooked();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't book that slot");
    }
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl" data-testid="missed-class-slot-picker">
        <div className="border-b p-5">
          <h3 className="text-base font-semibold text-slate-800">
            Give Day {session.session_number} a date
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {session.lead_name} · Day {session.session_number} of {session.total_sessions} · with {session.physio_name || "the physio"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading this physio's calendar...</p>
          ) : failed ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">
              Couldn't load {session.physio_name || "this physio"}'s calendar.
            </p>
          ) : dates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-8 text-center text-sm text-amber-800">
              {session.physio_name || "This physio"} has no free slots published from today on.
              <span className="mt-1 block text-xs font-normal text-amber-700">
                Open some days in MANAGEMENT → PHYSIO CALENDAR, then come back.
              </span>
            </p>
          ) : (
            <>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Pick a day</p>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {dates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPickedDate(d === pickedDate ? null : d)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                      d === pickedDate
                        ? "border-sky-500 bg-sky-50 text-sky-700 ring-2 ring-sky-200"
                        : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
                    }`}
                    data-testid={`missed-class-date-${d}`}
                  >
                    {shortDate(d)}
                    <span className="ml-1 text-[10px] font-normal text-slate-400">{byDate[d].length}</span>
                  </button>
                ))}
              </div>

              {pickedDate && (
                <>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Open times on {longDate(pickedDate)}
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {byDate[pickedDate].map((time) => (
                      <button
                        key={time}
                        type="button"
                        disabled={saving}
                        onClick={() => book(`${pickedDate}T${time}`)}
                        className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-2.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 disabled:opacity-50"
                        data-testid={`missed-class-slot-${pickedDate}T${time}`}
                      >
                        {to12h(time)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-slate-400">
                    Picking a time books it straight away.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export default function MissedClassPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await unscheduledSessions();
      setRows(data.sessions || []);
    } catch {
      toast.error("Couldn't load missed classes");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const patients = useMemo(() => new Set(rows.map((r) => r.lead_id)).size, [rows]);

  return (
    <div className="space-y-4" data-testid="branch-missed-class-panel">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Days to re-book" value={rows.length} sub="left without a date" icon={UserX} color="#d97706" testid="missed-class-tile-days" />
        <StatTile label="Patients waiting" value={patients} sub="owed a day of treatment" icon={AlertCircle} color="#dc2626" testid="missed-class-tile-patients" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          A day here is a day the patient has paid for and not been given. Book it onto the physio's calendar.
        </p>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="shrink-0" data-testid="missed-class-refresh">
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-16 text-center" data-testid="missed-class-empty">
          <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-200" />
          <p className="text-sm text-slate-400">
            {loading ? "Loading..." : "Every treatment day has a date. Nothing to re-book."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="w-[8%] px-3 py-2.5">S.No</th>
                <th className="w-[26%] px-3 py-2.5">Patient</th>
                <th className="w-[13%] px-3 py-2.5">Day</th>
                <th className="w-[18%] px-3 py-2.5">Physio</th>
                <th className="w-[20%] px-3 py-2.5">Missed on</th>
                <th className="w-[15%] px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s, i) => (
                <tr key={s.id} className="align-middle hover:bg-slate-50/60" data-testid={`missed-class-row-${s.id}`}>
                  <td className="px-3 py-3 text-xs text-slate-400">{i + 1}</td>
                  <td className="px-3 py-3">
                    <p className="truncate text-sm font-semibold text-slate-800">{s.lead_name || "Unknown"}</p>
                    <p className="truncate text-[11px] text-slate-400">{s.patient_number || s.phone || "—"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                      Day {s.session_number}
                    </span>
                    <p className="mt-0.5 text-[10px] text-slate-400">of {s.total_sessions}</p>
                  </td>
                  <td className="truncate px-3 py-3 text-xs text-slate-600">{s.physio_name || "—"}</td>
                  <td className="px-3 py-3">
                    {/* The absence that caused this — the reason the physio typed is the
                        only context for whether the patient is likely to make a new day. */}
                    {s.last_absence ? (
                      <>
                        <p className="text-xs text-slate-600">{shortDate(s.last_absence.date)}</p>
                        <p className="truncate text-[10px] text-slate-400" title={s.last_absence.remarks || ""}>
                          {s.last_absence.remarks || `Day ${s.last_absence.session_number} absent`}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      size="sm"
                      className="bg-amber-600 text-xs text-white hover:bg-amber-700"
                      onClick={() => setPicking(s)}
                      data-testid={`missed-class-assign-${s.id}`}
                    >
                      <CalendarPlus className="mr-1 h-3 w-3" /> Give a date
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picking && (
        <SlotPicker
          session={picking}
          onClose={() => setPicking(null)}
          onBooked={() => { setPicking(null); load(); }}
        />
      )}
    </div>
  );
}
