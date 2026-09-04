/**
 * HR's running month: Attendance, Payroll, Approvals and Quotes.
 *
 * Four tabs of HR Admin, sitting straight after the Dashboard because they are the work
 * of a month rather than the shape of the company — the Employees, Credentials and
 * Department tabs after them are the org chart, which changes rarely, and these change
 * every day.
 *
 * They are one file because they are one chain, the same one their endpoints describe in
 * backend/routers/v3_hr_ops.py:
 *
 *     Approvals  ->  Attendance  ->  Payroll
 *
 * An approved leave writes itself into the register; the register's loss-of-pay days are
 * what payroll pro-rates against. Splitting them into four files would have put the three
 * screens that share those rules three imports apart, and the rules are the thing most
 * likely to be edited together.
 *
 * Kept out of HRBoard.jsx, which is already four thousand lines of the org chart. The
 * tabs are wired in there; everything they do lives here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock, Ban, CalendarCheck, CalendarDays, CalendarOff, Check, ChevronLeft, ChevronRight,
  Download, IndianRupee, Lock, Palmtree, Pin, PinOff, Plus, Quote, RefreshCw, Save, Sun,
  Trash2, TriangleAlert, Undo2, Wallet, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { downloadCsv } from "@/lib/printable";
// The hours each person is rostered on, set in Super Admin → Credentials. Shared with
// that screen rather than reimplemented here — see lib/workTiming.js.
import { LATE_GRACE_MINUTES, isRostered, lateBy, lateLabel, prettyTime, workTiming } from "@/lib/workTiming";
import {
  hrAttendanceDay, hrMarkAttendance, hrEmployees,
  hrApprovals, hrCreateApproval, hrDecideApproval, hrDeleteApproval,
  hrPayroll, hrGeneratePayroll, hrAdjustPayslip, hrPayrollStatus,
  hrQuotes, hrAddQuote, hrUpdateQuote, hrDeleteQuote,
} from "@/lib/api";

// ---------- shared ----------

const money = (n) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

/** "2026-09-04" -> "04 Sep 2026". Blank in, blank out — a missing date reads as a dash
 *  at the call site rather than as "Invalid Date". */
const prettyDate = (iso) => (iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  : "");

const prettyMonth = (month) => (month
  ? new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
  : "");

const shiftMonth = (month, by) => {
  const d = new Date(`${month}-01T00:00:00`);
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const todayIso = () => {
  // The browser's own day, which for everyone using this is the clinic's. The server has
  // its own answer (see clinic_today in backend/utils.py) and sends it down with the
  // register; this is only for capping the date picker before that reply lands.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const shiftDay = (iso, by) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fail = (e) => toast.error(e?.response?.data?.detail || e?.message || "Something went wrong");

/** A figure with a caption, in the same shape as the Dashboard's KPI tiles so the three
 *  screens read as one board rather than three. Clickable only when there is somewhere
 *  for the click to go. */
const Stat = ({ label, value, tone = "text-slate-800", onClick, active, testid }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={`w-full rounded-xl border-2 bg-white px-3 py-2.5 text-left transition ${
        active ? "border-sky-400 shadow-sm" : "border-slate-200"
      } ${onClick ? "cursor-pointer hover:border-sky-300 hover:shadow-sm" : ""}`}
      data-testid={testid}
    >
      <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`mt-0.5 block text-2xl font-extrabold ${tone}`}>{value}</span>
    </Tag>
  );
};

const Empty = ({ children }) => (
  <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">{children}</p>
);

// ---------- Attendance ----------

// Mirrors ATTENDANCE_STATUSES in backend/routers/v3_hr_ops.py. `lop` is repeated here
// only so the screen can say what a mark costs before it is saved; the figure payroll
// actually uses is the server's.
const MARKS = [
  { key: "present", short: "P", label: "Present", lop: 0, on: "bg-emerald-600 text-white border-emerald-600", off: "border-emerald-200 text-emerald-700 hover:bg-emerald-50" },
  { key: "late", short: "L", label: "Late", lop: 0, on: "bg-amber-500 text-white border-amber-500", off: "border-amber-200 text-amber-700 hover:bg-amber-50" },
  { key: "half_day", short: "½", label: "Half day", lop: 0.5, on: "bg-orange-500 text-white border-orange-500", off: "border-orange-200 text-orange-700 hover:bg-orange-50" },
  { key: "absent", short: "A", label: "Absent", lop: 1, on: "bg-rose-600 text-white border-rose-600", off: "border-rose-200 text-rose-700 hover:bg-rose-50" },
  { key: "leave", short: "LV", label: "Leave", lop: 0, on: "bg-sky-600 text-white border-sky-600", off: "border-sky-200 text-sky-700 hover:bg-sky-50" },
  { key: "week_off", short: "WO", label: "Week off", lop: 0, on: "bg-slate-600 text-white border-slate-600", off: "border-slate-200 text-slate-600 hover:bg-slate-50" },
  { key: "holiday", short: "H", label: "Holiday", lop: 0, on: "bg-violet-600 text-white border-violet-600", off: "border-violet-200 text-violet-700 hover:bg-violet-50" },
];
const MARK_BY_KEY = Object.fromEntries(MARKS.map((m) => [m.key, m]));
// The two marks where the clock matters. On the rest the time boxes are pointless — a
// week off has no check-in — so they are disabled rather than left open to be filled with
// something the register would then carry around meaninglessly.
const CLOCKED = new Set(["present", "late", "half_day"]);

