import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Music, Pencil, Plus, RefreshCw, Stethoscope, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { toast } from "@/components/ui/sonner";
import { listZumba, listZumbaMasters, addZumba, updateZumba, deleteZumba, setZumbaStatus, acceptZumbaReferral, renewZumba, collectZumba, listStoreItems } from "@/lib/api";

// How a registration arrived, as the branch would say it. A referral is recorded against
// the master who made it rather than against a single "Masters" bucket, so these six are
// the answers that stand on their own; the masters are offered alongside them by name.
//
// Everything but Consultation and Zumba Master counts towards Direct: nobody referred
// them, they came to us. Those two name whoever did the refer, and land on Consultant and
// Refer Master. The mapping lives on the server, which stamps each row with its card so
// this list and the counts cannot disagree.
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

const PAYMENT_MODE_LABELS = { ...Object.fromEntries(PAYMENT_MODES.map((m) => [m.value, m.label])), split: "Split" };

// The modes that leave a trail somewhere else, and what that trail is called. A UPI ID and
// a transaction number are different kinds of thing, so the field asks for the one it
// wants rather than a generic "reference" the desk has to interpret. Cash is absent
// because cash leaves no trail — kept in step with REFERENCE_LABELS in
// backend/routers/v3_zumba.py, which refuses a save that arrives without one.
// The three a Zumba fee is taken by at the desk, and All Modes over them.
//
// Account Transfer is still a mode -- the form offers it and the Fee column names it -- it
// just has no pill here, because a class fee handed over at the counter is cash, UPI or a
// card and filtering by the fourth found nothing. "Nothing collected" went the same way:
// Due Payment above already answers who has not paid, and better, since it knows what is
// owed rather than only that nothing came in.
const MODE_FILTERS = [
  ["", "All Modes"],
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["account_transfer", "Bank Transfer"],
  // A payment that arrived more than one way is its own answer, not a missing one — and
  // without a pill it was the one kind of row the filter row could not find.
  ["split", "Split"],
];

const REFERENCE_LABELS = { upi: "UPI ID", card: "Transaction ID", account_transfer: "Transaction ID" };
const REFERENCE_PLACEHOLDERS = { upi: "name@bank", card: "Transaction number", account_transfer: "Transaction number" };

// The notes a class fee is actually handed over in, largest first — the order a drawer is
// emptied in. Kept in step with DENOMINATIONS in backend/routers/v3_zumba.py, which drops
// a count in anything else. Shorter than the Fitness desk's list on purpose: the 2000 is
// out of circulation, and nobody counts a 3,000 rupee membership out in fives.
const DENOMINATIONS = [500, 200, 100, 50];

const EMPTY_LINE = { mode: "cash", amount: "", reference: "", notes: {} };

/** When a term starting on `from` and running `classes` long would finish, as YYYY-MM-DD.
 *
 * A preview only. The server works this out for every row that has been saved and sends it
 * back as finish_on, which is what every column reads; this exists so the form can answer
 * the question before there is a row to ask it about. Kept to the same rule — a month per
 * twelve classes, clamping rather than spilling on a short month — so the preview and the
 * saved answer agree.
 */
