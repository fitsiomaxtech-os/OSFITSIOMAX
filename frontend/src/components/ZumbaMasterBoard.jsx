import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Music, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { listZumba, addZumba, getBranches } from "@/lib/api";

// The three evenings the class runs, in the numbering Date.getDay() uses (0 = Sunday).
// The same three the membership is sold on — see ZUMBA_CLASS_DAYS in PackagesBoard.jsx
// and CLASS_WEEKDAYS in backend/routers/v3_zumba.py, which is the one that counts.
const CLASS_DAYS = [1, 3, 5];
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The source a referral from this board is filed under. The rest of the vocabulary went
// with the Source column: where a lead came from is the branch's question, answered before
// this roll ever saw them, and a master reads a class rather than a pipeline.
const MASTER = "master";

const shortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const EMPTY_REFERRAL = { name: "", phone: "", age: "" };

// The two the class is taught in, in the words the branch stores them by -- kept in step
// with TIME_SLOTS in backend/routers/v3_zumba.py, which drops anything else.
const SESSIONS = [
  { key: "10:00 am - 11:00 am", label: "1st Session", when: "10:00 am - 11:00 am" },
  { key: "11:00 am - 12:00 pm", label: "2nd Session", when: "11:00 am - 12:00 pm" },
];

const CLASSES_PER_MONTH = 12;

/** When the membership runs out: the day they joined, plus a month for every twelve
 *  classes it holds. Nothing stores an end date -- it is the package's length counted
 *  forward, which is the same answer without a second field to keep true.
 *
 *  A short month clamps rather than spilling: joining on the 31st and finishing on the 3rd
 *  of the month after next is arithmetic nobody recognises as their own membership. */
const finishOn = (row) => {
  const classes = Number(row?.package_sessions || 0);
  if (!classes || classes % CLASSES_PER_MONTH !== 0 || !row?.created_at) return "—";
  const start = new Date(row.created_at);
  if (Number.isNaN(start.getTime())) return "—";
  const months = classes / CLASSES_PER_MONTH;
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);
  if (end.getDate() !== start.getDate()) end.setDate(0);
  return shortDate(end.toISOString());
};

/** What the roll below is showing, so the header names the open card rather than
 *  always saying "Customers" over a list that has been narrowed. */
const CARD_TITLES = {
  all: "Customers",
  today: "Today's Session Students",
};

/** One headline figure, and the filter behind it.
 *
 * The caption underneath is where the qualification goes, so the number itself is never
 * asked to carry a footnote. Each card narrows the roll below to the people it counted —
 * a figure you cannot open is a figure you have to take on trust.
 */
const SummaryCard = ({ label, value, caption, tone, active, onClick, testid }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`flex-1 rounded-xl border p-4 text-left transition hover:brightness-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${tone} ${active ? "ring-2 ring-current ring-offset-1" : ""}`}
    data-testid={testid}
  >
    <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</p>
    <p className="mt-1 text-3xl font-extrabold leading-none">{value}</p>
    <p className="mt-1.5 text-[11px] font-medium opacity-70">{caption}</p>
  </button>
);

/**
 * The month, with the class days marked.
 *
 * Read-only on purpose: nothing records who turned up, so a day can honestly say the class
 * runs and how many are booked into it, and nothing more. Every class day carries the same
 * roll because a membership books all three evenings a week — printing a different number
 * per day would be inventing attendance the OS does not have.
 */
