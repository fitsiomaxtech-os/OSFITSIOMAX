/**
 * MY PROFILE — the page everybody has about themselves, whatever desk they sit at.
 *
 *     Attendance     the month I have worked, and today so far
 *     My Profile     what this company holds about me
 *
 * It replaced a dialog. The old My Profile was four lines in a box — name, role, joining
 * date — and every other fact about a person (their address, who to call in an emergency,
 * which account their salary lands in, how many hours they did last week) lived on screens
 * only Super Admin and HR can open. So the answer to "what does the company have on me"
 * was "ask somebody", for all forty-eight people on the books.
 *
 * A page rather than a bigger dialog because of what is on it. The month is a table with
 * eleven columns and thirty rows; a dialog either scrolls it in a letterbox or grows until
 * it is a page with a shadow under it. This takes the whole area under the header, with
 * Back where the board was.
 *
 * Attendance leads, not the profile. A profile is read once, when somebody joins or when a
 * detail changes; the month is read on a Friday afternoon by anyone wondering whether they
 * are ahead. The tab that opens is the one being opened for.
 *
 * Both halves come from routers/v3_me.py, which takes no id — there is no request this
 * page can make that reads another person's record.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  BriefcaseBusiness,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { myAttendance, myProfile } from "@/lib/api";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
// The same formatters the header clock and HR's register read a day with, so an hour and
// a half is not "1h 30m" here and "90m" three screens away.
import { duration, hours, prettyTime } from "@/lib/clock";

const TABS = [
  { key: "attendance", label: "Attendance", icon: Clock },
  { key: "profile", label: "My Profile", icon: UserRound },
];

// ---------- reading the figures ----------

/** Minutes as a signed count of hours: +1.3h, -9.0h, and 0 as a flat "0.0h".
 *
 *  A balance is the one figure on this page that is read for its sign before its size, so
 *  the plus is printed rather than left implied — "1.3h" beside "-9.0h" in the same column
 *  reads as a magnitude, not as an hour and a half in hand.
 */
const signedHours = (mins) => {
  const n = Math.round(Number(mins) || 0);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${(Math.abs(n) / 60).toFixed(1)}h`;
};

/** Minutes as plain hours to one place: 176.0, 26.3. For the summary row, where six
 *  figures are compared against each other and "7h 45m" is two numbers to read per tile. */
const plainHours = (mins) => (Math.abs(Number(mins) || 0) / 60).toFixed(1);

const monthLabel = (m) =>
  m ? new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";

const shiftMonth = (m, by) => {
  const d = new Date(`${m}-01T00:00:00`);
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const dayNumber = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const prettyDate = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  // Stored as YYYY-MM-DD by HR's form. Anything else — a date somebody typed in another
  // shape before the form was strict about it — is shown as it was written rather than
  // run through a parser that would turn it into "Invalid Date".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return new Date(`${text}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// What the register's marks are called on a person's own screen, and the colour each
// carries. `working` and `done` are the clock's states rather than HR's marks — a day
// nobody has marked is described by what was pressed on it, which is the honest answer
// and the one HR's own board gives (see _board_status in backend/routers/v3_hr_ops.py).
const STATUS_STYLES = {
  present: { label: "Present", cls: "bg-emerald-50 text-emerald-700" },
  late: { label: "Late", cls: "bg-amber-50 text-amber-700" },
  half_day: { label: "Half day", cls: "bg-orange-50 text-orange-700" },
  absent: { label: "Absent", cls: "bg-rose-50 text-rose-700" },
  leave: { label: "Leave", cls: "bg-violet-50 text-violet-700" },
  week_off: { label: "Week off", cls: "bg-slate-100 text-slate-500" },
  holiday: { label: "Holiday", cls: "bg-sky-50 text-sky-700" },
  working: { label: "Working", cls: "bg-emerald-50 text-emerald-700" },
  on_break: { label: "On break", cls: "bg-amber-50 text-amber-700" },
  done: { label: "Present", cls: "bg-emerald-50 text-emerald-700" },
  out: { label: "—", cls: "bg-slate-50 text-slate-400" },
};

const statusOf = (row) => STATUS_STYLES[row.status || row.state] || STATUS_STYLES.out;

// ---------- the small pieces ----------

/** A labelled figure. The tile the month's counts and its hours are both drawn with, so
 *  the two rows read as one summary rather than as two designs. */
const Tile = ({ label, value, sub, tone = "text-slate-800", accent = "", testid }) => (
  <div className={`rounded-xl border bg-white px-3 py-2.5 shadow-sm ${accent || "border-slate-200"}`} data-testid={testid}>
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`mt-0.5 text-xl font-extrabold leading-tight ${tone}`}>{value}</p>
    {sub && <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{sub}</p>}
  </div>
);