const finishPreview = (from, classes) => {
  const total = Number(classes) || 0;
  if (!from || !total || total % CLASSES_PER_MONTH !== 0) return "";
  const start = new Date(`${from}T00:00:00`);
  if (Number.isNaN(start.getTime())) return "";
  const end = new Date(start);
  end.setMonth(end.getMonth() + total / CLASSES_PER_MONTH);
  if (end.getDate() !== start.getDate()) end.setDate(0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
};

/** What one payment line comes to.
 *
 * Counted notes settle it rather than sitting beside it: two numbers that can disagree is
 * one number nobody trusts, and the count is the one somebody actually looked at.
 */
const noteTotal = (l) => DENOMINATIONS.reduce((sum, d) => sum + d * (Number(l?.notes?.[d]) || 0), 0);
const lineTotal = (l) => (l?.mode === "cash" && noteTotal(l) > 0 ? noteTotal(l) : Number(l?.amount) || 0);
const linesTotal = (lines) => (lines || []).reduce((sum, l) => sum + lineTotal(l), 0);

/** A stored row's payment, back in the shape the form edits.
 *
 * A row saved before payments were lines has a mode and a figure and no lines at all;
 * rebuilding one from them means editing such a row shows what was taken rather than an
 * empty payment the save would then overwrite with nothing.
 */
const linesOf = (row) => {
  if (Array.isArray(row?.payment_lines) && row.payment_lines.length > 0) {
    return row.payment_lines.map((l) => ({
      mode: l.mode || "cash",
      amount: String(l.amount ?? ""),
      reference: l.reference || "",
      // Only carried when every note counted is one this desk still offers. A line counted
      // in a note since dropped would otherwise re-total to less than was handed over, and
      // saving the row again would quietly reduce what the student has paid. Keeping the
      // figure and losing the breakdown is the honest half to keep.
      notes: Object.keys(l.denominations || {}).every((d) => DENOMINATIONS.includes(Number(d)))
        ? Object.fromEntries(Object.entries(l.denominations || {}).map(([d, n]) => [Number(d), String(n)]))
        : {},
    }));
  }
  if (Number(row?.fee_paid) > 0) {
    return [{ mode: row.payment_mode && row.payment_mode !== "split" ? row.payment_mode : "cash", amount: String(row.fee_paid), reference: row.payment_reference || "", notes: {} }];
  }
  return [];
};

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

/**
 * Money against a balance already owed.
 *
 * Separate from the edit form on purpose: editing a registration is changing what it says,
 * while this is recording something that happened at the counter. A desk taking the second
 * half of a fee should not have to open a form full of the student's age and gender to do
 * it, and should not be able to change those by accident on the way past.
 *
 * Refuses more than is outstanding, and says so before the round trip. Taking more than
 * the balance means one of the two figures is wrong, and quietly keeping the difference
 * hides which.
 */
const CollectDueModal = ({ row, onClose, onCollected }) => {
  const outstanding = Math.max(0, Number(row.fee_amount || 0) - Number(row.fee_paid || 0));
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  const taking = linesTotal(lines);
  const over = taking > outstanding;
  const remaining = Math.max(0, outstanding - taking);

  const submit = async () => {
    if (taking <= 0) { toast.error("Enter an amount to collect"); return; }
    if (over) { toast.error(`That is ${rupees(taking)} against ${rupees(outstanding)} outstanding`); return; }
    const missingRef = lineMissingReference(lines);
    if (missingRef) { toast.error(`Enter the ${REFERENCE_LABELS[missingRef.mode]}`); return; }
    setSaving(true);
    try {
      const res = await collectZumba(row.id, paymentPayload(lines));
      // The server's own sentence, so what the branch reads back is what was recorded.
      toast.success(res?.message || "Payment collected");
      onCollected();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not collect");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" data-testid="zumba-collect-dialog">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Collect from {row.name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.package_name ? `${row.package_name} · ` : ""}
              Fee {rupees(row.fee_amount)} · Collected {rupees(row.fee_paid)} ·{" "}
              <b className="text-rose-600">{rupees(outstanding)} due</b>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            title="Close"
            aria-label="Close"
            data-testid="zumba-collect-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <PaymentLinesEditor
            lines={lines}
            onChange={setLines}
            prefix="zumba-collect"
            emptyNote="Add how the money arrived."
          />

          <div className={`rounded-lg border p-3 ${over ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-600">Collecting now</span>
              <span className={`text-lg font-extrabold ${over ? "text-rose-700" : "text-emerald-700"}`} data-testid="zumba-collect-total">
                {rupees(taking)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-600" data-testid="zumba-collect-summary">
              {over
                ? `That is more than the ${rupees(outstanding)} outstanding.`
                : remaining > 0
                  ? `${rupees(remaining)} will still be due after this.`
                  : taking > 0 ? "This clears the balance." : "Nothing entered yet."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="zumba-collect-cancel">Cancel</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={saving || over || taking <= 0} onClick={submit} data-testid="zumba-collect-save">
            {saving ? "Saving…" : "Collect"}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Another term on a membership that is nearly up.
 *
 * Asks the two things a renewal is: which plan they are going back on, and what they have
 * handed over for it. Everything else about the student is already known and is not asked
 * again — a renewal is not a second registration.
 *
 * When the new term starts is the server's to decide, not this dialog's: it runs on from
 * the end of the current one, so a member renewing early keeps the days they paid for.
 */
const RenewMembershipModal = ({ row, packages, onClose, onRenewed }) => {
  const [pick, setPick] = useState(null);
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);

  const collected = linesTotal(lines);
  const price = pick ? planTotal(pick) : 0;

  const submit = async () => {
    if (!pick) { toast.error("Pick the membership they are renewing on"); return; }
    const missingRef = lineMissingReference(lines);
    if (missingRef) { toast.error(`Enter the ${REFERENCE_LABELS[missingRef.mode]}`); return; }
    setSaving(true);
    try {
      const res = await renewZumba(row.id, {
        package_id: pick.id,
        package_name: pick.name,
        package_sessions: pick.sessions_offline || pick.sessions_online || null,
        fee_amount: price,
        payment_lines: paymentPayload(lines),
      });
      // The server's own sentence, so what the branch reads back is what was recorded.
      toast.success(res?.message || "Membership renewed");
      onRenewed();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not renew");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" data-testid="zumba-renew-dialog">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Renew {row.name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.package_name ? `${row.package_name} · ` : ""}
              {row.finish_on ? `runs out ${shortDate(row.finish_on)}` : "no end date on the current term"}
              {typeof row.classes_left === "number" ? ` · ${row.classes_left} ${row.classes_left === 1 ? "class" : "classes"} left` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            title="Close"
            aria-label="Close"
            data-testid="zumba-renew-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-2">
            <FieldLabel>Renewing On</FieldLabel>
            {packages.length === 0 ? (
              <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
                No Zumba memberships on the shelf yet. Add them in Services and Products → Zumba Class.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="zumba-renew-packages">
                {packages.map((item) => {
                  const on = pick?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPick(on ? null : item)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${on ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                      title={item.name}
                      data-testid={`zumba-renew-package-${item.id}`}
                    >
                      {planLabel(item)} · {rupees(planTotal(item))}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel>Fee Collected</FieldLabel>
            <PaymentLinesEditor
              lines={lines}
              onChange={setLines}
              prefix="zumba-renew"
              emptyNote="Nothing collected yet. A renewal can be recorded now and paid for later."
            />
          </div>

          {pick && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs" data-testid="zumba-renew-summary">
              <div className="flex items-center justify-between font-semibold text-slate-700">
                <span>This term</span>
                <span className="text-emerald-700">{rupees(price)}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-600">
                {collected >= price ? "Paid up front." : `${rupees(price - collected)} of it will be outstanding.`}
                {" The new term runs on from "}
                {row.finish_on ? shortDate(row.finish_on) : "today"}.
              </p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="zumba-renew-cancel">Cancel</Button>
          <Button size="sm" className="bg-sky-600 hover:bg-sky-700" disabled={saving} onClick={submit} data-testid="zumba-renew-save">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

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
/**
 * How a payment arrived, line by line.
 *
 * One editor for the three places money is taken — registering a student, renewing them,
 * and collecting what is still due. They ask the identical question and were three copies
 * of the identical answer, which is three places for the denominations or the reference
 * rule to drift apart.
 *
 * State lives with the caller: each of the three keeps its lines somewhere different, and
 * a component that owned them would have to be told which.
 */
const PaymentLinesEditor = ({ lines, onChange, prefix, emptyNote }) => {
  const setLine = (i, patch) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  // A second line starts on UPI rather than cash: somebody adding one has already taken
  // the cash part, and the common split is cash plus something else.
  const addLine = () => onChange([...lines, lines.length === 0 ? { ...EMPTY_LINE } : { ...EMPTY_LINE, mode: "upi" }]);
  const dropLine = (i) => onChange(lines.filter((_, n) => n !== i));

  return (
    <>
      {lines.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">{emptyNote}</p>
      ) : (
        lines.map((l, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3" data-testid={`${prefix}-line-${i}`}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[140px] flex-1">
                <FieldLabel>Paid By</FieldLabel>
                <FormSelect value={l.mode} onChange={(v) => setLine(i, { mode: v, notes: {}, reference: "" })} testid={`${prefix}-mode-${i}`}>
                  {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </FormSelect>
              </div>
              <div className="min-w-[110px] flex-1">
                <FieldLabel>Amount</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  value={l.mode === "cash" && noteTotal(l) > 0 ? noteTotal(l) : l.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                  // Counted notes drive the figure, so the box shows the count rather than
                  // inviting a second, different number beside it.
                  readOnly={l.mode === "cash" && noteTotal(l) > 0}
                  className={l.mode === "cash" && noteTotal(l) > 0 ? "bg-slate-50" : ""}
                  data-testid={`${prefix}-amount-${i}`}
                />
              </div>
              {REFERENCE_LABELS[l.mode] && (
                <div className="min-w-[150px] flex-1">
                  <FieldLabel>{REFERENCE_LABELS[l.mode]}</FieldLabel>
                  <Input
                    value={l.reference}
                    onChange={(e) => setLine(i, { reference: e.target.value })}
                    placeholder={REFERENCE_PLACEHOLDERS[l.mode]}
                    data-testid={`${prefix}-reference-${i}`}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => dropLine(i)}
                className="mb-1 rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                title="Remove this payment"
                aria-label="Remove this payment"
                data-testid={`${prefix}-drop-${i}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {/* Counted notes, so the drawer can be reconciled against the row rather than
                against somebody's memory of it. Optional: leaving them blank and typing
                the amount is still a payment. */}
            {l.mode === "cash" && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Notes counted
                  <span className="ml-1 font-normal normal-case text-slate-400">— leave blank to just type the amount</span>
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {DENOMINATIONS.map((d) => (
                    <div key={d}>
                      <label className="mb-0.5 block text-center text-[11px] font-bold text-slate-500">₹{d}</label>
                      <Input
                        type="number"
                        min="0"
                        value={l.notes?.[d] ?? ""}
                        onChange={(e) => setLine(i, { notes: { ...l.notes, [d]: e.target.value } })}
                        className="h-9 px-1 text-center text-sm"
                        data-testid={`${prefix}-note-${i}-${d}`}
                      />
                    </div>
                  ))}
                </div>
                {noteTotal(l) > 0 && (
                  <p className="mt-2 text-right text-[11px] text-slate-500" data-testid={`${prefix}-note-total-${i}`}>
                    {DENOMINATIONS.filter((d) => Number(l.notes?.[d]) > 0).map((d) => `${l.notes[d]}×₹${d}`).join("  +  ")}
                    {" = "}<b className="text-slate-700">{rupees(noteTotal(l))}</b>
                  </p>
                )}
              </div>
            )}
          </div>
        ))
      )}
      <Button type="button" variant="outline" size="sm" onClick={addLine} data-testid={`${prefix}-add`}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {lines.length === 0 ? "Add Payment" : "Another Payment Mode"}
      </Button>
    </>
  );
};