/** The seven marks as one row of pills. Clicking the mark already set clears it, which is
 *  how a wrong entry is taken back — there is no separate "clear" control to hunt for. */
const MarkPicker = ({ value, disabled, onPick, testid }) => (
  <div className="flex flex-wrap items-center gap-1" data-testid={testid}>
    {MARKS.map((m) => {
      const on = value === m.key;
      return (
        <button
          key={m.key}
          type="button"
          disabled={disabled}
          title={disabled ? `${m.label} — locked by an approved request` : m.label}
          onClick={() => onPick(on ? "" : m.key)}
          className={`h-7 min-w-[28px] rounded-md border px-1.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? m.on : `bg-white ${m.off}`}`}
          data-testid={`${testid}-${m.key}`}
        >
          {m.short}
        </button>
      );
    })}
  </div>
);

// ---------- the roster behind the register ----------
//
// The hours Super Admin sets against a login in Credentials. The register carries them per
// row so a day is filled in against the hours somebody is actually on, and so the "late by
// 14m" it reports has the 09:00 it was measured from sitting next to it.

/** A row's rostered hours, with the break under them.
 *
 *  Nobody rostered reads as "No timing set" rather than as a dash — a blank here is the
 *  reason the register cannot say whether an arrival was late, so it is named, and the
 *  title says where the answer is set. */
const ShiftCell = ({ shift }) => {
  const t = workTiming({ shift });
  if (!isRostered(t)) {
    return (
      <span className="text-[11px] text-slate-300" title="Set this person's hours in Super Admin → Credentials → Timing">
        No timing set
      </span>
    );
  }
  return (
    <span className="block text-[11px] leading-tight text-slate-600">
      <span className="whitespace-nowrap font-medium text-slate-700">
        {prettyTime(t.login_time) || "—"} <span className="text-slate-400">→</span> {prettyTime(t.logout_time) || "—"}
      </span>
      {(t.break_in_time || t.break_out_time) && (
        <span className="mt-0.5 block whitespace-nowrap text-slate-400">
          Break {prettyTime(t.break_in_time) || "—"} → {prettyTime(t.break_out_time) || "—"}
        </span>
      )}
    </span>
  );
};

/** The amber "late by" chip. Shown only where there is both a rostered login and a typed
 *  check-in to measure against it. It reports the clock and says nothing about the mark HR
 *  chose, which stays theirs — the two are allowed to disagree. */
const LateChip = ({ minutes }) => (
  <span
    className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
    title="Past the login time on this person's roster"
  >
    <AlarmClock className="h-3 w-3" />Late by {lateLabel(minutes)}
  </span>
);

const TimeBox = ({ value, disabled, onChange, testid }) => (
  <input
    type="time"
    value={value || ""}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    className="h-8 w-[104px] rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-300 disabled:bg-slate-50 disabled:text-slate-300"
    data-testid={testid}
  />
);