/** One fact off the record: what it is called, and what it says.
 *
 *  A missing value is a dash rather than an empty space, so a half-filled record reads as
 *  a record with gaps in it — which is a thing to go and get filled in — rather than as a
 *  screen that failed to load.
 */
const Field = ({ label, value, testid }) => (
  <div data-testid={testid}>
    <p className="text-[11px] text-slate-400">{label}</p>
    <p className="mt-0.5 break-words text-sm font-medium text-slate-700">{value || "—"}</p>
  </div>
);

const Panel = ({ title, icon: Icon, children, testid }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" data-testid={testid}>
    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
      {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      {title}
    </h3>
    {children}
  </section>
);

// ---------- attendance ----------

/** Today, across the top: the day as it stands right now.
 *
 *  The same six figures the header clock holds behind its pill, laid out rather than
 *  hidden — this is the screen somebody opened to look at them.
 */
const TodayStrip = ({ row, standard }) => {
  const style = statusOf(row || {});
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="my-attendance-today">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Clock className="h-4 w-4 text-slate-400" />
          Today
          <span className="text-xs font-normal text-slate-400">
            (Standard: {standard?.start} – {standard?.end})
          </span>
        </h3>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.cls}`} data-testid="my-attendance-today-status">
          {style.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Login" value={prettyTime(row?.clock_in) || "—"} testid="my-attendance-today-in" />
        <Tile label="Logout" value={prettyTime(row?.clock_out) || "—"} testid="my-attendance-today-out" />
        <Tile
          label="Break"
          value={row?.break_minutes ? duration(row.break_minutes) : "—"}
          sub={row?.break_count ? `${row.break_count} taken` : ""}
          tone="text-amber-600"
          testid="my-attendance-today-break"
        />
        <Tile label="Sessions" value={row?.sessions ?? 0} testid="my-attendance-today-sessions" />
        <Tile label="On the clock" value={hours(row?.login_minutes)} testid="my-attendance-today-login" />
        <Tile label="Work hours" value={hours(row?.worked_minutes)} tone="text-emerald-600" testid="my-attendance-today-worked" />
      </div>
    </section>
  );
};

/** The month's counts, and then its hours. Two rows because they answer two questions —
 *  how many days, and how many hours — and one row of twelve tiles answers neither. */
const MonthSummary = ({ totals, month, today }) => {
  const behind = (totals?.balance_minutes || 0) < 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="my-attendance-counts">
        <Tile label="Working days" value={totals?.working_days ?? 0} sub={monthLabel(month)} testid="my-attendance-working-days" />
        <Tile label="Present days" value={totals?.present_days ?? 0} tone="text-sky-600" testid="my-attendance-present-days" />
        <Tile label="Absent" value={totals?.absent_days ?? 0} tone={totals?.absent_days ? "text-rose-600" : "text-slate-800"} testid="my-attendance-absent-days" />
        <Tile label="On leave" value={totals?.leave_days ?? 0} tone="text-violet-600" testid="my-attendance-leave-days" />
        <Tile label="Late / half" value={`${totals?.late_days ?? 0} / ${totals?.half_days ?? 0}`} tone="text-amber-600" testid="my-attendance-late-days" />
        <Tile label="Extra hours" value={plainHours(totals?.extra_minutes)} tone="text-emerald-600" sub="Over 8h, added up" testid="my-attendance-extra" />
      </div>

      <section className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm" data-testid="my-attendance-hours">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <CalendarClock className="h-4 w-4 text-slate-400" />
          Hours — {monthLabel(month)}
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Expected"
            value={plainHours(totals?.expected_minutes)}
            sub={`${totals?.working_days ?? 0} days × 8h`}
            testid="my-attendance-expected"
          />
          <Tile label="Worked" value={plainHours(totals?.worked_minutes)} tone="text-emerald-600" sub="Actual hours" testid="my-attendance-worked" />
          <Tile label="Extra" value={signedHours(totals?.extra_minutes)} tone="text-emerald-600" sub="Overtime" testid="my-attendance-overtime" />
          <Tile label="On breaks" value={plainHours(totals?.break_minutes)} tone="text-amber-600" sub="Off the clock" testid="my-attendance-breaks" />
          <Tile
            label="Expected so far"
            value={plainHours(totals?.expected_to_date_minutes)}
            sub={`Up to ${dayNumber(today)}`}
            testid="my-attendance-expected-to-date"
          />
          {/* Measured against the days that have happened, not against the whole month —
              the backend sends both, and a balance of −150h on the 5th would be the
              calendar talking, not the person. */}
          <Tile
            label="Balance"
            value={signedHours(totals?.balance_minutes)}
            sub={behind ? "Behind, so far" : "In hand"}
            tone={behind ? "text-rose-600" : "text-emerald-600"}
            accent={behind ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}
            testid="my-attendance-balance"
          />
        </div>
      </section>
    </>
  );
};

/** Every day of the month, newest first.
 *
 *  A table on a desktop and a stack of cards on a phone. Eleven columns do not survive a
 *  phone at any font size, and the usual answer — a horizontally scrolling table — hides
 *  the columns most worth reading (what was worked, and whether it was behind).
 */
const MonthTable = ({ rows }) => {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-400" data-testid="my-attendance-empty">
        Nothing recorded this month yet.
      </p>
    );
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="my-attendance-history">
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Attendance history</h3>

      {/* Phone */}
      <ul className="divide-y divide-slate-100 sm:hidden">
        {rows.map((r) => {
          const style = statusOf(r);
          return (
            <li key={r.date} className="px-4 py-3" data-testid={`my-attendance-card-${r.date}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">
                  {dayNumber(r.date)} <span className="font-normal text-slate-400">{r.weekday}</span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.cls}`}>{style.label}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {prettyTime(r.clock_in) || "—"} <span className="text-slate-300">→</span> {prettyTime(r.clock_out) || "—"}
                {r.break_minutes > 0 && <span className="text-amber-600"> · {duration(r.break_minutes)} break</span>}
              </p>
              <p className="mt-1 text-xs">
                <span className="font-semibold text-emerald-600">{hours(r.worked_minutes)}</span>
                <span className="text-slate-300"> worked · </span>
                <span className={r.balance_minutes < 0 ? "font-semibold text-rose-600" : "font-semibold text-emerald-600"}>
                  {signedHours(r.balance_minutes)}
                </span>
              </p>
              {r.note && <p className="mt-1 text-[11px] text-slate-400">{r.note}</p>}
            </li>
          );
        })}
      </ul>

      {/* Desktop */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm" data-testid="my-attendance-table">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Day</th>
              <th className="px-3 py-2 text-center font-semibold">Sessions</th>
              <th className="px-3 py-2 font-semibold">Login</th>
              <th className="px-3 py-2 font-semibold">Logout</th>
              <th className="px-3 py-2 font-semibold">On the clock</th>
              <th className="px-3 py-2 font-semibold">Break</th>
              <th className="px-3 py-2 font-semibold">Work hrs</th>
              <th className="px-3 py-2 font-semibold">Balance</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((r) => {
              const style = statusOf(r);
              return (
                <tr key={r.date} className="hover:bg-slate-50/70" data-testid={`my-attendance-row-${r.date}`}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700">{dayNumber(r.date)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{r.weekday}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-slate-100 px-1 text-[11px] font-semibold text-slate-600">
                      {r.sessions}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{prettyTime(r.clock_in) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{prettyTime(r.clock_out) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{hours(r.login_minutes)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-amber-600">
                    {r.break_minutes ? duration(r.break_minutes) : "—"}
                    {r.break_count > 1 && <span className="ml-1 text-[11px] text-slate-400">({r.break_count})</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-emerald-600">{hours(r.worked_minutes)}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 font-semibold ${r.balance_minutes < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {signedHours(r.balance_minutes)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}>{style.label}</span>
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-2.5 text-slate-400" title={r.note || ""}>{r.note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const AttendanceTab = () => {
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    myAttendance(month)
      .then(setData)
      .catch((e) => setError(e?.response?.data?.detail || "Could not load your attendance"))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(load, [load]);

  // Memoised rather than `data?.days || []`: the fallback is a fresh array on every
  // render, which would make the lookup below recompute forever.
  const rows = useMemo(() => data?.days || [], [data]);
  // Today is the first row of the current month, and nothing at all in a past one — the
  // strip is about the day in progress, so an older month simply does not have one.
  const todayRow = useMemo(
    () => (data?.today ? rows.find((r) => r.date === data.today) : null),
    [rows, data?.today],
  );
  const isThisMonth = month === thisMonth();

  return (
    <div className="space-y-4" data-testid="my-profile-attendance-tab">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Previous month"
          data-testid="my-attendance-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-slate-700" data-testid="my-attendance-month">{monthLabel(month)}</span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          // Nothing to show past this month: the days have not happened, and a next arrow
          // that lands on an empty table is a control that only reports its own limit.
          disabled={isThisMonth}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Next month"
          data-testid="my-attendance-next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="my-attendance-error">
          {error}
        </p>
      )}

      {loading && !data ? (
        <p className="py-16 text-center text-sm text-slate-400" data-testid="my-attendance-loading">Loading your month…</p>
      ) : (
        <>
          {isThisMonth && <TodayStrip row={todayRow} standard={data?.standard} />}
          <MonthSummary totals={data?.totals} month={month} today={data?.today} />
          <MonthTable rows={rows} />
          {/* Said once, at the foot, rather than as a banner over the figures: the hours
              above are real either way — they are what this person pressed — and only the
              marks (leave, absent, half day) are missing without the link. */}
          {data && !data.linked && (
            <p className="text-center text-xs text-slate-400" data-testid="my-attendance-unlinked">
              No employee record is linked to this login, so HR's marks — leave, absent, half day — are not shown here.
              The hours are your own clock.
            </p>
          )}
        </>
      )}
    </div>
  );
};

// ---------- my profile ----------

const WORK_TYPES = { online: "Online", offline: "Offline", both: "Online & Offline" };
const SERVICES = { physio: "Physiotherapy", fitness: "Fitness", both: "Physiotherapy & Fitness" };
const titleCase = (s) => String(s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ProfileTab = ({ roleLabel }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    myProfile()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e?.response?.data?.detail || "Could not load your profile"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  if (loading) {
    return <p className="py-16 text-center text-sm text-slate-400" data-testid="my-profile-loading">Loading your profile…</p>;
  }
  if (error) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="my-profile-error">
        {error}
      </p>
    );
  }

  const account = data?.account || {};
  const hasBank = data.bank_name || data.bank_account || data.ifsc;

  return (
    <div className="space-y-4" data-testid="my-profile-profile-tab">
      {!data.linked && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="my-profile-unlinked">
          This login is not linked to an employee record, so only what the account itself carries is shown below.
          Ask HR to link it from Credentials.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Personal information" icon={UserRound} testid="my-profile-personal">
          <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
            <EmployeeAvatar employee={data} size={64} className="text-2xl" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-800" data-testid="my-profile-name">{data.full_name}</p>
              <p className="truncate text-xs text-slate-500">{data.designation || roleLabel}</p>
              {data.employee_code && (
                <span className="mt-1 inline-block rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700" data-testid="my-profile-code">
                  {data.employee_code}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Email" value={data.email} testid="my-profile-email" />
            <Field label="Phone" value={data.phone} testid="my-profile-phone" />
            <Field label="Date of birth" value={prettyDate(data.dob)} />
            <Field label="Gender" value={titleCase(data.gender)} />
            <Field label="Blood group" value={data.blood_group} />
            <Field label="Marital status" value={titleCase(data.marital_status)} />
            <Field label="Father's name" value={data.father_name} />
            <Field label="Mother's name" value={data.mother_name} />
          </div>
        </Panel>

        <Panel title="Employment details" icon={BriefcaseBusiness} testid="my-profile-employment">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {/* The employee code where there is one, and the login's own short id where
                there is not — the header dialog called that the Employee ID for a year,
                and an account with nobody on the books behind it still has to answer
                "which id am I". */}
            <Field label="Employee ID" value={data.employee_code || account.short_id} testid="my-profile-employee-id" />
            <Field label="Role" value={roleLabel || titleCase(account.role)} testid="my-profile-role" />
            <Field label="Designation" value={data.designation} />
            <Field label="Department" value={data.department} />
            <Field label="Branch" value={account.branch_name} testid="my-profile-branch" />
            <Field label="Works" value={[WORK_TYPES[data.work_type], SERVICES[data.service]].filter(Boolean).join(" · ")} />
            <Field label="Joining date" value={prettyDate(data.joining_date)} testid="my-profile-joining" />
            <Field label="Reporting to" value={data.reporting_to} />
            <Field label="Status" value={titleCase(data.status)} />
            <Field label="Account created" value={prettyDate(String(account.created_at || "").slice(0, 10))} />
            {/* Masked to the last four by the server, so the full number never reaches the
                browser — see _masked in backend/routers/v3_me.py. Enough to confirm which
                document HR has on file, which is what this row is read for. */}
            <Field label="PAN" value={data.pan} />
            <Field label="Aadhaar" value={data.aadhar} />
          </div>
        </Panel>

        <Panel title="Address" icon={Home} testid="my-profile-address">
          <p className="whitespace-pre-line break-words text-sm font-medium text-slate-700" data-testid="my-profile-address-value">
            {data.address || "—"}
          </p>
        </Panel>

        <Panel title="Emergency contact" icon={ShieldAlert} testid="my-profile-emergency">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Contact name" value={data.emergency_contact_name} />
            <Field label="Contact phone" value={data.emergency_contact_phone} />
          </div>
        </Panel>

        <Panel title="Bank details" icon={Banknote} testid="my-profile-bank">
          {hasBank ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Bank name" value={data.bank_name} />
              <Field label="Account number" value={data.bank_account} />
              <Field label="IFSC" value={data.ifsc} />
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nothing on file. HR adds this on your employee record.</p>
          )}
        </Panel>
      </div>

      {/* Where a correction goes. Everything above is HR's to write — a page that shows a
          wrong phone number and says nothing about how to fix it makes the reader hunt for
          somebody to tell. */}
      <p className="text-center text-xs text-slate-400" data-testid="my-profile-footnote">
        These details are held by HR. Anything wrong here is corrected on your employee record — ask HR to update it.
      </p>
    </div>
  );
};

// ---------- the page ----------

export const MyProfilePage = ({ user, roleLabel, onBack }) => {
  const [tab, setTab] = useState("attendance");

  return (
    <div className="space-y-4" data-testid="my-profile-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
            data-testid="my-profile-back"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-emerald-700 sm:text-xl" data-testid="my-profile-greeting">
              Hi, {user?.full_name}
            </h2>
            <p className="truncate text-xs text-slate-500">Your attendance, hours and record — all in one place.</p>
          </div>
        </div>
        <div className="w-full sm:w-72" data-testid="my-profile-tabs-wrap">
          <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} testid="my-profile-tabs" mobileCols={2} />
        </div>
      </div>

      {/* Both tabs stay mounted once opened would mean two months of requests for a screen
          somebody opened to read one thing, so each is mounted only while it is the tab.
          Switching back re-reads, which is right for a page whose whole subject is what
          happened today. */}
      {tab === "attendance" ? <AttendanceTab /> : <ProfileTab roleLabel={roleLabel} />}
    </div>
  );
};

export default MyProfilePage;