/** The first line a payment that is missing its reference. Used before a save so the desk
 *  is told which line is short, rather than being handed the server's answer a round trip
 *  later. A split can have one traceable half and one not: the cash needs nothing and the
 *  UPI still needs its ID. */
const lineMissingReference = (lines) => (lines || []).find(
  (l) => lineTotal(l) > 0 && REFERENCE_LABELS[l.mode] && !(l.reference || "").trim(),
);

/** The payment lines a dialog sends, in the shape the server settles from. */
const paymentPayload = (lines) => (lines || [])
  .filter((l) => lineTotal(l) > 0)
  .map((l) => ({
    mode: l.mode,
    amount: lineTotal(l),
    reference: (l.reference || "").trim(),
    // Only for cash, and only what was actually counted — an empty map would read as
    // "counted nothing" rather than "did not count".
    denominations: l.mode === "cash" && noteTotal(l) > 0
      ? Object.fromEntries(DENOMINATIONS.filter((d) => Number(l.notes?.[d]) > 0).map((d) => [String(d), Number(l.notes[d])]))
      : undefined,
  }));

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
  { key: "all", label: "All", color: "#a855f7", sub: "on the roll" },
  { key: "direct", label: "Direct", color: "#f59e0b", sub: "nobody referred them" },
  { key: "consultant", label: "Consultant", color: "#f97316", sub: "from a consultation" },
  // Master is the leads a master brought in — a referral filed against a named master,
  // which is what the Zumba Master View's Refer Customer writes and what this card is
  // asked for. It held the branch-sourced count until that board existed and there was a
  // real master's referral to point it at.
  { key: "masters", label: "Refer Master", color: "#d97706", sub: "brought by a master" },
  // The last four are counts of people, like the four before them, but they answer what
  // became of a student rather than where they came from: is the money settled, and are
  // they still turning up. The revenue split that used to sit here said the same thing
  // three times over and answered neither.
  //
  // Payment Done is a settled account, not "has paid something" — a student halfway
  // through a 3,000 rupee membership belongs on Due Payment, which is the card somebody
  // acts on. A row with no fee on it yet is on neither: nothing has been sold.
  { key: "payment_done", label: "Payment Done", color: "#059669", sub: "nothing owed" },
  { key: "due_payment", label: "Due Payment", color: "#d97706", sub: "still to collect" },
  // One card, not two: Discontinue and Leave are both "not turning up", and splitting
  // them across the row asked the branch to read two numbers to learn one thing. The
  // distinction survives where it is actually useful — on the row, which says which — and
  // the server still counts them apart, so nothing downstream is coarsened by this.
  { key: "discontinued", label: "Discontinue", color: "#e11d48", sub: "left the class", sum: ["discontinued", "leave"] },
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

