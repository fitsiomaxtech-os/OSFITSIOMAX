import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Music, Pencil, RefreshCw, Stethoscope, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { toast } from "@/components/ui/sonner";
import { listZumba, listZumbaMasters, addZumba, updateZumba, deleteZumba, setZumbaStatus, acceptZumbaReferral, listStoreItems } from "@/lib/api";

// How a registration arrived, as the branch would say it. A referral is recorded against
// the master who made it rather than against a single "Masters" bucket, so these six are
// the answers that stand on their own; the masters are offered alongside them by name.
//
// Board, Social Media and Personal all count towards Direct: nobody referred them, they
// came to us. The rest name whoever did the referring. The mapping lives on the server,
// which stamps each row with its card so this list and the counts cannot disagree.
const SOURCES = [
  { key: "branch", label: "Branch Admin" },
  { key: "board", label: "Board" },
  { key: "consultations", label: "Consultation" },
  { key: "social_media", label: "Social Media" },
  { key: "personal", label: "Personal Brand (Sumaiya Naaz)" },
  { key: "fitsiomax", label: "Fitsiomax" },
];
const MASTER = "master";

// The two slots the class is taught in. Kept in step with TIME_SLOTS in
// backend/routers/v3_zumba.py, which drops anything it does not recognise.
const TIME_SLOTS = ["10:00 am - 11:00 am", "11:00 am - 12:00 pm"];
// The same four the consultation and store desks offer, in the same slugs, so a class
// fee taken in cash reads as cash wherever the money is counted later. Cheque and Partial
// belong to a treatment plan paid down over months; a membership is settled in one go.
const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "account_transfer", label: "Account Transfer" },
];
// The date row, in the shape DateFilterPopover hands back so the two controls write one
// piece of state. "All" is null rather than an open-ended range: the absence of a filter
// and a filter that happens to match everything read the same on screen but not in the
// code, and null is the one the rest of this panel already understands.
//
// The week runs Monday to Sunday, matching DashboardBoard's row rather than the Sunday
// start used elsewhere -- a class week is the week a branch talks about.
const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const endOfDay = (d) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };
const mondayOf = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

const DATE_PRESETS = [
  { key: "all", label: "All", range: () => null },
  { key: "today", label: "Today", range: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { key: "this_week", label: "This Week", range: () => { const m = mondayOf(new Date()); const e = new Date(m); e.setDate(e.getDate() + 6); return { from: m, to: endOfDay(e) }; } },
  { key: "this_month", label: "This Month", range: () => { const t = new Date(); return { from: startOfDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: endOfDay(new Date(t.getFullYear(), t.getMonth() + 1, 0)) }; } },
];
const presetFilter = (p) => { const r = p.range(); return r ? { key: p.key, label: p.label, ...r } : null; };

/** Whether a stored filter came from one of the pills above rather than the Custom dialog,
 *  which is how the Custom pill knows to stay quiet while a preset is the active one. */
const isPreset = (f) => !f || DATE_PRESETS.some((p) => p.key === f.key);

const PAYMENT_MODE_LABELS = Object.fromEntries(PAYMENT_MODES.map((m) => [m.value, m.label]));

// The modes that leave a trail somewhere else, and what that trail is called. A UPI ID and
// a transaction number are different kinds of thing, so the field asks for the one it
// wants rather than a generic "reference" the desk has to interpret. Cash is absent
// because cash leaves no trail — kept in step with REFERENCE_LABELS in
// backend/routers/v3_zumba.py, which refuses a save that arrives without one.
// The filter row's own list: the four the form offers, plus the rows that took no money
// at all -- which is the answer a desk chasing payments actually wants and is not a mode.
// Labelled "Bank Transfer" to match Accountant Manage and Finance > Approvals, which is
// what this reads as everywhere else it is filtered by.
const MODE_FILTERS = [
  ["", "All Modes"],
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["account_transfer", "Bank Transfer"],
  ["none", "Nothing collected"],
];

const REFERENCE_LABELS = { upi: "UPI ID", card: "Transaction ID", account_transfer: "Transaction ID" };
const REFERENCE_PLACEHOLDERS = { upi: "name@bank", card: "Transaction number", account_transfer: "Transaction number" };

const GENDERS = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
  { key: "other", label: "Other" },
];

// A membership is sold by the month — 12 classes in each. The shelf holds the per-class
// rate, so the price a student is quoted is that rate across the whole plan, rounded back
// to the figure that was typed when the package was priced.
const CLASSES_PER_MONTH = 12;
const planLabel = (item) => {
  const classes = item.sessions_offline || item.sessions_online || 0;
  const months = classes && classes % CLASSES_PER_MONTH === 0 ? classes / CLASSES_PER_MONTH : null;
  return months ? `${months} Month${months > 1 ? "s" : ""}` : item.name;
};
const planTotal = (item) => Math.round(
  (Number(item.price_offline ?? item.price_online) || 0) * (item.sessions_offline || item.sessions_online || 0),
);

/** The one dropdown shape this form uses, so six of them cannot drift into six looks. */
const FormSelect = ({ value, onChange, children, testid }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-10 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
    data-testid={testid}
  >
    {children}
  </select>
);

const FieldLabel = ({ children }) => (
  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</label>
);
const sourceLabel = (r) => (
  r.source === MASTER
    ? "Refer Master"
    : (SOURCES.find((s) => s.key === r.source) || { label: "Personal" }).label
);

/** The referring master's name, for the tooltip. The column says the channel; which master
 *  it was is the detail behind it, and printing it in place of the channel put a person's
 *  name in a column of channels — next to an Assignee column holding another person's
 *  name, where the two read as each other. */
