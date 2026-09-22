import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, CalendarX, CheckCircle2, Clock, RefreshCw, Trash2, UserX, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { StatTile } from "@/components/ui/stat-tile";
import {
  listPhysioAbsences,
  markPhysioAbsent,
  physioAbsenceDetail,
  cancelPhysioAbsence,
  reassignAbsenceDay,
  releaseAbsenceDay,
} from "@/lib/api";
import { to12h } from "@/lib/time";

/**
 * A physio who will not be in on a date, and the patients booked with them that day.
 *
 * One panel for both desks. The physio marks themselves off (`mode="physio"`); the Branch
 * Admin marks any physio at the branch (`mode="branch"`). Either can then settle each
 * patient: hand the day to another physio who has the same hour open and a seat free, or
 * — if the patient would rather wait for their own physio — release it, which sends it to
 * Missed Classes for a new date. Handing over is refused until the patient has agreed:
 * who treats them is theirs to say.
 */

const pad2 = (n) => String(n).padStart(2, "0");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const longDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const timeOf = (slot) => (slot && slot.includes("T") ? to12h(slot.split("T")[1].slice(0, 5)) : "—");
const errText = (err, fallback) => err?.response?.data?.detail || fallback;

const STATE_BADGE = {
  waiting: { label: "Needs a plan", cls: "bg-amber-100 text-amber-700" },
  reassigned: { label: "Handed over", cls: "bg-sky-100 text-sky-700" },
  released: { label: "Waiting for new date", cls: "bg-slate-100 text-slate-600" },
  done: { label: "Done", cls: "bg-emerald-100 text-emerald-700" },
};