const ClassCalendarModal = ({ students, onClose }) => {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const classDaysThisMonth = cells.filter((d) => d && CLASS_DAYS.includes(new Date(year, month, d).getDay())).length;

  const step = (by) => setCursor(new Date(year, month + by, 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="zumba-calendar-modal">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-violet-500 to-fuchsia-600 px-5 py-3 text-white">
          <p className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4" />Class Calendar</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="zumba-calendar-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => step(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Previous month" data-testid="zumba-calendar-prev"><ChevronLeft className="h-4 w-4" /></button>
            <p className="text-sm font-bold text-slate-800" data-testid="zumba-calendar-month">{MONTHS[month]} {year}</p>
            <button onClick={() => step(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Next month" data-testid="zumba-calendar-next"><ChevronRight className="h-4 w-4" /></button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_INITIALS.map((d, i) => (
              <span key={i} className="py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{d}</span>
            ))}
            {cells.map((day, i) => {
              if (!day) return <span key={`pad-${i}`} />;
              const date = new Date(year, month, day);
              const isClass = CLASS_DAYS.includes(date.getDay());
              const isToday = date.toDateString() === today.toDateString();
              return (
                <div
                  key={day}
                  className={`rounded-md py-1.5 text-xs ${isClass ? "bg-violet-50 font-bold text-violet-700" : "text-slate-400"} ${isToday ? "ring-2 ring-violet-500" : ""}`}
                  title={isClass ? `Zumba class — ${students} booked` : "No class"}
                  data-testid={`zumba-calendar-day-${day}`}
                >
                  {day}
                  {isClass && <span className="block text-[9px] font-semibold opacity-70">{students}</span>}
                </div>
              );
            })}
          </div>

          <div className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <p><span className="font-semibold text-slate-700">Mon · Wed · Fri</span> — {classDaysThisMonth} classes this month</p>
            <p><span className="font-semibold text-slate-700">{students}</span> students booked into each class</p>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Refer a customer into the class: name, phone, age, area, and nothing else.
 *
 *  The fee is deliberately absent. A master hands over a person, and the branch is where
 *  the money is taken and recorded -- asking for it here would invite a figure nobody at
 *  this desk can collect, and the Payment card counts what the branch actually banked. The
 *  source is fixed too: this form exists to record the ones a master brought in. */
const ReferCustomerModal = ({ masterName, branchId, branchName, onClose, onSaved }) => {
  const [form, setForm] = useState({ ...EMPTY_REFERRAL });
  const [saving, setSaving] = useState(false);
  // Starts on the master's own branch, which is where a referral goes nine times in ten.
  // Held as an id rather than a name so renaming a branch cannot orphan a registration.
  const [branch, setBranch] = useState(branchId || "");
  const [branches, setBranches] = useState([]);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Fetched rather than passed down: the board only knows the one branch it is reading,
  // and a referral may belong to another. A failed fetch leaves the picker on the master's
  // own branch, which is the answer it would have given anyway.
  useEffect(() => {
    let live = true;
    getBranches()
      .then((rows) => {
        if (!live) return;
        const list = Array.isArray(rows) ? rows : [];
        setBranches(list);
        // Keeps the value and the options honest: a master whose own branch is not in the
        // list would otherwise see the first option selected while the id underneath still
        // pointed somewhere else, and save against a branch they never chose.
        setBranch((cur) => (list.some((b) => b.id === cur) ? cur : (list[0]?.id || cur)));
      })
      .catch(() => { if (live) setBranches([]); });
    return () => { live = false; };
  }, []);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      await addZumba({
        name: form.name.trim(),
        phone: (form.phone || "").trim(),
        age: form.age === "" ? null : Number(form.age),
        source: MASTER,
        // Signed with the master's own name, so the branch's tab reads who referred them
        // rather than an anonymous "Master".
        master_name: masterName || "",
      }, branch || undefined);
      // Says where they went, because they will not appear on the roll below: a referral
      // reaches the branch, and only the branch puts somebody in a class.
      toast.success("Referred to the branch. They join your roll once the branch assigns them to you.");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not refer this customer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="zumba-refer-modal">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-violet-500 to-fuchsia-600 px-5 py-3 text-white">
          <p className="text-base font-semibold">Refer Customer</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="zumba-refer-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Name *</label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Customer name" data-testid="zumba-refer-name" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Phone</label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Mobile number" data-testid="zumba-refer-phone" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Age</label>
              <Input type="number" min="0" value={form.age} onChange={(e) => set("age", e.target.value)} placeholder="—" data-testid="zumba-refer-age" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600" htmlFor="zumba-refer-branch">Branch</label>
            {/* A select rather than a set of pills: there is one branch running Zumba today
                and a row of one pill reads as a decision nobody is being asked to make. */}
            <select
              id="zumba-refer-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-violet-400 focus:outline-none"
              data-testid="zumba-refer-branch"
            >
              {branches.length === 0 && <option value={branchId || ""}>{branchName || "Your branch"}</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.branch_name || b.name || "Branch"}</option>
              ))}
            </select>
          </div>
          <p className="rounded-md bg-violet-50 px-3 py-2 text-[11px] font-medium text-violet-700">
            Referred by <b>{masterName || "you"}</b>. Lands under <b>Refer Master</b> on that branch's Zumba tab, flagged as still needing a fee and a class — the branch fills those in and allocates the master.
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="zumba-refer-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-violet-600 text-white hover:bg-violet-700" data-testid="zumba-refer-submit">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * The Zumba master's board: the class they run, at their own branch.
 *
 * Two rows before anything else — the controls, then the three figures — because the
 * questions asked of this screen in that order are "find me a customer", "who is in
 * tonight's class" and "how much has come in". The roll itself sits underneath, which is
 * what the search box searches.
 *
 * The branch is never passed: the server scopes a Zumba account to the branch it was
 * hired into, exactly as it scopes a Branch Admin.
 */
export const ZumbaMasterBoard = ({ currentUser }) => {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  // Which branch this board is reading, as the server resolved it — an account with no
  // branch of its own falls back to one, and naming it here is how a master can tell.
  const [branch, setBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [card, setCard] = useState("all"); // "all" | "today"
  const [referring, setReferring] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [session, setSession] = useState(""); // "" = both slots, else the time_slot chosen

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listZumba();
      setRows(data.registrations || []);
      setSummary(data.summary || {});
      setBranch(data.branch || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the class roll");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isClassDay = Boolean(summary.is_class_day);
  // How many of today's class are in each slot, counted off the roll rather than asked for
  // separately, so a tab and the list behind it cannot disagree.
  const bookedIn = (slot) => (isClassDay ? rows.filter((r) => r.time_slot === slot).length : 0);

  const visible = useMemo(() => {
    // Today's card is the whole roll on a class day and nobody on any other day, matching
    // what the figure itself counts: a membership books all three evenings, so there is no
    // per-day list to draw — only a class, or no class. What it does split by is the hour,
    // because the two sessions are two rooms of people and a master teaches one at a time.
    let list = rows;
    if (card === "today") {
      list = isClassDay ? rows : [];
      if (session) list = list.filter((r) => r.time_slot === session);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q));
  }, [rows, search, card, isClassDay, session]);

  return (
    <div className="flex flex-col gap-4" data-testid="zumba-master-board">
      {/* Row one — find someone, bring someone in, look at the month. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="zumba-master-toolbar">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name or phone..."
            className="h-10 pl-9"
            data-testid="zumba-master-search"
          />
        </div>
        <Button onClick={() => setReferring(true)} className="h-10 bg-violet-600 text-white hover:bg-violet-700" data-testid="zumba-master-refer">
          <Plus className="mr-1 h-4 w-4" />Refer Customer
        </Button>
        <Button variant="outline" onClick={() => setShowCalendar(true)} className="h-10" data-testid="zumba-master-calendar">
          <CalendarDays className="mr-1 h-4 w-4" />Calendar
        </Button>
        <Button variant="outline" onClick={load} className="h-10 w-10 p-0" title="Refresh" aria-label="Refresh" data-testid="zumba-master-refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Row two — the three figures. Today's is the one that needs its caption: on a day
          the class does not run it reads zero, and without the caption a zero looks like
          an empty class rather than no class. */}
      <div className="flex flex-col gap-3 sm:flex-row" data-testid="zumba-master-summary">
        {/* One way onto this roll: the branch assigned them to you. Referring somebody
            does not, on purpose — a referral says who brought them in, which is a claim on
            the lead, not a seat in your class. */}
        <SummaryCard
          label="All Students"
          value={summary.all ?? 0}
          caption="Assigned to your class by the branch"
          tone="border-violet-200 bg-violet-50 text-violet-900"
          active={card === "all"}
          onClick={() => { setCard("all"); setSession(""); }}
          testid="zumba-card-all"
        />
        <SummaryCard
          label="Today's Session Students"
          value={summary.today_session ?? 0}
          caption={isClassDay ? "Booked into today's class" : "No class today — Mon, Wed, Fri"}
          tone="border-sky-200 bg-sky-50 text-sky-900"
          active={card === "today"}
          onClick={() => setCard("today")}
          testid="zumba-card-today"
        />
      </div>

      {/* Under today's card, and only there: the two slots are how one class day divides,
          not a way to read the whole roll. Each says how many are in it, so choosing is
          done from the numbers rather than by trying one. */}
      {card === "today" && (
        <div className="flex flex-wrap items-center gap-2" data-testid="zumba-master-sessions">
          <button
            type="button"
            onClick={() => setSession("")}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${session === "" ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"}`}
            data-testid="zumba-master-session-all"
          >
            Both sessions
          </button>
          {SESSIONS.map((slot) => (
            <button
              key={slot.key}
              type="button"
              onClick={() => setSession(session === slot.key ? "" : slot.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${session === slot.key ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"}`}
              title={slot.when}
              data-testid={`zumba-master-session-${slot.key.startsWith("10") ? "1" : "2"}`}
            >
              {slot.label}
              <span className={`ml-1.5 font-normal ${session === slot.key ? "text-white/80" : "text-slate-400"}`}>
                {slot.when} · {bookedIn(slot.key)}
              </span>
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
            <Music className="h-4 w-4 text-violet-600" />
            {CARD_TITLES[card] || "Customers"}
            <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500" data-testid="zumba-master-count">{visible.length}</span>
            {branch?.name && (
              <span className="rounded bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700" data-testid="zumba-master-branch">
                {branch.name}
              </span>
            )}
          </div>

          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400" data-testid="zumba-master-empty">
              {rows.length === 0
                ? "Nobody assigned to your class yet. The branch admin assigns students to a master."
                : search.trim()
                  ? "Nobody matches that search."
                  : card === "today"
                    ? "No class today. The class runs Mon, Wed and Fri."
                    : "Nobody here yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {/* What a master needs of a student: who they are, how to reach them,
                      when their membership started and ends, and how much of it they
                      bought. The money is the branch's business and has gone with the
                      source, which said where a lead came from -- a question answered
                      before this roll ever saw them. */}
                  <tr>
                    <th className="w-[5%] px-3 py-2.5">S.No</th>
                    <th className="w-[22%] px-3 py-2.5">Name</th>
                    <th className="w-[15%] px-3 py-2.5">Phone</th>
                    <th className="w-[20%] px-3 py-2.5">Email</th>
                    <th className="w-[13%] px-3 py-2.5">Joined</th>
                    <th className="w-[13%] px-3 py-2.5">Finishes</th>
                    <th className="w-[12%] px-3 py-2.5">Classes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r, i) => (
                    <tr key={r.id} className="align-middle hover:bg-slate-50/60" data-testid={`zumba-master-row-${r.id}`}>
                      <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-slate-800">{r.name || "—"}</p>
                        {/* Which of the two they are in, under the name — on the roll as a
                            whole it is the only place the hour is said at all. */}
                        {r.time_slot ? <p className="text-[11px] text-slate-400">{r.time_slot}</p> : null}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{r.phone || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-600">
                        <span className="block max-w-[16rem] truncate" title={r.email || ""}>{r.email || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">{shortDate(r.created_at)}</td>
                      <td className="px-3 py-2.5 text-slate-500" data-testid={`zumba-master-finish-${r.id}`}>{finishOn(r)}</td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {r.package_sessions ? `${r.package_sessions} classes` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {referring && (
        <ReferCustomerModal
          masterName={currentUser?.full_name || ""}
          branchId={branch?.id || ""}
          branchName={branch?.name || ""}
          onClose={() => setReferring(false)}
          onSaved={load}
        />
      )}
      {showCalendar && <ClassCalendarModal students={summary.all ?? 0} onClose={() => setShowCalendar(false)} />}
    </div>
  );
};