const STATUS_CHIP = {
  active: { label: "On the roll", classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  discontinued: { label: "Discontinued", classes: "border-rose-200 bg-rose-50 text-rose-700" },
  leave: { label: "On leave", classes: "border-indigo-200 bg-indigo-50 text-indigo-700" },
};

/**
 * Everything on one registration, read rather than edited, and the two things that end it.
 *
 * Shaped like the gym's membership dialog next door, because they answer the same question
 * about the same kind of person and reading them differently for no reason is a cost paid
 * by whoever works both tabs. What is owed leads, since it is the thing a desk opens a row
 * to find out; who they are and what they bought sit under it, side by side.
 */
const ViewRegistrationModal = ({ row, masterNameOf, onEdit, onCollect, onClose, onSaved }) => {
  const [pending, setPending] = useState(null); // "discontinued" | "leave" | null
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const status = row.status || "active";
  const ended = status === "discontinued" || status === "leave";
  const chip = STATUS_CHIP[status] || STATUS_CHIP.active;
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

  const owed = Number(row.fee_amount || 0);
  const paid = Number(row.fee_paid || 0);
  const due = owed - paid;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="zumba-view-dialog"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b p-5">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-800">
              {row.name || "—"}
              <span className={`inline-flex rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${chip.classes}`} data-testid="zumba-view-status-chip">
                {chip.label}
              </span>
            </h3>
            {/* The three that identify somebody at a glance, on one line — the same three
                the gym's dialog leads with, and the reason neither needs a photo. */}
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.phone || "No phone"}{row.age ? ` · ${row.age}` : ""}{row.gender ? ` · ${row.gender}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close" data-testid="zumba-view-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* What is outstanding, first and largest. A settled row says so rather than
              printing a zero, which reads as a figure nobody has filled in yet. */}
          <div className={`rounded-lg border p-3 ${due > 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Balance</p>
                <p className={`text-xl font-extrabold ${due > 0 ? "text-rose-700" : "text-emerald-700"}`} data-testid="zumba-view-balance">
                  {due > 0 ? `${rupees(due)} due` : owed > 0 ? "Paid up" : "Nothing sold yet"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-right text-[11px] text-slate-600">
                  Fee <b>{rupees(owed)}</b><br />
                  Collected <b className="text-emerald-700">{rupees(paid)}</b>
                </p>
                {/* Offered from the balance rather than the footer, because it is the one
                    thing to do about the figure beside it. Absent when nothing is owed,
                    where there is nothing to collect. */}
                {due > 0 && !ownedElsewhere && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={onCollect} data-testid="zumba-view-collect">
                    Collect Due
                  </Button>
                )}
              </div>
            </div>
          </div>

          {ended && (
            <div className={`rounded-lg border p-3 text-xs ${status === "discontinued" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-indigo-200 bg-indigo-50 text-indigo-700"}`} data-testid="zumba-view-status">
              <p className="font-bold">{STATUS_LABELS[status]}</p>
              {row.status_remarks ? <p className="mt-0.5">{row.status_remarks}</p> : null}
              {row.status_by ? <p className="mt-0.5 opacity-70">{row.status_by} · {shortDate(row.status_at)}</p> : null}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Student</p>
              <DetailRow label="Phone" value={row.phone} />
              <DetailRow label="Age" value={row.age} />
              <DetailRow label="Gender" value={(GENDERS.find((g) => g.key === row.gender) || {}).label} />
              <DetailRow label="Email" value={row.email} />
              <DetailRow label="Address" value={row.address} />
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Membership</p>
              <DetailRow label="Package" value={row.package_name} />
              <DetailRow label="Classes" value={row.package_sessions ? `${row.package_sessions} classes` : ""} />
              <DetailRow label="Time" value={row.time_slot} />
              <DetailRow label="Class" value={masterNameOf(row.assigned_master_id)} />
              <DetailRow label="Source" value={sourceDetail(row)} />
              <DetailRow label="Joined" value={shortDate(row.joined_on || row.created_at)} />
              {/* The term's own end, beside the day it began. Read off the server so
                  the sheet, the row and the master's roll are one answer. */}
              {row.finish_on ? <DetailRow label="Finishing" value={shortDate(row.finish_on)} /> : null}
            </div>
          </div>

          {/* How the money came in, where the gym's dialog lists its collections. A Zumba
              fee is taken once at the desk rather than through a collect flow, so this is
              the mode and its reference and nothing more — and says so when it is empty
              rather than leaving a card that looks unfinished. */}
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Payment</p>
            {row.payment_mode ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2" data-testid="zumba-view-payment">
                <span className="text-sm font-bold text-emerald-700">{rupees(paid)}</span>
                <span className="text-[11px] text-slate-500">
                  {PAYMENT_MODE_LABELS[row.payment_mode] || row.payment_mode}
                  {row.payment_reference ? ` · ${row.payment_reference}` : ""}
                </span>
              </div>
            ) : (
              <p className="py-3 text-center text-xs text-slate-400" data-testid="zumba-view-no-payment">
                {paid > 0
                  ? "Collected without a mode recorded — the figure above was set on the registration directly."
                  : "Nothing collected yet."}
              </p>
            )}
          </div>

          {/* Asked before it is saved, not after: the reason is the point of recording it. */}
          {pending ? (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
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
          ) : null}

          {ownedElsewhere && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-medium text-sky-700" data-testid="zumba-view-owned-elsewhere">
              Referred on the consultation, which owns this record — discontinuing or ending it is done there, by un-ticking Zumba on the lead.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="zumba-view-close-btn">Close</Button>
          {!ownedElsewhere && (
            <>
              <Button variant="outline" size="sm" onClick={onEdit} data-testid="zumba-view-edit">
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** The stored timestamp as a plain YYYY-MM-DD, which is what the date inputs compare. */
const dayOf = (iso) => String(iso || "").slice(0, 10);

/** Today, as the branch's own calendar has it. Not off toISOString(), which is UTC: at
 *  three in the morning in India that still reads as yesterday, and a membership would be
 *  dated to a day nobody was at the desk. */
const todayLocal = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
  source: "personal", master_name: "", assigned_master_id: "", time_slot: "", joined_on: "",
  package_id: "", package_name: "", package_sessions: "", fee_amount: "", fee_paid: "", payment_mode: "", payment_reference: "", payment_lines: [],
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
  const [renewing, setRenewing] = useState(null); // the membership being sold another term
  const [collecting, setCollecting] = useState(null); // the balance being paid down
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
    if (modeFilter) list = list.filter((r) => r.payment_mode === modeFilter);
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

  // The payment lines the dialog edits. Declared beside openForm rather than inside the
  // dialog's JSX so the handlers are one thing each, and `collected` is read by both the
  // Fee Collected box and the running total under the lines.
  const collected = linesTotal(form?.payment_lines);

  const openForm = (row) => {
    setNewMaster("");
    setForm(row
      ? { ...EMPTY, ...row, age: row.age ?? "", joined_on: row.joined_on || dayOf(row.created_at), payment_lines: linesOf(row) }
      : { ...EMPTY, joined_on: todayLocal() });
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
    // Asked per line, because a split payment can have one traceable half and one not:
    // the cash needs nothing and the UPI still needs its ID. Refused here as well as on the
    // server, so the desk is told before the round trip.
    const missingRef = lineMissingReference(form.payment_lines);
    if (missingRef) {
      toast.error(`Enter the ${REFERENCE_LABELS[missingRef.mode]}`);
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
        // Not asked for any more, but still sent: a consultation referral arrives with
        // an address off the lead, and dropping it here would mean editing such a row
        // for any other reason silently deleted it.
        address: (form.address || "").trim(),
        time_slot: form.time_slot || "",
        joined_on: form.joined_on || "",
        package_id: form.package_id || "",
        package_name: form.package_name || "",
        package_sessions: form.package_sessions === "" || form.package_sessions == null ? null : Number(form.package_sessions),
        source: form.source || "personal",
        master_name: (form.master_name || "").trim(),
        assigned_master_id: form.assigned_master_id || "",
        fee_amount: Number(form.fee_amount || 0),
        fee_paid: Number(form.fee_paid || 0),
        // The three the server works out from these are still in the payload above for
        // callers that send no lines; with lines present they are ignored and settled here.
        payment_lines: paymentPayload(form.payment_lines),
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
      toast.success(target.origin === "consultation" ? "Referral turned away" : "Registration removed");
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
        className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 lg:grid-cols-7"
        data-testid="zumba-summary"
      >
        {CARDS.map((c) => (
          <StatTile
            key={c.key}
            label={c.label}
            value={(c.sum || [c.key]).reduce((n, k) => n + (Number(summary?.[k]) || 0), 0)}
            sub={c.sub}
            icon={Music}
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
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                    modeFilter === key
                      ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
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
              <table className="w-full min-w-[60rem] text-left text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {/* Ten columns where there were twelve. Age and Registered moved under
                      the name, which is where a person's own details belong and where the
                      gym's table already keeps them; what is left is one fact per column,
                      each wide enough to be read. */}
                  <tr>
                    <th className="w-[4%] px-3 py-2.5">S.No</th>
                    <th className="w-[16%] px-3 py-2.5">Student</th>
                    <th className="w-[10%] px-3 py-2.5">Phone</th>
                    <th className="w-[8%] px-3 py-2.5">Source</th>
                    <th className="w-[11%] px-3 py-2.5">Package</th>
                    <th className="w-[8%] px-3 py-2.5">Finish</th>
                    <th className="w-[10%] px-3 py-2.5">Class</th>
                    {showStage && <th className="w-[8%] px-3 py-2.5">Stage</th>}
                    <th className="w-[8%] px-3 py-2.5">Collected</th>
                    <th className="w-[10%] px-3 py-2.5">Paid By</th>
                    <th className="w-[8%] px-3 py-2.5">Status</th>
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
                        onClick={() => setViewing(r)}
                        className={`cursor-pointer align-top ${gaps.length > 0 ? "bg-amber-50/50 hover:bg-amber-50" : "hover:bg-slate-50/60"}`}
                        data-testid={`zumba-row-${r.id}`}
                      >
                        <td className="px-3 py-3 text-xs text-slate-400">{i + 1}</td>
                        <td className="px-3 py-3">
                          <p className="truncate font-semibold text-slate-800" title={r.name}>{r.name || "—"}</p>
                          {/* Age, gender and the day they joined read as one line about the
                              person rather than as three columns of one value each. The
                              address goes with them into the record, where there is room to
                              read it. */}
                          <p className="truncate text-[11px] text-slate-400">
                            {[r.age ? `${r.age}` : null, r.gender || null].filter(Boolean).join(" · ")}
                            {(r.age || r.gender) ? " · " : ""}Joined {shortDate(r.joined_on || r.created_at)}
                          </p>
                          {/* Names what is missing rather than saying "incomplete": the
                              branch admin opens this row to do one specific thing, and the
                              badge may as well say which. */}
                          {gaps.length > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); return r.origin === "consultation" ? acceptAndEdit(r) : openForm(r); }}
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
                        <td className="px-3 py-3">
                          {/* A referral prints the master's name, because "Master" on its
                              own is the half of the answer nobody asks for. */}
                          <span className={`inline-block max-w-full truncate whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-semibold ${r.source === MASTER ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`} title={sourceDetail(r)}>
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
                        {/* When the membership runs out, counted forward from the term's
                            start by the plan's own length — the server works it out so this
                            column and the master's roll cannot answer it differently. The
                            classes left sit under it, in amber once a renewal is due, so
                            the date and the reason to act on it are read together. */}
                        <td className="px-3 py-3">
                          {r.finish_on ? (
                            <>
                              <p className="truncate text-xs text-slate-600">{shortDate(r.finish_on)}</p>
                              {typeof r.classes_left === "number" ? (
                                <p className={`truncate text-[10px] ${r.renewal_due ? "font-semibold text-amber-600" : "text-slate-400"}`}>
                                  {r.classes_left === 0 ? "term over" : `${r.classes_left} left`}
                                </p>
                              ) : null}
                            </>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        {/* Whose class they turn up to, which is not who brought them in.
                            Only what is set here reaches a master's own board. */}
                        <td className="px-3 py-3">
                          {r.assigned_master_name ? (
                            <span className="inline-block max-w-full truncate whitespace-nowrap rounded bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700" title={r.assigned_master_name}>
                              {r.assigned_master_name}
                            </span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                          {/* The hour under the master, because "whose class" and "which
                              class" are the same question asked twice otherwise. */}
                          {r.time_slot ? <p className="mt-0.5 truncate text-[10px] text-slate-400">{r.time_slot}</p> : null}
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
                        {/* What has come in, and what is still to. The plan's price is not
                            here: it is the sum of the two and is already named by the
                            package a column over, so printing it made a third line the
                            column had no room for and answered nothing the other two did
                            not. The record still shows all three. */}
                        <td className="px-3 py-3">
                          <p className="text-xs font-semibold text-emerald-700">{rupees(paid)}</p>
                          {due > 0
                            ? <p className="text-[11px] font-semibold text-rose-600">{rupees(due)} due</p>
                            : Number(r.fee_amount || 0) > 0
                              ? <p className="text-[11px] text-emerald-600">Paid up</p>
                              : <p className="text-[11px] text-slate-400">Nothing sold</p>}
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
                                <p className="mt-0.5 max-w-full truncate text-[10px] text-slate-400" title={r.payment_reference}>{r.payment_reference}</p>
                              ) : null}
                              {/* "Split" on its own says a payment arrived more than one way
                                  without saying which, which is the question it prompts. */}
                              {r.payment_mode === "split" && Array.isArray(r.payment_lines) ? (
                                <p className="mt-0.5 truncate text-[10px] text-slate-400" title={r.payment_lines.map((l) => `${PAYMENT_MODE_LABELS[l.mode] || l.mode} ${rupees(l.amount)}`).join(", ")}>
                                  {r.payment_lines.map((l) => `${PAYMENT_MODE_LABELS[l.mode] || l.mode} ${rupees(l.amount)}`).join(" + ")}
                                </p>
                              ) : null}
                            </>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        {/* Whether they are still coming, in the words the record uses. */}
                        <td className="px-3 py-3">
                          {(() => {
                            const chip = STATUS_CHIP[r.status || "active"] || STATUS_CHIP.active;
                            return (
                              <span className={`inline-flex whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${chip.classes}`} data-testid={`zumba-row-status-${r.id}`}>
                                {chip.label}
                              </span>
                            );
                          })()}
                        </td>
                        {/* The actions cell swallows the click: pressing Edit or Delete
                            should not also open the record behind the dialog it opened. */}
                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {/* A referral is a decision recorded on the consultation, read
                              live from the lead rather than copied here. Editing it would
                              only put this tab out of step with the consultation that owns
                              it — but taking it off this list is the branch's own call, and
                              is recorded here rather than by rewriting the lead. */}
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
                              {/* The other thing to do with a referral: this branch is not
                                  running the class for them. It comes off the list without
                                  the consultation's record changing, and a fresh
                                  recommendation later brings them back. */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 border-rose-200 p-0 text-rose-600 hover:bg-rose-50"
                                onClick={() => setRemoving(r)}
                                title="Take this referral off the Zumba list"
                                aria-label="Take this referral off the Zumba list"
                                data-testid={`zumba-delete-${r.id}`}
                              >
                                <Trash2 className="h-3 w-3" />
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
                              {/* Only once the term is nearly up. A renewal offered on the
                                  first day of six months is a button nobody presses, and
                                  one offered on the last is a conversation already missed. */}
                              {r.renewal_due && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 border-amber-300 px-2 text-[10px] font-semibold text-amber-700 hover:bg-amber-50"
                                  onClick={(e) => { e.stopPropagation(); setRenewing(r); }}
                                  title={r.classes_left === 0
                                    ? "This membership has run out — sell them another term"
                                    : `${r.classes_left} classes left — sell them another term`}
                                  data-testid={`zumba-renew-${r.id}`}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Renew
                                </Button>
                              )}
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
          {/* Header outside the scroller rather than at the top of it: a close the reader
              has to scroll back up to find is one they will look for on the backdrop
              instead. The body scrolls under it. */}
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">{form.id ? "Edit Zumba Lead" : "Zumba Lead Create"}</h3>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                title="Close"
                aria-label="Close"
                data-testid="zumba-dialog-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">

            {/* One column, in the order the desk asks: who the person is, then what the
                branch is doing with them. The headings keep the two apart without a second
                column putting half the questions where a form is not read. */}
            <div className="space-y-5">

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

                {/* When the term runs, side by side because the second follows from the
                    first. Joined is asked rather than taken from when the row was typed —
                    a branch entering last week's walk-ins would otherwise date every
                    membership to the paperwork. */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <FieldLabel>Joined</FieldLabel>
                    <Input
                      type="date"
                      value={form.joined_on || ""}
                      onChange={(e) => setForm({ ...form, joined_on: e.target.value })}
                      data-testid="zumba-field-joined"
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Finishing</FieldLabel>
                    {/* Read-only because it is not a fact of its own: it is the joining date
                        plus the plan's length, and a box that could disagree with those two
                        is a third answer to a question that already has one. */}
                    <Input
                      type="date"
                      value={finishPreview(form.joined_on, form.package_sessions)}
                      readOnly
                      className="bg-slate-50"
                      data-testid="zumba-field-finish"
                    />
                    <p className="text-[11px] text-slate-400">
                      {form.package_sessions
                        ? "Follows from the membership below."
                        : "Pick a membership below to set this."}
                    </p>
                  </div>
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
                              ? { ...form, package_id: "", package_name: "", package_sessions: "", fee_amount: "" }
                              : {
                                  ...form,
                                  package_id: item.id,
                                  package_name: item.name,
                                  package_sessions: item.sessions_offline || item.sessions_online || "",
                                  fee_amount: total,
                                })}
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
                      {/* Read off the payment below rather than typed beside it: a figure
                          that can disagree with the modes under it is a figure nobody can
                          reconcile at the end of the day. */}
                      <Input
                        type="number"
                        value={collected || ""}
                        readOnly
                        placeholder="0"
                        className="bg-slate-50"
                        data-testid="zumba-field-paid"
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Fee Amount</FieldLabel>
                      <Input type="number" value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value, package_id: "", package_name: "", package_sessions: "" })} placeholder="0" data-testid="zumba-field-amount" />
                    </div>
                  </div>
                  {/* A payment can arrive more than one way — half in cash, the rest by
                      UPI — and one mode per registration forced the desk to record the
                      larger half and pretend the other never happened. The same shape the
                      Fitness desk collects in, so one counter learns it once. */}
                  <div className="space-y-2 pt-1">
                    <FieldLabel>Mode of Payment</FieldLabel>
                    <PaymentLinesEditor
                      lines={form.payment_lines || []}
                      onChange={(next) => setForm((f) => ({ ...f, payment_lines: next }))}
                      prefix="zumba-pay"
                      emptyNote="Nothing collected yet. Add a payment when the student pays."
                    />

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      {collected > 0 && (
                        <p className="text-xs text-slate-500" data-testid="zumba-pay-total">
                          Collecting <b className="text-emerald-700">{rupees(collected)}</b>
                          {Number(form.fee_amount) > 0 && (
                            collected > Number(form.fee_amount)
                              ? <span className="text-rose-600"> — {rupees(collected - Number(form.fee_amount))} more than the fee</span>
                              : collected < Number(form.fee_amount)
                                ? <span> · {rupees(Number(form.fee_amount) - collected)} still due</span>
                                : <span className="text-emerald-700"> · paid up</span>
                          )}
                        </p>
                      )}
                    </div>
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
        </div>
      )}

      {collecting && (
        <CollectDueModal
          row={collecting}
          onClose={() => setCollecting(null)}
          onCollected={load}
        />
      )}

      {renewing && (
        <RenewMembershipModal
          row={renewing}
          packages={packages}
          onClose={() => setRenewing(null)}
          onRenewed={load}
        />
      )}

      {viewing && (
        <ViewRegistrationModal
          row={viewing}
          masterNameOf={(id) => (zumbaMasters.find((m) => m.id === id) || {}).name || ""}
          onEdit={() => { const r = viewing; setViewing(null); openForm(r); }}
          onCollect={() => { const r = viewing; setViewing(null); setCollecting(r); }}
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
                {/* Two different acts behind one button, so the dialog says which. A
                    registration is deleted; a referral is only turned away, and saying
                    "cannot be undone" about that would be false. */}
                <h3 className="text-base font-semibold text-slate-900">
                  {removing.origin === "consultation" ? "Turn this referral away?" : "Remove this registration?"}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  <b className="text-slate-700">{removing.name}</b> comes off the Zumba list and out of the counts above.
                  {removing.origin === "consultation"
                    ? " The consultation's own record is untouched, and a fresh Zumba recommendation there brings them back."
                    : " This cannot be undone."}
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