export const AttendanceTab = () => {
  const [day, setDay] = useState(todayIso());
  const [data, setData] = useState(null);
  // Marks typed but not yet saved, keyed by employee id. Held apart from `data` so a row
  // can be compared against what the server last said and only the changed ones sent —
  // and so a failed save leaves the typing on screen rather than wiping it.
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback((on) => {
    setLoading(true);
    return hrAttendanceDay(on)
      .then((d) => { setData(d); setDraft({}); })
      .catch(fail)
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(day); }, [day, load]);

  const rows = useMemo(() => data?.rows || [], [data]);
  const rowOf = (r) => ({ ...r, ...(draft[r.employee_id] || {}) });

  const dirty = useMemo(() => rows.filter((r) => {
    const d = draft[r.employee_id];
    if (!d) return false;
    return d.status !== r.status || (d.check_in || "") !== r.check_in || (d.check_out || "") !== r.check_out || (d.note || "") !== r.note;
  }), [rows, draft]);

  const set = (id, patch) => setDraft((prev) => {
    const base = rows.find((r) => r.employee_id === id) || {};
    const next = { status: base.status, check_in: base.check_in, check_out: base.check_out, note: base.note, ...(prev[id] || {}), ...patch };
    // A mark with no clock keeps no times: switching Present to Week off should not leave
    // yesterday's 09:15 sitting on a day nobody worked.
    if (!CLOCKED.has(next.status)) { next.check_in = ""; next.check_out = ""; }
    return { ...prev, [id]: next };
  });

  /** Fill every row that has no mark yet — the register's fast path. Rows already marked
   *  and rows locked by an approval are left exactly as they are. */
  const fillBlanks = (status) => {
    const patch = {};
    rows.forEach((r) => {
      const cur = rowOf(r);
      if (cur.locked || cur.status) return;
      patch[r.employee_id] = { status, check_in: "", check_out: "", note: cur.note || "" };
    });
    if (!Object.keys(patch).length) { toast.info("Every row is already marked."); return; }
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const save = async () => {
    if (!dirty.length) return;
    setSaving(true);
    try {
      const entries = dirty.map((r) => {
        const d = rowOf(r);
        return { employee_id: r.employee_id, status: d.status || "", check_in: d.check_in || "", check_out: d.check_out || "", note: d.note || "" };
      });
      const res = await hrMarkAttendance(day, entries);
      toast.success(`${prettyDate(day)} saved — ${res.saved} marked${res.cleared ? `, ${res.cleared} cleared` : ""}.`);
      await load(day);
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  // The draft's own count, not the server's, so the chips move as the register is filled
  // rather than only after a save.
  const summary = useMemo(() => {
    const out = { unmarked: 0, lop: 0 };
    MARKS.forEach((m) => { out[m.key] = 0; });
    rows.forEach((r) => {
      // Read straight off the draft rather than through rowOf, which the dependency
      // array cannot see into. Every draft entry carries a full status, so the two agree.
      const s = (draft[r.employee_id] || r).status;
      if (!s) { out.unmarked += 1; return; }
      out[s] = (out[s] || 0) + 1;
      out.lop += MARK_BY_KEY[s]?.lop || 0;
    });
    return out;
  }, [rows, draft]);

  const isToday = day === (data?.today || todayIso());
  // The server's grace, which is the one the stored figure was worked out with. The
  // constant only covers the moment before the register's first reply lands.
  const grace = data?.late_grace_minutes ?? LATE_GRACE_MINUTES;

  /** Fill a row's In and Out from the hours that person is rostered on.
   *
   *  An explicit click, never automatic. A register is a record of what happened, and
   *  writing 09:00 into it because that is when somebody was due would be the register
   *  making the claim rather than reporting one. This only saves the typing where the
   *  roster is in fact what happened. */
  const applyRosterHours = (r) => {
    const shift = r.shift || {};
    set(r.employee_id, { check_in: shift.login_time || "", check_out: shift.logout_time || "" });
  };

  // Two things the roster says about the day, both counted off the draft so they move as
  // the register is filled in. `late` is the clock's answer, which is not the same as the
  // Late mark HR may or may not choose to set — that stays theirs.
  const rosterNote = useMemo(() => {
    let late = 0, unrostered = 0;
    rows.forEach((r) => {
      const d = { ...r, ...(draft[r.employee_id] || {}) };
      if (!isRostered(r.shift)) { unrostered += 1; return; }
      if (CLOCKED.has(d.status) && lateBy(r.shift, d.check_in) > grace) late += 1;
    });
    return { late, unrostered };
  }, [rows, draft, grace]);

  return (
    <div className="space-y-4" data-testid="hr-attendance-tab">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Button variant="outline" size="icon" onClick={() => setDay(shiftDay(day, -1))} title="Previous day" data-testid="hr-att-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="w-[190px]">
            <MilkDateInput value={day} max={data?.today || todayIso()} accent="sky" onChange={(e) => setDay(e.target.value)} data-testid="hr-att-date" />
          </div>
          <Button
            variant="outline"
            size="icon"
            disabled={isToday}
            onClick={() => setDay(shiftDay(day, 1))}
            title={isToday ? "Today is as far forward as the register goes" : "Next day"}
            data-testid="hr-att-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDay(data?.today || todayIso())} data-testid="hr-att-today">
              <CalendarDays className="h-4 w-4" />Today
            </Button>
          )}

          <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />

          <Button variant="outline" size="sm" onClick={() => fillBlanks("present")} data-testid="hr-att-all-present">
            <Check className="h-4 w-4" />Fill blanks as Present
          </Button>
          <Button variant="outline" size="sm" onClick={() => fillBlanks("week_off")} data-testid="hr-att-all-off">
            <Sun className="h-4 w-4" />as Week off
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {dirty.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setDraft({})} data-testid="hr-att-discard">
                <Undo2 className="h-4 w-4" />Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty.length || saving} data-testid="hr-att-save">
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : dirty.length ? `Save ${dirty.length} change${dirty.length > 1 ? "s" : ""}` : "Saved"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {MARKS.map((m) => (
          <Stat key={m.key} label={m.label} value={summary[m.key] || 0} tone={m.key === "absent" ? "text-rose-600" : "text-slate-800"} testid={`hr-att-count-${m.key}`} />
        ))}
        <Stat label="Unmarked" value={summary.unmarked} tone={summary.unmarked ? "text-amber-600" : "text-slate-400"} testid="hr-att-count-unmarked" />
      </div>

      {/* Unmarked is deliberately not a silent absence — payroll pays those days. Said
          here so nobody discovers it at the end of the month on a payslip. */}
      {summary.unmarked > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="hr-att-unmarked-note">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {summary.unmarked} {summary.unmarked === 1 ? "person has" : "people have"} no mark for this day. Payroll pays unmarked days in full — mark an absence to dock it.
        </p>
      )}

      {/* What the roster says about the day, beside what the marks say. Late here is the
          clock's answer — a check-in past the login time somebody is rostered on — and it
          is deliberately separate from the Late mark, which is HR's decision about that
          fact and is not made for them. */}
      {rosterNote.late > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="hr-att-late-note">
          <AlarmClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {rosterNote.late} {rosterNote.late === 1 ? "person" : "people"} checked in more than {grace} minutes after their rostered login time.
        </p>
      )}

      {rosterNote.unrostered > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="hr-att-unrostered-note">
          <AlarmClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {rosterNote.unrostered} {rosterNote.unrostered === 1 ? "person has" : "people have"} no work timing set, so a late arrival cannot be spotted for them. Set it in Super Admin → Credentials → Timing.
        </p>
      )}

      {/* What this day costs, said on the day it is marked rather than at the end of the
          month on a payslip. Absences and half days are the only two marks that carry a
          figure -- see LOP_DAYS in backend/routers/v3_hr_ops.py, which is where payroll
          gets the same number from. */}
      {summary.lop > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" data-testid="hr-att-lop-note">
          <IndianRupee className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {summary.lop} {summary.lop === 1 ? "day" : "days"} of pay lost on this day, once the month is run.
        </p>
      )}

      {loading && !data ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          {/* Phone: one card per person. The pills wrap onto their own line, which is the
              only way seven of them fit a phone without becoming a dropdown. */}
          <div className="space-y-2 lg:hidden" data-testid="hr-att-cards">
            {rows.map((r) => {
              const d = rowOf(r);
              return (
                <div key={r.employee_id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-att-card-${r.employee_id}`}>
                  <div className="flex items-center gap-2.5">
                    <EmployeeAvatar employee={r} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">{r.full_name}</p>
                      <p className="truncate text-xs text-slate-400">{r.employee_code}{r.designation ? ` · ${r.designation}` : ""}</p>
                    </div>
                    {d.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-sky-500" title="Set by an approved request" />}
                  </div>
                  <div className="mt-1.5" data-testid={`hr-att-shift-m-${r.employee_id}`}>
                    <ShiftCell shift={r.shift} />
                  </div>
                  <div className="mt-2">
                    <MarkPicker value={d.status} disabled={d.locked} onPick={(s) => set(r.employee_id, { status: s })} testid={`hr-att-mark-m-${r.employee_id}`} />
                  </div>
                  {CLOCKED.has(d.status) && (
                    <>
                      <div className="mt-2 flex items-center gap-2">
                        <TimeBox value={d.check_in} onChange={(v) => set(r.employee_id, { check_in: v })} testid={`hr-att-in-m-${r.employee_id}`} />
                        <span className="text-xs text-slate-400">to</span>
                        <TimeBox value={d.check_out} onChange={(v) => set(r.employee_id, { check_out: v })} testid={`hr-att-out-m-${r.employee_id}`} />
                        {isRostered(r.shift) && !d.locked && (r.shift.login_time || r.shift.logout_time) && (
                          <button
                            type="button"
                            onClick={() => applyRosterHours(r)}
                            className="rounded border border-slate-200 px-1.5 py-1 text-[10px] font-semibold text-slate-500"
                            data-testid={`hr-att-use-shift-m-${r.employee_id}`}
                          >
                            Use hours
                          </button>
                        )}
                      </div>
                      {lateBy(r.shift, d.check_in) > grace && (
                        <div data-testid={`hr-att-late-m-${r.employee_id}`}><LateChip minutes={lateBy(r.shift, d.check_in)} /></div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && <Empty>No active employees to mark.</Empty>}
          </div>

          <Card className="hidden lg:block">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Register — {prettyDate(day)}</CardTitle>
              <p className="text-xs text-slate-500">Click a mark again to clear it. Nothing is stored until you save.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">S.No</th>
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2">Dept</th>
                      <th className="px-3 py-2">Shift</th>
                      <th className="px-3 py-2">Mark</th>
                      <th className="px-3 py-2">In</th>
                      <th className="px-3 py-2">Out</th>
                      <th className="px-3 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const d = rowOf(r);
                      const changed = dirty.some((x) => x.employee_id === r.employee_id);
                      return (
                        <tr key={r.employee_id} className={`border-t border-slate-100 ${changed ? "bg-sky-50/60" : "hover:bg-slate-50"}`} data-testid={`hr-att-row-${r.employee_id}`}>
                          <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2.5">
                              <EmployeeAvatar employee={r} size={30} />
                              <div className="min-w-0">
                                <p className="flex items-center gap-1 font-medium text-slate-800">
                                  {r.full_name}
                                  {d.locked && <Lock className="h-3 w-3 text-sky-500" />}
                                </p>
                                <p className="text-xs text-slate-400">{r.employee_code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-600">{r.department || "—"}</td>
                          <td className="px-3 py-2" data-testid={`hr-att-shift-${r.employee_id}`}>
                            <ShiftCell shift={r.shift} />
                            {/* Only where there are hours to copy and a mark that takes a
                                clock — on a week off there is nothing for it to mean. */}
                            {isRostered(r.shift) && CLOCKED.has(d.status) && !d.locked && (r.shift.login_time || r.shift.logout_time) && (
                              <button
                                type="button"
                                onClick={() => applyRosterHours(r)}
                                className="mt-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                                data-testid={`hr-att-use-shift-${r.employee_id}`}
                              >
                                Use these hours
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <MarkPicker value={d.status} disabled={d.locked} onPick={(s) => set(r.employee_id, { status: s })} testid={`hr-att-mark-${r.employee_id}`} />
                          </td>
                          <td className="px-3 py-2">
                            <TimeBox value={d.check_in} disabled={d.locked || !CLOCKED.has(d.status)} onChange={(v) => set(r.employee_id, { check_in: v })} testid={`hr-att-in-${r.employee_id}`} />
                            {CLOCKED.has(d.status) && lateBy(r.shift, d.check_in) > grace && (
                              <span className="block" data-testid={`hr-att-late-${r.employee_id}`}><LateChip minutes={lateBy(r.shift, d.check_in)} /></span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <TimeBox value={d.check_out} disabled={d.locked || !CLOCKED.has(d.status)} onChange={(v) => set(r.employee_id, { check_out: v })} testid={`hr-att-out-${r.employee_id}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={d.note || ""}
                              disabled={d.locked}
                              onChange={(e) => set(r.employee_id, { note: e.target.value })}
                              placeholder="—"
                              className="h-8 w-40 rounded-md border border-slate-200 px-2 text-xs outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-1 focus:ring-sky-300 disabled:bg-slate-50"
                              data-testid={`hr-att-note-${r.employee_id}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan="8" className="px-3 py-6 text-center text-slate-400">No active employees to mark.</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

// ---------- Payroll ----------

const RUN_TONE = {
  draft: "bg-amber-100 text-amber-700",
  finalised: "bg-sky-100 text-sky-700",
  paid: "bg-emerald-100 text-emerald-700",
};

/** A rupee figure typed against one payslip line, saved when the box is left rather than
 *  on every keystroke — a PATCH per digit would be a request per digit. */
const AmountBox = ({ value, disabled, onCommit, testid }) => {
  const [text, setText] = useState(String(value ?? 0));
  useEffect(() => { setText(String(value ?? 0)); }, [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      inputMode="numeric"
      onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))}
      onBlur={() => {
        const n = Number(text || 0);
        if (Number.isNaN(n) || n === Number(value ?? 0)) { setText(String(value ?? 0)); return; }
        onCommit(n);
      }}
      className="h-8 w-24 rounded-md border border-slate-200 px-2 text-right text-xs outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-300 disabled:bg-slate-50 disabled:text-slate-400"
      data-testid={testid}
    />
  );
};

export const PayrollTab = () => {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback((m) => {
    setLoading(true);
    return hrPayroll(m).then(setData).catch(fail).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(month); }, [month, load]);

  const run = data?.run || null;
  const slips = data?.slips || [];
  const totals = data?.totals || {};
  const status = run?.status || "";
  const editable = status === "draft";

  const act = async (fn, done) => {
    setBusy(true);
    try { const res = await fn(); toast.success(done); setData(res.slips ? res : await hrPayroll(month)); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  const adjust = async (employeeId, patch) => {
    try {
      await hrAdjustPayslip(month, employeeId, patch);
      setData(await hrPayroll(month));
    } catch (e) { fail(e); }
  };

  const exportCsv = () => {
    downloadCsv([
      ["Employee", "Code", "Department", "Base", "Days", "LOP days", "Payable days", "Earned", "Bonus", "Deduction", "Net payable"],
      ...slips.map((s) => [
        s.employee_name, s.employee_code, s.department, s.base, s.days_in_month,
        s.lop_days, s.payable_days, s.earned, s.bonus, s.deduction, s.net_payable,
      ]),
    ], `payroll-${month}.csv`);
  };

  return (
    <div className="space-y-4" data-testid="hr-payroll-tab">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} title="Previous month" data-testid="hr-pay-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] text-center text-sm font-semibold text-slate-800" data-testid="hr-pay-month">{prettyMonth(month)}</span>
          <Button
            variant="outline"
            size="icon"
            disabled={month >= todayIso().slice(0, 7)}
            onClick={() => setMonth(shiftMonth(month, 1))}
            title="Next month"
            data-testid="hr-pay-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {status && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${RUN_TONE[status] || "bg-slate-100 text-slate-600"}`} data-testid="hr-pay-status">
              {status}
            </span>
          )}
          {data?.preview && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500" data-testid="hr-pay-preview-badge">
              Preview
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!slips.length} data-testid="hr-pay-csv">
              <Download className="h-4 w-4" />CSV
            </Button>
            {status !== "paid" && (
              <Button variant="outline" size="sm" disabled={busy || (status && status !== "draft")} onClick={() => act(() => hrGeneratePayroll(month), `${prettyMonth(month)} generated from the register.`)} data-testid="hr-pay-generate">
                <RefreshCw className="h-4 w-4" />{run ? "Regenerate" : "Generate run"}
              </Button>
            )}
            {status === "draft" && (
              <Button size="sm" disabled={busy} onClick={() => act(() => hrPayrollStatus(month, "finalised"), `${prettyMonth(month)} finalised.`)} data-testid="hr-pay-finalise">
                <Check className="h-4 w-4" />Finalise
              </Button>
            )}
            {status === "finalised" && (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => hrPayrollStatus(month, "draft"), `${prettyMonth(month)} reopened.`)} data-testid="hr-pay-reopen">
                  <Undo2 className="h-4 w-4" />Reopen
                </Button>
                <Button size="sm" disabled={busy} onClick={() => act(() => hrPayrollStatus(month, "paid"), `${prettyMonth(month)} marked paid.`)} data-testid="hr-pay-paid">
                  <Wallet className="h-4 w-4" />Mark paid
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Says plainly which of the two things is on screen. A preview computed from a
          register still being filled in is useful; mistaking it for the month's record is
          not, so it is labelled rather than left to be inferred from a missing badge. */}
      {data?.preview && (
        <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="hr-pay-preview-note">
          <CalendarCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Nothing has been generated for {prettyMonth(month)} yet. This is what payroll comes to against the register as it stands right now — generate a run to freeze it and start adding bonuses and deductions.
        </p>
      )}
      {totals.unmarked_days > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="hr-pay-unmarked-note">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {totals.unmarked_days} employee-days this month have no attendance mark and are being paid in full. Fill them in on Attendance, then regenerate.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Employees" value={totals.employees ?? 0} testid="hr-pay-t-emp" />
        <Stat label="Earned" value={money(totals.gross)} testid="hr-pay-t-gross" />
        <Stat label="Bonuses" value={money(totals.bonus)} tone="text-emerald-600" testid="hr-pay-t-bonus" />
        <Stat label="Deductions" value={money(totals.deduction)} tone="text-rose-600" testid="hr-pay-t-ded" />
        <Stat label="Net payable" value={money(totals.net_payable)} tone="text-sky-700" testid="hr-pay-t-net" />
      </div>

      {loading && !data ? <p className="text-sm text-slate-500">Loading...</p> : (
        <>
          <div className="space-y-2 lg:hidden" data-testid="hr-pay-cards">
            {slips.map((s) => (
              <div key={s.employee_id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-pay-card-${s.employee_id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{s.employee_name}</p>
                    <p className="truncate text-xs text-slate-400">{s.employee_code}{s.department ? ` · ${s.department}` : ""}</p>
                  </div>
                  <span className="shrink-0 text-base font-bold text-sky-700">{money(s.net_payable)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span>Base {money(s.base)}</span>
                  <span>{s.payable_days}/{s.days_in_month} days</span>
                  {s.lop_days > 0 && <span className="font-semibold text-rose-600">LOP {s.lop_days}</span>}
                  {s.bonus > 0 && <span className="text-emerald-600">+{money(s.bonus)}</span>}
                  {s.deduction > 0 && <span className="text-rose-600">−{money(s.deduction)}</span>}
                </div>
              </div>
            ))}
            {slips.length === 0 && <Empty>No active employees to pay.</Empty>}
          </div>

          <Card className="hidden lg:block">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payslips — {prettyMonth(month)}</CardTitle>
              <p className="text-xs text-slate-500">
                Pay is pro-rated on calendar days: a day of loss of pay costs base ÷ days in month. Bonuses and deductions are editable while the run is a draft.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">S.No</th>
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2 text-right">Base</th>
                      <th className="px-3 py-2 text-right">Payable days</th>
                      <th className="px-3 py-2 text-right">LOP</th>
                      <th className="px-3 py-2 text-right">Earned</th>
                      <th className="px-3 py-2 text-right">Bonus</th>
                      <th className="px-3 py-2 text-right">Deduction</th>
                      <th className="px-3 py-2 text-right">Net payable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map((s, i) => (
                      <tr key={s.employee_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`hr-pay-row-${s.employee_id}`}>
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-800">{s.employee_name}</p>
                          <p className="text-xs text-slate-400">{s.employee_code}{s.department ? ` · ${s.department}` : ""}</p>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600" title={`From the employee record's ${s.base_from}`}>{money(s.base)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {s.payable_days}<span className="text-slate-400">/{s.days_in_month}</span>
                          {s.unmarked_days > 0 && <span className="ml-1 text-[10px] font-semibold text-amber-600" title={`${s.unmarked_days} days unmarked, paid in full`}>({s.unmarked_days}?)</span>}
                        </td>
                        <td className={`px-3 py-2 text-right ${s.lop_days > 0 ? "font-semibold text-rose-600" : "text-slate-400"}`}>{s.lop_days}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{money(s.earned)}</td>
                        <td className="px-3 py-2 text-right">
                          {editable
                            ? <AmountBox value={s.bonus} onCommit={(n) => adjust(s.employee_id, { bonus: n })} testid={`hr-pay-bonus-${s.employee_id}`} />
                            : <span className={s.bonus ? "text-emerald-600" : "text-slate-400"}>{money(s.bonus)}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {editable
                            ? <AmountBox value={s.deduction} onCommit={(n) => adjust(s.employee_id, { deduction: n })} testid={`hr-pay-ded-${s.employee_id}`} />
                            : <span className={s.deduction ? "text-rose-600" : "text-slate-400"}>{money(s.deduction)}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-sky-700">{money(s.net_payable)}</td>
                      </tr>
                    ))}
                    {slips.length === 0 && <tr><td colSpan="9" className="px-3 py-6 text-center text-slate-400">No active employees to pay.</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

// ---------- Approvals ----------

// Mirrors KINDS in backend/routers/v3_hr_ops.py. `dated` and `priced` decide which half
// of the form a kind asks for — a leave wants dates, an advance wants an amount, and
// showing both to both would make every request half empty.
const KINDS = [
  { key: "leave", label: "Leave", dated: true, priced: false, icon: Palmtree },
  { key: "comp_off", label: "Comp off", dated: true, priced: false, icon: CalendarOff },
  { key: "advance", label: "Salary advance", dated: false, priced: true, icon: IndianRupee },
  { key: "expense", label: "Expense claim", dated: false, priced: true, icon: Wallet },
  { key: "other", label: "Other", dated: false, priced: false, icon: AlarmClock },
];
const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.key, k]));

const STATUS_TONE = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

const NewRequestModal = ({ employees, onClose, onSaved }) => {
  const [form, setForm] = useState({ employee_id: "", kind: "leave", from_date: "", to_date: "", amount: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const kind = KIND_BY_KEY[form.kind];
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.employee_id) { toast.error("Pick who this is for."); return; }
    setSaving(true);
    try {
      await hrCreateApproval({
        employee_id: form.employee_id,
        kind: form.kind,
        from_date: kind.dated ? form.from_date : "",
        // A one-day leave is the common case, so leaving the second date blank means the
        // same day rather than being an error to correct.
        to_date: kind.dated ? (form.to_date || form.from_date) : "",
        amount: kind.priced ? Number(form.amount || 0) : 0,
        reason: form.reason,
      });
      toast.success("Request logged.");
      onSaved();
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="hr-approval-modal">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">New request</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="hr-approval-modal-close"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</span>
            <select
              value={form.employee_id}
              onChange={(e) => set({ employee_id: e.target.value })}
              className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-300"
              data-testid="hr-approval-employee"
            >
              <option value="">Select</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.employee_code ? ` (${e.employee_code})` : ""}</option>)}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => set({ kind: k.key })}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                    form.kind === k.key ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
                  }`}
                  data-testid={`hr-approval-kind-${k.key}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {kind.dated && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">From</span>
                <MilkDateInput value={form.from_date} accent="sky" centered title="Pick the first day" onChange={(e) => set({ from_date: e.target.value })} data-testid="hr-approval-from" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">To</span>
                <MilkDateInput value={form.to_date} min={form.from_date} accent="sky" centered title="Pick the last day" placeholder="Same day" onChange={(e) => set({ to_date: e.target.value })} data-testid="hr-approval-to" />
              </label>
            </div>
          )}

          {kind.priced && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Amount (₹)</span>
              <Input value={form.amount} inputMode="numeric" onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })} data-testid="hr-approval-amount" />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</span>
            <textarea
              value={form.reason}
              onChange={(e) => set({ reason: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-300"
              data-testid="hr-approval-reason"
            />
          </label>

          {kind.dated && (
            <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Approving this writes those days into the attendance register as leave, and payroll reads them from there.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="hr-approval-save">{saving ? "Saving..." : "Log request"}</Button>
        </div>
      </div>
    </div>
  );
};

export const ApprovalsTab = () => {
  const [filter, setFilter] = useState("pending");
  const [data, setData] = useState({ approvals: [], counts: {} });
  const [employees, setEmployees] = useState([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback((status) => {
    setLoading(true);
    return hrApprovals(status === "all" ? {} : { status })
      .then(setData).catch(fail).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(filter); }, [filter, load]);
  useEffect(() => { hrEmployees({ status: "active" }).then(setEmployees).catch(() => setEmployees([])); }, []);

  const decide = async (row, decision) => {
    try {
      const res = await hrDecideApproval(row.id, decision);
      const days = res.attendance_days_changed || 0;
      toast.success(
        decision === "pending" ? "Sent back to pending."
          : `${decision === "approved" ? "Approved" : "Rejected"}${days > 0 ? ` — ${days} day${days > 1 ? "s" : ""} marked as leave` : days < 0 ? ` — ${-days} leave day${days < -1 ? "s" : ""} cleared` : ""}.`
      );
      load(filter);
    } catch (e) { fail(e); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete this ${KIND_BY_KEY[row.kind]?.label.toLowerCase() || "request"} for ${row.employee_name}? Any leave days it marked are cleared too.`)) return;
    try { await hrDeleteApproval(row.id); toast.success("Deleted."); load(filter); } catch (e) { fail(e); }
  };

  const counts = data.counts || {};
  const rows = data.approvals || [];

  const when = (row) => {
    if (row.from_date) {
      return row.from_date === row.to_date
        ? prettyDate(row.from_date)
        : `${prettyDate(row.from_date)} → ${prettyDate(row.to_date)} · ${row.days} days`;
    }
    return row.amount ? money(row.amount) : "—";
  };

  return (
    <div className="space-y-4" data-testid="hr-approvals-tab">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Pending" value={counts.pending ?? 0} tone={counts.pending ? "text-amber-600" : "text-slate-400"} active={filter === "pending"} onClick={() => setFilter("pending")} testid="hr-appr-f-pending" />
        <Stat label="Approved" value={counts.approved ?? 0} tone="text-emerald-600" active={filter === "approved"} onClick={() => setFilter("approved")} testid="hr-appr-f-approved" />
        <Stat label="Rejected" value={counts.rejected ?? 0} tone="text-rose-600" active={filter === "rejected"} onClick={() => setFilter("rejected")} testid="hr-appr-f-rejected" />
        <Stat label="All requests" value={(counts.pending || 0) + (counts.approved || 0) + (counts.rejected || 0)} active={filter === "all"} onClick={() => setFilter("all")} testid="hr-appr-f-all" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {filter === "all" ? "Every request" : `${filter[0].toUpperCase()}${filter.slice(1)} requests`} · approving a leave marks the register.
        </p>
        <Button onClick={() => setAdding(true)} data-testid="hr-appr-new"><Plus className="h-4 w-4" />New request</Button>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading...</p> : rows.length === 0 ? (
        <Empty>{filter === "pending" ? "Nothing waiting on a decision." : "No requests here."}</Empty>
      ) : (
        <div className="space-y-2" data-testid="hr-appr-list">
          {rows.map((row) => {
            const kind = KIND_BY_KEY[row.kind] || KIND_BY_KEY.other;
            const Icon = kind.icon;
            return (
              <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`hr-appr-row-${row.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">{row.employee_name}</span>
                      <span className="text-xs text-slate-400">{row.employee_code}{row.department ? ` · ${row.department}` : ""}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        <Icon className="h-3 w-3" />{kind.label}
                      </span>
                      <span>{when(row)}</span>
                    </p>
                    {row.reason && <p className="mt-1 text-sm text-slate-500">{row.reason}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      Logged by {row.requested_by || "—"}
                      {row.decided_by ? ` · ${row.status} by ${row.decided_by}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_TONE[row.status]}`}>{row.status}</span>
                    {row.status === "pending" ? (
                      <>
                        <Button size="sm" onClick={() => decide(row, "approved")} data-testid={`hr-appr-approve-${row.id}`}><Check className="h-4 w-4" />Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => decide(row, "rejected")} data-testid={`hr-appr-reject-${row.id}`}><Ban className="h-4 w-4" />Reject</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => decide(row, "pending")} title="Undo this decision" data-testid={`hr-appr-reopen-${row.id}`}>
                        <Undo2 className="h-4 w-4" />Reopen
                      </Button>
                    )}
                    <button type="button" onClick={() => remove(row)} title="Delete request" className="p-1.5 text-slate-400 hover:text-rose-600" data-testid={`hr-appr-delete-${row.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && <NewRequestModal employees={employees} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(filter); }} />}
    </div>
  );
};

// ---------- Quotes ----------

export const QuotesTab = () => {
  const [data, setData] = useState({ quotes: [], today: null });
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const boxRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    return hrQuotes().then(setData).catch(fail).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!text.trim()) { toast.error("Write the quote first."); boxRef.current?.focus(); return; }
    setSaving(true);
    try {
      await hrAddQuote(text.trim(), author.trim());
      setText(""); setAuthor("");
      toast.success("Added to the board.");
      load();
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  const patch = async (q, body, done) => {
    try { await hrUpdateQuote(q.id, body); if (done) toast.success(done); load(); } catch (e) { fail(e); }
  };

  const remove = async (q) => {
    if (!window.confirm("Delete this quote?")) return;
    try { await hrDeleteQuote(q.id); toast.success("Deleted."); load(); } catch (e) { fail(e); }
  };

  const quotes = data.quotes || [];
  const live = quotes.filter((q) => q.active).length;

  return (
    <div className="space-y-4" data-testid="hr-quotes-tab">
      {/* Today's quote, shown the way staff will see it. The board is written here and
          read at /hr/quotes/today, so this card is the same answer that endpoint gives. */}
      <Card className="border-2 border-sky-100 bg-gradient-to-br from-sky-50 to-white">
        <CardContent className="p-5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-600">
            <Quote className="h-3.5 w-3.5" />Quote of the day · {prettyDate(data.date)}
          </p>
          {data.today ? (
            <>
              <p className="mt-2 text-lg font-semibold leading-snug text-slate-800" data-testid="hr-quote-today">“{data.today.text}”</p>
              <p className="mt-1.5 text-sm text-slate-500">
                — {data.today.author || "Unknown"}
                {data.today.pinned && <span className="ml-2 inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700"><Pin className="h-2.5 w-2.5" />Pinned</span>}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500" data-testid="hr-quote-today-empty">
              Nothing on the board yet. Add one below and it shows here from today.
            </p>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            {live > 1 && !data.today?.pinned
              ? `Rotating through ${live} active quotes — a different one each day. Pin one to hold it.`
              : "Pin a quote to hold it in place; unpinned, the board rotates a new one every day."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Add a quote</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <textarea
            ref={boxRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 400))}
            rows={2}
            placeholder="The quote itself"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-300"
            data-testid="hr-quote-text"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Who said it (optional)" className="max-w-xs" data-testid="hr-quote-author" />
            <span className="text-xs text-slate-400">{text.length}/400</span>
            <Button className="ml-auto" onClick={add} disabled={saving} data-testid="hr-quote-add"><Plus className="h-4 w-4" />Add</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-slate-500">Loading...</p> : quotes.length === 0 ? (
        <Empty>The board is empty.</Empty>
      ) : (
        <div className="space-y-2" data-testid="hr-quote-list">
          {quotes.map((q) => (
            <div
              key={q.id}
              className={`rounded-xl border bg-white p-3 ${q.pinned ? "border-sky-300" : "border-slate-200"} ${q.active ? "" : "opacity-60"}`}
              data-testid={`hr-quote-row-${q.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">“{q.text}”</p>
                  <p className="mt-1 text-xs text-slate-400">
                    — {q.author || "Unknown"} · added by {q.added_by || "—"}
                    {!q.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">Off the board</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => patch(q, { pinned: !q.pinned }, q.pinned ? "Unpinned — the board rotates again." : "Pinned as the quote of the day.")}
                    title={q.pinned ? "Unpin" : "Pin as the quote of the day"}
                    className={`p-1.5 ${q.pinned ? "text-sky-600" : "text-slate-400 hover:text-sky-600"}`}
                    data-testid={`hr-quote-pin-${q.id}`}
                  >
                    {q.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(q, { active: !q.active })}
                    title={q.active ? "Take off the board" : "Put back on the board"}
                    className={`p-1.5 ${q.active ? "text-emerald-600 hover:text-slate-500" : "text-slate-400 hover:text-emerald-600"}`}
                    data-testid={`hr-quote-toggle-${q.id}`}
                  >
                    {q.active ? <Check className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => remove(q)} title="Delete" className="p-1.5 text-slate-400 hover:text-rose-600" data-testid={`hr-quote-delete-${q.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