const sourceDetail = (r) => (r.source === MASTER && r.master_name ? `Refer Master · ${r.master_name}` : sourceLabel(r));

// The strip, in the order asked for. Styled like the Human Resource board's stage cards:
// a white card each, the name in its own colour above the count, and the selected one
// picked out by taking that colour into its border and a wash of it behind.
//
// The tinted boxes that used to group these are gone with the style. They were doing the
// work the colours now do, and a group box inside a row of cards that each carry their own
// colour reads as two systems arguing about the same thing.
//
// The colours run warm through the sources and cool through the four that follow, so the
// two halves of the row stay legible without drawing a box around either.
const CARDS = [
  { key: "all", label: "All", color: "#a855f7" },
  { key: "direct", label: "Direct", color: "#f59e0b" },
  { key: "consultant", label: "Consultant", color: "#f97316" },
  // Master is the leads a master brought in — a referral filed against a named master,
  // which is what the Zumba Master View's Refer Customer writes and what this card is
  // asked for. It held the branch-sourced count until that board existed and there was a
  // real master's referral to point it at.
  { key: "masters", label: "Refer Master", color: "#d97706" },
  // The last four are counts of people, like the four before them, but they answer what
  // became of a student rather than where they came from: is the money settled, and are
  // they still turning up. The revenue split that used to sit here said the same thing
  // three times over and answered neither.
  //
  // Payment Done is a settled account, not "has paid something" — a student halfway
  // through a 3,000 rupee membership belongs on Due Payment, which is the card somebody
  // acts on. A row with no fee on it yet is on neither: nothing has been sold.
  { key: "payment_done", label: "Payment Done", color: "#059669" },
  { key: "due_payment", label: "Due Payment", color: "#d97706" },
  // One card, not two: Discontinue and Leave are both "not turning up", and splitting
  // them across the row asked the branch to read two numbers to learn one thing. The
  // distinction survives where it is actually useful — on the row, which says which — and
  // the server still counts them apart, so nothing downstream is coarsened by this.
  { key: "discontinued", label: "Discontinue", color: "#e11d48", sum: ["discontinued", "leave"] },
];

/** Whether this registration's fee is settled. Nothing sold is not settled. */
const isPaidUp = (r) => Number(r?.fee_amount || 0) > 0 && Number(r?.fee_paid || 0) >= Number(r?.fee_amount || 0);
const amountDue = (r) => Number(r?.fee_amount || 0) - Number(r?.fee_paid || 0);

const STATUS_LABELS = { discontinued: "Discontinued", leave: "On leave" };

/** The colour Super Admin gave a stage in CI/CD ROOTS, or a neutral slate for one that
    no longer exists. Read off the pipeline rather than kept here, so a colour changed
    there changes here without a deploy. */
const stageColor = (stages, name) => (stages.find((st) => st.name === name) || {}).color || "#64748b";

/** One labelled line of the detail popup. A blank reads as a dash rather than as nothing,
 *  so a gap in the record is visible instead of invisible. */
// Above ViewRegistrationModal, which reads both. A const is not hoisted, so writing
// them below the modal that prints a fee and a date left them undefined at the line
// that needed them.
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** "06 Aug 2026" off the stored ISO timestamp; a dash rather than "Invalid Date". */
const shortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const DetailRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
    <span className="min-w-0 break-words text-right text-xs font-medium text-slate-700">{value || "—"}</span>
  </div>
);

/**
 * One registration, read rather than edited, and the two things that end it.
 *
 * Discontinue and Leave both ask why before they will save. The counts on the cards are
 * only worth having if they can be read back as reasons -- "six discontinued" is a number,
 * "six discontinued, four of them over the class time" is something a branch can act on.
 *
 * The two are kept apart because they are not the same event: Leave is a student expected
 * back, Discontinue is one who is not. A row already ended offers the way back instead,
 * which needs no reason -- returning to class is the normal state resuming.
 */