/** One patient's day on the absent date, and the two ways to settle it. */
function DayRow({ absence, day, candidates, onChanged }) {
  const [toId, setToId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const [saving, setSaving] = useState(false);

  const options = candidates || [];
  const picked = options.find((c) => c.id === toId);
  const settled = day.state === "done" || day.state === "released";
  const badge = STATE_BADGE[day.state] || STATE_BADGE.waiting;

  const assign = async () => {
    if (!toId) { toast.error("Pick the physio who will see this patient"); return; }
    if (!confirmed) { toast.error(`Confirm with ${day.lead_name} that they are happy to see ${picked?.name || "another physio"}`); return; }
    setSaving(true);
    try {
      await reassignAbsenceDay(absence.id, day.track, day.id, { to_physio_id: toId, patient_confirmed: true, note });
      toast.success(`${day.lead_name} will see ${picked?.name || "the new physio"} at ${timeOf(day.slot_time)}`);
      setToId(""); setConfirmed(false); setNote("");
      onChanged();
    } catch (err) {
      toast.error(errText(err, "Couldn't hand this day over"));
    }
    setSaving(false);
  };

  const release = async () => {
    if (!releaseReason.trim()) { toast.error("Say what the patient asked for"); return; }
    setSaving(true);
    try {
      await releaseAbsenceDay(absence.id, day.track, day.id, releaseReason.trim());
      toast.success(`${day.lead_name}'s day is in Missed Classes, waiting on a new date`);
      setReleasing(false); setReleaseReason("");
      onChanged();
    } catch (err) {
      toast.error(errText(err, "Couldn't release this day"));
    }
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`absence-day-${day.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-700">{timeOf(day.slot_time)}</span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{day.lead_name}</p>
        <span className="text-[11px] text-slate-500">
          {day.track === "rehab" ? "Rehab day" : "Day"} {day.session_number} of {day.total_sessions}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
      </div>
      {day.state === "reassigned" && (
        <p className="mt-1 text-[11px] text-sky-700">
          With <span className="font-semibold">{day.physio_name}</span> for this day
        </p>
      )}

      {!settled && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {!releasing ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={toId} onValueChange={(v) => { setToId(v); setConfirmed(false); }}>
                  <SelectTrigger
                    className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-none hover:bg-slate-50 focus:ring-2 focus:ring-sky-200"
                    data-testid={`absence-day-physio-${day.id}`}
                  >
                    <SelectValue placeholder={day.state === "reassigned" ? "Hand to someone else…" : "Hand to another physio…"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 border-slate-200">
                    {options.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        disabled={!c.available || c.id === day.physio_id}
                        className="text-sm text-slate-700"
                      >
                        {c.name} <span className="text-slate-400">· {c.available ? `${c.taken}/${c.capacity} booked` : c.reason}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="h-9 sm:w-48"
                />
              </div>
              {options.length > 0 && !options.some((c) => c.available) && (
                <p className="text-[11px] text-amber-700">
                  No other physio has {timeOf(day.slot_time)} open with a free seat. Open it in MANAGEMENT → PHYSIO CALENDAR, or let the patient wait for a new date.
                </p>
              )}
              {options.length === 0 && (
                <p className="text-[11px] text-amber-700">No other physio at this branch.</p>
              )}
              {toId && (
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5"
                    data-testid={`absence-day-confirm-${day.id}`}
                  />
                  <span>
                    I've spoken to <span className="font-semibold">{day.lead_name}</span> and they are happy to see{" "}
                    <span className="font-semibold">{picked?.name}</span> at {timeOf(day.slot_time)}.
                  </span>
                </label>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setReleasing(true)} disabled={saving} data-testid={`absence-day-release-${day.id}`}>
                  <Clock className="mr-1 h-3.5 w-3.5" /> Patient will wait
                </Button>
                <Button
                  size="sm"
                  onClick={assign}
                  disabled={saving || !toId || !confirmed}
                  className="bg-sky-600 text-white hover:bg-sky-700"
                  data-testid={`absence-day-assign-${day.id}`}
                >
                  <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Hand over
                </Button>
              </div>
            </>
          ) : (
            <>
              <Input
                autoFocus
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                placeholder="What did the patient ask for? e.g. wants to wait for their own physio"
                className="h-9"
                data-testid={`absence-day-release-reason-${day.id}`}
              />
              <p className="text-[11px] text-slate-500">
                The day comes off {longDate(absence.date)} and goes to Missed Classes for a new date. It stays part of the package.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setReleasing(false)} disabled={saving}>Back</Button>
                <Button size="sm" onClick={release} disabled={saving} className="bg-amber-600 text-white hover:bg-amber-700" data-testid={`absence-day-release-confirm-${day.id}`}>
                  Release day
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The worklist for one absence: every patient booked with the physio that day. */
function AbsenceDetail({ absenceId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await physioAbsenceDetail(absenceId));
    } catch (err) {
      toast.error(errText(err, "Couldn't load this absence"));
    }
    setLoading(false);
  }, [absenceId]);

  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); onChanged(); };
  const days = data?.days || [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" data-testid="physio-absence-detail">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <UserX className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold text-slate-800">
              {data?.physio_name || "Physio"} <span className="font-medium text-slate-400">absent</span> {longDate(data?.date)}
            </h3>
            <p className="truncate text-[11px] text-slate-400">
              {data?.reason ? `${data.reason} · ` : ""}marked by {data?.marked_by || "—"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
          Call each patient first. Hand the day to another physio only once they agree; if they'd rather wait for their own physio, release the day for a new date.
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading && !data ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          ) : days.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-200" />
              <p className="text-sm text-slate-400">No patients were booked with this physio on this day.</p>
            </div>
          ) : (
            days.map((d) => (
              <DayRow
                key={d.id}
                absence={data}
                day={d}
                candidates={(data?.candidates || {})[d.slot_time]}
                onChanged={changed}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-end border-t border-slate-200 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export function PhysioAbsencePanel({ mode = "branch" }) {
  const isPhysio = mode === "physio";
  const [data, setData] = useState({ absences: [], physios: [] });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ date: localToday(), physio_id: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listPhysioAbsences());
    } catch (err) {
      toast.error(errText(err, "Couldn't load absences"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const absences = useMemo(() => data.absences || [], [data]);
  const totals = useMemo(() => absences.reduce((t, a) => ({
    waiting: t.waiting + (a.counts?.waiting || 0),
    reassigned: t.reassigned + (a.counts?.reassigned || 0),
    released: t.released + (a.counts?.released || 0),
  }), { waiting: 0, reassigned: 0, released: 0 }), [absences]);

  const submit = async () => {
    if (!form.date) { toast.error("Pick the date"); return; }
    if (!isPhysio && !form.physio_id) { toast.error("Pick the physio who is absent"); return; }
    setSaving(true);
    try {
      const created = await markPhysioAbsent({
        date: form.date,
        reason: form.reason,
        physio_id: isPhysio ? undefined : form.physio_id,
      });
      const n = created.days_total || 0;
      toast.success(n
        ? `Marked absent. ${n} patient${n === 1 ? "" : "s"} booked that day need${n === 1 ? "s" : ""} another physio or a new date.`
        : "Marked absent. Nobody was booked that day.");
      setForm((f) => ({ ...f, reason: "" }));
      await load();
      if (n) setOpenId(created.id);
    } catch (err) {
      toast.error(errText(err, "Couldn't mark absent"));
    }
    setSaving(false);
  };

  const cancel = async (a) => {
    const msg = a.counts?.reassigned
      ? `Cancel ${a.physio_name}'s absence on ${longDate(a.date)}? The ${a.counts.reassigned} day(s) handed to other physios go back to ${a.physio_name}.`
      : `Cancel ${a.physio_name}'s absence on ${longDate(a.date)}?`;
    if (!window.confirm(msg)) return;
    try {
      await cancelPhysioAbsence(a.id);
      toast.success("Absence cancelled");
      load();
    } catch (err) {
      toast.error(errText(err, "Couldn't cancel the absence"));
    }
  };

  return (
    <div className="space-y-4" data-testid={`physio-absence-panel-${mode}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Absences" value={absences.length} sub="today and ahead" icon={CalendarX} color="#e11d48" testid="physio-absence-tile-count" />
        <StatTile label="Need a plan" value={totals.waiting} sub="patients still booked" icon={UserX} color="#d97706" testid="physio-absence-tile-waiting" />
        <StatTile label="Handed over" value={totals.reassigned} sub="to another physio" icon={Users} color="#0284c7" testid="physio-absence-tile-reassigned" />
        <StatTile label="Waiting" value={totals.released} sub="for a new date" icon={Clock} color="#64748b" testid="physio-absence-tile-released" />
      </div>

      {/* Mark absent */}
      <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="physio-absence-form">
        <p className="mb-3 text-sm font-semibold text-slate-700">
          {isPhysio ? "Mark yourself absent" : "Mark a physio absent"}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {!isPhysio && (
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Physio
              <Select
                value={form.physio_id}
                onValueChange={(v) => setForm((f) => ({ ...f, physio_id: v }))}
              >
                <SelectTrigger
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-800 shadow-none hover:bg-slate-50 focus:ring-2 focus:ring-sky-200"
                  data-testid="physio-absence-physio"
                >
                  <SelectValue placeholder="Pick a physio…" />
                </SelectTrigger>
                <SelectContent className="max-h-72 border-slate-200">
                  {(data.physios || []).map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-sm text-slate-700">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Date
            <MilkDateInput
              min={localToday()}
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              accent="sky"
              iconLeft
              className="h-10 border-slate-200 bg-white font-normal normal-case tracking-normal sm:w-44"
              data-testid="physio-absence-date"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Reason
            <Input
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. unwell, family function"
              className="h-10"
              data-testid="physio-absence-reason"
            />
          </label>
          <Button onClick={submit} disabled={saving} className="h-10 bg-rose-600 text-white hover:bg-rose-700" data-testid="physio-absence-submit">
            <CalendarX className="mr-1.5 h-4 w-4" /> Mark Absent
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Every patient booked on an absent day needs another physio or a new date, agreed with the patient.
        </p>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="shrink-0" data-testid="physio-absence-refresh">
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {absences.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-14 text-center" data-testid="physio-absence-empty">
          <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-200" />
          <p className="text-sm text-slate-400">{loading ? "Loading…" : "No absences marked from today on."}</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="physio-absence-list">
          {absences.map((a) => {
            const waiting = a.counts?.waiting || 0;
            return (
              <div key={a.id} className={`flex flex-col gap-3 rounded-xl border bg-white p-3 sm:flex-row sm:items-center ${waiting ? "border-amber-200" : "border-slate-200"}`} data-testid={`physio-absence-row-${a.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {longDate(a.date)}{!isPhysio && <span className="font-medium text-slate-500"> · {a.physio_name}</span>}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {a.reason ? `${a.reason} · ` : ""}marked by {a.marked_by}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                    {a.days_total === 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">No patients booked</span>}
                    {waiting > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{waiting} need a plan</span>}
                    {a.counts?.reassigned > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">{a.counts.reassigned} handed over</span>}
                    {a.counts?.released > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{a.counts.released} waiting for new date</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => cancel(a)} className="text-rose-600" data-testid={`physio-absence-cancel-${a.id}`}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setOpenId(a.id)}
                    className={waiting ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-slate-600 text-white hover:bg-slate-700"}
                    data-testid={`physio-absence-open-${a.id}`}
                  >
                    <Users className="mr-1 h-3.5 w-3.5" /> {waiting ? "Assign patients" : "View patients"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openId && <AbsenceDetail absenceId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

export default PhysioAbsencePanel;