const ViewRegistrationModal = ({ row, masterNameOf, onClose, onSaved }) => {
  const [pending, setPending] = useState(null); // "discontinued" | "leave" | null
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const status = row.status || "active";
  const ended = status === "discontinued" || status === "leave";
  // A consultation's referral is not a row of this collection -- it is read live off the
  // lead that owns it. Ending it here would ask the server to change a record it does not
  // hold, so the popup reads it and says where the decision actually lives.
  const ownedElsewhere = row.origin === "consultation";

  const apply = async (next, why) => {
    setSaving(true);
    try {
      await setZumbaStatus(row.id, next, why);
      toast.success(
        next === "discontinued" ? "Marked discontinued"
          : next === "leave" ? "Marked on leave"
            : "Back on the class roll",
      );
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const due = Number(row.fee_amount || 0) - Number(row.fee_paid || 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="zumba-view-dialog">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-900">{row.name || "—"}</h3>
            <p className="text-xs text-slate-500">Registered {shortDate(row.created_at)}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close" data-testid="zumba-view-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {ended && (
          <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${status === "discontinued" ? "bg-rose-50 text-rose-700" : "bg-indigo-50 text-indigo-700"}`} data-testid="zumba-view-status">
            <p className="font-bold">{STATUS_LABELS[status]}</p>
            {row.status_remarks ? <p className="mt-0.5">{row.status_remarks}</p> : null}
            {row.status_by ? <p className="mt-0.5 opacity-70">{row.status_by} · {shortDate(row.status_at)}</p> : null}
          </div>
        )}

        <div className="space-y-0.5">
          <DetailRow label="Phone" value={row.phone} />
          <DetailRow label="Email" value={row.email} />
          <DetailRow label="Age" value={row.age} />
          <DetailRow label="Gender" value={(GENDERS.find((g) => g.key === row.gender) || {}).label} />
          <DetailRow label="Address" value={row.address} />
          <DetailRow label="Source" value={sourceDetail(row)} />
          <DetailRow label="Class" value={masterNameOf(row.assigned_master_id)} />
          <DetailRow label="Time" value={row.time_slot} />
          <DetailRow label="Package" value={row.package_name} />
          <DetailRow label="Stage" value={row.stage} />
          <DetailRow
            label="Fee"
            value={`${rupees(row.fee_paid)} paid${due > 0 ? ` · ${rupees(due)} due` : row.fee_amount ? " · settled" : ""}`}
          />
        </div>

        {/* Asked before it is saved, not after: the reason is the point of recording it. */}
        {pending ? (
          <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Why are they {pending === "discontinued" ? "discontinuing" : "taking leave"}? *
            </label>
            <textarea
              rows={3}
              autoFocus
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={pending === "discontinued" ? "Moved away, too expensive, unhappy with the timing…" : "Travelling for a month, injury, exams…"}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
              data-testid="zumba-status-remarks"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setPending(null); setRemarks(""); }} data-testid="zumba-status-cancel">Cancel</Button>
              <Button
                size="sm"
                className={pending === "discontinued" ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}
                disabled={saving || !remarks.trim()}
                onClick={() => apply(pending, remarks.trim())}
                data-testid="zumba-status-confirm"
              >
                {saving ? "Saving…" : pending === "discontinued" ? "Confirm Discontinue" : "Confirm Leave"}
              </Button>
            </div>
          </div>
        ) : ownedElsewhere ? (
          <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-medium text-sky-700" data-testid="zumba-view-owned-elsewhere">
            Referred on the consultation, which owns this record — discontinuing or ending it is done there, by un-ticking Zumba on the lead.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {ended ? (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => apply("active", "")} data-testid="zumba-status-restore">
                Put back on the roll
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setPending("discontinued")} data-testid="zumba-status-discontinue">
                  Discontinue
                </Button>
                <Button size="sm" variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={() => setPending("leave")} data-testid="zumba-status-leave">
                  Leave
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** The Human Resource board's stage card, in the one other place that wants it.
 *
 * Copied rather than imported: that one is local to HumanResourceBoard.jsx and shaped for
 * a five-across phone row of nine stages, where this row holds seven. Lifting it into
 * components/ui to share would make both boards answer to one file for a look they only
 * happen to agree on today. */
const SummaryCard = ({ label, count, color, active, onClick, testid, readOnly = false }) => (
  <button
    type="button"
    onClick={readOnly ? undefined : onClick}
    // A card with nothing to filter to is still a card, but it must not offer the click:
    // no hover lift, no pointer, and the keyboard skips it rather than landing on a
    // control that does nothing.
    disabled={readOnly}
    tabIndex={readOnly ? -1 : undefined}
    className={`min-w-0 flex-1 rounded-lg border-2 px-1 py-1.5 text-center transition sm:rounded-xl sm:px-2.5 sm:py-2.5 sm:text-left ${
      readOnly ? "cursor-default" : "hover:shadow-sm"
    } ${
      active ? "shadow-sm" : "border-slate-200 bg-white"
    }`}
    style={active ? { borderColor: color, backgroundColor: `${color}14` } : undefined}
    data-testid={testid}
  >
    {/* Wraps rather than truncates on a phone: "Fee's Collected" and "Fee's Collect…" are
        the same width and only one of them can be read. */}
    <span
      className="block break-words text-[9px] font-bold uppercase leading-[1.15] [hyphens:auto] sm:truncate sm:text-xs sm:tracking-wider"
      style={{ color }}
      title={label}
    >
      {label}
    </span>
    {/* Sized for nine across, not the five this card was borrowed from: a rupee figure
        at 3xl set the width of every card in the row and pushed the labels to an
        ellipsis two words early. */}
    <span className="mt-0.5 block text-base font-extrabold leading-tight sm:mt-0.5 sm:text-xl" style={{ color }}>
      {count}
    </span>
  </button>
);

/** The stored timestamp as a plain YYYY-MM-DD, which is what the date inputs compare. */
const dayOf = (iso) => String(iso || "").slice(0, 10);

/**
 * What this registration still needs, named.
 *
 * A referral arrives as half a record: the master hands over a person -- name, phone, age,
 * area -- and the branch owes the rest of it, which is the part that turns a name into a
 * student in a class. These four are that part, and they are the four the row's badge
 * offers to go and fill in.
 *
 * Deliberately not everything that could be blank. Age and email are worth having and not
 * worth chasing, and listing them would put a badge on nearly every row, which says
 * "something is missing here" so often that it stops meaning it.
 *
 * Read as a phrase, so the badge reads "Needs a class time & a package" rather than naming
 * database columns at somebody.
 */
const missingDetails = (row) => {
  const gaps = [];
  if (!(row?.phone || "").trim()) gaps.push("a phone number");
  if (!(row?.assigned_master_id || "").trim()) gaps.push("a master");
  if (!(row?.time_slot || "").trim()) gaps.push("a class time");
  if (!(row?.package_id || "").trim()) gaps.push("a package");
  return gaps;
};

const EMPTY = {
  name: "", email: "", phone: "", age: "", gender: "", address: "",
  source: "personal", master_name: "", assigned_master_id: "", time_slot: "",
  package_id: "", package_name: "", fee_amount: "", fee_paid: "", payment_mode: "", payment_reference: "",
};

/**
 * Zumba registrations for one branch.
 *
 * Deliberately not part of the leads pipeline: a Zumba registration has no stage, no
 * consultation and no discharge, so putting it there would have meant a row sitting in
 * every stage filter while answering none of them. The cards split by source instead,
 * which is what a branch wants to know about a class it is filling.
 */
export const ZumbaPanel = ({ branchId }) => {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState("all");
  const [search, setSearch] = useState("");
  const [needsOnly, setNeedsOnly] = useState(false); // show only the half-filled rows
  const [modeFilter, setModeFilter] = useState(""); // "" = every mode, including none
  // The same shape Branch Leads keeps: { key, label, from, to } with Dates on the ends,
  // or null for no filter. The presets and the typed range both come from the one
  // control, so there is no From/To bar of this tab's own to keep in step with it.
  const [dateFilter, setDateFilter] = useState(null);
  const [form, setForm] = useState(null); // null | { ...fields, id? }
  const [newMaster, setNewMaster] = useState(""); // a master not yet on the list
  // The Zumba accounts at this branch, which is what a student is assigned *to*. Not
  // the same list as `masters` above: that one is names typed onto referrals, and a
  // referral name with no account behind it cannot be given a class.
  const [zumbaMasters, setZumbaMasters] = useState([]);
  // The Zumba shelf as Super Admin priced it — 1, 3 and 6 month memberships. Read rather
  // than hardcoded, so a change of price on the shelf is the change of price here.
  const [packages, setPackages] = useState([]);
  // Which branch these rows belong to, as the server resolved it. Printed rather than
  // assumed: an empty list is either "nobody has registered" or "you are looking at the
  // wrong branch", and those two read identically until the branch is named.
  const [branch, setBranch] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [viewing, setViewing] = useState(null);   // the registration open in the detail popup
  const [accepting, setAccepting] = useState(null); // the referral being taken onto the books
  // The Zumba pipeline exactly as Super Admin has it in CI/CD ROOTS. Nothing is hardcoded
  // here: a clinic that has not set the pipeline up has no stages, and the Stage column
  // and its move control drop out of the table rather than drawing an empty pipeline.
  const [stages, setStages] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listZumba(branchId);
      setRows(data.registrations || []);
      setSummary(data.summary || {});
      setMasters(data.masters || []);
      setStages(data.stages || []);
      setBranch(data.branch || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load Zumba registrations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  // Once, not per open: the shelf does not change while a form is on screen, and fetching
  // it on every Create would put a spinner in front of a list that is nearly always the
  // same three rows.
  useEffect(() => {
    listStoreItems("zumba", "session")
      .then(setPackages)
      .catch(() => setPackages([]));
  }, []);

  // Loaded apart from the registrations: the roster does not change when a row does, and a
  // branch with no Zumba accounts should still get its board rather than an error.
  useEffect(() => {
    let live = true;
    listZumbaMasters(branchId)
      .then((data) => { if (live) setZumbaMasters(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setZumbaMasters([]); });
    return () => { live = false; };
  }, [branchId]);

  // The Stage column belongs to All and nowhere else. Every other card is already an
  // answer about these rows — where they came from, whether they have paid, whether they
  // still come — and a stage beside that answer is a second axis nobody asked for on a
  // list that has just been narrowed to one.
  //
  // On All it reads rather than edits: the column says where each student stands, and
  // moving them is a decision made on the record, not from a dropdown in a table where
  // the wrong row is one mis-click away.
  const showStage = stages.length > 0 && card === "all";

  const visible = useMemo(() => {
    let list = rows;
    // A student who has discontinued is off the roll, so they appear on their own card and
    // nowhere else: not in All, not under the source that brought them in, and not among
    // who owes money. Applied before the card filters rather than inside each one, so
    // there is a single place that decides who is still on the list.
    //
    // Leave is not the same and stays: they are expected back, and the counts that describe
    // the roll should still include them. The server's summary draws the same line, so the
    // number on a card and the rows behind it cannot disagree.
    if (card !== "discontinued") list = list.filter((r) => (r.status || "active") !== "discontinued");
    // Four of the cards are not sources, so each says which rows it stands for. Where a
    // student came from and what became of them are different questions, and only the
    // first is the `card` the server stamps on the row.
    if (card === "payment_done") list = list.filter(isPaidUp);
    else if (card === "due_payment") list = list.filter((r) => amountDue(r) > 0);
    else if (card === "discontinued") list = list.filter((r) => (r.status || "active") !== "active");
    else if (card !== "all") list = list.filter((r) => r.card === card);
    if (dateFilter) {
      // Compared as timestamps rather than as day strings: the picker hands back Dates
      // whose ends are the start and the end of a day, so a single day is a range like
      // any other and needs no special case.
      const fromTs = dateFilter.from?.getTime();
      const toTs = dateFilter.to?.getTime();
      list = list.filter((r) => {
        const ts = new Date(`${dayOf(r.created_at)}T00:00:00`).getTime();
        if (!ts) return false;
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
        return true;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q));
    }
    if (needsOnly) list = list.filter((r) => missingDetails(r).length > 0);
    // "unpaid" is its own answer rather than an absent one: a desk chasing money wants
    // the rows that took none, and those have no mode to select by.
    if (modeFilter === "none") list = list.filter((r) => !r.payment_mode);
    else if (modeFilter) list = list.filter((r) => r.payment_mode === modeFilter);
    return list;
  }, [rows, card, search, dateFilter, needsOnly, modeFilter]);

  // Counted off every row, not the filtered ones: the point of the badge is to say
  // there is work waiting even while a card or a date range is hiding it.
  // Counted over the roll, not over everybody: a discontinued student missing a phone
  // number is not work waiting, and chasing them is exactly what the badge would be asking
  // somebody to do.
  const needsCount = useMemo(
    () => rows.filter((r) => (r.status || "active") !== "discontinued" && missingDetails(r).length > 0).length,
    [rows],
  );

  // Every master offered in the picker: the ones already referred from, plus one being
  // typed in now, so a new name is selectable the moment it exists.
  /**
   * Who can be named as the master who referred somebody.
   *
   * Three sources, in the order they matter. The Zumba accounts at this branch come first
   * and are the answer nearly every time — a master with a login is a master the branch
   * employs, and having to type their name while their account sits in the Assign To box
   * below was the gap here. Then the names already typed onto earlier referrals, so a
   * master with no account keeps working once introduced. Then whatever this row already
   * says, so editing an old referral never silently blanks its master.
   *
   * Deduped on the name case-folded, since the same person reached from two of those
   * sources is one option, not two that save the same string.
   */
  const masterOptions = useMemo(() => {
    const seen = new Map();
    const add = (name) => {
      const label = (name || "").trim();
      const key = label.toLowerCase();
      if (label && !seen.has(key)) seen.set(key, label);
    };
    zumbaMasters.forEach((m) => add(m.name));
    masters.forEach(add);
    if (form?.source === MASTER) add(form.master_name);
    return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [zumbaMasters, masters, form]);

  const openForm = (row) => {
    setNewMaster("");
    setForm(row ? { ...EMPTY, ...row, age: row.age ?? "" } : { ...EMPTY });
  };

  /**
   * Take a CONSULTANT's referral onto the branch's books, then edit it.
   *
   * Until this runs the row is the lead, read live, with nothing to assign a master to or
   * collect a fee against. One click does the taking over and opens the form on what it
   * made, because nobody asks for a referral to be "accepted" as an end in itself -- they
   * ask because they are about to fill something in.
   */
  const acceptAndEdit = async (row) => {
    if (accepting) return;
    setAccepting(row.id);
    try {
      const created = await acceptZumbaReferral(row.lead_id);
      await load();
      openForm(created);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not take this referral on");
    } finally {
      setAccepting(null);
    }
  };

  const save = async () => {
    if (!form?.name?.trim()) { toast.error("Name is required"); return; }
    // Belt to the server's braces: a lead-backed row has no registration to write to, and
    // saying so here costs one comparison rather than a round trip that can only fail.
    if (String(form.id || "").startsWith("lead:")) {
      toast.error("Referred on the consultation — change it there, not here");
      return;
    }
    const wantsReference = Number(form.fee_paid) > 0 && REFERENCE_LABELS[form.payment_mode];
    if (wantsReference && !(form.payment_reference || "").trim()) {
      toast.error(`Enter the ${wantsReference}`);
      return;
    }
    if (form.source === MASTER && !(form.master_name || "").trim()) { toast.error("Which master referred them?"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: (form.phone || "").trim(),
        age: form.age === "" || form.age == null ? null : Number(form.age),
        email: (form.email || "").trim(),
        gender: form.gender || "",
        address: (form.address || "").trim(),
        time_slot: form.time_slot || "",
        package_id: form.package_id || "",
        package_name: form.package_name || "",
        source: form.source || "personal",
        master_name: (form.master_name || "").trim(),
        assigned_master_id: form.assigned_master_id || "",
        fee_amount: Number(form.fee_amount || 0),
        fee_paid: Number(form.fee_paid || 0),
        payment_mode: form.payment_mode || "",
        payment_reference: (form.payment_reference || "").trim(),
      };
      if (form.id) await updateZumba(form.id, payload);
      else await addZumba(payload, branchId);
      toast.success(form.id ? "Registration updated" : "Registration added");
      setForm(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const target = removing;
    setRemoving(null);
    try {
      await deleteZumba(target.id);
      toast.success("Registration removed");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove");
    }
  };


  return (
    <div className="flex flex-col gap-4" data-testid="branch-zumba-panel">
      {/* One row, always. The cards share the width evenly and never wrap: nine of them
          breaking as 7 + 2 read as two unrelated strips, and the second one looked like a
          separate thing rather than the tail of the first.

          No minimum width and no scroller: nine cards divide whatever width there is, so
          the row ends exactly where the page does. What gives instead is the label, which
          truncates and carries the full text on `title`. */}
      <div
        className="flex flex-nowrap gap-1.5 sm:gap-2"
        data-testid="zumba-summary"
      >
        {CARDS.map((c) => (
          <SummaryCard
            key={c.key}
            label={c.label}
            count={(c.sum || [c.key]).reduce((n, k) => n + (Number(summary?.[k]) || 0), 0)}
            color={c.color}
            active={card === c.key}
            onClick={() => setCard(c.key === "all" ? "all" : (card === c.key ? "all" : c.key))}
            testid={`zumba-card-${c.key}`}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Music className="h-4 w-4 text-sky-600" />
              Zumba Registrations
              {branch?.name && (
                <span className="rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700" data-testid="zumba-branch-name">
                  {branch.name}
                </span>
              )}

              <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500">{visible.length}</span>
              {/* Only ever drawn when there is something to draw it for, so an empty queue
                  leaves the header alone rather than reporting nothing to do. */}
              {needsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setNeedsOnly((v) => !v)}
                  aria-pressed={needsOnly}
                  className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${needsOnly ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"}`}
                  title={needsOnly ? "Show every registration" : "Show only the ones still to fill in"}
                  data-testid="zumba-needs-details"
                >
                  {needsCount} to fill in
                </button>
              )}
            </div>
            {/* The collected total used to be printed here because the card beside it had
                room for a count only. The card carries the figure itself now, so repeating
                it on the list header would state the same number twice. */}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or phone"
                className="h-8 w-44 text-xs"
                data-testid="zumba-search"
              />
              {/* Grey, because it changes nothing — it re-reads what is already on screen.
                  The blue is spent on the one button that creates something.

                  Icon only, and square like the date toggle beside it: the glyph says
                  refresh on its own, and the word was the widest thing in a row that has
                  a search field to fit. The label lives on title/aria-label, so a hover
                  still says what it does and a screen reader still announces it. */}
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 border-slate-200 bg-slate-100 p-0 text-slate-600 hover:bg-slate-200 hover:text-slate-700"
                onClick={load}
                title="Refresh"
                aria-label="Refresh"
                data-testid="zumba-refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button
                size="sm"
                className="h-8 w-8 bg-sky-600 p-0 text-white hover:bg-sky-700"
                onClick={() => openForm(null)}
                title="Zumba Lead Create"
                aria-label="Zumba Lead Create"
                data-testid="zumba-add"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* One line, two groups: when the dates are asked on the left and the payment
              mode on the right, the space between them is what says they are separate
              questions. Pills rather than dropdowns, because every option is then a click
              away and the row says what is currently on, where a closed select says only
              its own label. On a window too narrow for both, the modes take their own line
              rather than the two interleaving. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-100 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5" data-testid="zumba-date-filter">
              {DATE_PRESETS.map((preset) => {
                const active = preset.key === "all" ? !dateFilter : dateFilter?.key === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => setDateFilter(presetFilter(preset))}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-sky-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    data-testid={`zumba-date-${preset.key}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              {/* The trigger is a Button this component does not own, so its size and text
                  are pinned from out here rather than by adding props to a control five
                  other boards share. Handed null while a preset is active, so it reads
                  "Custom" rather than echoing the pill already lit beside it. */}
              <span className="[&_button]:h-[30px] [&_button]:rounded-md [&_button]:px-3 [&_button]:text-xs [&_button]:font-semibold [&_svg]:mr-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5">
                <DateFilterPopover
                  value={isPreset(dateFilter) ? null : dateFilter}
                  onChange={setDateFilter}
                  centered
                  placeholder="Custom"
                  testid="zumba-date-custom"
                />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="zumba-mode-filter">
              {MODE_FILTERS.map(([key, label]) => (
                <button
                  key={key || "all"}
                  type="button"
                  onClick={() => setModeFilter(key)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                    modeFilter === key
                      ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                  }`}
                  data-testid={`zumba-mode-${key || "all"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">
              {rows.length > 0
                ? "Nothing under this filter."
                : branch?.name
                  ? `No Zumba registrations at ${branch.name} yet. A registration is filed against the branch it was taken at — a master's referral lands on the branch their own account belongs to.`
                  : branch
                    ? "This account has no branch assigned, so there is no Zumba list to read. Assign one in HR Admin → Roles & Credentials."
                    : "No Zumba registrations yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[68rem] text-left text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="w-[4%] px-3 py-2.5">S.No</th>
                    <th className="w-[14%] px-3 py-2.5">Name</th>
                    <th className="w-[9%] px-3 py-2.5">Phone</th>
                    <th className="w-[4%] px-3 py-2.5">Age</th>
                    <th className="w-[9%] px-3 py-2.5">Source</th>
                    <th className="w-[10%] px-3 py-2.5">Package</th>
                    <th className="w-[10%] px-3 py-2.5">Assignee</th>
                    {showStage && <th className="w-[8%] px-3 py-2.5">Stage</th>}
                    <th className="w-[8%] px-3 py-2.5">Fee</th>
                    <th className="w-[10%] px-3 py-2.5">Mode of Payment</th>
                    <th className="w-[7%] px-3 py-2.5">Registered</th>
                    <th className="w-[7%] px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r, i) => {
                    const paid = Number(r.fee_paid || 0);
                    const due = Number(r.fee_amount || 0) - paid;
                    // Tinted rather than badged alone: a row that needs work should be
                    // findable while scrolling past it, not only once it is read.
                    const gaps = missingDetails(r);
                    return (
                      <tr
                        key={r.id}
                        className={`align-middle ${gaps.length > 0 ? "bg-amber-50/50 hover:bg-amber-50" : "hover:bg-slate-50/60"}`}
                        data-testid={`zumba-row-${r.id}`}
                      >
                        <td className="px-3 py-3 text-xs text-slate-400">{i + 1}</td>
                        <td className="px-3 py-3">
                          <p className="truncate font-semibold text-slate-800" title={r.name}>{r.name || "—"}</p>
                          {r.address ? <p className="truncate text-[11px] text-slate-500" title={r.address}>{r.address}</p> : null}
                          {/* Names what is missing rather than saying "incomplete": the
                              branch admin opens this row to do one specific thing, and the
                              badge may as well say which. */}
                          {gaps.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => (r.origin === "consultation" ? acceptAndEdit(r) : openForm(r))}
                              className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-300 transition hover:bg-amber-200"
                              title={r.origin === "consultation"
                                ? `Take this referral onto the branch's books and fill in the ${gaps.join(" and ")}`
                                : `Open this registration and fill in the ${gaps.join(" and ")}`}
                              data-testid={`zumba-row-needs-${r.id}`}
                            >
                              Needs {gaps.join(" & ")}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">{r.phone || "—"}</td>
                        <td className="px-3 py-3 text-xs text-slate-600">{r.age || "—"}</td>
                        <td className="px-3 py-3">
                          {/* A referral prints the master's name, because "Master" on its
                              own is the half of the answer nobody asks for. */}
                          <span className={`inline-block max-w-full truncate rounded px-2 py-0.5 text-[10px] font-semibold ${r.source === MASTER ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`} title={sourceDetail(r)}>
                            {sourceLabel(r)}
                          </span>
                        </td>
                        {/* What they bought, in a column of its own. It used to sit under
                            the source, where a membership and a lead channel read as one
                            fact about the student rather than two. */}
                        <td className="px-3 py-3">
                          {r.package_name ? (
                            <p className="truncate text-xs text-slate-600" title={r.package_name}>
                              {r.package_name}
                              {r.package_sessions ? <span className="block text-[10px] text-slate-400">{r.package_sessions} classes</span> : null}
                            </p>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        {/* Whose class they turn up to, which is not who brought them in.
                            Only what is set here reaches a master's own board. */}
                        <td className="px-3 py-3">
                          {r.assigned_master_name ? (
                            <span className="inline-block max-w-full truncate rounded bg-pink-50 px-2 py-0.5 text-[10px] font-semibold text-pink-700" title={r.assigned_master_name}>
                              {r.assigned_master_name}
                            </span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        {showStage && (
                          <td className="px-3 py-3">
                            <span
                              className="inline-block max-w-full truncate rounded px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: `${stageColor(stages, r.stage)}18`, color: stageColor(stages, r.stage) }}
                              title={r.stage || "—"}
                              data-testid={`zumba-stage-${r.id}`}
                            >
                              {r.stage || "—"}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-3 text-xs">
                          <span className={paid > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}>{rupees(paid)}</span>
                          {/* Shown only when something is actually outstanding — a fully
                              paid row saying "0 due" is noise on every line. */}
                          {due > 0 ? <span className="ml-1 text-[10px] text-amber-600">{rupees(due)} due</span> : null}
                        </td>
                        {/* Beside the figure it describes rather than under it, so a column
                            of modes can be read down. The reference sits below the mode:
                            it is what a disputed payment is traced by, not a second mode. */}
                        <td className="px-3 py-3">
                          {r.payment_mode ? (
                            <>
                              <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                {PAYMENT_MODE_LABELS[r.payment_mode] || r.payment_mode}
                              </span>
                              {r.payment_reference ? (
                                <p className="mt-0.5 truncate text-[10px] text-slate-400" title={r.payment_reference}>{r.payment_reference}</p>
                              ) : null}
                            </>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500">{shortDate(r.created_at)}</td>
                        <td className="px-3 py-3 text-right">
                          {/* A referral is a decision recorded on the consultation, read
                              live from the lead rather than copied here. Editing or
                              deleting it would only put this tab out of step with the
                              consultation that owns it — un-ticking Zumba there takes the
                              row out on its own. */}
                          {r.origin === "consultation" ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setViewing(r)} title="View" aria-label="View" data-testid={`zumba-view-${r.id}`}>
                                <Eye className="h-3 w-3" />
                              </Button>
                              {/* Says where it came from and offers the one thing to do
                                  with it: a referral the branch has not taken on yet. */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 border-sky-200 px-2 text-[10px] font-semibold text-sky-700 hover:bg-sky-50"
                                disabled={accepting === r.id}
                                onClick={() => acceptAndEdit(r)}
                                title="Referred on the consultation — take it onto the branch's books to assign a master, set a time and collect the fee"
                                data-testid={`zumba-accept-${r.id}`}
                              >
                                <Stethoscope className="h-3 w-3" />
                                {accepting === r.id ? "Taking on…" : "Referred"}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setViewing(r)} title="View" aria-label="View" data-testid={`zumba-view-${r.id}`}>
                                <Eye className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => openForm(r)} title="Edit" aria-label="Edit" data-testid={`zumba-edit-${r.id}`}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 w-7 border-rose-200 p-0 text-rose-700 hover:bg-rose-50" onClick={() => setRemoving(r)} title="Delete" aria-label="Delete" data-testid={`zumba-delete-${r.id}`}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {form && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="zumba-dialog">
          <div className="max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">{form.id ? "Edit Zumba Lead" : "Zumba Lead Create"}</h3>

            {/* Two columns, and the split is the question each answers: who the person is
                on the left, what the branch is doing with them on the right. On a phone
                they stack in that same order, which is the order they are asked in. */}
            <div className="grid gap-5 md:grid-cols-2">

              {/* ---------------------------------------------------- who they are */}
              <div className="space-y-3">
                <p className="border-b border-slate-100 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Basic Details</p>
                <div className="space-y-2">
                  <FieldLabel>Name *</FieldLabel>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" data-testid="zumba-field-name" />
                </div>
                <div className="space-y-2">
                  <FieldLabel>Email</FieldLabel>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" data-testid="zumba-field-email" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-2">
                    <FieldLabel>Phone Number</FieldLabel>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit number" data-testid="zumba-field-phone" />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Age</FieldLabel>
                    <Input type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="—" data-testid="zumba-field-age" />
                  </div>
                </div>
                <div className="space-y-2">
                  <FieldLabel>Gender</FieldLabel>
                  <FormSelect value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} testid="zumba-field-gender">
                    <option value="">Not stated</option>
                    {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </FormSelect>
                </div>
                <div className="space-y-2">
                  <FieldLabel>Address</FieldLabel>
                  <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Where they are coming from" data-testid="zumba-field-address" />
                </div>
              </div>

              {/* -------------------------------------------- what the branch does */}
              <div className="space-y-3">
                <p className="border-b border-slate-100 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Lead &amp; Class</p>

                <div className="space-y-2">
                  <FieldLabel>Source of the Lead</FieldLabel>
                  <FormSelect
                    value={form.source}
                    onChange={(v) => setForm({ ...form, source: v, master_name: v === MASTER ? form.master_name : "" })}
                    testid="zumba-field-source"
                  >
                    {SOURCES.map((src) => <option key={src.key} value={src.key}>{src.label}</option>)}
                    <option value={MASTER}>Zumba Master</option>
                  </FormSelect>
                  {/* Which master, asked only once the source says a master referred them.
                      The roster is the names already referred from, so the first referral
                      by a master has to introduce them. */}
                  {form.source === MASTER && (
                    <div className="space-y-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-2.5">
                      <FieldLabel>Which master referred them?</FieldLabel>
                      <FormSelect
                        value={form.master_name}
                        onChange={(v) => setForm({ ...form, master_name: v })}
                        testid="zumba-field-master-name"
                      >
                        <option value="">Select a master…</option>
                        {masterOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                      </FormSelect>
                      <div className="flex items-center gap-2">
                        <Input
                          value={newMaster}
                          onChange={(e) => setNewMaster(e.target.value)}
                          placeholder="New master's name"
                          className="h-8 text-xs"
                          data-testid="zumba-field-new-master"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50"
                          disabled={!newMaster.trim()}
                          onClick={() => { setForm({ ...form, source: MASTER, master_name: newMaster.trim() }); setNewMaster(""); }}
                          data-testid="zumba-field-add-master"
                        >
                          Add Master
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Its own field rather than a second use of Source: Source is how this
                    student arrived, this is whose class they are in. Only what is set here
                    reaches a master's board — referring somebody does not put them on your
                    own roll, which is the point of keeping the two apart. */}
                <div className="space-y-2">
                  <FieldLabel>Assign To</FieldLabel>
                  {zumbaMasters.length === 0 ? (
                    <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500" data-testid="zumba-field-assign-empty">
                      No Zumba accounts at this branch yet. Add one in HR Admin to assign students to a class.
                    </p>
                  ) : (
                    <FormSelect
                      value={form.assigned_master_id}
                      onChange={(v) => setForm({ ...form, assigned_master_id: v })}
                      testid="zumba-field-assign"
                    >
                      <option value="">Unassigned</option>
                      {zumbaMasters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </FormSelect>
                  )}
                </div>

                <div className="space-y-2">
                  <FieldLabel>Time</FieldLabel>
                  <FormSelect value={form.time_slot} onChange={(v) => setForm({ ...form, time_slot: v })} testid="zumba-field-time">
                    <option value="">Not set</option>
                    {TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </FormSelect>
                </div>

                {/* The shelf, priced. Picking a membership fills the amount owed, which is
                    what the plan costs; what has actually been handed over stays a separate
                    number, because the two are only equal once the student has paid. */}
                <div className="space-y-2">
                  <FieldLabel>Fee</FieldLabel>
                  {packages.length === 0 ? (
                    <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500" data-testid="zumba-field-package-empty">
                      No Zumba memberships on the shelf yet. Add them in Services and Products → Zumba Class.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5" data-testid="zumba-field-packages">
                      {packages.map((item) => {
                        const on = form.package_id === item.id;
                        const total = planTotal(item);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setForm(on
                              ? { ...form, package_id: "", package_name: "", fee_amount: "" }
                              : { ...form, package_id: item.id, package_name: item.name, fee_amount: total })}
                            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${on ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                            title={item.name}
                            data-testid={`zumba-field-package-${item.id}`}
                          >
                            {planLabel(item)} · {rupees(total)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-2">
                      <FieldLabel>Fee Collected</FieldLabel>
                      <Input type="number" value={form.fee_paid} onChange={(e) => setForm({ ...form, fee_paid: e.target.value })} placeholder="0" data-testid="zumba-field-paid" />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Fee Amount</FieldLabel>
                      <Input type="number" value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value, package_id: "", package_name: "" })} placeholder="0" data-testid="zumba-field-amount" />
                    </div>
                  </div>
                  {/* Under the amount rather than beside it, because it is a fact about the
                      money above and not a third figure. Tied to it too: with nothing
                      collected there is no mode to record, and the server clears one sent
                      anyway rather than let a row claim cash was taken from a student who
                      has paid nothing. */}
                  <div className="space-y-2 pt-1">
                    <FieldLabel>Mode of Payment</FieldLabel>
                    <FormSelect
                      value={form.payment_mode}
                      onChange={(v) => setForm({ ...form, payment_mode: v })}
                      testid="zumba-field-payment-mode"
                    >
                      <option value="">Not stated</option>
                      {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </FormSelect>
                    {!(Number(form.fee_paid) > 0) && (
                      <p className="text-[11px] text-slate-400">Recorded once a fee has been collected.</p>
                    )}
                    {/* Asked only by the modes that leave a trail elsewhere, and named for
                        the one they leave: cash is settled by being handed over, so there
                        is nothing to write down and nothing is asked. */}
                    {REFERENCE_LABELS[form.payment_mode] && (
                      <div className="space-y-2 pt-1">
                        <FieldLabel>{REFERENCE_LABELS[form.payment_mode]}</FieldLabel>
                        <Input
                          value={form.payment_reference}
                          onChange={(e) => setForm({ ...form, payment_reference: e.target.value })}
                          placeholder={REFERENCE_PLACEHOLDERS[form.payment_mode]}
                          data-testid="zumba-field-payment-reference"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setForm(null)} data-testid="zumba-cancel">Cancel</Button>
              <Button size="sm" className="bg-sky-600 hover:bg-sky-700" disabled={saving} onClick={save} data-testid="zumba-save">
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <ViewRegistrationModal
          row={viewing}
          masterNameOf={(id) => (zumbaMasters.find((m) => m.id === id) || {}).name || ""}
          onClose={() => setViewing(null)}
          onSaved={load}
        />
      )}

      {removing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="zumba-delete-dialog">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Remove this registration?</h3>
                <p className="mt-1 text-xs text-slate-500">
                  <b className="text-slate-700">{removing.name}</b> comes off the Zumba list and out of the counts above. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setRemoving(null)} data-testid="zumba-delete-cancel">Cancel</Button>
              <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={remove} data-testid="zumba-delete-confirm">Yes, Remove</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZumbaPanel;
