import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertCircle, FileText, Calendar, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, XCircle, Search, Phone, Stethoscope, ClipboardList, Lock, Pencil, Dumbbell, Users, X, Bell, Plus, Trash2, Ban, ClipboardCheck, IndianRupee, Printer, Share2, Download, Eye, Salad } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { StageTabBar } from "@/components/ui/stage-tab";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { LeadDocuments } from "@/components/LeadDocuments";
import { LeadMarks } from "@/components/ui/lead-marks";
import {
  getConsultationsBoard, moveConsultationStage, listStoreItems, collectRehabFee,
  collectPackagePayment, collectTreatmentFee, markInstallmentPaid, savePhysioDiagnosis, unlockPhysioDiagnosis,
  saveTreatmentSummary, unlockTreatmentSummary, stagesList, getDoctors,
  assignPhysioWithSessions, assignRehab, getDoctorCalendar,
  listNutritionCoaches, bookDietAppointment, collectDietFee,
  scheduleConsultationFollowUp, rescheduleConsultationFollowUp,
  getLeadRemarks, getLeadActivity, leadDocuments,
  saveConsultationDecision, markConsultationCompleted, getBranches,
  listTextPresets, addTextPreset, deleteTextPreset,
  getTreatmentTypes,
} from "@/lib/api";
import { waNumber } from "@/lib/phone";
import { endTime12h, to12h } from "@/lib/time";
import { LOGO_URL, PRINTABLE_STYLES, escapeHtml, openPrintable, downloadPrintable, sharePrintable } from "@/lib/printable";
import { MilkDateInput, MilkTimeInput } from "@/components/ui/milk-calendar";

const CONSULTATION_FEE_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "account_transfer", label: "Account Transfer" },
];
const TREATMENT_FEE_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "account_transfer", label: "Account Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "partial", label: "Partial Payment" },
];
const INSTALLMENT_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "account_transfer", label: "Account Transfer" },
  { value: "cheque", label: "Cheque" },
];
// Modes that collect the bank's own account details. Card and Account Transfer ask for
// the same four fields; Account Transfer additionally needs the transfer's reference.
const BANK_DETAIL_MODES = ["card", "account_transfer"];

// What a booking on each of an expert's calendars is called, keyed by the `course` tag
// get_doctor_calendar puts on every occupant. Used to tell a patient why a slot they can
// see is not one they can take.
const COURSE_DAY_NOUN = { session: "treatment day", rehab: "rehab day", diet: "check-in", consult: "consultation" };
// These two mirror SETTLED_NOW_MODES / PART_SESSION_MODES in the backend's
// v3_packages.py and must be kept in step with them. The first is every mode where the
// money lands in full right now, so the amount is editable and a confirmation is
// required; the second adds Cheque — every mode that can cover only some of a package's
// sessions today and leave the rest as a scheduled balance.
const SETTLED_NOW_MODES = ["cash", "upi", "card", "account_transfer"];
const PART_SESSION_MODES = ["cash", "upi", "card", "cheque", "account_transfer"];
const PARTIAL_ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
const partialInstallmentLabel = (idx) => `${PARTIAL_ORDINALS[idx] || `#${idx + 1}`} Payment`;

// ---- Payment receipt ----------------------------------------------------------------
// The receipt is built as a standalone HTML document rather than printed from the page:
// window.print() here would send the whole board — modals, sidebar and all — to the
// printer, and the same document is what gets downloaded, so paper and file always match.
const ALL_PAYMENT_MODE_LABELS = { cash: "Cash", upi: "UPI", card: "Card", account_transfer: "Account Transfer", cheque: "Cheque", partial: "Partial Payment" };

/** Whatever identifies this payment with the bank — the thing a dispute is traced by. */
const paymentReference = (p) => p.transfer_reference
  || p.upi_utr || p.upi_transaction_id
  || (p.cheque_number ? `Cheque ${p.cheque_number}${p.bank_name ? ` · ${p.bank_name}` : ""}` : "")
  || (p.account_number ? `Card ****${String(p.account_number).replace(/\D/g, "").slice(-4)}` : "");

// `kind: "schedule"` is a Partial Payment plan — the installments are agreed but no money
// has come in yet, so it must never print "Amount Paid" or "PAYMENT RECEIVED".
const isSchedule = (r) => r.kind === "schedule";

// The receipt's own document content. The branding, styles and the open/print/download/
// share mechanics are shared with every other printable in lib/printable.js.
const receiptRows = (r) => [
  [isSchedule(r) ? "Reference No." : "Transaction ID", r.receiptNo],
  ["Date", r.dateLabel],
  ["Patient", r.patient],
  ["Patient No.", r.patientNo],
  ["Phone", r.phone],
  r.branch ? ["Branch", r.branch] : null,
  [isSchedule(r) ? "Scheduled For" : "Paid For", r.paidFor],
  r.packageName ? ["Package", r.packageName] : null,
  r.sessionsCovered ? ["Sessions Covered", r.sessionsCovered] : null,
  ["Payment Mode", r.modeLabel],
  r.reference ? ["Reference", r.reference] : null,
  r.originalAmount != null && r.originalAmount !== r.amount ? ["Original Price", `Rs.${r.originalAmount}`] : null,
  // The percentage alongside the rupees, so the receipt says how big the discount was and
  // not just how much came off. Omitted when there's no original price to measure against.
  r.discount
    ? ["Discount", r.originalAmount > 0
        ? `- Rs.${r.discount} (${Number(((r.discount / r.originalAmount) * 100).toFixed(2))}%)`
        : `- Rs.${r.discount}`]
    : null,
  [isSchedule(r) ? "Total Payable" : "Amount Paid", `Rs.${r.amount}`],
  r.balanceDue ? ["Balance Due", r.balanceDue] : null,
  [isSchedule(r) ? "Prepared By" : "Collected By", r.collectedBy],
].filter(Boolean);

/**
 * The shorter list the on-screen receipt shows. Deliberately not receiptRows.
 *
 * The printed bill and the shared text are records — they carry the branch, the package,
 * the mode, the original price and who collected it, because that is what a receipt has to
 * prove months later. The popup is an acknowledgement seen for a few seconds while the
 * patient is still standing there, and thirteen rows to confirm one payment is a wall to
 * read past rather than a confirmation.
 *
 * Everything dropped here is still on the bill, in the share text and in the download.
 * Money is not among it: the three figures sit in the block above this, larger.
 */
const receiptPopupRows = (r) => [
  [isSchedule(r) ? "Reference No." : "Transaction ID", r.receiptNo],
  ["Date and Time", r.dateLabel],
  ["Patient Name", r.patient],
  ["Phone Number", r.phone],
  [isSchedule(r) ? "Scheduled For" : "Paid For", r.paidFor],
].filter(([, v]) => v);

const receiptHtml = (r) => `<!doctype html><html><head><meta charset="utf-8">
<title>Receipt ${escapeHtml(r.receiptNo)}</title><style>${PRINTABLE_STYLES}</style></head>
<body><div class="wrap">
  <div class="head">
    <img class="logo" src="${LOGO_URL}" alt="FITSIOMAX">
    <div>
      <div class="brand">FITSIOMAX</div>
      <div class="sub">${escapeHtml(r.branch || "Physiotherapy & Rehabilitation")}</div>
    </div>
  </div>
  <div class="tag${isSchedule(r) ? " tag-sch" : ""}">${isSchedule(r) ? "PAYMENT SCHEDULE" : "PAYMENT RECEIVED"}</div>
  <hr>
  <div class="amt-label">${isSchedule(r) ? "Total Payable" : "Amount Paid"}</div>
  <div class="amt${isSchedule(r) ? " amt-sch" : ""}">Rs.${escapeHtml(r.amount)}</div>
  <hr>
  <table>${receiptRows(r).map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(v)}</td></tr>`).join("")}</table>
  ${(r.installments || []).length ? `<hr><div class="amt-label">Installments</div>
  <table>${r.installments.map((i, n) => `<tr><td class="k">#${n + 1}${i.sessions ? ` · ${escapeHtml(i.sessions)} sessions` : ""} · due ${escapeHtml(i.due_date || "—")}</td><td class="v">Rs.${escapeHtml(i.amount)}${i.paid ? " · PAID" : ""}</td></tr>`).join("")}</table>` : ""}
  <hr>
  <div class="foot">${isSchedule(r)
    ? "This is a payment schedule, not a receipt — no amount has been collected yet.<br>A receipt is issued for each installment when it is paid."
    : "This is a computer-generated receipt and needs no signature.<br>Thank you for choosing FITSIOMAX."}</div>
</div></body></html>`;

const receiptText = (r) => [
  `FITSIOMAX — Payment Receipt`,
  ...receiptRows(r).map(([k, v]) => `${k}: ${v}`),
].join("\n");

const printReceipt = (r) => openPrintable(receiptHtml(r), { print: true });
const downloadReceipt = (r) => downloadPrintable(receiptHtml(r), `receipt-${r.receiptNo}.html`);
const shareReceipt = (r) => sharePrintable(receiptText(r), `FITSIOMAX Receipt ${r.receiptNo}`);

/** A phone rather than a desk: the two need opposite handoffs, below. */
const isHandheld = () => (typeof window !== "undefined"
  && (window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0));

/**
 * Straight to the patient's own number with the receipt already typed.
 *
 * Share hands the text to whatever the OS offers and asks who it is going to; this skips
 * that, which is the whole point — the receipt is nearly always going to the person whose
 * number is already on it.
 */
const whatsappReceipt = (r) => {
  const num = waNumber(r.phone);
  if (!num) { toast.error("This patient has no phone number on file"); return; }
  const url = `https://wa.me/${num}?text=${encodeURIComponent(receiptText(r))}`;
  if (isHandheld()) {
    // Same-tab on a phone. window.open with _blank hands mobile browsers an ambiguous
    // new-tab context and often leaves the app on a blank white screen once WhatsApp
    // gives control back — the same fix the appointment card needed (caf18a6).
    window.location.href = url;
    return;
  }
  // Desk: its own tab, so the board stays where it was. noopener isn't passed because it
  // makes window.open return null; the opener is cleared by hand for the same protection.
  const tab = window.open(url, "_blank");
  if (tab) tab.opener = null;
};

// Month-grid helpers for the treatment-session slot picker — the same shape the PHYSIO
// CALENDAR itself uses, so the two read as one workflow.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
/** "2026-08-03" -> "Monday, 3 Aug" — how a treatment day reads on the plan. */
const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
/** "2026-08-03" -> "Mon, 3 Aug" — the same day on a plan card, which only has a third
 *  of a phone's width to say it in. */
const shortDayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
/** Same week rule the backend stamps on each session: whole weeks from the first day. */
const weekOf = (d, firstDay) => Math.floor((new Date(`${d}T00:00:00`) - new Date(`${firstDay}T00:00:00`)) / 604800000) + 1;
// The treatment slot length is the one FITSIO STORE publishes for session packages —
// the same value PHYSIO CALENDAR cuts a physio's day into, so one published slot is
// always exactly one treatment session.
const FALLBACK_SESSION_MINUTES = 30;

/**
 * What the Head Physio is sending the patient away with. Consultation itself needs no
 * choice — the Head Physio seeing the patient and submitting this form already means a
 * consultation happened — so the only decision left is which of these four the patient
 * is also going away with, and the Head Physio can pick any combination of them (none of
 * them included, one, or all four). Treatment is the one with a package to pick;
 * diet/rehab/fitness are pure routing flags, each independent for the same reason: a
 * fifth value of a field (or six, or fourteen) would break every existing
 * `consultation_decision === "consultation_treatment"` / `== "consultation_only"` check
 * in the codebase, where four flags read side by side break nothing.
 */
const CONSULTATION_ADDONS = [
  { key: "treatment", label: "Treatment", tone: "#1baf7a" },
  { key: "diet", label: "Diet", tone: "#eb6834" },
  { key: "rehab", label: "Rehab", tone: "#0891b2" },
  { key: "fitness", label: "Fitness", tone: "#7c3aed" },
  { key: "zumba", label: "Zumba", tone: "#db2777" },
];

// "Consultation" first always, then whichever add-ons are on — same shape read back from
// a saved lead (decisionSummaryOf) as from the draft mid-edit, so a label built one way
// can never say something the other way wouldn't.
const addonsLabel = ({ treatment, diet, rehab, fitness, zumba }) => [
  "Consultation",
  treatment ? "Treatment" : null,
  diet ? "Diet" : null,
  rehab ? "Rehab" : null,
  fitness ? "Fitness" : null,
  zumba ? "Zumba" : null,
].filter(Boolean).join(" + ");

// What a confirmed treatment reads as, on screen and in a WhatsApp message. One shape
// for both, so the message cannot say something the popup does not.
const decisionText = (d) => [
  `*Treatment confirmed*`,
  `${d.name}${d.patientNo ? ` (${d.patientNo})` : ""}`,
  ``,
  `Plan: ${d.planLabel}`,
  d.packageName ? `Package: ${d.packageName}` : null,
  d.perWeek && d.weeks ? `${d.perWeek} sessions weekly x ${d.weeks} weeks = ${d.perWeek * d.weeks} total sessions` : null,
  ``,
  `- FITSIOMAX`,
].filter((l) => l !== null).join("\n");

const shareDecision = (d) => {
  const num = waNumber(d.phone);
  if (!num) { toast.error("This patient has no phone number on file"); return; }
  const url = `https://wa.me/${num}?text=${encodeURIComponent(decisionText(d))}`;
  if (isHandheld()) { window.location.href = url; return; }
  window.open(url, "_blank");
};

// The Treatment Package options used to cycle through five colours. They are one list of
// one kind of thing — durations of the same package — so the colour was decorative, and it
// read as a category each pill belonged to. Plain now, with only the selected one filled.

// FITSIO STORE session packages are named like "02 Weeks" / "03 Week" — there's no
// separate structured weeks field, so the duration is read off the leading number in
// the name. Falls back to null (shown as "—") for a package that isn't named this way.
const weeksFromPackageName = (name) => {
  const match = (name || "").match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

// One fixed color per payment mode, consistent everywhere it's offered.
const PAYMENT_MODE_COLORS = {
  cash: "#059669",
  upi: "#2563eb",
  card: "#7c3aed",
  account_transfer: "#0891b2",
  cheque: "#d97706",
  partial: "#e11d48",
};

const round2 = (n) => Math.round(n * 100) / 100;

// A discount above this reads as a mistyped amount (120 for 1200) more often than a real
// decision, so it's called out — but never blocked. Talking a price down is the Branch
// Admin's call to make; the popup's job is to make sure they meant it.
const STEEP_DISCOUNT_PCT = 25;

/**
 * Amount-to-collect with its discount worked out both ways: type a percentage or a rupee
 * discount and the amount follows; type the amount and the discount follows it.
 *
 * `amount` stays the single source of truth that gets submitted -- the two discount boxes
 * are only ever a way of arriving at it. They keep their own text state so a half-typed
 * "0." or "4." isn't destroyed by rounding mid-keystroke, and `selfEdit` stops the sync
 * back from the amount from overwriting the box being typed into.
 */
const DiscountCalculator = ({ assignedPrice, amount, onAmountChange, label, testPrefix }) => {
  const price = Number(assignedPrice);
  const hasPrice = Number.isFinite(price) && price > 0;
  const amt = parseFloat(amount);
  const validAmt = Number.isFinite(amt);

  const [pctText, setPctText] = useState("");
  const [rsText, setRsText] = useState("");
  const selfEdit = useRef(false);

  // Re-derive both boxes whenever the amount changes from outside this component.
  useEffect(() => {
    if (selfEdit.current) { selfEdit.current = false; return; }
    if (!hasPrice || !validAmt) { setPctText(""); setRsText(""); return; }
    const off = round2(price - amt);
    setRsText(off > 0 ? String(off) : "");
    setPctText(off > 0 ? String(round2((off / price) * 100)) : "");
  }, [amount, price, hasPrice, validAmt, amt]);

  const applyDiscountRs = (offRaw) => {
    const off = parseFloat(offRaw);
    if (!hasPrice || !Number.isFinite(off)) return;
    selfEdit.current = true;
    onAmountChange(String(round2(price - off)));
  };

  const onPct = (v) => {
    setPctText(v);
    const pct = parseFloat(v);
    if (!hasPrice || !Number.isFinite(pct)) return;
    const off = round2((price * pct) / 100);
    setRsText(String(off));
    applyDiscountRs(off);
  };

  const onRs = (v) => {
    setRsText(v);
    const off = parseFloat(v);
    if (!hasPrice || !Number.isFinite(off)) return;
    setPctText(String(round2((off / price) * 100)));
    applyDiscountRs(off);
  };

  const discountRs = hasPrice && validAmt ? round2(price - amt) : 0;
  const discountPct = hasPrice && discountRs ? round2((discountRs / price) * 100) : 0;
  const steep = discountPct > STEEP_DISCOUNT_PCT;
  const overpaid = discountRs < 0;

  return (
    <div className="space-y-2.5">
      {hasPrice && (
        <div className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px]">
          <span className="text-slate-500">Assigned Price</span>
          <span className="font-semibold text-slate-700">Rs.{price}</span>
        </div>
      )}

      {hasPrice && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">Discount %</label>
            <Input type="number" min="0" value={pctText} onChange={(e) => onPct(e.target.value)} className="h-9" placeholder="0" data-testid={`${testPrefix}-discount-pct`} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">Discount (₹)</label>
            <Input type="number" min="0" value={rsText} onChange={(e) => onRs(e.target.value)} className="h-9" placeholder="0" data-testid={`${testPrefix}-discount-rs`} />
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-500">{label}</label>
        <Input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          className="h-9"
          data-testid={`${testPrefix}-amount`}
        />
      </div>

      {hasPrice && discountRs > 0 && (
        <div
          className={`rounded-md border p-2.5 text-[11px] ${steep ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
          data-testid={`${testPrefix}-discount-summary`}
        >
          <p>
            Discount <span className="font-semibold">Rs.{discountRs}</span> ({discountPct}%) — collecting{" "}
            <span className="font-semibold">Rs.{round2(amt)}</span> of Rs.{price}.
          </p>
          {steep && <p className="mt-1 font-semibold">That is over {STEEP_DISCOUNT_PCT}% off. Please confirm this is correct.</p>}
        </div>
      )}

      {overpaid && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800" data-testid={`${testPrefix}-overpaid-warning`}>
          <span className="font-semibold">Rs.{Math.abs(discountRs)}</span> above the assigned Rs.{price}. Please confirm this is correct.
        </div>
      )}
    </div>
  );
};

/**
 * Button label that shortens on a phone.
 *
 * The Fee Collected panel can show four actions at once — Assign Physio, Collect Diet Fee,
 * Diet Appointment, Cancel — and their full labels need roughly 280px of text, more than a
 * phone has once the panel's padding is off. They have to sit on one row, so the row cannot
 * wrap and must not scroll; the labels are what gives way instead.
 */
const Lbl = ({ full, short }) => (
  <>
    <span className="sm:hidden">{short}</span>
    <span className="hidden sm:inline">{full}</span>
  </>
);

// Applied to every button in a stage action row: tighter below sm so four fit, normal above.
const ACT_BTN = "px-2 text-[11px] sm:px-3 sm:text-xs";

/**
 * How full a treatment slot is, as one dot per seat — filled for taken, hollow for free.
 * Two of three booked reads at a glance, where "2/3" had to be read and divided.
 *
 * Colour comes from currentColor, so the dots take the tone of the line they sit on
 * (amber when the slot is full, emerald while it is still open) with nothing to keep in
 * step separately.
 *
 * slot_capacity is configurable per physio calendar, so it is not always three. Past
 * DOT_MAX the row would outgrow a box a third of a phone wide and the dots stop being
 * countable at a glance anyway, so it falls back to the number it replaced.
 */
const DOT_MAX = 8;
const SeatDots = ({ taken, capacity }) => {
  const cap = Number(capacity) || 0;
  const used = Math.min(Number(taken) || 0, cap);
  if (cap < 1) return null;
  if (cap > DOT_MAX) return <span>{used}/{cap}</span>;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" aria-label={`${used} of ${cap} booked`}>
      {Array.from({ length: cap }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full border border-current ${i < used ? "bg-current" : "bg-transparent opacity-45"}`}
        />
      ))}
    </span>
  );
};

/**
 * What was knocked off this patient's Consultation Fee, or null if nothing was.
 *
 * Taken from the lead itself — the listed price against what was actually collected. The
 * activity trail carries an explicit discount_amount, but a lead row never loads its
 * activities, and by construction the two are the same figure.
 *
 * Null rather than zero for a fee paid in full, so the column can show a dash instead of
 * "Rs.0" on the majority of rows. A negative gap means more than the listed fee came in,
 * which is not a discount and is left out.
 */
const consultationDiscount = (l) => {
  const listed = Number(l.package_price);
  const paid = Number(l.package_paid);
  if (!Number.isFinite(listed) || !Number.isFinite(paid) || listed <= 0) return null;
  const off = Math.round((listed - paid) * 100) / 100;
  return off > 0 ? { off, pct: (off / listed) * 100 } : null;
};

// The percentages below must total 100 under table-fixed, so the extra column cannot be
// appended — it takes its 8% out of the six widest, and the min-width grows by the same
// amount so nothing is squeezed to make room. Both sets are written out literally because
// Tailwind reads the source for class names and would compile nothing from a template.
const COLS_WITH_DISCOUNT = {
  sno: "w-[4%]", patient: "w-[9%]", pno: "w-[7%]", phone: "w-[9%]", email: "w-[9%]",
  stage: "w-[10%]", expert: "w-[8%]", collected: "w-[8%]", discount: "w-[7%]",
  appt: "w-[8%]", updated: "w-[7%]", total: "w-[8%]", action: "w-[6%]",
};

/**
 * The three fees a patient can pay, each collected at its own point and stored separately.
 *
 * Fee Collected holds anyone who has paid anything, which made it one list answering three
 * different questions — "who paid to be seen", "who bought treatment", "who took a diet
 * plan" — and the branch could not read any of them off it.
 *
 * Consultation is first and is the widest: it is the fee that puts a patient in this stage
 * at all, so nearly everyone here has one. The other two are what they went on to buy.
 *
 * `paid` reads the amount rather than a flag because there is no flag — the amount being
 * present is what "collected" means, and 0 is not a collection.
 */
const FEE_TABS = [
  {
    key: "consultation",
    label: "Consultation",
    tone: "#0284c7",
    paid: (l) => Number(l.package_paid) || 0,
    item: (l) => l.package_name || l.consultation_item_name || "",
    mode: (l) => l.package_payment_mode || "",
  },
  {
    key: "treatment",
    label: "Treatment",
    tone: "#059669",
    paid: (l) => Number(l.treatment_fee_paid) || 0,
    item: (l) => l.session_package_name || "",
    mode: (l) => l.treatment_fee_payment_mode || "",
  },
  {
    key: "diet",
    label: "Diet",
    tone: "#d97706",
    paid: (l) => Number(l.diet_fee_paid) || 0,
    item: (l) => l.diet_package_name || "",
    mode: (l) => l.diet_fee_payment_mode || "",
  },
];

const rupees = (n) => `Rs.${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

// Everything this patient has paid, all three fees together. The fee column beside it
// shows only the one the open tab is about, so somebody who paid to be seen and then
// bought a diet plan reads as two separate figures on two separate tabs and never as
// what they came to in total. Summed off FEE_TABS so a fee added there is counted here
// without this needing to know about it.
const totalPaid = (l) => FEE_TABS.reduce((sum, t) => sum + t.paid(l), 0);
const COLS_PLAIN = {
  sno: "w-[4%]", patient: "w-[13%]", pno: "w-[10%]", phone: "w-[12%]", email: "w-[13%]",
  stage: "w-[13%]", expert: "w-[11%]", discount: "", appt: "w-[9%]", updated: "w-[9%]", action: "w-[6%]",
};

// The one shape every stage panel in the lead card takes: a header band naming what is on
// screen with its state at the far end, a row of controls that stays put, and a body under
// them that swaps. Written once because it was hand-copied into four panels and had already
// started to drift — centred buttons in some, left-aligned in others, three filled colours
// here and one there.
//
// Tailwind reads the source for class names, so the tones are spelled out rather than built
// from the `tone` string. Same reason segmented-tabs writes out its column layouts.
const PANEL_TONES = {
  indigo: { shell: "border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-indigo-50/60 to-white", band: "border-indigo-100", tile: "bg-indigo-600/10 text-indigo-700", heading: "text-indigo-800" },
  cyan: { shell: "border-cyan-200/80 bg-gradient-to-br from-cyan-50 via-cyan-50/60 to-white", band: "border-cyan-100", tile: "bg-cyan-600/10 text-cyan-700", heading: "text-cyan-800" },
  orange: { shell: "border-orange-200/80 bg-gradient-to-br from-orange-50 via-orange-50/60 to-white", band: "border-orange-100", tile: "bg-orange-500/10 text-orange-600", heading: "text-orange-800" },
  violet: { shell: "border-violet-200/80 bg-gradient-to-br from-violet-50 via-violet-50/60 to-white", band: "border-violet-100", tile: "bg-violet-600/10 text-violet-700", heading: "text-violet-800" },
  sky: { shell: "border-sky-200/80 bg-gradient-to-br from-sky-50 via-sky-50/60 to-white", band: "border-sky-100", tile: "bg-sky-600/10 text-sky-700", heading: "text-sky-800" },
  emerald: { shell: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-emerald-50/60 to-white", band: "border-emerald-100", tile: "bg-emerald-600/10 text-emerald-700", heading: "text-emerald-800" },
};

/** The state at the end of a panel's header band — "Both Fees Collected", "Diet Fee Due". */
const PanelChip = ({ tone = "amber", tick = false, children }) => (
  <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
    tone === "emerald" ? "bg-emerald-100 text-emerald-700"
      : tone === "rose" ? "bg-rose-100 text-rose-700"
      : tone === "slate" ? "bg-slate-100 text-slate-600"
      : "bg-amber-100 text-amber-700"
  }`}>
    {tick && <CheckCircle2 className="h-3 w-3" />} {children}
  </span>
);

function StagePanel({ tone = "indigo", icon: Icon, title, chip, tabs, children, testid }) {
  const t = PANEL_TONES[tone] || PANEL_TONES.indigo;
  return (
    <div className={`overflow-hidden rounded-xl border shadow-sm ring-1 ring-inset ring-white/60 ${t.shell}`} data-testid={testid}>
      <div className={`flex items-center justify-between gap-3 border-b px-4 py-2.5 ${t.band}`}>
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.tile}`}>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <span className={`truncate text-xs font-semibold uppercase tracking-wider ${t.heading}`}>{title}</span>
        </div>
        {chip}
      </div>
      <div className="p-4">
        {/* The controls sit above a hairline and do not move when the body under them
            changes, so the control that opened a view is the control that leaves it. */}
        {tabs && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 pb-3 [&>*]:shrink-0" data-testid={`${testid}-tabs`}>
            {tabs}
          </div>
        )}
        <div className={tabs ? "mt-3" : ""}>{children}</div>
      </div>
    </div>
  );
}

/** A label/value line inside a panel's white card. */
const PanelRow = ({ label, value, note, noteTone = "text-emerald-600", tone = "", strong = false }) => (
  <div className="flex items-baseline justify-between gap-4 px-3 py-2">
    <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
    <dd className={`min-w-0 truncate text-right font-semibold ${strong ? "text-[15px]" : "text-sm"} ${tone || "text-slate-800"}`} title={String(value)}>
      {value}
      {note && <span className={`ml-1 text-xs font-medium capitalize ${noteTone}`}>({note})</span>}
    </dd>
  </div>
);

/** The white card those rows sit in. */
const PanelCard = ({ children, testid, footer }) => (
  <div className="rounded-lg border border-slate-200/80 bg-white shadow-sm" data-testid={testid}>
    <dl className="divide-y divide-slate-100">{children}</dl>
    {footer}
  </div>
);

export const ConsultationsBoard = ({ branchId, viewerRole, externalStageFilter, showOwnStageBar = true, autoOpenLeadId, onAutoOpened, externalDate, hideDateFilter = false, onCountChange, onRowsChange, externalSearch, externalDateFilter, reloadToken, mobileCards = false, toolbarSlot = null }) => {
  const isConsultant = viewerRole === "head_physio";
  // Head Physio tracks progress on their own independent pipeline (head_consultation_stage),
  // fully separate from Branch's own consultation_stage pipeline.
  const stageField = isConsultant ? "head_consultation_stage" : "consultation_stage";
  const [board, setBoard] = useState({ leads: [], stage_counts: {} });
  const [stages, setStages] = useState([]); // dynamic Consultation Stages, from Super Admin > Pipeline Stage Management
  const [stageFilter, setStageFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null — filters by appointment date
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [timelineRemarks, setTimelineRemarks] = useState([]);
  const [timelineActivity, setTimelineActivity] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, time, remarks } | null
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [loading, setLoading] = useState(false);

  // Head Physio's own diagnosis report — separate from Pre-Sales' read-only `diagnosis`
  const [physioDiagDraft, setPhysioDiagDraft] = useState("");
  const [physioDiagEditing, setPhysioDiagEditing] = useState(false);
  const [savingPhysioDiag, setSavingPhysioDiag] = useState(false);
  const physioDiagDebounceRef = useRef(null);
  // What has been typed but is not yet known to be on the server. "Done" used to flush the
  // debounce before it closed the box; with the button gone, closing the popup inside the
  // 800ms window would otherwise drop the last keystrokes silently. Holds the lead id too,
  // because the flush runs after selectedLead has already been cleared.
  const pendingWriteRef = useRef({ leadId: null, diag: null, treat: null });

  // Head Physio's treatment plan summary
  const [treatmentDraft, setTreatmentDraft] = useState("");
  const [treatmentEditing, setTreatmentEditing] = useState(false);
  const [savingTreatment, setSavingTreatment] = useState(false);
  const treatmentDebounceRef = useRef(null);
  // The catalogue behind Treatment Summary's tick-list — Super Admin > Treatment. Empty
  // until someone fills it, and the box falls back to free text while it is, so a clinic
  // that has not populated it can still finish a consultation.
  const [treatmentTypes, setTreatmentTypes] = useState([]);

  // Collect Fee popup (Branch Admin only) — at the Consultation Fee stage, Cash/UPI/Card only
  const [collectFeeDraft, setCollectFeeDraft] = useState(null); // { amount, payment_mode } | null
  const [collectingFee, setCollectingFee] = useState(false);
  // Second-step popup — only opens if the entered amount doesn't match the assigned
  // package price (needs an explicit "yes, that's right" confirm) and/or the chosen
  // mode needs its own extra fields (UPI Transaction ID/UTR, Card account details).
  // Cash at the expected amount skips this entirely and submits straight away.
  const [packageConfirmDraft, setPackageConfirmDraft] = useState(null);

  // Shown after a fee is actually taken — the money has changed hands and the client is
  // standing there, so the acknowledgement has to be something that can be handed over,
  // not a toast that disappears. Lives outside the lead dialog so it survives that
  // closing on the last fee.
  const [receipt, setReceipt] = useState(null);

  // A lead carries branch_id but no branch name — the schema has never had one — so the
  // receipt's branch line was silently falling back to the generic strapline. Resolve it
  // from the branch list, keyed by the lead's own branch_id rather than this board's
  // branchId, because a Head Physio's board runs across every branch at once.
  const [branchNames, setBranchNames] = useState({});
  useEffect(() => {
    let alive = true;
    getBranches()
      .then((rows) => {
        if (!alive) return;
        setBranchNames(Object.fromEntries((rows || []).map((b) => [b.id, b.branch_name])));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  /** Every fee path builds its receipt here, so they can't drift apart field by field. */
  const makeReceipt = ({ lead, payload, prefix, paidFor, packageName, assignedPrice, kind = "paid", sessionsCovered, balanceDue, installments, transactionId }) => {
    const amount = payload.amount;
    // A Branch-Admin-negotiated amount below the assigned price is a discount, and the
    // receipt has to show both numbers or it reads as though the price was simply lower.
    const discount = assignedPrice != null && assignedPrice > amount
      ? Math.round((assignedPrice - amount) * 100) / 100
      : null;
    return {
      kind,
      // The server's Transaction ID, assigned when the money was taken and stored on the
      // record — so reprinting this receipt shows the same number, and the number can be
      // searched for. A Partial Payment *schedule* moves no money and has no transaction,
      // so it keeps a local reference built from the patient number instead.
      receiptNo: transactionId
        || `${prefix}-${(lead.patient_number || lead.id || "").toString().slice(-8).toUpperCase()}-${Date.now().toString().slice(-6)}`,
      dateLabel: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      patient: lead.name || "—",
      patientNo: lead.patient_number || "—",
      phone: lead.phone || "—",
      branch: lead.branch_name || branchNames[lead.branch_id] || "",
      paidFor,
      packageName: packageName || "",
      sessionsCovered: sessionsCovered || "",
      balanceDue: balanceDue || "",
      installments: installments || [],
      amount,
      originalAmount: assignedPrice != null ? assignedPrice : null,
      discount,
      modeLabel: ALL_PAYMENT_MODE_LABELS[payload.payment_mode] || payload.payment_mode,
      reference: paymentReference(payload),
      collectedBy: "Branch Admin",
      isCash: payload.payment_mode === "cash",
    };
  };

  /**
   * Builds and shows a receipt for a payment that has already gone through.
   *
   * Guarded on its own because it runs after the money is collected: if building the
   * document fails the payment still stands, so it says exactly that instead of letting
   * the error reach the collect handler's catch, which would announce a failure to
   * collect and invite a second charge.
   */
  const showReceipt = (build) => {
    try {
      setReceipt(build());
    } catch {
      toast.message("Payment saved — the receipt couldn't be produced. Find it under Accountant Manage.");
    }
  };

  // Collect Treatment Fee popup (Branch Admin only) — at the Treatment Fee stage, any payment method
  const [treatmentFeeDraft, setTreatmentFeeDraft] = useState(null); // { paid_amount, payment_mode } | null
  const [collectingTreatmentFee, setCollectingTreatmentFee] = useState(false);
  // Same second-step confirm popup as packageConfirmDraft above, but for Cash/UPI/Card
  // on the Treatment Fee. Cheque and Partial Payment keep their existing single-popup
  // flow (locked amount, no manual override, no confirm step).
  const [treatmentConfirmDraft, setTreatmentConfirmDraft] = useState(null);

  // Partial Payment schedule's own per-row Collect popup — collecting one specific
  // installment is a real payment in its own right (amount, mode, UTR/cheque number),
  // same as every other Treatment Fee mode, not just a bare "mark paid" flip.
  const [partialCollectDraft, setPartialCollectDraft] = useState(null); // { idx, amount, payment_mode, ... } | null

  // Diet Consultation Fee (Branch Admin only). Collected in one go like the Consultation
  // Fee rather than in installments like the Treatment Fee — a diet consultation is a
  // single visit at a single price, so there is no schedule to spread.
  //
  // The Diet Package is chosen here, not upstream: the Head Physio picks a treatment
  // package during their decision but never a diet one, because diet is optional and
  // often decided after treatment is under way.
  const [dietFeeDraft, setDietFeeDraft] = useState(null); // { item_id, mode, payment_mode, amount } | null
  // The Rehab course fee. One popup rather than the diet fee's two: the course and its
  // price were settled by the Consultant, so there is nothing to choose before
  // confirming — only the amount, which a discount can still move.
  const [rehabFeeDraft, setRehabFeeDraft] = useState(null);
  const [collectingRehabFee, setCollectingRehabFee] = useState(false);
  const [dietFeeConfirmDraft, setDietFeeConfirmDraft] = useState(null);
  const [collectingDietFee, setCollectingDietFee] = useState(false);
  const [dietItems, setDietItems] = useState([]);

  // Physio Assign (Branch Admin only) — two steps. Step 1 picks an available Jr. Physio;
  // clicking one opens step 2, the slot picker, where every session of the paid package is
  // placed on a *chosen* date and time from that physio's own PHYSIO CALENDAR. The dates
  // are never auto-filled: a treatment plan is spread across days deliberately, so the
  // Branch Admin fixes each session's date and time themselves.
  const [showPhysioModal, setShowPhysioModal] = useState(false);
  // Which programme record is open in the lead panel: "diet", "rehab", or neither.
  // Which view of the lead panel is on screen: "own" (the stage itself), "diet" or
  // "rehab". A tab selects a view outright — pressing the lit one again used to hide it
  // and drop the reader back onto a different panel, which is not what a tab does.
  const [programmeDetail, setProgrammeDetail] = useState("own");
  // Whether this patient has anything on file at all. Consultation Visit will not take a
  // payment until they do — see the panel — so this has to be known before the button is
  // drawn rather than discovered when it is pressed. Bumped by the uploader so the gate
  // opens on the upload rather than on a reload.
  const [leadDocCount, setLeadDocCount] = useState(null); // null = not counted yet
  const [docTick, setDocTick] = useState(0);
  useEffect(() => {
    if (!selectedLead?.id) { setLeadDocCount(null); return; }
    let cancelled = false;
    setLeadDocCount(null);
    leadDocuments(selectedLead.id)
      .then((r) => { if (!cancelled) setLeadDocCount((r?.documents || []).length); })
      // Counted as none rather than left unknown: an upload screen that cannot say whether
      // anything is there should ask for one, not quietly wave the patient through.
      .catch(() => { if (!cancelled) setLeadDocCount(0); });
    return () => { cancelled = true; };
  }, [selectedLead?.id, docTick]);
  // Closed whenever a different patient is opened: a Diet card left standing would
  // otherwise read as the new patient's, with the previous one's figures still in it.
  useEffect(() => { setProgrammeDetail("own"); }, [selectedLead?.id]);
  const [assignTrack, setAssignTrack] = useState("treatment"); // "treatment" | "rehab"
  const [physioOptions, setPhysioOptions] = useState([]);
  const [physioPick, setPhysioPick] = useState("");
  const [assigningPhysio, setAssigningPhysio] = useState(false);
  const [physioCalendarData, setPhysioCalendarData] = useState(null);
  const [loadingPhysioCalendar, setLoadingPhysioCalendar] = useState(false);
  // Step 2 — the "pick the treatment dates and times" popup.
  const [showSlotPicker, setShowSlotPicker] = useState(false);
  const [pickedSessionSlots, setPickedSessionSlots] = useState([]); // ["YYYY-MM-DDTHH:MM", ...]
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [pickerDate, setPickerDate] = useState(null); // "YYYY-MM-DD"
  const [sessionMinutes, setSessionMinutes] = useState(FALLBACK_SESSION_MINUTES);

  // Diet Appointment (Branch Admin only) — books the Diet Consultation.
  //
  // Diet is a consultation vertical, the same shape as the Head Physio's: the Nutrition
  // Coach sees the patient once to read them and set a plan. So this books ONE slot on
  // the coach's calendar, not a course of days — the counterpart to booking a Head Physio
  // consultation, not to Assign Physio.
  //
  // Two steps all the same, because the coach's calendar is a month of published days and
  // a flat list of every time in it is unreadable: pick the coach, then pick the day and
  // the time on a month grid of what that coach has actually opened.
  //
  // Offered on both paths on purpose. Diet normally follows treatment, but a patient can
  // come for a diet consultation and nothing else, so nothing here requires a physio or a
  // treatment package — only that the Consultation Fee is in.
  const [showDietModal, setShowDietModal] = useState(false);
  const [coachOptions, setCoachOptions] = useState([]);
  const [coachPick, setCoachPick] = useState("");
  const [coachCalendar, setCoachCalendar] = useState(null);
  const [loadingCoachCalendar, setLoadingCoachCalendar] = useState(false);
  const [dietSlot, setDietSlot] = useState(""); // "YYYY-MM-DDTHH:MM"
  const [assigningDiet, setAssigningDiet] = useState(false);
  // Step 2 — the "pick the consultation date and time" popup.
  const [showDietSlotPicker, setShowDietSlotPicker] = useState(false);
  const [dietPickerMonth, setDietPickerMonth] = useState(new Date().getMonth());
  const [dietPickerYear, setDietPickerYear] = useState(new Date().getFullYear());
  const [dietPickerDate, setDietPickerDate] = useState(null); // "YYYY-MM-DD"
  const [dietMinutes, setDietMinutes] = useState(FALLBACK_SESSION_MINUTES);

  // Treatment (Head Physio only) — "Save & Move": Diagnosis Report + Treatment Summary
  // have to be written first, but no add-on has to be picked — every toggle starts off,
  // which submits as a plain Consultation, the same as a patient who needs nothing else.
  // Picking Treatment reveals the Treatment Package (names only, no prices shown here).
  const [decisionDraft, setDecisionDraft] = useState({ treatment: false, diet: false, rehab: false, fitness: false, zumba: false, item_id: "", rehab_item_id: "", zumba_item_id: "", mode: "offline", sessionsPerWeek: "" });
  const [savingDecision, setSavingDecision] = useState(false);
  // The confirmation shown after a decision saves, and the flag that reopens the form
  // behind it. Both clear when the popup moves to another lead.
  const [decisionReceipt, setDecisionReceipt] = useState(null);
  const [editingDecision, setEditingDecision] = useState(false);

  // Mark Consultation Completed (Branch Admin only) — "Consultation Only" patients, at
  // the Fee Collected stage.
  const [completingConsultation, setCompletingConsultation] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getConsultationsBoard(branchId, isConsultant ? "head_consultation" : undefined);
        if (!cancelled) setBoard(res);
      } catch (err) {
        console.error("Consultations board load error:", err);
        if (!cancelled) toast.error("Failed to load consultations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const res = await getConsultationsBoard(branchId, isConsultant ? "head_consultation" : undefined);
      setBoard(res);
    } catch (err) {
      console.error("Consultations board load error:", err);
      toast.error("Failed to load consultations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  // Date Filter + search only — deliberately excludes the stage-pill filter, so this can
  // also drive the per-stage counts below (counting by stage after narrowing to
  // "everything in the date range", not after already narrowing to one stage).
  const dateAndSearchFiltered = useMemo(() => {
    let rows = board.leads || [];
    if (dateFilter) {
      const from = dateFilter.from?.getTime();
      const to = dateFilter.to?.getTime();
      rows = rows.filter((l) => {
        if (!l.appointment_date) return false;
        const ts = new Date(`${l.appointment_date}T00:00:00`).getTime();
        if (!ts) return false;
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((l) => `${l.name || ""} ${l.phone || ""}`.toLowerCase().includes(q));
    }
    return rows;
  }, [board.leads, dateFilter, search]);

  // "Treatments" (Head Physio's own board only) is a cross-cutting view, not a real
  // position in the head_consultation_stage pipeline — a lead shows up here the moment
  // any Treatment Fee amount is collected, while staying visible under "Consultation
  // Visit" too, since head_consultation_stage itself never actually changes to
  // "Treatments" (there's nothing to "leave" for it to count as a real stage move).
  const matchesStage = useCallback((lead, stageName) => {
    if (isConsultant && stageName === "Treatments") return lead.treatment_fee_paid != null;
    // Diet Consultation is a stage nothing writes — see matchesConsultationStage in
    // BranchAdminBoard for why it is read off the lead's diet flag instead. Gated to the
    // branch pipeline: the Head Physio's own board runs on head_consultation_stage and has
    // no such stage, so this must not fire there.
    if (!isConsultant && stageName === "Diet Consultation") return !!lead.diet_recommended;
    // Rehab reads off the fee for the same reason Diet reads off its flag — nothing ever
    // writes the stage. Branch pipeline only: the Consultant's own board has no such stage.
    if (!isConsultant && stageName === "Rehab") return lead.rehab_fee_paid != null;
    return lead[stageField] === stageName;
  }, [isConsultant, stageField]);

  const inStage = useMemo(() => {
    if (!stageFilter) return dateAndSearchFiltered;
    return dateAndSearchFiltered.filter((l) => matchesStage(l, stageFilter));
  }, [dateAndSearchFiltered, stageFilter, matchesStage]);

  const showDiscountColumn = stageFilter === "Fee Collected";
  const cols = showDiscountColumn ? COLS_WITH_DISCOUNT : COLS_PLAIN;

  // Which of the three fees the Fee Collected list is showing. Consultation first: it is
  // the fee that puts a patient in this stage, so it is the one that answers "everyone".
  const [feeTab, setFeeTab] = useState("consultation");
  const activeFee = FEE_TABS.find((t) => t.key === feeTab) || FEE_TABS[0];
  // Everyone who paid this tab's own fee. Outside Fee Collected the tabs do not exist,
  // so the stage's rows pass through whole.
  const filtered = useMemo(
    () => (showDiscountColumn ? inStage.filter((l) => activeFee.paid(l) > 0) : inStage),
    [inStage, showDiscountColumn, activeFee],
  );

  // Stage counts for the head bar — derived client-side from the Date Filter/search-only
  // list so they always match whichever pipeline (branch vs. head physio) is active for
  // this viewer, and reflect the active filters rather than all-time totals.
  const derivedStageCounts = useMemo(() => {
    const counts = {};
    stages.forEach((s) => { counts[s.name] = dateAndSearchFiltered.filter((l) => matchesStage(l, s.name)).length; });
    return counts;
  }, [dateAndSearchFiltered, stages, matchesStage]);

  // Lets a parent label its own cards without fetching the board's data a second time.
  // The per-stage counts go up too, so a parent that has replaced this board's stage bar
  // with its own controls can still say how many sit behind each one.
  // The stage names go up in pipeline order as well. They're configured in Pipeline Stage
  // Management and get renamed, so a parent driving its own controls has to read them from
  // here rather than hardcoding what they were called when it was written.
  const stageNames = useMemo(() => stages.map((st) => st.name), [stages]);

  useEffect(() => {
    if (onCountChange) onCountChange(dateAndSearchFiltered.length, derivedStageCounts, stageNames);
  }, [dateAndSearchFiltered.length, derivedStageCounts, stageNames, onCountChange]);

  // The rows themselves, for a parent that merges this board's leads into a list of its
  // own. Safe to depend on directly: it's a useMemo, so its identity only changes when
  // the underlying set does.
  useEffect(() => {
    if (onRowsChange) onRowsChange(dateAndSearchFiltered);
  }, [dateAndSearchFiltered, onRowsChange]);

  useEffect(() => {
    listStoreItems().then(setStoreItems).catch(() => setStoreItems([]));
    // Loaded up front, not just when the collect-fee popup opens: the Consultation Visit
    // panel now quotes the Diet Fee before anyone has opened anything.
    listStoreItems(undefined, "diet").then((d) => setDietItems(d || [])).catch(() => setDietItems([]));
    stagesList(isConsultant ? "head_consultation" : "consultation").then(setStages).catch(() => setStages([]));
  }, [isConsultant]);

  // When embedded inside another board (e.g. Branch Leads' unified stage bar), let the
  // parent drive which stage this board is filtered to.
  useEffect(() => {
    if (externalStageFilter !== undefined) setStageFilter(externalStageFilter);
  }, [externalStageFilter]);

  // A parent search box (the Head Physio header's) drives the search, so a phone doesn't
  // need a second one inside a list it has already scrolled past.
  useEffect(() => {
    if (externalSearch !== undefined) setSearch(externalSearch);
  }, [externalSearch]);

  // A parent that owns the whole toolbar (Branch Leads) drives the date filter with the
  // popover's own value, rather than the single ISO day externalDate takes. Same shape as
  // this board's state, so it passes straight through.
  useEffect(() => {
    if (externalDateFilter === undefined) return;
    setDateFilter(externalDateFilter);
  }, [externalDateFilter]);

  // A parent's Refresh button reaching this board's data. Bumping the token reloads;
  // the first value is skipped because the mount effect above has already fetched, and
  // firing here too would double every open of the board.
  const reloadSeen = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken === undefined || reloadToken === reloadSeen.current) return;
    reloadSeen.current = reloadToken;
    load();
  }, [reloadToken, load]);

  // A parent day-picker (the Head Physio board's week strip) drives the date filter, so
  // the board shows one day at a time without its own popover fighting the selection.
  useEffect(() => {
    if (externalDate === undefined) return;
    if (!externalDate) { setDateFilter(null); return; }
    const from = new Date(`${externalDate}T00:00:00`);
    const to = new Date(`${externalDate}T23:59:59`);
    setDateFilter({ from, to, key: externalDate, label: externalDate });
  }, [externalDate]);

  // Branch Leads' own lead popup hands off a specific lead here (rather than duplicating
  // this board's stage-specific popups) — once this board's own data has loaded, find that
  // lead and open its detail modal directly.
  useEffect(() => {
    if (!autoOpenLeadId || !(board.leads || []).length) return;
    const match = board.leads.find((l) => l.id === autoOpenLeadId);
    if (match) {
      setSelectedLead(match);
      onAutoOpened && onAutoOpened();
    }
  }, [autoOpenLeadId, board.leads]);

  const stageColor = useCallback(
    (name) => stages.find((s) => s.name === name)?.color || "#64748b",
    [stages],
  );

  useEffect(() => {
    setPhysioDiagDraft(selectedLead?.physio_diagnosis_report || "");
    setPhysioDiagEditing(!selectedLead?.physio_diagnosis_report);
    setTreatmentDraft(selectedLead?.treatment_summary || "");
    setTreatmentEditing(!selectedLead?.treatment_summary);
    setShowPhysioModal(false);
    setPhysioPick("");
    setFollowUpDraft(null);
    setRescheduleDraft(null);
    setCollectFeeDraft(null);
    setTreatmentFeeDraft(null);
    setDecisionDraft({ treatment: false, diet: false, rehab: false, fitness: false, zumba: false, item_id: "", rehab_item_id: "", zumba_item_id: "", mode: "offline", sessionsPerWeek: "" });
    setDecisionReceipt(null);
    setEditingDecision(false);
  }, [selectedLead?.id]);

  useEffect(() => {
    getTreatmentTypes().then(setTreatmentTypes).catch(() => setTreatmentTypes([]));
  }, []);

  useEffect(() => {
    if (!selectedLead?.id || detailTab !== "timeline") return;
    getLeadRemarks(selectedLead.id).then(setTimelineRemarks).catch(() => setTimelineRemarks([]));
    getLeadActivity(selectedLead.id).then(setTimelineActivity).catch(() => setTimelineActivity([]));
  }, [selectedLead?.id, detailTab]);

  // Session packages (weeks/session-count items) — the Treatment Package chosen
  // as part of the Consultation Decision (Consultation + Treatment only).
  //
  // Physiotherapy only. Rehab, Zumba and Fitness are written as session items too, so a
  // bare item_type check offered a Zumba class as a Treatment Package. An item saved
  // before the other shelves existed carries no category and is a treatment package by
  // definition, so it keeps its place here.
  const treatmentPackageItems = storeItems.filter((i) => i.item_type === "session" && (i.category || "physiotherapy") === "physiotherapy");
  // The Rehab shelf, offered beside the referral itself. A rehab course is a session item
  // under its own category and is priced the same way — a per-session rate whose total is
  // the rate times the course's session count.
  const rehabPackageItems = storeItems.filter((i) => i.item_type === "session" && i.category === "rehab");
  // The Zumba shelf. Its plan amount is stored divided down to a per-class rate, exactly
  // like a rehab course, so the same rate-times-count arithmetic returns the plan price.
  const zumbaPackageItems = storeItems.filter((i) => i.item_type === "session" && i.category === "zumba");

  const moveStage = async (lead, next) => {
    if (next === lead.consultation_stage) return;
    try {
      const updated = await moveConsultationStage(lead.id, next);
      toast.success(`${lead.name || "Lead"} moved → ${next}`);
      setSelectedLead(null);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === lead.id ? { ...l, consultation_stage: updated.consultation_stage } : l) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
    }
  };

  // ---- Consultation Decision (Head Physio) — "Save & Move" ----
  const submitConsultationDecision = async () => {
    if (!(selectedLead.physio_diagnosis_report || "").trim()) { toast.error("Write the Diagnosis Report first"); return; }
    if (!(selectedLead.treatment_summary || "").trim()) { toast.error("Write the Treatment Summary first"); return; }

    // No add-on picked submits as a plain Consultation — that's a valid, common outcome
    // (the patient needs nothing further today), not an incomplete form. Only Treatment
    // demands anything more: its package.
    const decision = decisionDraft.treatment ? "consultation_treatment" : "consultation_only";
    let payload = {
      decision,
      diet_recommended: decisionDraft.diet,
      rehab_referred: decisionDraft.rehab,
      // Only meaningful with the referral, and the server enforces the same pairing.
      rehab_item_id: decisionDraft.rehab ? decisionDraft.rehab_item_id || null : null,
      fitness_recommended: decisionDraft.fitness,
      zumba_recommended: decisionDraft.zumba,
      zumba_item_id: decisionDraft.zumba ? decisionDraft.zumba_item_id || null : null,
      mode: decisionDraft.mode,
    };
    if (decisionDraft.treatment) {
      if (!decisionDraft.item_id) { toast.error("Select a Treatment Package"); return; }
      const item = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
      const weeks = weeksFromPackageName(item?.name);
      if (!weeks) { toast.error("Couldn't read a week count from this package's name"); return; }
      const perWeek = parseInt(decisionDraft.sessionsPerWeek, 10) || 0;
      if (!perWeek) { toast.error("Enter sessions per week"); return; }
      payload = { ...payload, item_id: decisionDraft.item_id, sessions_override: weeks * perWeek };
    }
    setSavingDecision(true);
    try {
      const res = await saveConsultationDecision(selectedLead.id, payload);
      toast.success(decisionDraft.rehab ? "Saved — patient moved to Rehab" : "Saved & moved to Branch Admin");
      // The lead stays open behind the confirmation rather than the board closing it. The
      // popup's three actions all act on this patient, and two of them — Edit and Share —
      // have nothing to work with once the record underneath has gone.
      setEditingDecision(false);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
      setSelectedLead(res.lead);
      const pkg = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
      setDecisionReceipt({
        leadId: res.lead.id,
        name: res.lead.name || "Unknown",
        patientNo: res.lead.patient_number || "",
        phone: res.lead.phone || "",
        planLabel: addonsLabel(decisionDraft),
        packageName: decisionDraft.treatment ? (pkg?.name || res.lead.session_package_name || "") : "",
        perWeek: parseInt(decisionDraft.sessionsPerWeek, 10) || 0,
        weeks: weeksFromPackageName(pkg?.name) || 0,
        rehab: decisionDraft.rehab,
      });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save");
    }
    setSavingDecision(false);
  };

  // The saved decision in the shape the receipt and the share text both read.
  const decisionSummaryOf = (lead) => {
    const weeks = weeksFromPackageName(lead.session_package_name);
    const total = lead.session_package_sessions || 0;
    return {
      leadId: lead.id,
      name: lead.name || "Unknown",
      patientNo: lead.patient_number || "",
      phone: lead.phone || "",
      planLabel: addonsLabel({
        treatment: lead.consultation_decision === "consultation_treatment",
        diet: !!lead.diet_recommended,
        rehab: !!lead.rehab_referred,
        fitness: !!lead.fitness_recommended,
        zumba: !!lead.zumba_recommended,
      }),
      packageName: lead.session_package_name || "",
      weeks: weeks || 0,
      perWeek: weeks && total ? Math.round(total / weeks) : 0,
      rehab: !!lead.rehab_referred,
    };
  };

  // Edit reopens the form on what was saved. Seeded from the lead rather than left on the
  // draft's defaults, or the first save would rewrite the choice to whatever the form
  // happened to be showing.
  const beginEditDecision = (lead) => {
    const weeks = weeksFromPackageName(lead.session_package_name);
    const total = lead.session_package_sessions || 0;
    setDecisionDraft({
      treatment: lead.consultation_decision === "consultation_treatment",
      diet: !!lead.diet_recommended,
      rehab: !!lead.rehab_referred,
      fitness: !!lead.fitness_recommended,
      zumba: !!lead.zumba_recommended,
      item_id: lead.session_package_id || "",
      rehab_item_id: lead.rehab_package_id || "",
      zumba_item_id: lead.zumba_package_id || "",
      mode: lead.consultation_mode || "offline",
      sessionsPerWeek: weeks && total ? String(Math.round(total / weeks)) : "",
    });
    setDecisionReceipt(null);
    setEditingDecision(true);
  };

  // ---- Mark Consultation Completed (Branch Admin) — "Consultation Only" patients ----
  const submitMarkCompleted = async () => {
    setCompletingConsultation(true);
    try {
      const res = await markConsultationCompleted(selectedLead.id);
      toast.success("Consultation marked completed");
      setSelectedLead(null);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to mark completed");
    }
    setCompletingConsultation(false);
  };

  const applyUpdatedLead = (updatedLead) => {
    setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === updatedLead.id ? updatedLead : l) }));
    setSelectedLead(updatedLead);
  };

  // ---- Head Physio's diagnosis report (separate from Pre-Sales' read-only diagnosis) ----
  // Auto-saves (debounced, silent — no toast) while typing; never re-locks a record, so
  // once opened for editing it just keeps saving in place until "Done" is clicked.
  const autoSavePhysioDiag = async (text) => {
    if (!text.trim()) return;
    setSavingPhysioDiag(true);
    try {
      const updated = await savePhysioDiagnosis(selectedLead.id, text.trim(), false);
      applyUpdatedLead(updated);
      if (pendingWriteRef.current.diag === text) pendingWriteRef.current.diag = null;
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save diagnosis report");
    }
    setSavingPhysioDiag(false);
  };

  const handlePhysioDiagChange = (text) => {
    setPhysioDiagDraft(text);
    pendingWriteRef.current.leadId = selectedLead?.id || null;
    pendingWriteRef.current.diag = text;
    if (physioDiagDebounceRef.current) clearTimeout(physioDiagDebounceRef.current);
    physioDiagDebounceRef.current = setTimeout(() => autoSavePhysioDiag(text), 800);
  };

  const unlockPhysioDiag = async () => {
    try {
      const updated = await unlockPhysioDiagnosis(selectedLead.id);
      applyUpdatedLead(updated);
      setPhysioDiagEditing(true);
    } catch (err) {
      toast.error("Failed to unlock diagnosis report");
    }
  };

  // ---- Head Physio's treatment summary ----
  const autoSaveTreatment = async (text) => {
    // Empty writes through, unlike the diagnosis box above. With a tick-list, clearing the
    // last box is a deliberate act; refusing it would leave the old summary on the server
    // while the screen showed nothing ticked. Only ever reached from a user edit — the
    // draft is seeded by setTreatmentDraft, which does not route through here.
    setSavingTreatment(true);
    try {
      const updated = await saveTreatmentSummary(selectedLead.id, text.trim(), false);
      applyUpdatedLead(updated);
      if (pendingWriteRef.current.treat === text) pendingWriteRef.current.treat = null;
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save treatment summary");
    }
    setSavingTreatment(false);
  };

  const handleTreatmentChange = (text) => {
    setTreatmentDraft(text);
    pendingWriteRef.current.leadId = selectedLead?.id || null;
    pendingWriteRef.current.treat = text;
    if (treatmentDebounceRef.current) clearTimeout(treatmentDebounceRef.current);
    treatmentDebounceRef.current = setTimeout(() => autoSaveTreatment(text), 800);
  };

  // Writes out anything still in flight when the popup closes or moves to another lead.
  // This is what "Done" used to do, minus the button: it cancels the pending debounce and
  // saves that text immediately, against the lead it was actually typed for.
  const openLeadId = selectedLead?.id;
  useEffect(() => {
    if (!openLeadId) return undefined;
    return () => {
      if (physioDiagDebounceRef.current) { clearTimeout(physioDiagDebounceRef.current); physioDiagDebounceRef.current = null; }
      if (treatmentDebounceRef.current) { clearTimeout(treatmentDebounceRef.current); treatmentDebounceRef.current = null; }
      const p = pendingWriteRef.current;
      if (p.leadId !== openLeadId) return;
      if (p.diag && p.diag.trim()) savePhysioDiagnosis(openLeadId, p.diag.trim(), false).catch(() => {});
      // `!== null` rather than truthy: p.treat is only set by an edit, so an empty string
      // here means the boxes were deliberately cleared and that has to reach the server.
      if (p.treat !== null) saveTreatmentSummary(openLeadId, p.treat.trim(), false).catch(() => {});
      pendingWriteRef.current = { leadId: null, diag: null, treat: null };
    };
  }, [openLeadId]);

  const unlockTreatment = async () => {
    try {
      const updated = await unlockTreatmentSummary(selectedLead.id);
      applyUpdatedLead(updated);
      setTreatmentEditing(true);
    } catch (err) {
      toast.error("Failed to unlock treatment summary");
    }
  };

  // ---- Collect Fee (Branch Admin) — at the Consultation Visit stage ----
  // The amount defaults to the assigned package_price but Branch Admin can edit it
  // if a different amount was actually collected. If the Head Physio's decision was
  // "Consultation + Treatment" and the Treatment Fee hasn't been paid yet, its draft
  // opens alongside this one so both fees are collected together in one popup.
  const openCollectFeeDraft = () => {
    setCollectFeeDraft({
      payment_mode: selectedLead.package_payment_mode || "cash",
      amount: selectedLead.package_paid ?? selectedLead.package_price ?? "",
    });
    if (selectedLead.consultation_decision === "consultation_treatment" && selectedLead.treatment_fee_paid == null) {
      openTreatmentFeeDraft();
    }
  };

  // ---- Collect Treatment Fee (Branch Admin) — for "Consultation + Treatment"
  // patients only. The Treatment Package and its price are locked in from what the
  // Head Physio already chose at Save & Move — neither is editable here. Normally
  // opened together with the Consultation Fee draft above; also independently
  // reachable from the Fee Collected panel as a fallback if it wasn't collected
  // together the first time.
  function openTreatmentFeeDraft() {
    // A Partial Payment schedule that already exists on the lead (whether or not
    // every installment is collected yet) is reloaded from the real saved rows —
    // never reset back to two blank ones — so reopening this always shows what's
    // actually still owed, with already-collected rows carrying their paid flag.
    const total = selectedLead.session_package_sessions || 0;
    const rate = total ? (selectedLead.session_package_price || 0) / total : 0;
    const existing = selectedLead.treatment_fee_payment_details?.installments;
    setTreatmentFeeDraft({
      payment_mode: selectedLead.treatment_fee_payment_mode || "cash",
      amount: selectedLead.treatment_fee_paid ?? selectedLead.session_package_price ?? "",
      bank_name: "",
      cheque_number: "",
      // Cash/UPI/Card/Cheque default to covering every session (today's full
      // Collect behavior) — reducing this reveals a Due Date for the balance.
      sessions_now: selectedLead.session_package_sessions ?? "",
      balance_due_date: "",
      // First installment defaults to today — it's the one being collected right now;
      // later installments get their own scheduled due date.
      partial_installments: existing && existing.length
        ? existing.map((inst) => ({
            sessions: rate ? String(Math.round((inst.amount || 0) / rate)) : "",
            due_date: inst.due_date || "",
            paid: !!inst.paid,
          }))
        : [
            { sessions: "", due_date: new Date().toISOString().slice(0, 10) },
            { sessions: "", due_date: "" },
          ],
    });
  }

  // Jumps straight to the Payment Schedule view (skipping the mode-picker click)
  // for a lead whose Partial Payment plan already exists — used by both the
  // combined "Collect Fees" popup and the Fee Collected side panel once
  // hasPendingInstallments is true.
  const openPartialScheduleDraft = () => {
    openTreatmentFeeDraft();
    setTreatmentConfirmDraft({ upi_transaction_id: "", account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "" });
  };

  // Partial Payment is split by session count, not a raw amount — each installment's
  // amount is derived from how many of the package's sessions it covers, at the
  // package's own per-session rate, so the numbers always agree with "N sessions x
  // Rs.rate/session" shown elsewhere. Total to split is the locked-in
  // session_package_price/session_package_sessions, never client-editable fields.
  const treatmentFeeTotal = selectedLead?.session_package_price || 0;
  const treatmentFeeTotalSessions = selectedLead?.session_package_sessions || 0;
  const perSessionRate = treatmentFeeTotalSessions ? treatmentFeeTotal / treatmentFeeTotalSessions : 0;
  const partialInstallments = treatmentFeeDraft?.partial_installments || [];
  const partialSessionsTotal = partialInstallments.reduce((sum, i) => sum + (parseInt(i.sessions, 10) || 0), 0);
  const partialMismatch = treatmentFeeTotalSessions > 0 && partialSessionsTotal !== treatmentFeeTotalSessions;
  const partialAllFilled = partialInstallments.length >= 2 && partialInstallments.every((i) => parseInt(i.sessions, 10) > 0 && i.due_date);

  // A Partial Payment schedule leaves treatment_fee_paid set (the full price) the
  // moment it's created — even though nothing may actually be collected yet — so
  // "already collected" everywhere else in this file has to be read together with
  // whether any installment is still unpaid, not treatment_fee_paid alone.
  const savedInstallments = selectedLead?.treatment_fee_payment_details?.installments || [];
  const hasPendingInstallments = selectedLead?.treatment_fee_payment_mode === "partial" && savedInstallments.some((i) => !i.paid);

  // Cash/UPI/Card/Cheque can ALSO collect for only some sessions right now (e.g.
  // 5 of 10) — same session-split math as Partial Payment, but as a single
  // "pay now" / "balance due later" split rather than a full pre-planned schedule.
  const treatmentSessionsNowRaw = treatmentFeeDraft?.sessions_now;
  const treatmentSessionsNow = treatmentSessionsNowRaw === "" || treatmentSessionsNowRaw == null
    ? treatmentFeeTotalSessions
    : (parseInt(treatmentSessionsNowRaw, 10) || 0);
  const treatmentIsPartialSessions = treatmentFeeTotalSessions > 0 && treatmentSessionsNow > 0 && treatmentSessionsNow < treatmentFeeTotalSessions;
  const treatmentComputedAmount = treatmentFeeTotalSessions ? Math.round(treatmentSessionsNow * perSessionRate * 100) / 100 : treatmentFeeTotal;
  const treatmentRemainingSessions = treatmentFeeTotalSessions - treatmentSessionsNow;
  const treatmentRemainingAmount = Math.round((treatmentFeeTotal - (parseFloat(treatmentFeeDraft?.amount) || treatmentComputedAmount)) * 100) / 100;

  // Changing "Sessions Covered Now" re-computes the Treatment Fee amount to match
  // (still hand-editable afterward for a discount, same as the full-package flow).
  const setTreatmentSessionsNow = (value) => {
    const sessionsNum = value === "" ? treatmentFeeTotalSessions : (parseInt(value, 10) || 0);
    const computed = treatmentFeeTotalSessions ? Math.round(sessionsNum * perSessionRate * 100) / 100 : treatmentFeeTotal;
    setTreatmentFeeDraft({ ...treatmentFeeDraft, sessions_now: value, amount: computed });
  };

  // Attaches sessions_now/balance_due_date to a Cash/UPI/Card/Cheque payload when
  // this collection doesn't cover every session — validates the balance Due Date
  // is filled in first. Returns null (after a toast) if validation fails.
  const attachSessionsSplit = (payload) => {
    if (!treatmentIsPartialSessions) return payload;
    if (!treatmentFeeDraft.balance_due_date) {
      toast.error("Enter a Due Date for the balance sessions");
      return null;
    }
    return { ...payload, sessions_now: treatmentSessionsNow, balance_due_date: treatmentFeeDraft.balance_due_date };
  };

  // Shared validation for Cheque/Partial Payment's own fields — Cash/UPI/Card
  // don't use this at all, they go through the separate confirm-popup flow below
  // since their amount is editable and (for UPI/Card) they need their own fields.
  const buildTreatmentFeePayload = () => {
    const mode = treatmentFeeDraft.payment_mode;
    const payload = { payment_mode: mode };
    if (mode === "cheque") {
      if (!treatmentFeeDraft.bank_name.trim() || !treatmentFeeDraft.cheque_number.trim()) {
        toast.error("Bank Name and Cheque Number are required");
        return null;
      }
      payload.bank_name = treatmentFeeDraft.bank_name.trim();
      payload.cheque_number = treatmentFeeDraft.cheque_number.trim();
      return attachSessionsSplit(payload);
    } else if (mode === "partial") {
      if (!partialAllFilled) {
        toast.error("Every installment needs a session count and a due date");
        return null;
      }
      if (partialMismatch) {
        toast.error("Installment sessions must add up to the Total Sessions");
        return null;
      }
      payload.partial_installments = partialInstallments.map((i) => ({
        amount: Math.round((parseInt(i.sessions, 10) || 0) * perSessionRate),
        due_date: i.due_date,
      }));
    }
    return payload;
  };

  // Clicking "Collect Consultation Fee" in the main popup always opens the
  // second "Confirm Payment" popup — a simple, explicit confirm/cancel step
  // (with the amount still editable there) before anything is actually saved.
  const startCollectConsultationFee = () => {
    const amount = parseFloat(collectFeeDraft.amount);
    if (!(amount > 0)) {
      toast.error("Enter a valid Consultation Fee amount");
      return;
    }
    setPackageConfirmDraft({ upi_transaction_id: "", account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "", transfer_reference: "" });
  };

  // Card and Account Transfer share the same four bank fields; Account Transfer also
  // needs the reference the money arrived under. Returns false (after a toast) if any
  // required field is blank, so both fee flows validate them identically.
  const attachBankDetails = (payload, draft, mode) => {
    if (!draft.account_number.trim() || !draft.account_holder_name.trim() || !draft.bank_name.trim() || !draft.ifsc_code.trim()) {
      toast.error("Account Number, Account Holder Name, Bank Name and IFSC Code are required");
      return false;
    }
    if (mode === "account_transfer" && !draft.transfer_reference.trim()) {
      toast.error("Reference / UTR No. is required for an Account Transfer");
      return false;
    }
    payload.account_number = draft.account_number.trim();
    payload.account_holder_name = draft.account_holder_name.trim();
    payload.bank_name = draft.bank_name.trim();
    payload.ifsc_code = draft.ifsc_code.trim();
    if (mode === "account_transfer") payload.transfer_reference = draft.transfer_reference.trim();
    return true;
  };

  // Confirm button inside the second "Confirm Payment" popup — validates
  // UPI/Card/Account Transfer's own fields (Cash just needed the mismatch acknowledged).
  const confirmCollectConsultationFee = () => {
    const amount = parseFloat(collectFeeDraft.amount);
    const mode = collectFeeDraft.payment_mode;
    const payload = { payment_mode: mode, amount, confirmed: true };
    if (mode === "upi") {
      payload.upi_transaction_id = packageConfirmDraft.upi_transaction_id.trim();
    } else if (BANK_DETAIL_MODES.includes(mode)) {
      if (!attachBankDetails(payload, packageConfirmDraft, mode)) return;
    }
    submitConsultationFee(payload);
  };

  // Actually calls the API. Leaves the Treatment Fee section (if present)
  // untouched and open for its own button.
  async function submitConsultationFee(payload) {
    setCollectingFee(true);
    // Only the call is guarded. Anything below runs after the money is already taken,
    // and a failure there must never be reported as a failure to collect — that reads
    // as "try again" and the branch collects a second time.
    let res;
    try {
      res = await collectPackagePayment(selectedLead.id, payload);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect Consultation Fee");
      setCollectingFee(false);
      return;
    }
    setCollectingFee(false);

    toast.success(selectedLead.package_paid != null ? "Consultation Fee payment updated" : "Consultation Fee collected");
    setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
    setPackageConfirmDraft(null);
    // The receipt closes on its own button; the patient stays open behind it so the
    // Treatment Fee can be taken next without reopening them.
    setCollectFeeDraft(null);
    setTreatmentFeeDraft(null);
    setSelectedLead(res.lead);
    showReceipt(() => makeReceipt({
      lead: selectedLead, payload, prefix: "CF",
      paidFor: "Consultation Fee",
      packageName: selectedLead.package_name || "",
      assignedPrice: selectedLead.package_price,
      transactionId: res.transaction_id,
    }));
  }

  // Clicking one of the 5 Payment Mode buttons opens that mode's own dedicated
  // popup — every mode (including Cash) now goes through its own explicit
  // "Collect" step there, rather than sharing one form with a mode selector.
  const chooseTreatmentPaymentMode = (mode) => {
    setTreatmentFeeDraft({ ...treatmentFeeDraft, payment_mode: mode });
    setTreatmentConfirmDraft({ upi_transaction_id: "", account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "", transfer_reference: "" });
  };

  // The dedicated popup's own submit button — dispatches to whichever path
  // already handles that mode (Cheque/Partial build their own payload directly;
  // Cash/UPI/Card go through the shared confirm-and-collect path).
  const submitTreatmentModePopup = () => {
    const mode = treatmentFeeDraft.payment_mode;
    if (mode === "cheque" || mode === "partial") {
      const payload = buildTreatmentFeePayload();
      if (!payload) return;
      submitTreatmentFee(payload);
      return;
    }
    confirmCollectTreatmentFee();
  };

  // Confirm button inside the second "Confirm Payment" popup — validates
  // UPI/Card's own fields (Cash just needed the mismatch acknowledged).
  function confirmCollectTreatmentFee() {
    const amount = parseFloat(treatmentFeeDraft.amount);
    const mode = treatmentFeeDraft.payment_mode;
    const payload = { payment_mode: mode, amount, confirmed: true };
    if (mode === "upi") {
      payload.upi_transaction_id = treatmentConfirmDraft.upi_transaction_id.trim();
    } else if (BANK_DETAIL_MODES.includes(mode)) {
      if (!attachBankDetails(payload, treatmentConfirmDraft, mode)) return;
    }
    const splitPayload = attachSessionsSplit(payload);
    if (!splitPayload) return;
    submitTreatmentFee(splitPayload);
  }

  // Submits the Treatment Fee — used both from the combined popup (its own button,
  // Consultation Fee handled separately above) and from the Fee Collected panel's
  // standalone fallback (where collectFeeDraft is always null, so this always
  // closes the popup on success). Pass a payload directly for Cash/UPI/Card (built
  // above); omit it for Cheque/Partial Payment, which build their own from the
  // inline fields via buildTreatmentFeePayload.
  async function submitTreatmentFee(directPayload) {
    const payload = directPayload || buildTreatmentFeePayload();
    if (!payload) return;
    setCollectingTreatmentFee(true);
    // Only the call is guarded — see submitConsultationFee. A fault while building the
    // receipt below must not be reported as a failure to collect.
    let res;
    try {
      res = await collectTreatmentFee(selectedLead.id, payload);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect Treatment Fee");
      setCollectingTreatmentFee(false);
      return;
    }

    toast.success(selectedLead.treatment_fee_paid != null ? "Treatment Fee payment updated" : "Treatment Fee collected");
    setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
    setTreatmentConfirmDraft(null);

    const totalSessions = selectedLead.session_package_sessions || 0;
    const savedInst = res.lead?.treatment_fee_payment_details?.installments || [];
    const scheduleOnly = payload.payment_mode === "partial";
    // Cash/UPI/Card/Cheque can cover only some of the package's sessions now, with the
    // rest scheduled — the receipt has to say which sessions this money bought, or it
    // reads as payment for the whole package.
    const partOfPackage = !scheduleOnly && payload.sessions_now != null && totalSessions && payload.sessions_now < totalSessions;
    const unpaid = savedInst.filter((i) => !i.paid);
    showReceipt(() => makeReceipt({
      lead: selectedLead, payload,
      prefix: scheduleOnly ? "TS" : "TF",
      kind: scheduleOnly ? "schedule" : "paid",
      paidFor: "Treatment Fee",
      packageName: selectedLead.session_package_name
        ? `${selectedLead.session_package_name} · ${totalSessions} sessions`
        : "",
      // Against what these sessions should cost, not the whole package — collecting for
      // fewer sessions must never be recorded as a discount.
      assignedPrice: scheduleOnly
        ? null
        : partOfPackage
        ? Math.round((selectedLead.session_package_price || 0) / totalSessions * payload.sessions_now)
        : selectedLead.session_package_price,
      sessionsCovered: partOfPackage ? `${payload.sessions_now} of ${totalSessions}` : "",
      balanceDue: unpaid.length
        ? `Rs.${unpaid.reduce((s, i) => s + (i.amount || 0), 0)}${unpaid[0]?.due_date ? ` · due ${unpaid[0].due_date}` : ""}`
        : "",
      installments: scheduleOnly ? savedInst : [],
      transactionId: res.transaction_id,
    }));
    // Same as the installment path: the receipt is the confirmation and closes on
    // its own button, so the patient stays open behind it rather than the whole
    // stack vanishing the moment the money goes through.
    setCollectFeeDraft(null);
    setTreatmentFeeDraft(null);
    setSelectedLead(res.lead);
    setCollectingTreatmentFee(false);
  }

  // Opens the Collect popup for one specific Partial Payment installment — amount
  // pre-filled from the real saved amount if the schedule already exists on the
  // lead, or computed from that row's sessions x rate for a schedule not yet
  // saved — but always re-editable, plus a payment mode picker (same 4 modes as
  // everywhere else) and that mode's own fields.
  const openPartialCollectPopup = (idx) => {
    const inst = partialInstallments[idx] || {};
    const saved = savedInstallments[idx];
    const amount = saved?.amount ?? Math.round((parseInt(inst.sessions, 10) || 0) * perSessionRate);
    setPartialCollectDraft({
      idx,
      amount: amount > 0 ? String(amount) : "",
      payment_mode: "cash",
      upi_transaction_id: "",
      account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "",
      cheque_number: "", transfer_reference: "",
    });
  };

  // Submits the per-installment Collect popup. If the Partial Payment schedule
  // hasn't been saved to the lead yet (first-ever collect on this draft), it's
  // created first — every installment still starts unpaid, same as always — then
  // this one specific installment is collected with its own mode/UTR/cheque details,
  // which also logs a real activity entry so it shows up in Session Collections /
  // Accountant Manage exactly like any other Treatment Fee collection.
  const submitPartialCollect = async () => {
    const draft = partialCollectDraft;
    const amount = parseFloat(draft.amount);
    if (!(amount > 0)) {
      toast.error("Enter a valid amount");
      return;
    }
    const mode = draft.payment_mode;
    const payload = { payment_mode: mode, amount };
    if (mode === "upi") {
      payload.upi_transaction_id = draft.upi_transaction_id.trim();
    } else if (BANK_DETAIL_MODES.includes(mode)) {
      if (!attachBankDetails(payload, draft, mode)) return;
    } else if (mode === "cheque") {
      if (!draft.bank_name.trim() || !draft.cheque_number.trim()) {
        toast.error("Bank Name and Cheque Number are required");
        return;
      }
      payload.bank_name = draft.bank_name.trim();
      payload.cheque_number = draft.cheque_number.trim();
    }

    setCollectingTreatmentFee(true);
    try {
      let lead = selectedLead;
      const scheduleExists = (lead.treatment_fee_payment_details?.installments || []).length > 0;
      if (!scheduleExists) {
        const schedulePayload = buildTreatmentFeePayload();
        if (!schedulePayload) {
          setCollectingTreatmentFee(false);
          return;
        }
        const res = await collectTreatmentFee(lead.id, schedulePayload);
        lead = res.lead;
      }
      const paidRes = await markInstallmentPaid(lead.id, draft.idx + 1, payload);
      const installments = (lead.treatment_fee_payment_details?.installments || []).map((inst, i) =>
        i === draft.idx ? { ...inst, paid: true, amount, payment_mode: mode, transaction_id: paidRes?.transaction_id } : inst
      );
      const updatedLead = { ...lead, treatment_fee_payment_details: { ...lead.treatment_fee_payment_details, installments } };
      toast.success(`Payment #${draft.idx + 1} collected`);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === updatedLead.id ? updatedLead : l)) }));
      setPartialCollectDraft(null);

      const stillOwed = installments.filter((i) => !i.paid);
      const thisInst = installments[draft.idx] || {};
      showReceipt(() => makeReceipt({
        lead: updatedLead, payload, prefix: `TF${draft.idx + 1}`,
        paidFor: `Treatment Fee · Payment #${draft.idx + 1} of ${installments.length}`,
        packageName: updatedLead.session_package_name
          ? `${updatedLead.session_package_name} · ${updatedLead.session_package_sessions || 0} sessions`
          : "",
        sessionsCovered: thisInst.sessions ? `${thisInst.sessions} sessions` : "",
        balanceDue: stillOwed.length
          ? `Rs.${stillOwed.reduce((s, i) => s + (i.amount || 0), 0)}${stillOwed[0]?.due_date ? ` · due ${stillOwed[0].due_date}` : ""}`
          : "",
        transactionId: paidRes?.transaction_id,
      }));
      // The receipt above is the confirmation and closes on its own button, so the
      // patient stays open behind it — collecting one installment shouldn't throw the
      // admin out of the patient they're working on. The remaining balance and the
      // next due date are both on the Fee Collected panel they land back on.
      setCollectFeeDraft(null);
      setTreatmentFeeDraft(null);
      setSelectedLead(updatedLead);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect this installment");
    }
    setCollectingTreatmentFee(false);
  };

  // ---- Physio Assign (Branch Admin) — after fees are collected ----
  // The same picker books two different courses. `track` says which: the treatment package
  // (its own sessions, paid by the Treatment Fee) or the rehab course (its own days, paid
  // by the Rehab Fee). They share a physio and a published calendar and nothing else — see
  // backend/v3_rehab for why they are separate records.
  const openPhysioModal = async (track = "treatment") => {
    setAssignTrack(track);
    setShowPhysioModal(true);
    setShowSlotPicker(false);
    setPhysioPick(selectedLead.assigned_physio_id || "");
    setPhysioCalendarData(null);
    setPickedSessionSlots([]);
    setPickerDate(null);
    setPickerMonth(new Date().getMonth());
    setPickerYear(new Date().getFullYear());
    try {
      const rows = await getDoctors({ branch_id: branchId });
      setPhysioOptions((rows || []).filter((d) => d.profile_type === "physio"));
    } catch {
      setPhysioOptions([]);
    }
  };

  // Load the picked physio's own calendar (same one managed at MANAGEMENT > PHYSIO
  // CALENDAR) so the slot picker can only ever offer times that physio has actually
  // published, and can grey out the ones another patient already holds.
  useEffect(() => {
    if (!showPhysioModal || !physioPick) { setPhysioCalendarData(null); return; }
    let cancelled = false;
    setLoadingPhysioCalendar(true);
    getDoctorCalendar(physioPick)
      .then((data) => { if (!cancelled) setPhysioCalendarData(data); })
      .catch(() => { if (!cancelled) setPhysioCalendarData(null); })
      .finally(() => { if (!cancelled) setLoadingPhysioCalendar(false); });
    return () => { cancelled = true; };
  }, [showPhysioModal, physioPick]);

  // How long one treatment session runs. Read from FITSIO STORE exactly the way PHYSIO
  // CALENDAR reads it, so the length shown here is always the length of the slots that
  // calendar actually publishes — one published slot is one treatment session.
  useEffect(() => {
    if (!showPhysioModal) return;
    let cancelled = false;
    listStoreItems(undefined, "session")
      .then((items) => {
        const configured = (items || []).map((i) => i.duration_minutes).find((d) => Number(d) > 0);
        if (!cancelled && configured) setSessionMinutes(Number(configured));
      })
      .catch(() => { /* keep the fallback */ });
    return () => { cancelled = true; };
  }, [showPhysioModal]);

  const isRehabAssign = assignTrack === "rehab";
  // Rehab counts its own days off the rehab course; treatment counts the session package.
  const totalSessionsNeeded = (isRehabAssign
    ? selectedLead?.rehab_package_sessions
    : selectedLead?.session_package_sessions) || 0;
  // What the picker calls a booked day, so its copy reads as the course being booked.
  const dayNoun = isRehabAssign ? "rehab day" : "treatment day";
  const courseName = (isRehabAssign
    ? selectedLead?.rehab_package_name
    : selectedLead?.session_package_name) || (isRehabAssign ? "Rehab course" : "Session package");

  // A physio treats two or three patients in the same hour, so a slot is only off the
  // table once it is FULL — not once it has anyone in it. Capacity comes from the
  // physio's own record; a Head Physio is always 1, because a consultation is one-to-one.
  const slotCapacity = physioCalendarData?.slot_capacity || 1;

  // Which course this picker is booking, spelled the way get_doctor_calendar tags its
  // occupants. Only this lead's rows on *this* course are being replaced by what gets
  // submitted; everything else on the slot is a standing booking.
  const assignCourse = isRehabAssign ? "rehab" : "session";

  // This lead's own bookings on the course being booked don't count against the slot.
  // Re-opening the picker for the physio they're already with would otherwise see their
  // own sessions as a clash and refuse to let them keep the times they already have.
  //
  // That course only. A physio runs two off one calendar, and this lead's days on the
  // other one are not being replaced here — they are still standing, still filling a seat,
  // and both assign endpoints count them. Discounting all of a lead's rows regardless of
  // course was how this grid drew a free seat on a slot the backend then refused with
  // "Full for this physio (3 per slot)" — the branch was shown the slot, picked it, and
  // was told at submit that it had never been available.
  const slotSeatsTaken = useCallback((slot) => {
    const occ = physioCalendarData?.occupancy?.[slot] || 0;
    const mine = (physioCalendarData?.occupants?.[slot] || [])
      .filter((o) => o.lead_id === selectedLead?.id && o.course === assignCourse).length;
    return Math.max(0, occ - mine);
  }, [physioCalendarData, selectedLead, assignCourse]);

  // A day this patient already holds with this physio on the other course. The seat count
  // cannot express it — the physio may well have a free seat — but the patient cannot be
  // on the treatment floor and in rehab in the same half hour. Both assign endpoints
  // refuse it by name; this takes the slot off the table before the branch gets that far.
  const slotOwnOtherCourse = useCallback((slot) => {
    const clash = (physioCalendarData?.occupants?.[slot] || [])
      .find((o) => o.lead_id === selectedLead?.id && o.course && o.course !== assignCourse);
    return clash ? (COURSE_DAY_NOUN[clash.course] || "booking") : "";
  }, [physioCalendarData, selectedLead, assignCourse]);

  // One gate for every place that asks "can this slot be picked" — the month grid's
  // availability dots, the open-slot count, the tile, and the pick handler.
  const slotFull = useCallback(
    (slot) => slotSeatsTaken(slot) >= slotCapacity || !!slotOwnOtherCourse(slot),
    [slotSeatsTaken, slotCapacity, slotOwnOtherCourse],
  );

  const slotOccupantNames = useCallback((slot) => (physioCalendarData?.occupants?.[slot] || [])
    .filter((o) => o.lead_id !== selectedLead?.id)
    .map((o) => o.lead_name)
    .filter(Boolean)
    .join(", "), [physioCalendarData, selectedLead]);

  // Every published slot of the picked physio, grouped by date, so the picker's month grid
  // can flag which days actually have availability and the day panel can list its times.
  const physioSlotsByDate = useMemo(() => {
    const map = {};
    for (const slot of physioCalendarData?.slots || []) {
      const [d, t] = slot.split("T");
      if (!d || !t) continue;
      (map[d] = map[d] || []).push(t);
    }
    Object.values(map).forEach((times) => times.sort());
    return map;
  }, [physioCalendarData]);

  const openSlotCount = useMemo(
    () => (physioCalendarData?.slots || []).filter((s) => !slotFull(s)).length,
    [physioCalendarData, slotFull],
  );

  // Re-opening this for the physio the lead is already with: start from the sessions they
  // already hold rather than a blank picker, so a reschedule only means moving the few
  // that actually change.
  useEffect(() => {
    // Rehab starts from a blank plan: the calendar's booked map now carries this lead's
    // treatment days as well as their rehab days, and pre-loading would quietly seed a
    // rehab course with the dates of the treatment one. Re-assigning rehab replaces the
    // course outright anyway — the backend clears the old days first.
    if (isRehabAssign) return;
    if (!physioCalendarData || !selectedLead || physioPick !== selectedLead.assigned_physio_id) return;
    const seenDays = new Set();
    const mine = Object.entries(physioCalendarData.booked || {})
      .filter(([, b]) => b.lead_id === selectedLead.id)
      .map(([slot]) => slot)
      .sort()
      // Keep one a day, matching the rule the picker now enforces. Sessions booked before
      // that rule existed can sit several to a day; those extra days come back as unfixed
      // rather than being carried forward as a plan that could no longer be built here.
      .filter((slot) => {
        const day = slot.split("T")[0];
        if (seenDays.has(day)) return false;
        seenDays.add(day);
        return true;
      });
    if (mine.length === 0) return;
    setPickedSessionSlots((prev) => (prev.length === 0 ? mine.slice(0, selectedLead.session_package_sessions || 0) : prev));
  }, [physioCalendarData, physioPick, selectedLead, isRehabAssign]);

  const sortedPickedSlots = useMemo(() => [...pickedSessionSlots].sort(), [pickedSessionSlots]);
  // A Rehab course entered without a day count leaves nothing to count towards. Rather than
  // a disabled button and no way forward, the branch fixes as many days as it sold and the
  // course is however many that is — the backend accepts that case for the same reason.
  // Treatment is never open-ended: its package always states its session count.
  const openEndedRehab = isRehabAssign && totalSessionsNeeded === 0;
  const allSessionsPicked = openEndedRehab
    ? sortedPickedSlots.length > 0
    : totalSessionsNeeded > 0 && sortedPickedSlots.length === totalSessionsNeeded;

  // How much of this package the patient has actually paid for, in sessions. The Treatment
  // Fee can be collected for only some of the sessions up front (e.g. 6 of 9, balance due
  // later), and the picker has to say so — the last few treatment days are being scheduled
  // against money that hasn't come in yet.
  const sessionPayment = useMemo(() => {
    const total = totalSessionsNeeded;
    // The Rehab Fee is collected in one go — there is no installment plan to read, so every
    // day of the course is paid for and the picker must not mark the later ones as owing.
    if (isRehabAssign) {
      const paidAmount = selectedLead?.rehab_fee_paid || 0;
      return { total, paid: total, unpaid: 0, paidAmount, price: selectedLead?.rehab_package_price || paidAmount, dueAmount: 0, dueDate: null };
    }
    const price = selectedLead?.session_package_price || 0;
    const rate = total > 0 ? price / total : 0;
    const installments = selectedLead?.treatment_fee_payment_details?.installments || [];

    // No schedule on the record means it was collected in one go — every session is
    // covered. Deriving from the amount instead would mis-round a negotiated discount.
    if (installments.length === 0) {
      const paid = selectedLead?.treatment_fee_paid != null ? total : 0;
      return { total, paid, unpaid: total - paid, paidAmount: selectedLead?.treatment_fee_paid || 0, price, dueAmount: 0, dueDate: null };
    }

    // Each installment covers a number of sessions — recorded outright when the collection
    // was made per-session, otherwise taken from its share of the package price.
    const sessionsIn = (i) => (i.sessions != null ? i.sessions : rate ? i.amount / rate : 0);
    const paid = Math.min(total, Math.round(installments.filter((i) => i.paid).reduce((n, i) => n + sessionsIn(i), 0)));
    const outstanding = installments.filter((i) => !i.paid);
    return {
      total,
      paid,
      unpaid: total - paid,
      paidAmount: installments.filter((i) => i.paid).reduce((n, i) => n + (i.amount || 0), 0),
      price,
      dueAmount: outstanding.reduce((n, i) => n + (i.amount || 0), 0),
      dueDate: outstanding.map((i) => i.due_date).filter(Boolean).sort()[0] || null,
    };
  }, [selectedLead, totalSessionsNeeded, isRehabAssign]);

  // Days are numbered in date order, so the first `paid` of them are the ones covered.
  const isPaidSession = (dayNumber) => dayNumber <= sessionPayment.paid;

  // The plan itself: one treatment session per day, numbered Day 1, Day 2 … in date order
  // and stamped with the week it falls in — the same week rule the backend records, so a
  // "03 Week · 9 sessions" package reads as 3 weeks of 3 treatment days.
  const treatmentPlan = useMemo(() => {
    if (sortedPickedSlots.length === 0) return [];
    const firstDay = sortedPickedSlots[0].split("T")[0];
    return sortedPickedSlots.map((slot, i) => {
      const [date, time] = slot.split("T");
      return { slot, date, time, day: i + 1, week: weekOf(date, firstDay) };
    });
  }, [sortedPickedSlots]);

  const planByDate = useMemo(() => {
    const map = {};
    treatmentPlan.forEach((p) => { map[p.date] = p; });
    return map;
  }, [treatmentPlan]);

  /** The next date after `after` that still has an open slot and no session on it yet. */
  const nextOpenDateAfter = (after, alreadyFixed) => Object.keys(physioSlotsByDate)
    .filter((d) => d > after
      && !alreadyFixed.has(d)
      && physioSlotsByDate[d].some((t) => !slotFull(`${d}T${t}`)))
    .sort()[0];

  const togglePickedSlot = (slot) => {
    if (slotFull(slot)) return;
    const day = slot.split("T")[0];
    const prev = pickedSessionSlots;

    if (prev.includes(slot)) { setPickedSessionSlots(prev.filter((s) => s !== slot)); return; }

    // One treatment session a day — a 9-session package is 9 separate treatment days, not
    // 9 back-to-back slots. Picking another time on a day that already holds a session
    // moves that day's session rather than stacking a second one onto it.
    const sameDay = prev.find((s) => s.startsWith(`${day}T`));
    if (sameDay) { setPickedSessionSlots([...prev.filter((s) => s !== sameDay), slot]); return; }

    if (!openEndedRehab && prev.length >= totalSessionsNeeded) {
      toast.error(`All ${totalSessionsNeeded} ${dayNoun}s are already fixed — remove one first`);
      return;
    }
    const next = [...prev, slot];
    setPickedSessionSlots(next);

    // Fixing a day's time settles that day, so jump straight to the next date still
    // needing one — the whole plan gets laid out in a single run of clicks instead of
    // going back to the calendar between every session. Moving an already-fixed day
    // deliberately doesn't advance: that's a correction, and the result should stay in
    // view. Neither does the last one, so the finished plan can be checked over.
    if (openEndedRehab || next.length < totalSessionsNeeded) {
      const nextDate = nextOpenDateAfter(day, new Set(next.map((s) => s.split("T")[0])));
      if (nextDate) {
        const [y, m] = nextDate.split("-").map(Number);
        setPickerYear(y);
        setPickerMonth(m - 1);
        setPickerDate(nextDate);
      }
    }
  };

  // Opening the picker for the physio this lead is already with pre-loads the sessions
  // they already hold, so a reschedule starts from what's booked instead of a blank slate.
  const openSlotPickerFor = (physioId) => {
    setPhysioPick(physioId);
    setPickedSessionSlots(physioId === selectedLead?.assigned_physio_id ? pickedSessionSlots : []);
    setPickerDate(null);
    setShowSlotPicker(true);
  };

  const submitPhysioAssign = async () => {
    if (!physioPick) { toast.error("Choose a physio"); return; }
    if (!allSessionsPicked) {
      toast.error(`Pick a date and time for all ${totalSessionsNeeded} ${dayNoun}s (${sortedPickedSlots.length} placed so far)`);
      return;
    }
    setAssigningPhysio(true);
    try {
      // Two courses, two endpoints, two collections. Rehab days must not be written as
      // treatment sessions: the review chain and the "Day 3 of 7" count are taken off the
      // treatment rows, and a rehab day landing there puts both out.
      const res = isRehabAssign
        ? await assignRehab({ lead_id: selectedLead.id, physio_id: physioPick, slot_times: sortedPickedSlots })
        : await assignPhysioWithSessions(selectedLead.id, { physio_id: physioPick, slot_times: sortedPickedSlots });
      toast.success(isRehabAssign
        ? `Rehab assigned to ${res.physio_name} — ${res.days_booked} days booked`
        : `Physio assigned — ${res.sessions_booked} sessions booked`);
      setShowSlotPicker(false);
      setShowPhysioModal(false);
      // Close the lead card instantly, same as a plain stage move.
      setSelectedLead(null);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === res.lead.id ? res.lead : l) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || (isRehabAssign ? "Failed to assign rehab" : "Failed to assign physio"));
    }
    setAssigningPhysio(false);
  };

  // ---- Diet Consultation Fee (Branch Admin) ----
  const dietItemById = (id) => dietItems.find((i) => i.id === id);

  /**
   * What to quote for the Diet Fee before it has been collected.
   *
   * The lead only carries diet_package_price once the fee is actually taken — the package
   * is chosen at collection. So this falls back to the store, and only when there is
   * exactly one Diet package priced: with several, any single number would be a guess at
   * which one this patient is getting, and this panel is what Branch Admin reads to take
   * money. Ambiguous means "—" and the real figure appears in the collect popup.
   */
  const dietFeeDue = useMemo(() => {
    if (selectedLead?.diet_package_price != null) return Number(selectedLead.diet_package_price);
    if (dietItems.length !== 1) return null;
    const mode = selectedLead?.package_mode || selectedLead?.appointment_mode || "offline";
    const price = mode === "online" ? dietItems[0].price_online : dietItems[0].price_offline;
    return price != null ? Number(price) : null;
  }, [selectedLead, dietItems]);
  const dietListPrice = (draft) => {
    const item = dietItemById(draft?.item_id);
    if (!item) return null;
    const price = draft.mode === "online" ? item.price_online : item.price_offline;
    return price != null ? Number(price) : null;
  };

  const openRehabFeeDraft = () => {
    setRehabFeeDraft({
      payment_mode: selectedLead.rehab_fee_payment_mode || "cash",
      amount: String(selectedLead.rehab_package_price ?? ""),
      upi_transaction_id: "",
      account_number: "",
      account_holder_name: "",
      bank_name: "",
      ifsc_code: "",
      transfer_reference: "",
    });
  };

  const confirmCollectRehabFee = async () => {
    const amount = parseFloat(rehabFeeDraft.amount);
    if (!(amount > 0)) { toast.error("Enter the amount collected"); return; }
    setCollectingRehabFee(true);
    try {
      const res = await collectRehabFee(selectedLead.id, {
        ...rehabFeeDraft,
        amount,
        confirmed: true,
      });
      toast.success(`Rehab Fee collected · Rs.${amount}`);
      setRehabFeeDraft(null);
      // Patch the row and the open card off the server's answer, the way the other fees
      // do, so the button flips to Update without waiting for a reload.
      if (res?.lead) {
        setSelectedLead(res.lead);
        setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === res.lead.id ? res.lead : l)) }));
      }
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect the Rehab Fee");
    }
    setCollectingRehabFee(false);
  };

  const openDietFeeDraft = async () => {
    let items = dietItems;
    if (!items.length) {
      try {
        items = (await listStoreItems(undefined, "diet")) || [];
        setDietItems(items);
      } catch {
        items = [];
      }
    }
    if (!items.length) {
      toast.error("No Diet Package priced yet — add one in Services and Products > Diet Package.");
      return;
    }
    setDietFeeDraft({
      // Re-collecting keeps whatever was chosen last time, so a correction doesn't
      // silently move the patient onto a different package.
      item_id: selectedLead.diet_package_id || items[0].id,
      mode: selectedLead.diet_package_mode || "offline",
      payment_mode: "cash",
      amount: "",
    });
  };

  const startCollectDietFee = () => {
    const price = dietListPrice(dietFeeDraft);
    if (!dietFeeDraft.item_id) { toast.error("Choose a Diet Package"); return; }
    if (!(price > 0)) { toast.error(`This Diet Package has no ${dietFeeDraft.mode} price set`); return; }
    setDietFeeDraft((d) => ({ ...d, amount: String(price) }));
    setDietFeeConfirmDraft({
      upi_transaction_id: "",
      account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "", transfer_reference: "",
    });
  };

  const confirmCollectDietFee = async () => {
    const amount = parseFloat(dietFeeDraft.amount);
    const mode = dietFeeDraft.payment_mode;
    if (!(amount > 0)) { toast.error("Enter the amount collected"); return; }
    const payload = { item_id: dietFeeDraft.item_id, mode: dietFeeDraft.mode, payment_mode: mode, amount, confirmed: true };
    if (mode === "upi") {
      if (!dietFeeConfirmDraft.upi_transaction_id.trim()) {
        toast.error("UPI Transaction ID is required");
        return;
      }
      payload.upi_transaction_id = dietFeeConfirmDraft.upi_transaction_id.trim();
    } else if (BANK_DETAIL_MODES.includes(mode)) {
      if (!attachBankDetails(payload, dietFeeConfirmDraft, mode)) return;
    }

    setCollectingDietFee(true);
    // Only the call is guarded: a fault while building the receipt below must never be
    // reported as a failure to collect, because the money is already recorded.
    let res;
    try {
      res = await collectDietFee(selectedLead.id, payload);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to collect the Diet Consultation Fee");
      setCollectingDietFee(false);
      return;
    }
    toast.success(`Diet Consultation Fee collected — Rs.${amount}`);
    setDietFeeConfirmDraft(null);
    setDietFeeDraft(null);
    setSelectedLead(res.lead);
    setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === res.lead.id ? res.lead : l)) }));
    showReceipt(() => makeReceipt({
      lead: res.lead,
      payload,
      prefix: "DIET",
      paidFor: "Diet Consultation Fee",
      packageName: res.lead.diet_package_name || "",
      assignedPrice: res.lead.diet_package_price,
      transactionId: res.transaction_id,
    }));
    setCollectingDietFee(false);
  };

  // ---- Diet Appointment (Branch Admin) ----
  const openDietModal = async () => {
    setShowDietModal(true);
    setShowDietSlotPicker(false);
    setCoachPick(selectedLead.diet_coach_id || "");
    setCoachCalendar(null);
    setDietSlot(selectedLead.diet_appointment_at || "");
    setDietPickerDate(null);
    setDietPickerMonth(new Date().getMonth());
    setDietPickerYear(new Date().getFullYear());
    try {
      const res = await listNutritionCoaches();
      setCoachOptions(res?.coaches || []);
    } catch {
      setCoachOptions([]);
    }
  };

  // How long one check-in runs. Read from the Diet Package in FITSIO STORE, not from the
  // session package — a check-in is not a treatment session and the two are priced and
  // timed separately.
  useEffect(() => {
    if (!showDietModal) return;
    let cancelled = false;
    listStoreItems(undefined, "diet")
      .then((items) => {
        const configured = (items || []).map((i) => i.duration_minutes).find((d) => Number(d) > 0);
        if (!cancelled && configured) setDietMinutes(Number(configured));
      })
      .catch(() => { /* keep the fallback */ });
    return () => { cancelled = true; };
  }, [showDietModal]);

  // The picked coach's own calendar — the same DIET CALENDAR the Branch Admin publishes
  // under MANAGEMENT. Only days that coach has actually put up can be booked.
  useEffect(() => {
    if (!showDietModal || !coachPick) { setCoachCalendar(null); return; }
    let cancelled = false;
    setLoadingCoachCalendar(true);
    getDoctorCalendar(coachPick)
      .then((data) => { if (!cancelled) setCoachCalendar(data); })
      .catch(() => { if (!cancelled) setCoachCalendar(null); })
      .finally(() => { if (!cancelled) setLoadingCoachCalendar(false); });
    return () => { cancelled = true; };
  }, [showDietModal, coachPick]);

  // A coach takes one patient at a time, so a slot is gone once anyone holds it — but this
  // lead's own check-ins don't count against themselves, or re-opening the picker for the
  // coach they're already with would refuse the days they already have.
  const checkinSeatsTaken = useCallback((slot) => {
    const occ = coachCalendar?.occupancy?.[slot] || 0;
    const mine = (coachCalendar?.occupants?.[slot] || []).filter((o) => o.lead_id === selectedLead?.id).length;
    return Math.max(0, occ - mine);
  }, [coachCalendar, selectedLead]);

  const checkinSlotFull = useCallback(
    (slot) => checkinSeatsTaken(slot) >= (coachCalendar?.slot_capacity || 1),
    [checkinSeatsTaken, coachCalendar],
  );

  const checkinSlotHeldBy = useCallback((slot) => (coachCalendar?.occupants?.[slot] || [])
    .filter((o) => o.lead_id !== selectedLead?.id)
    .map((o) => o.lead_name)
    .filter(Boolean)
    .join(", "), [coachCalendar, selectedLead]);

  // Published days from today onward, grouped by date. Past days are dropped rather than
  // shown greyed: a coach's calendar accumulates months of them, and a picker that opens
  // on last March is a picker nobody can use.
  const coachSlotsByDate = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = {};
    for (const slot of coachCalendar?.slots || []) {
      const [d, t] = slot.split("T");
      if (!d || !t || d < today) continue;
      (map[d] = map[d] || []).push(t);
    }
    Object.values(map).forEach((times) => times.sort());
    return map;
  }, [coachCalendar]);

  // Counted off the same days the picker will actually offer, so the header's "N slots
  // open" can't promise times that are in the past and unreachable.
  const openCheckinSlotCount = useMemo(
    () => Object.entries(coachSlotsByDate)
      .reduce((n, [d, times]) => n + times.filter((t) => !checkinSlotFull(`${d}T${t}`)).length, 0),
    [coachSlotsByDate, checkinSlotFull],
  );

  const dietSlotDate = dietSlot ? dietSlot.split("T")[0] : "";
  const dietSlotTime = dietSlot ? dietSlot.split("T")[1] : "";

  // One consultation, so picking a time replaces whatever was picked before rather than
  // adding to a list — clicking the chosen time again clears it.
  const pickDietSlot = (slot) => {
    if (checkinSlotFull(slot)) return;
    setDietSlot((prev) => (prev === slot ? "" : slot));
  };

  // Opening the picker for the coach this patient is already booked with keeps their
  // existing time, so re-opening is a reschedule rather than a blank slate.
  const openDietSlotPickerFor = (coachId) => {
    setCoachPick(coachId);
    setDietSlot(coachId === selectedLead?.diet_coach_id ? (selectedLead?.diet_appointment_at || "") : "");
    // Land on the month the existing booking is in, so a reschedule opens where the
    // patient already is instead of on today.
    const existing = coachId === selectedLead?.diet_coach_id ? selectedLead?.diet_appointment_at : null;
    if (existing) {
      const [y, m] = existing.split("T")[0].split("-").map(Number);
      setDietPickerYear(y);
      setDietPickerMonth(m - 1);
      setDietPickerDate(existing.split("T")[0]);
    } else {
      setDietPickerDate(null);
    }
    setShowDietSlotPicker(true);
  };

  const submitDietAssign = async () => {
    if (!coachPick) { toast.error("Choose a Nutritionist"); return; }
    if (!dietSlot) { toast.error("Pick the consultation date and time"); return; }
    setAssigningDiet(true);
    try {
      const res = await bookDietAppointment({ lead_id: selectedLead.id, coach_id: coachPick, slot_time: dietSlot });
      toast.success(`Diet Consultation booked with ${res.coach_name} — ${dayLabel(dietSlotDate)} at ${to12h(dietSlotTime)}`);
      setShowDietSlotPicker(false);
      setShowDietModal(false);
      // The endpoint answers with the appointment, not the lead, so the row is patched
      // with the fields it sets. The patient card stays open on purpose: unlike Physio
      // Assign this isn't the end of their consultation — the physio side may still be
      // mid-flow, and diet normally comes after it.
      const patch = {
        diet_coach_id: coachPick,
        diet_coach_name: res.coach_name,
        diet_appointment_at: res.slot_time,
        diet_stage: "Diet Consultation Booked",
        diet_recommended: true,
      };
      setSelectedLead((l) => (l ? { ...l, ...patch } : l));
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === selectedLead.id ? { ...l, ...patch } : l)) }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to book the Diet Consultation");
    }
    setAssigningDiet(false);
  };

  // The fee picker for the Fee Collected stage. Held as a function because it renders in
  // one of two places: its own row under the toolbar, or — when the parent hands down a
  // slot — inside that toolbar, ahead of the date filter. `compact` drops the card wrapper
  // for the second, where the toolbar is already the card.
  const feeTabsBar = (compact) => (
        // The row was three pills against a wide empty white band. The purchased / not
        // purchased picker takes that space at the far end, which both fills it and puts
        // the two controls in reading order: pick the fee, then pick which half of it.
        <div className={compact
          ? "flex shrink-0 items-center gap-1.5"
          : "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-1"}
          data-testid={compact ? "cons-fee-tabs-toolbar" : "cons-fee-tabs"}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {FEE_TABS.map((t) => {
            const on = t.key === activeFee.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFeeTab(t.key)}
                className={`flex-1 rounded-md px-3 py-2 text-left transition sm:flex-none ${on ? "text-white" : "text-slate-600 hover:bg-slate-50"}`}
                style={on ? { background: t.tone } : undefined}
                data-testid={`cons-fee-tab-${t.key}`}
              >
                <span className="block text-xs font-semibold">{t.label}</span>
              </button>
            );
          })}
          </div>

        </div>
  );

  return (
    <div className="space-y-3" data-testid="consultations-board">
      {/* Stage Head Bar — Pre-Sales / Branch Leads style sticky segmented tabs.
          Suppressed when embedded inside Branch Leads' own unified stage bar. */}
      {showOwnStageBar && (
        <StageTabBar
          stages={stages}
          stageFilter={stageFilter}
          setStageFilter={setStageFilter}
          counts={derivedStageCounts}
          totalCount={dateAndSearchFiltered.length}
          hideAllStages
          testid="cons-metric"
        />
      )}

      {/* Search — hidden outright when a parent provides one. It used to reappear at sm:+
          on the assumption the parent's box was phone-only; Head Physio now carries one
          above all four of its tabs, and two search boxes on the same screen looking for
          the same thing is worse than either. */}
      <div className={`items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 ${externalSearch !== undefined ? "hidden" : "flex"}`}>
        <Search className="h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patients in Consultations..."
          className="h-8 border-0 p-0 focus-visible:ring-0"
          data-testid="cons-search"
        />
        {!hideDateFilter && <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="cons-date-filter" />}
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="h-8 w-8 shrink-0 border-emerald-600 bg-emerald-600 p-0 text-white hover:bg-emerald-700"
          data-testid="cons-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Which fee the Fee Collected list is showing. Only here: this stage is the one
          place where a patient may have paid up to three separate things, and everywhere
          else there is nothing yet to split. Each tab carries its own count and total, so
          the three questions the branch actually asks of this stage — what came in from
          consultations, from treatment, from diet — are answered without opening a row.

          Above both the phone cards and the desk table, because it governs both: it filters
          `filtered`, which each of them renders. */}
      {showDiscountColumn && (toolbarSlot ? (
        <>
          {/* Into the toolbar, immediately before the date filter. Desktop only: that
              row already fights for width on a phone — six controls against 330px — so
              below sm the picker keeps the line of its own it has always had. */}
          {createPortal(<div className="hidden shrink-0 sm:flex">{feeTabsBar(true)}</div>, toolbarSlot)}
          <div className="sm:hidden">{feeTabsBar(false)}</div>
        </>
      ) : feeTabsBar(false))}

      {mobileCards && (
        <div className="space-y-2 sm:hidden" data-testid="cons-mobile-cards">
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">
              {/* Head Physio browses this a day at a time; Branch Admin arrives filtered
                  by stage, where "on this day" would be describing a filter it isn't using. */}
              {loading ? "Loading…" : externalDate ? "No patients on this day." : "No patients in this stage yet."}
            </p>
          ) : filtered.map((l, i) => {
            const hex = stageColor(l[stageField]);
            const wa = waNumber(l.phone);
            return (
              // A div, not a button: the Call and WhatsApp actions below are interactive
              // themselves, and a button inside a button is markup the browser resolves
              // by dropping one of them.
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => { setSelectedLead(l); setDetailTab("overview"); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedLead(l); setDetailTab("overview"); }
                }}
                className="w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-left active:bg-slate-50"
                data-testid={`cons-card-${l.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      <span className="mr-1.5 font-semibold text-slate-300">{i + 1}.</span>{l.name || "—"}<LeadMarks lead={l} className="ml-1.5" />
                    </p>
                    <p className="truncate text-xs text-slate-500">{l.phone || "—"}</p>
                  </div>
                  <span
                    className="shrink-0 rounded-[5px] px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: `${hex}14`, color: hex, border: `1px solid ${hex}33` }}
                  >
                    {l[stageField] || "—"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  {l.patient_number && <span className="font-mono">{l.patient_number}</span>}
                  {l.assigned_physio_name && <span>· {l.assigned_physio_name}</span>}
                  {l.appointment_date && (
                    <span>· {l.appointment_date} {l.appointment_time ? to12h(l.appointment_time) : ""}</span>
                  )}
                </div>
                {/* Same pair as the Branch Leads cards — reaching the patient is the
                    commonest thing done from a list like this, and it was otherwise
                    behind the detail dialog. */}
                {wa && (
                  <div className="mt-2.5 flex gap-2 border-t border-slate-100 pt-2.5">
                    <a
                      href={`tel:${wa}`}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-700 active:bg-slate-100"
                      data-testid={`cons-card-call-${l.id}`}
                    >
                      <Phone className="h-3.5 w-3.5" /> Call
                    </a>
                    <a
                      href={`https://wa.me/${wa}`}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 py-2 text-xs font-semibold text-[#128C7E] active:bg-[#25D366]/20"
                      data-testid={`cons-card-whatsapp-${l.id}`}
                    >
                      <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      <Card className={`overflow-hidden border-slate-200 ${mobileCards ? "hidden sm:block" : ""}`}>
        {/* The rows scroll, the header does not. Capping the height here is what makes
            that possible: a sticky header sticks to its nearest scrolling ancestor, and
            with the old overflow-x-auto alone that ancestor grew with the table, so there
            was no vertical scroll of its own to stick against and the header rode up the
            page with the rows. Same shape as the Branch Leads list. */}
        <CardContent className="max-h-[65vh] overflow-auto p-0">
          {/* These percentages must add up to 100. They used to total 111, and a
              table-fixed layout answers that by scaling every column down by the
              overage — so no column was the width it declared, the ratios drifted,
              and the trailing date columns ended up too narrow to hold a date,
              breaking "2026-08-02" across two lines. The min-width is what lets the
              wrapper scroll on a narrow screen instead of crushing them again. */}
          {/* S.No took its 4% out of the four widest columns rather than being appended:
              these percentages have to total 100 under table-fixed, and the min-width grew
              by the same 40px so no column lost real estate to make room for it. */}
          {/* Fee Collected is the stage where a negotiated Consultation Fee has become a
              fact, so the discount column is added there alone — on every earlier stage
              there is no payment yet and the column would be a row of dashes. */}
          <table className={`w-full table-fixed text-sm ${showDiscountColumn ? "min-w-[1240px]" : "min-w-[1040px]"}`}>
            <thead className="sticky top-0 z-10 bg-slate-500 text-xs uppercase text-white">
              <tr>
                <th className={`${cols.sno} px-3 py-2 text-left align-middle`}>S.No</th>
                <th className={`${cols.patient} px-4 py-2 text-left align-middle`}>Patient</th>
                <th className={`${cols.pno} px-4 py-2 text-left align-middle`}>Patient No.</th>
                <th className={`${cols.phone} px-4 py-2 text-left align-middle`}>Phone</th>
                <th className={`${cols.email} px-4 py-2 text-left align-middle`}>Email</th>
                {/* Shortened on Fee Collected alone: that list carries three more columns than any
                    other stage, and the words the headings lose there — Consultation, Expert,
                    Applied — are the ones the column below already makes obvious. Every other
                    stage has the room and keeps the full wording. */}
                <th className={`${cols.stage} px-4 py-2 text-left align-middle`}>
                  {isConsultant ? "Live Stage" : showDiscountColumn ? "Stage" : "Consultation Stage"}
                </th>
                <th className={`${cols.expert} px-4 py-2 text-left align-middle`}>
                  {showDiscountColumn ? "Assigned" : "Assigned Expert"}
                </th>
                {/* Named for the tab rather than a bare "Collected": three tabs showing a
                    column of the same name is three lists that look identical. */}
                {showDiscountColumn && <th className={`${cols.collected} px-3 py-2 text-left align-middle`}>{activeFee.label} Fee</th>}
                {showDiscountColumn && <th className={`${cols.discount} px-3 py-2 text-left align-middle`}>Discount</th>}
                <th className={`${cols.appt} px-3 py-2 text-left align-middle`}>Appointment</th>
                <th className={`${cols.updated} px-3 py-2 text-left align-middle`}>Updated</th>
                {showDiscountColumn && <th className={`${cols.total} px-3 py-2 text-left align-middle`}>Total Amount</th>}
                <th className={`${cols.action} px-3 py-2 text-center align-middle`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, i) => {
                const hex = stageColor(l[stageField]);
                return (
                  <tr key={l.id} onClick={() => { setSelectedLead(l); setDetailTab("overview"); }} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" data-testid={`cons-row-${l.id}`}>
                    <td className="px-3 py-3 align-middle text-slate-400">{i + 1}</td>
                    <td className="truncate px-4 py-3 align-middle font-medium text-slate-800" title={l.name}>{l.name || "—"}<LeadMarks lead={l} className="ml-1.5" /></td>
                    <td className="truncate px-4 py-3 align-middle font-mono text-xs text-slate-500" title={l.patient_number}>{l.patient_number || "—"}</td>
                    <td className="truncate px-4 py-3 align-middle text-slate-600" title={l.phone}>{l.phone || "—"}</td>
                    <td className="truncate px-4 py-3 align-middle text-slate-600" title={l.email}>{l.email || "—"}</td>
                    <td className="px-4 py-3 align-middle">
                      <span
                        className="inline-flex max-w-full items-center gap-1 truncate rounded-[5px] px-2 py-0.5 text-xs font-semibold"
                        style={{ background: `${hex}14`, color: hex, border: `1px solid ${hex}33` }}
                        title={l[stageField] || ""}
                      >
                        {l[stageField] || "—"}
                      </span>
                    </td>
                    <td className="truncate px-4 py-3 align-middle text-slate-600" title={l.assigned_physio_name}>{l.assigned_physio_name || "—"}</td>
                    {showDiscountColumn && (
                      // The amount this row contributes to the tab's total, with what it
                      // bought under it — a column of figures with no idea what was sold
                      // is a number nobody can check.
                      <td className="whitespace-nowrap px-3 py-3 align-middle text-xs" data-testid={`cons-fee-${activeFee.key}-${l.id}`}>
                        <span className="font-semibold" style={{ color: activeFee.tone }}>{rupees(activeFee.paid(l))}</span>
                        {activeFee.item(l) && (
                          <span className="block max-w-full truncate text-[10px] text-slate-400" title={activeFee.item(l)}>
                            {activeFee.item(l)}
                          </span>
                        )}
                        {activeFee.mode(l) && (
                          <span className="block text-[10px] uppercase tracking-wide text-slate-300">{activeFee.mode(l)}</span>
                        )}
                      </td>
                    )}
                    {showDiscountColumn && (() => {
                      const d = consultationDiscount(l);
                      return (
                        <td className="whitespace-nowrap px-3 py-3 align-middle text-xs">
                          {d ? (
                            <span
                              className="inline-flex items-center rounded-[5px] border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700"
                              title={`Listed Rs.${Number(l.package_price).toLocaleString("en-IN")}, collected Rs.${Number(l.package_paid).toLocaleString("en-IN")}`}
                            >
                              Rs.{d.off.toLocaleString("en-IN")} · {d.pct.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })()}
                    {/* Date and time each own a line rather than wrapping wherever the
                        column happens to run out — so the dates stack in a straight
                        edge down the column instead of breaking at a different word
                        on every row. */}
                    <td className="whitespace-nowrap px-3 py-3 align-middle text-xs text-slate-500">
                      {l.appointment_date ? (
                        <>
                          <span className="block">{l.appointment_date}</span>
                          {l.appointment_time && <span className="block text-slate-400">{to12h(l.appointment_time)}</span>}
                        </>
                      ) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-middle text-xs text-slate-400">{(l.updated_at || "").slice(0, 10) || "—"}</td>
                    {showDiscountColumn && (
                      <td className="whitespace-nowrap px-3 py-3 align-middle text-xs font-semibold text-slate-700" data-testid={`cons-total-${l.id}`}>
                        {rupees(totalPaid(l))}
                      </td>
                    )}
                    {/* The whole row already opens the detail dialog, but nothing on screen
                        said so. This is the same action made visible — stopPropagation so
                        the row's own handler doesn't fire a second time behind it. */}
                    <td className="px-3 py-3 text-center align-middle">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedLead(l); setDetailTab("overview"); }}
                        title="View details"
                        aria-label={`View ${l.name || "patient"} details`}
                        className="rounded p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                        data-testid={`cons-row-view-${l.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={showDiscountColumn ? 13 : 10} className="px-4 py-8 text-center text-sm text-slate-400">
                  {loading
                    ? "Loading…"
                    // An empty tab is not an empty stage: saying "no leads in consultations"
                    // under a Diet tab reads as the board being broken rather than as nobody
                    // having bought a diet plan.
                    : showDiscountColumn
                      ? `No ${activeFee.label.toLowerCase()} fee collected${stageFilter ? "" : " yet"}.`
                      : "No leads in consultations yet. Book an appointment with a CONSULTANT to populate this list."}
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Detail / move-stage dialog */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-2" onClick={(e) => { if (e.target === e.currentTarget) setSelectedLead(null); }} data-testid="cons-detail-dialog">
          {/* A floating card rather than a full-bleed sheet on a phone: edge to edge reads
              as a page you navigated to, with no backdrop to show it sits above the list
              and nothing beside it to tap to dismiss. Capped height, and tapping the
              backdrop closes — the same behaviour as every other popup on this board. */}
          <div className="max-h-[85dvh] w-full space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:max-h-[calc(100vh-1rem)] sm:w-[96vw] sm:max-w-5xl sm:p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900" data-testid="cons-detail-title">
                  {selectedLead.name || "Lead"}
                  {selectedLead.patient_number && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-500" data-testid="cons-detail-patient-number">{selectedLead.patient_number}</span>
                  )}
                </h3>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <Phone className="h-3 w-3" /> {selectedLead.phone || "—"}
                  {selectedLead.appointment_date && (
                    <>· <Calendar className="ml-1 h-3 w-3" /> {selectedLead.appointment_date} {to12h(selectedLead.appointment_time)}</>
                  )}
                </p>
                {selectedLead.assigned_physio_name && (
                  <p className="mt-0.5 text-xs text-emerald-600">Expert: {selectedLead.assigned_physio_name}</p>
                )}
                {isConsultant && (
                  <span
                    className={`mt-1.5 inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[10px] font-semibold ${
                      selectedLead.consultation_fee ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                    data-testid="cons-consultation-paid-badge"
                  >
                    {selectedLead.consultation_fee ? "Consultation Paid" : "Consultation Pending"}
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedLead(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-detail-close"><XCircle className="h-4 w-4" /></button>
            </div>

            {/* Sub tabs */}
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-3" data-testid="cons-detail-tabs">
              {[
                { key: "overview", label: "Overview" },
                { key: "followup", label: "Follow up" },
                { key: "documents", label: "Documents" },
                { key: "timeline", label: "Timeline" },
                { key: "profile", label: "Profile" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  className={`rounded-[5px] px-3.5 py-1 text-xs font-semibold transition-all ${detailTab === t.key ? "bg-sky-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
                  data-testid={`cons-detail-tab-${t.key}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {detailTab === "overview" && (
            <>
            {/* Pre-Sales Diagnosis — read-only reference, mini card */}
            {selectedLead.diagnosis && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="cons-presales-diagnosis">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <Stethoscope className="h-3.5 w-3.5" /> Pre-Sales Diagnosis
                </p>
                <p className="text-xs text-slate-700">{selectedLead.diagnosis}</p>
              </div>
            )}

            {/* Diagnosis Report + Treatment Summary — side by side */}
            {((isConsultant || selectedLead.physio_diagnosis_report) || (isConsultant || selectedLead.treatment_summary)) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(isConsultant || selectedLead.physio_diagnosis_report) && (
                  <LockableTextBox
                    icon={Stethoscope}
                    label="Diagnosis Report"
                    accent="sky"
                    value={physioDiagDraft}
                    onChange={handlePhysioDiagChange}
                    editing={physioDiagEditing}
                    locked={!!selectedLead.physio_diagnosis_locked}
                    savedText={selectedLead.physio_diagnosis_report}
                    saving={savingPhysioDiag}
                    canEdit={isConsultant}
                    onEdit={() => setPhysioDiagEditing(true)}
                    onUnlock={unlockPhysioDiag}
                    rows={3}
                    placeholder="Write the full diagnosis report..."
                    presetKind="diagnosis_report"
                    testPrefix="cons-physio-diagnosis"
                  />
                )}

                {(isConsultant || selectedLead.treatment_summary) && (
                  <LockableTextBox
                    // Keyed by lead so the tick-list remounts between patients. It holds
                    // the open/search state, and without this the panel would stay open
                    // across a switch, showing the next patient's ticks mid-search.
                    key={selectedLead.id}
                    icon={ClipboardList}
                    label="Treatment Summary"
                    accent="indigo"
                    value={treatmentDraft}
                    onChange={handleTreatmentChange}
                    editing={treatmentEditing}
                    locked={!!selectedLead.treatment_summary_locked}
                    savedText={selectedLead.treatment_summary}
                    saving={savingTreatment}
                    canEdit={isConsultant}
                    onEdit={() => setTreatmentEditing(true)}
                    onUnlock={unlockTreatment}
                    rows={3}
                    placeholder="What treatment should be given to the patient..."
                    presetKind="treatment_summary"
                    choices={treatmentTypes}
                    testPrefix="cons-treatment-summary"
                  />
                )}
              </div>
            )}

            {/* Treatment — Head Physio's own "Save & Move". Requires Diagnosis Report +
                Treatment Summary to already be written (that's what marks the consultation
                itself done and ready for Branch Admin to collect the Consultation Fee).
                Every patient goes on to a Treatment Package here — "Consultation Only" is a
                legacy decision value some already-existing leads still carry, no longer
                offered as a choice. Physio assignment lives entirely on Branch Admin's own
                board, after both fees are collected. */}
            {isConsultant && (() => {
              // Read off the decision the lead carries rather than the name of the stage
              // it landed on. The backend writes whatever the head_consultation pipeline's
              // closing stage is currently called, which Pipeline Stage Management can
              // rename — and a literal compared against that goes quietly false, putting
              // the whole form back in front of a consultation already finished.
              const alreadyMoved = !!selectedLead.consultation_decision && !editingDecision;
              const diagnosisReady = !!(selectedLead.physio_diagnosis_report || "").trim();
              const summaryReady = !!(selectedLead.treatment_summary || "").trim();
              const selectedPackage = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
              const selectedPackageWeeks = selectedPackage ? weeksFromPackageName(selectedPackage.name) : null;
              const needsPackage = decisionDraft.treatment;
              const packageReady = !needsPackage
                || (!!decisionDraft.item_id && !!selectedPackageWeeks && !!parseInt(decisionDraft.sessionsPerWeek, 10));
              // No add-on is a valid, completed choice on its own — a plain Consultation —
              // so nothing here requires at least one to be picked.
              const canSave = diagnosisReady && summaryReady && packageReady;

              if (alreadyMoved) {
                return (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="cons-decision-summary">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                      <ClipboardCheck className="h-3.5 w-3.5" /> Treatment
                    </p>
                    {/* Read back as the choice that was made, rather than as the flags it
                        is stored as. */}
                    <p className="text-sm font-semibold text-slate-800">
                      {addonsLabel({
                        treatment: selectedLead.consultation_decision === "consultation_treatment",
                        diet: !!selectedLead.diet_recommended,
                        rehab: !!selectedLead.rehab_referred,
                        fitness: !!selectedLead.fitness_recommended,
                        zumba: !!selectedLead.zumba_recommended,
                      })}
                    </p>
                    {selectedLead.consultation_decision === "consultation_treatment" && selectedLead.session_package_name && (
                      <p className="mt-0.5 text-xs text-slate-600">
                        Treatment Package: <span className="font-semibold">{selectedLead.session_package_name}</span>
                      </p>
                    )}
                    {/* The other two courses the Consultant can pick. Only the treatment
                        package was named here, so a patient sent to Rehab read as "+ Rehab"
                        with no way to see which course was chosen without reopening the
                        Consultant's own form. */}
                    {selectedLead.rehab_referred && selectedLead.rehab_package_name && (
                      <p className="mt-0.5 text-xs text-slate-600" data-testid="cons-decision-summary-rehab">
                        Rehab Package: <span className="font-semibold">{selectedLead.rehab_package_name}</span>
                        {selectedLead.rehab_package_sessions ? <span className="text-slate-400"> · {selectedLead.rehab_package_sessions} sessions</span> : null}
                      </p>
                    )}
                    {selectedLead.zumba_recommended && selectedLead.zumba_package_name && (
                      <p className="mt-0.5 text-xs text-slate-600" data-testid="cons-decision-summary-zumba">
                        Zumba Plan: <span className="font-semibold">{selectedLead.zumba_package_name}</span>
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] text-slate-500">Sent to Branch Admin — Consultation Visit.</p>
                    {/* Reopens the form on the choice and package already saved, rather
                        than on a blank one — see beginEditDecision. */}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => beginEditDecision(selectedLead)}
                        data-testid="cons-decision-edit"
                      >
                        <Pencil className="mr-1 h-3 w-3" />Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => shareDecision(decisionSummaryOf(selectedLead))}
                        data-testid="cons-decision-share"
                      >
                        <Share2 className="mr-1 h-3 w-3" />Share
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3" data-testid="cons-decision-form">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
                    <ClipboardCheck className="h-3.5 w-3.5" /> Treatment
                  </p>
                  {(!diagnosisReady || !summaryReady) && (
                    <p className="mb-2 text-[11px] font-medium text-amber-600" data-testid="cons-decision-required-hint">
                      Write the Diagnosis Report and Treatment Summary above before Save & Move.
                    </p>
                  )}
                  {/* Consultation itself needs no toggle — writing this form up is the
                      consultation. These four are what else the patient is going away
                      with, and any combination is valid, including none of them. One row,
                      scrolled sideways on a narrow screen rather than wrapped — they read
                      as one group of choices, and a wrapped row reads as two groups. */}
                  <div className="mb-3">
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Also Going Away With</label>
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="cons-decision-plan-options">
                      {CONSULTATION_ADDONS.map((p) => {
                        const selected = !!decisionDraft[p.key];
                        return (
                          <button
                            key={p.key}
                            type="button"
                            // Turning Treatment off clears the package with it, so an
                            // abandoned choice can't be submitted once the picker showing
                            // it is gone.
                            onClick={() => setDecisionDraft((d) => ({
                              ...d,
                              [p.key]: !d[p.key],
                              ...(p.key === "treatment" && d.treatment ? { item_id: "", sessionsPerWeek: "" } : {}),
                              ...(p.key === "rehab" && d.rehab ? { rehab_item_id: "" } : {}),
                              ...(p.key === "zumba" && d.zumba ? { zumba_item_id: "" } : {}),
                            }))}
                            className="shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition hover:brightness-95"
                            style={selected
                              ? { background: `${p.tone}22`, color: p.tone, borderColor: p.tone, boxShadow: `inset 0 0 0 1px ${p.tone}` }
                              : { background: `${p.tone}14`, color: p.tone, borderColor: `${p.tone}33` }}
                            data-testid={`cons-decision-plan-${p.key}`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* The Rehab shelf from Services and Products, offered the moment Rehab is
                      ticked. Optional: referring to Rehab and settling the course later is
                      the flow that existed before this picker, and the receipt still reads
                      "Waiting on a package in Rehab" when nothing is chosen. */}
                  {decisionDraft.rehab && (
                    <div data-testid="cons-decision-rehab-package">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Rehab Package <span className="font-normal text-slate-400">(optional)</span></label>
                      <div className="flex flex-wrap gap-2" data-testid="cons-decision-rehab-options">
                        {rehabPackageItems.map((i) => {
                          const selected = decisionDraft.rehab_item_id === i.id;
                          return (
                            <button
                              key={i.id}
                              type="button"
                              // Clicking the chosen one again clears it, which is the only
                              // way back to no course once one has been picked.
                              onClick={() => setDecisionDraft((p) => ({ ...p, rehab_item_id: selected ? "" : i.id }))}
                              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                                selected
                                  ? "border-cyan-600 bg-cyan-600 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              data-testid={`cons-decision-rehab-option-${i.id}`}
                            >
                              {i.name}
                            </button>
                          );
                        })}
                        {rehabPackageItems.length === 0 && (
                          <p className="text-xs text-slate-400">No rehab packages in Services and Products yet.</p>
                        )}
                      </div>
                      {/* Session count only, never the price — the same rule the Treatment
                          picker follows, with the amount shown to Branch Admin at collection. */}
                      {decisionDraft.rehab_item_id && (() => {
                        const item = rehabPackageItems.find((i) => i.id === decisionDraft.rehab_item_id);
                        if (!item) return null;
                        const count = decisionDraft.mode === "online" ? item.sessions_online : item.sessions_offline;
                        return (
                          <p className="mt-2 text-xs text-slate-500" data-testid="cons-decision-rehab-summary">
                            {item.name}{count ? ` · ${count} sessions` : ""}
                          </p>
                        );
                      })()}
                    </div>
                  )}

                  {/* The Zumba shelf, on the same terms as Rehab above: shown when Zumba is
                      ticked, optional, and named without a price. */}
                  {decisionDraft.zumba && (
                    <div data-testid="cons-decision-zumba-package">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Zumba Package <span className="font-normal text-slate-400">(optional)</span></label>
                      <div className="flex flex-wrap gap-2" data-testid="cons-decision-zumba-options">
                        {zumbaPackageItems.map((i) => {
                          const selected = decisionDraft.zumba_item_id === i.id;
                          return (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => setDecisionDraft((p) => ({ ...p, zumba_item_id: selected ? "" : i.id }))}
                              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                                selected
                                  ? "border-pink-600 bg-pink-600 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              data-testid={`cons-decision-zumba-option-${i.id}`}
                            >
                              {i.name}
                            </button>
                          );
                        })}
                        {zumbaPackageItems.length === 0 && (
                          <p className="text-xs text-slate-400">No Zumba packages in Services and Products yet.</p>
                        )}
                      </div>
                      {decisionDraft.zumba_item_id && (() => {
                        const item = zumbaPackageItems.find((i) => i.id === decisionDraft.zumba_item_id);
                        if (!item) return null;
                        const count = decisionDraft.mode === "online" ? item.sessions_online : item.sessions_offline;
                        return (
                          <p className="mt-2 text-xs text-slate-500" data-testid="cons-decision-zumba-summary">
                            {item.name}{count ? ` · ${count} classes` : ""}
                          </p>
                        );
                      })()}
                    </div>
                  )}

                  {/* Only the two plans that include treatment need a package. Showing it
                      for the others would ask for a decision that has no meaning. */}
                  <div className={needsPackage ? "" : "hidden"}>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Treatment Package</label>
                    <div className="flex flex-wrap gap-2" data-testid="cons-decision-package-options">
                      {treatmentPackageItems.map((i) => {
                        const selected = decisionDraft.item_id === i.id;
                        return (
                          <button
                            key={i.id}
                            type="button"
                            onClick={() => setDecisionDraft((p) => ({ ...p, item_id: i.id, sessionsPerWeek: "" }))}
                            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                              selected
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                            data-testid={`cons-decision-package-option-${i.id}`}
                          >
                            {i.name}
                          </button>
                        );
                      })}
                    </div>

                    {decisionDraft.item_id && (() => {
                      const item = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
                      if (!item) return null;
                      // Head Physio sees the session count only — never the price.
                      // The Treatment Fee amount is derived server-side from
                      // sessions_override and shown to Branch Admin at fee collection.
                      const weeks = weeksFromPackageName(item.name);
                      const perWeek = parseInt(decisionDraft.sessionsPerWeek, 10) || 0;
                      const totalSessions = weeks && perWeek ? weeks * perWeek : 0;
                      return (
                        <div className="mt-2 rounded-md border border-slate-200 bg-white p-3" data-testid="cons-decision-package-summary">
                          <p className="text-sm font-semibold text-slate-800">{item.name}{weeks ? ` · ${weeks} week${weeks > 1 ? "s" : ""}` : ""}</p>
                          <div className="mt-2">
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">Sessions / week</label>
                            <div className="flex flex-wrap gap-1.5" data-testid="cons-decision-sessions-per-week">
                              {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                                const selected = perWeek === n;
                                return (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setDecisionDraft((p) => ({ ...p, sessionsPerWeek: String(n) }))}
                                    className={`h-8 w-8 rounded-md border text-xs font-semibold transition ${
                                      selected ? "border-sky-500 bg-sky-500 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                                    }`}
                                    data-testid={`cons-decision-sessions-per-week-${n}`}
                                  >
                                    {n}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="mt-2 text-xs text-slate-500" data-testid="cons-decision-total-sessions">
                              {!weeks
                                ? <span className="text-amber-600">Couldn't read a week count from this package's name.</span>
                                : !perWeek
                                ? "Choose sessions per week"
                                : (
                                  <>
                                    {perWeek} session{perWeek > 1 ? "s" : ""} Weekly × {weeks} Week{weeks > 1 ? "s" : ""} = <span className="text-sm font-semibold text-slate-800">{totalSessions} Total Sessions</span>
                                  </>
                                )}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <Button
                    size="sm"
                    className="mt-3 bg-sky-600 hover:bg-sky-700 text-xs"
                    onClick={submitConsultationDecision}
                    disabled={savingDecision || !canSave}
                    data-testid="cons-decision-save"
                  >
                    {savingDecision
                      ? "Saving..."
                      // The label names what the button will actually do. Treatment needs
                      // a package still to review, so it says only "Confirm"; Rehab with
                      // no Treatment names where the patient is headed; anything else is
                      // simply done.
                      : needsPackage ? "Confirm"
                      : decisionDraft.rehab ? "Confirm & Move to Rehab"
                      : "Confirm & Save"}
                  </Button>
                </div>
              );
            })()}

            {!isConsultant && (() => {
              const stage = selectedLead.consultation_stage;
              const decision = selectedLead.consultation_decision;
              const cancellable = ["New Appointment", "Follow Up", "Consultation Visit", "Fee Collected", "Physio Assign"].includes(stage);
              // Once a lead has moved forward past a stage, it can never come back —
              // there's no manual "move backward" control anymore (see the backend's
              // matching rejection in move-consultation-stage).
              const activeFollowUp = (selectedLead.consultation_follow_ups || []).slice().reverse().find((f) => f.status !== "rescheduled");

              const CancelButton = cancellable ? (
                <Button
                  size="sm"
                  variant="outline"
                  className={`border-rose-200 text-rose-600 hover:bg-rose-50 ${ACT_BTN}`}
                  onClick={() => { if (window.confirm("Cancel this consultation?")) moveStage(selectedLead, "Cancel"); }}
                  data-testid="cons-cancel-btn"
                >
                  <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
                </Button>
              ) : null;

              // Diet, one button, one strict sequence: the Diet Fee first, then the
              // Nutrition Coach + their appointment — can't reach assignment until the fee
              // is in. Routes to the same two flows as before (openDietFeeDraft /
              // openDietModal), just gated behind one entry point instead of two sitting
              // side by side, where either could be done first or skipped.
              //
              // Offered from the moment the Consultation Fee is in, and on every path.
              // Diet normally follows treatment, but a patient can come for a diet
              // consultation and nothing else, so it never waits on a physio or a package.
              const dietFeePaid = selectedLead.diet_fee_paid != null;
              const dietAssigned = !!selectedLead.diet_coach_id;
              const dietBooked = !!selectedLead.diet_appointment_at;
              const DietButton = selectedLead.package_paid != null ? (
                <Button
                  size="sm"
                  variant={dietFeePaid && dietBooked ? "outline" : undefined}
                  className={`${dietFeePaid && dietBooked
                    ? "border-orange-200 text-orange-700 hover:bg-orange-50"
                    : "bg-orange-500 text-white hover:bg-orange-600"} ${ACT_BTN}`}
                  onClick={!dietFeePaid ? openDietFeeDraft : openDietModal}
                  data-testid="cons-open-diet-assign"
                >
                  <Salad className="mr-1 h-3.5 w-3.5" />{" "}
                  {!dietFeePaid
                    ? <Lbl full="Collect Diet Fee" short="Diet Fee" />
                    : !dietBooked
                    ? <Lbl full="Assign Nutritionist" short="Assign" />
                    : <Lbl full="Reschedule Diet" short="Diet" />}
                </Button>
              ) : null;

              // Offered once the Consultation Fee is in and the Consultant actually chose a
              // course — without one there is no price to collect against, and the backend
              // refuses for the same reason. Shows on every path a referred patient can be
              // sitting on, beside the Diet button it is modelled on.
              const rehabFeePaid = selectedLead.rehab_fee_paid != null;
              const RehabButton = (selectedLead.package_paid != null && selectedLead.rehab_referred && selectedLead.rehab_package_id) ? (
                <Button
                  size="sm"
                  variant={rehabFeePaid ? "outline" : undefined}
                  className={`${rehabFeePaid
                    ? "border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                    : "bg-cyan-600 text-white hover:bg-cyan-700"} ${ACT_BTN}`}
                  onClick={openRehabFeeDraft}
                  data-testid="cons-open-rehab-fee"
                >
                  <Activity className="mr-1 h-3.5 w-3.5" />{" "}
                  {rehabFeePaid
                    ? <Lbl full="Update Rehab Fee" short="Rehab" />
                    : <Lbl full="Collect Rehab Fee" short="Rehab Fee" />}
                </Button>
              ) : null;

              // Diet and Rehab each run a whole programme — a package, a fee, an expert, a
              // set of days — and the panel only ever offered the next payment button for
              // them. Where a patient actually stood went unanswered: is the fee in, how
              // many days is the course, has anyone been assigned.
              //
              // They are views of the same panel rather than cards of their own. The four
              // controls stay put and only the body under them changes, so the row that got
              // you into a programme is the row that gets you back out — a card that
              // replaced the whole panel took its own way out with it.
              const openDetail = (which) => setProgrammeDetail(which);

              const DetailRow = ({ label, value, tone = "" }) => (
                <div className="flex items-baseline justify-between gap-4 px-3 py-2">
                  <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
                  <dd className={`min-w-0 truncate text-right text-sm font-semibold ${tone || "text-slate-800"}`} title={String(value)}>{value}</dd>
                </div>
              );

              // What the panel's header band says while a programme is open. Kept beside the
              // body it belongs to so a view can never announce itself as one thing and then
              // show another.
              const DIET_VIEW = {
                tone: "orange",
                title: "Diet Programme",
                icon: Salad,
                chip: dietFeePaid
                  ? { tone: "emerald", label: "Fee Collected", tick: true }
                  : { tone: "amber", label: "Diet Fee Due", tick: false },
              };

              const REHAB_VIEW = {
                tone: "cyan",
                title: "Rehab Programme",
                icon: Activity,
                chip: rehabFeePaid
                  ? { tone: "emerald", label: "Fee Collected", tick: true }
                  : { tone: "amber", label: "Rehab Fee Due", tick: false },
              };

              const DietDetailBody = (
                <>
                  <div className="rounded-lg border border-slate-200/80 bg-white shadow-sm" data-testid="cons-diet-detail">
                    <dl className="divide-y divide-slate-100">
                      <DetailRow label="Diet Package" value={selectedLead.diet_package_name || "Not chosen yet"} />
                      <DetailRow
                        label="Diet Fee"
                        value={dietFeePaid
                          ? `Rs.${Number(selectedLead.diet_fee_paid).toLocaleString("en-IN")}${selectedLead.diet_fee_payment_mode ? ` (${selectedLead.diet_fee_payment_mode})` : ""}`
                          : (dietFeeDue != null ? `Rs.${Number(dietFeeDue).toLocaleString("en-IN")} — not collected` : "Not collected")}
                        tone={dietFeePaid ? "text-emerald-700" : "text-amber-700"}
                      />
                      <DetailRow label="Nutritionist" value={selectedLead.diet_coach_name || "Not assigned"} tone={dietAssigned ? "" : "text-amber-700"} />
                      <DetailRow
                        label="Diet Consultation"
                        value={selectedLead.diet_appointment_at
                          ? `${dayLabel(selectedLead.diet_appointment_at.split("T")[0])} at ${to12h(selectedLead.diet_appointment_at.split("T")[1])}`
                          : "Not booked"}
                        tone={dietBooked ? "" : "text-amber-700"}
                      />
                    </dl>
                  </div>
                  {/* The fee first and the nutritionist after it, because that is the order
                      the backend enforces — assign-diet refuses an unpaid patient, so
                      offering assignment first would be offering a dead end. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 [&>*]:shrink-0">
                    <Button
                      size="sm"
                      className={`${dietFeePaid ? "bg-white text-orange-700 shadow-sm ring-1 ring-orange-200 hover:bg-orange-50" : "bg-orange-500 text-white shadow-sm hover:bg-orange-600"} ${ACT_BTN}`}
                      onClick={openDietFeeDraft}
                      data-testid="cons-diet-detail-fee"
                    >
                      <IndianRupee className="mr-1 h-3.5 w-3.5" />
                      {dietFeePaid ? "Update Diet Fee" : "Collect Diet Fee"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!dietFeePaid}
                      title={dietFeePaid ? undefined : "Collect the Diet Fee first"}
                      className={`${dietFeePaid ? "bg-orange-500 text-white shadow-sm hover:bg-orange-600" : "bg-slate-100 text-slate-400"} ${ACT_BTN}`}
                      onClick={openDietModal}
                      data-testid="cons-diet-detail-assign"
                    >
                      <Salad className="mr-1 h-3.5 w-3.5" />
                      {dietBooked ? "Reschedule Diet" : "Assign Nutritionist"}
                    </Button>
                  </div>
                </>
              );

              const RehabDetailBody = (
                <>
                  <div className="rounded-lg border border-slate-200/80 bg-white shadow-sm" data-testid="cons-rehab-detail">
                    <dl className="divide-y divide-slate-100">
                      <DetailRow label="Rehab Course" value={selectedLead.rehab_package_name || "Not chosen yet"} />
                      <DetailRow
                        label="Sessions"
                        value={selectedLead.rehab_package_sessions
                          ? `${selectedLead.rehab_package_sessions} day${selectedLead.rehab_package_sessions > 1 ? "s" : ""}`
                          : "Not stated on the course"}
                        tone={selectedLead.rehab_package_sessions ? "" : "text-slate-400"}
                      />
                      <DetailRow
                        label="Rehab Fee"
                        value={rehabFeePaid
                          ? `Rs.${Number(selectedLead.rehab_fee_paid).toLocaleString("en-IN")}${selectedLead.rehab_fee_payment_mode ? ` (${selectedLead.rehab_fee_payment_mode})` : ""}`
                          : (selectedLead.rehab_package_price != null ? `Rs.${Number(selectedLead.rehab_package_price).toLocaleString("en-IN")} — not collected` : "Not collected")}
                        tone={rehabFeePaid ? "text-emerald-700" : "text-amber-700"}
                      />
                      <DetailRow label="Rehab Physio" value={selectedLead.rehab_physio_name || "Not assigned"} tone={selectedLead.rehab_physio_name ? "" : "text-amber-700"} />
                    </dl>
                  </div>
                  {/* Same order and the same gate as diet: the days cannot be booked until
                      the course is paid for, which is the rule assign-rehab itself holds. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 [&>*]:shrink-0">
                    <Button
                      size="sm"
                      className={`${rehabFeePaid ? "bg-white text-cyan-700 shadow-sm ring-1 ring-cyan-200 hover:bg-cyan-50" : "bg-cyan-600 text-white shadow-sm hover:bg-cyan-700"} ${ACT_BTN}`}
                      onClick={openRehabFeeDraft}
                      data-testid="cons-rehab-detail-fee"
                    >
                      <IndianRupee className="mr-1 h-3.5 w-3.5" />
                      {rehabFeePaid ? "Update Rehab Fee" : "Collect Rehab Fee"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!rehabFeePaid}
                      title={rehabFeePaid ? undefined : "Collect the Rehab Fee first"}
                      className={`${rehabFeePaid ? "bg-cyan-600 text-white shadow-sm hover:bg-cyan-700" : "bg-slate-100 text-slate-400"} ${ACT_BTN}`}
                      onClick={() => openPhysioModal("rehab")}
                      data-testid="cons-rehab-detail-assign"
                    >
                      <Activity className="mr-1 h-3.5 w-3.5" />
                      {selectedLead.rehab_physio_name ? "Reassign Rehab Physio" : "Assign Physio"}
                    </Button>
                  </div>
                </>
              );

              // Documents, as a view of the panel rather than a trip to the Documents tab
              // at the top of the card. Consultation Visit needs one before it will take a
              // payment, and sending someone to another tab to satisfy a rule this panel is
              // enforcing is how a person ends up not knowing why the button is dead.
              // Consultation Visit is the one stage that will not proceed without paperwork.
              // Everywhere else Documents is simply available.
              const docsRequired = stage === "Consultation Visit";
              const hasDocs = (leadDocCount || 0) > 0;

              const DocumentsBody = (
                <div data-testid="cons-documents-body">
                  {docsRequired && !hasDocs && (
                    <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>Upload the consultation paperwork before collecting the fee — the scan or photo is the record that the consultation happened.</span>
                    </p>
                  )}
                  <LeadDocuments
                    leadId={selectedLead.id}
                    canEdit={["branch_admin", "super_admin", "head_physio"].includes(viewerRole)}
                    onChanged={(n) => setLeadDocCount(n)}
                  />
                </div>
              );

              // Which programme is on screen, if any. Null means the panel shows its own
              // stage — the fee summary and the line about what to do next.
              const detailView = programmeDetail === "diet" ? DIET_VIEW
                : programmeDetail === "rehab" ? REHAB_VIEW
                : null;
              const detailBody = programmeDetail === "diet" ? DietDetailBody
                : programmeDetail === "rehab" ? RehabDetailBody
                : programmeDetail === "documents" ? DocumentsBody
                : null;

              // The buttons that open the two cards above. They replace the pair that used
              // to fire a fee popup straight off this row — same place, but they now show
              // the programme rather than assuming the next thing wanted is a payment.
              // Gated on the referral, like its Rehab twin below. It was offered to every
              // patient whose consultation fee was in, so a Consultant who sent somebody to
              // Rehab and nowhere else still produced a Diet Details button on the Branch
              // Admin's panel — a programme this patient was never put on, sitting beside
              // the one they were.
              const DietDetailButton = (selectedLead.package_paid != null && selectedLead.diet_recommended) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className={`${programmeDetail === "diet" ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"} ${ACT_BTN}`}
                  onClick={() => openDetail("diet")}
                  data-testid="cons-open-diet-detail"
                >
                  <Salad className="mr-1 h-3.5 w-3.5" />
                  <Lbl full="Diet Details" short="Diet" />
                </Button>
              ) : null;

              const RehabDetailButton = (selectedLead.package_paid != null && selectedLead.rehab_referred && selectedLead.rehab_package_id) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className={`${programmeDetail === "rehab" ? "border-cyan-300 bg-cyan-50 text-cyan-700" : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"} ${ACT_BTN}`}
                  onClick={() => openDetail("rehab")}
                  data-testid="cons-open-rehab-detail"
                >
                  <Activity className="mr-1 h-3.5 w-3.5" />
                  <Lbl full="Rehab Details" short="Rehab" />
                </Button>
              ) : null;

              // The tab for a panel's own stage. Each panel names it for what it holds —
              // "Assign Physio" on Fee Collected — because "Overview" would tell the reader
              // nothing about which of the three views they are on.
              const OwnTab = ({ label, short, icon: TabIcon, active }) => (
                <Button
                  size="sm"
                  variant="outline"
                  className={`${programmeDetail === "own" ? active : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"} ${ACT_BTN}`}
                  onClick={() => openDetail("own")}
                  data-testid="cons-open-own-detail"
                >
                  <TabIcon className="mr-1 h-3.5 w-3.5" />
                  <Lbl full={label} short={short || label} />
                </Button>
              );

              // The pipeline the lead already carries (diet_stage, diet_consultation_report
              // written by the coach) made visible here — where Branch/Super Admin already
              // are — instead of only on the Nutrition Coach's own board.
              const DietStatus = (dietFeePaid || dietAssigned) ? (
                <div className="mt-3 border-t border-indigo-100 pt-3" data-testid="cons-diet-status">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-orange-600">
                    <Salad className="h-3.5 w-3.5" /> Diet
                  </p>
                  <div className="space-y-1.5 text-sm">
                    {dietFeePaid && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Diet Package</span>
                        <span className="font-semibold text-slate-800">
                          {selectedLead.diet_package_name || "—"}{selectedLead.diet_package_mode ? ` · ${selectedLead.diet_package_mode}` : ""}
                        </span>
                      </div>
                    )}
                    {dietFeePaid && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Diet Fee</span>
                        <span className="font-semibold text-slate-800">
                          Rs.{selectedLead.diet_fee_paid}
                          <span className="ml-1 capitalize text-emerald-600">({selectedLead.diet_fee_payment_mode})</span>
                        </span>
                      </div>
                    )}
                    {selectedLead.diet_coach_name && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Nutritionist</span>
                        <span className="font-semibold text-slate-800">{selectedLead.diet_coach_name}</span>
                      </div>
                    )}
                    {selectedLead.diet_appointment_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Appointment</span>
                        <span className="font-semibold text-slate-800">
                          {dayLabel(selectedLead.diet_appointment_at.split("T")[0])} at {to12h(selectedLead.diet_appointment_at.split("T")[1])}
                        </span>
                      </div>
                    )}
                    {selectedLead.diet_stage && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Stage</span>
                        <span className="font-semibold text-slate-800">{selectedLead.diet_stage}</span>
                      </div>
                    )}
                  </div>
                  {selectedLead.diet_consultation_report ? (
                    <div className="mt-2 rounded-md border border-orange-100 bg-orange-50/60 p-2" data-testid="cons-diet-chart">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Diet Chart</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{selectedLead.diet_consultation_report}</p>
                    </div>
                  ) : dietAssigned && (
                    <p className="mt-2 text-[11px] text-slate-500">Diet Chart — the Nutrition Coach hasn't written it up yet.</p>
                  )}
                </div>
              ) : null;

              const panel = (() => {
                // FIRST in this chain, deliberately. The Rehab tab is a cross-cutting view
                // rather than a position in the pipeline: a patient is on it because their
                // Rehab Fee is in, while their consultation_stage still says where they
                // actually are — which for almost all of them is Fee Collected. Placed any
                // lower, that branch returns first and the Rehab tab opens a patient onto
                // the fee panel with no way to reach Assign Physio.
                if (stageFilter === "Rehab" && selectedLead.rehab_fee_paid != null) {
                  const rehabDays = selectedLead.rehab_package_sessions || 0;
                  const rehabAssigned = !!selectedLead.rehab_physio_name;
                  // Label/value pairs built once, so the rows below are a list rather than
                  // four hand-repeated flex divs — and so a row that has nothing to say is
                  // dropped instead of printing "0 days" or an empty physio.
                  const rehabRows = [
                    { label: "Course", value: selectedLead.rehab_package_name || "Rehab course" },
                    rehabDays > 0 ? { label: "Duration", value: `${rehabDays} day${rehabDays > 1 ? "s" : ""}` } : null,
                    {
                      label: "Rehab Fee",
                      value: `Rs.${Number(selectedLead.rehab_fee_paid).toLocaleString("en-IN")}`,
                      note: selectedLead.rehab_fee_payment_mode || "",
                      strong: true,
                    },
                    rehabAssigned ? { label: "Rehab Physio", value: selectedLead.rehab_physio_name } : null,
                  ].filter(Boolean);
                  return (
                    <div
                      className="overflow-hidden rounded-xl border border-cyan-200/80 bg-gradient-to-br from-cyan-50 via-cyan-50/60 to-white shadow-sm ring-1 ring-inset ring-white/60"
                      data-testid="cons-stage-panel-rehab"
                    >
                      {/* Header band: the icon gets a tile of its own and the state sits at
                          the far end, so the panel says what it is and where it stands on
                          one line before any figure is read. */}
                      <div className="flex items-center justify-between gap-3 border-b border-cyan-100 px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-600/10 text-cyan-700">
                            <Activity className="h-4 w-4" />
                          </span>
                          <span className="truncate text-xs font-semibold uppercase tracking-wider text-cyan-800">Rehab</span>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Fee Collected
                        </span>
                      </div>

                      <div className="p-4">
                        {/* Hairline-divided rows rather than four bordered boxes: one card,
                            one column of values, nothing for the eye to step over. */}
                        <div className="rounded-lg border border-slate-200/80 bg-white shadow-sm" data-testid="cons-rehab-summary">
                          <dl className="divide-y divide-slate-100">
                            {rehabRows.map((row) => (
                              <div key={row.label} className="flex items-baseline justify-between gap-4 px-3 py-2">
                                <dt className="shrink-0 text-xs text-slate-500">{row.label}</dt>
                                <dd className={`min-w-0 truncate text-right font-semibold text-slate-800 ${row.strong ? "text-[15px]" : "text-sm"}`} title={String(row.value)}>
                                  {row.value}
                                  {row.note && <span className="ml-1 text-xs font-medium capitalize text-emerald-600">({row.note})</span>}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>

                        <p className="mt-3 text-xs leading-relaxed text-slate-600">
                          {rehabAssigned
                            ? "The course is booked — every day sits on this physio's calendar and on their board."
                            : "Choose the physio who will deliver the course and fix a date and time for every day."}
                        </p>

                        {/* One solid action on the same left edge as everything above it.
                            Diet and Cancel stay reachable as quiet outlines rather than as
                            two more filled colours competing with the step to take. */}
                        <div className="mt-3 flex flex-wrap items-center gap-2 [&>*]:shrink-0">
                          <Button
                            size="sm"
                            className="bg-cyan-600 text-xs text-white shadow-sm transition hover:bg-cyan-700 hover:shadow"
                            onClick={() => openPhysioModal("rehab")}
                            data-testid="cons-open-rehab-assign"
                          >
                            <Activity className="mr-1.5 h-3.5 w-3.5" />
                            {rehabAssigned ? "Reassign Rehab Physio" : "Assign Physio"}
                          </Button>
                          {DietDetailButton}
                          {CancelButton}
                        </div>
                        {/* Opened from the row above, and shown under it for the same reason
                            the Fee Collected panel does: the control that opened a
                            programme has to stay on screen to close it again. */}
                        {detailBody && <div className="mt-3 border-t border-cyan-100 pt-3">{detailBody}</div>}
                      </div>
                    </div>
                  );
                }

                // Diet Consultation is the same kind of pill as Rehab — nothing writes it,
                // a patient is under it because they are on a diet plan — so it opens the
                // diet programme rather than whatever stage the lead happens to sit at.
                if (stageFilter === "Diet Consultation" && selectedLead.diet_recommended) {
                  return (
                    <StagePanel
                      tone={detailView && detailView.tone === "cyan" ? "cyan" : "orange"}
                      icon={detailView && detailView.tone === "cyan" ? Activity : Salad}
                      title={detailView && detailView.tone === "cyan" ? "Rehab Programme" : "Diet Programme"}
                      testid="cons-stage-panel-diet"
                      /* Both the chip and the own-tab follow whichever programme is on
                         screen. This panel shows either, and it read "Diet Fee Due" over a
                         rehab course — a patient on both was told the wrong fee was
                         outstanding for the thing they were looking at. */
                      chip={
                        programmeDetail === "rehab" ? (
                          <PanelChip tone={selectedLead.rehab_fee_paid != null ? "emerald" : "amber"} tick={selectedLead.rehab_fee_paid != null}>
                            {selectedLead.rehab_fee_paid != null ? "Fee Collected" : "Rehab Fee Due"}
                          </PanelChip>
                        ) : (
                          <PanelChip tone={dietFeePaid ? "emerald" : "amber"} tick={dietFeePaid}>
                            {dietFeePaid ? "Fee Collected" : "Diet Fee Due"}
                          </PanelChip>
                        )
                      }
                      tabs={
                        programmeDetail === "rehab" ? (
                          <>
                            <OwnTab label="Rehab Details" short="Rehab" icon={Activity} active="border-cyan-300 bg-cyan-50 text-cyan-700" />
                            {DietDetailButton}
                            {CancelButton}
                          </>
                        ) : (
                          <>
                            <OwnTab label="Diet Details" short="Diet" icon={Salad} active="border-orange-300 bg-orange-50 text-orange-700" />
                            {RehabDetailButton}
                            {CancelButton}
                          </>
                        )
                      }
                    >
                      {programmeDetail === "rehab" ? RehabDetailBody : DietDetailBody}
                    </StagePanel>
                  );
                }

                if (stage === "New Appointment") {
                  return (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3" data-testid="cons-stage-panel-early">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-700">
                        <Calendar className="h-3.5 w-3.5" /> Move to Stage
                      </p>
                      <p className="mb-2 text-xs text-slate-600">Schedule the Consultation Date & Time to send this patient to the CONSULTANT.</p>
                      <div className="flex items-center gap-1.5 [justify-content:safe_center] [&>*]:shrink-0">
                        <Button
                          size="sm"
                          className="bg-amber-500 text-xs text-white hover:bg-amber-600"
                          onClick={() => setFollowUpDraft({ date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: "10:00", remarks: "" })}
                          data-testid="cons-move-followup"
                        >
                          Schedule Consultation & Move
                        </Button>
                        {CancelButton}
                      </div>
                    </div>
                  );
                }

                if (stage === "Follow Up") {
                  return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="cons-stage-panel-followup">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                        <Bell className="h-3.5 w-3.5" /> Consultation Scheduled
                      </p>
                      <p className="mb-2 text-xs text-slate-600">
                        {activeFollowUp ? `Scheduled for ${activeFollowUp.date} at ${activeFollowUp.time} — waiting on the CONSULTANT.` : "Waiting on the CONSULTANT."}
                      </p>
                      <div className="flex items-center gap-1.5 [justify-content:safe_center] [&>*]:shrink-0">
                        <Button
                          size="sm"
                          className="bg-amber-500 text-xs text-white hover:bg-amber-600"
                          onClick={() => (activeFollowUp
                            ? setRescheduleDraft({ followupId: activeFollowUp.id, date: activeFollowUp.date, time: activeFollowUp.time, reason: "" })
                            : setFollowUpDraft({ date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: "10:00", remarks: "" }))}
                          data-testid="cons-reschedule-btn"
                        >
                          Reschedule
                        </Button>
                        {CancelButton}
                      </div>
                    </div>
                  );
                }

                if (stage === "Consultation Visit") {
                  const alreadyPaid = selectedLead.package_paid != null;
                  const hasTreatment = decision === "consultation_treatment";
                  return (
                    <StagePanel
                      tone={detailView ? detailView.tone : "sky"}
                      icon={detailView ? detailView.icon : IndianRupee}
                      title={detailView ? detailView.title : "Collect a Payment"}
                      testid="cons-stage-panel-consultation-visit"
                      chip={detailView ? (
                        <PanelChip tone={detailView.chip.tone} tick={detailView.chip.tick}>{detailView.chip.label}</PanelChip>
                      ) : alreadyPaid ? (
                        <PanelChip tone="emerald" tick>Consultation Fee In</PanelChip>
                      ) : (
                        <PanelChip>Payment Due</PanelChip>
                      )}
                      tabs={
                        <>
                          <OwnTab label={alreadyPaid ? "Payment" : "Collect Payment"} short="Payment" icon={IndianRupee} active="border-sky-300 bg-sky-50 text-sky-700" />
                          {/* Required at this stage, so it is a tab here rather than a trip
                              to the Documents tab at the top of the card: the rule is being
                              enforced by this panel and has to be satisfiable from it. The
                              amber ring is the only thing on the row asking to be pressed
                              when nothing is on file yet. */}
                          <Button
                            size="sm"
                            variant="outline"
                            className={`${programmeDetail === "documents"
                              ? "border-sky-300 bg-sky-50 text-sky-700"
                              : hasDocs
                              ? "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"
                              : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"} ${ACT_BTN}`}
                            onClick={() => openDetail("documents")}
                            data-testid="cons-open-documents"
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            <Lbl full={hasDocs ? `Documents (${leadDocCount})` : "Documents — required"} short="Docs" />
                          </Button>
                          {DietDetailButton}
                          {RehabDetailButton}
                          {CancelButton}
                        </>
                      }
                    >
                      {detailBody || (
                        <>
                          {/* Everything this patient has been quoted, on the one screen the
                              Branch Admin reads before taking money. Each line is gated on
                              the patient actually being on that programme — quoting diet or
                              rehab to everyone would overstate what is owed. */}
                          <PanelCard testid="cons-consultation-visit-summary">
                            <PanelRow
                              label="Consultation Fee"
                              value={selectedLead.package_price != null ? `Rs.${Number(selectedLead.package_price).toLocaleString("en-IN")}` : "—"}
                              strong
                            />
                            {hasTreatment && (
                              <PanelRow
                                label="Treatment Fee"
                                value={selectedLead.session_package_price != null ? `Rs.${Number(selectedLead.session_package_price).toLocaleString("en-IN")}` : "—"}
                              />
                            )}
                            {selectedLead.diet_recommended && (
                              <PanelRow
                                label="Diet Fee"
                                value={dietFeeDue != null ? `Rs.${Number(dietFeeDue).toLocaleString("en-IN")}` : "—"}
                              />
                            )}
                            {/* The course is named as well as priced: "Rs.18,000" with no
                                idea what it buys is not something to ask a patient to pay.
                                Its own Collect Rehab Fee button lives on the Rehab tab once
                                the consultation fee is in, which is why this is a quote. */}
                            {selectedLead.rehab_referred && (
                              <PanelRow
                                label="Rehab Fee"
                                value={`${selectedLead.rehab_package_price != null ? `Rs.${Number(selectedLead.rehab_package_price).toLocaleString("en-IN")}` : "—"}${selectedLead.rehab_package_name ? ` · ${selectedLead.rehab_package_name}` : ""}`}
                              />
                            )}
                            {alreadyPaid && (
                              <PanelRow
                                label="Already Paid Via"
                                value={selectedLead.package_payment_mode || "—"}
                                tone="text-emerald-700"
                              />
                            )}
                          </PanelCard>
                          {/* No paperwork, no payment. The scan is the record that the
                              consultation happened, and a fee taken against nothing on file
                              is a figure the branch cannot answer for later.

                              Said as a block rather than as a footnote beside a dead button.
                              The rule was stated twice — an amber tab up top and an
                              underlined line down here — and neither read as the reason the
                              button would not press, so it got pressed again and reported as
                              broken. One panel, with the action that satisfies it inside.

                              Updating a payment already taken is not blocked — that would
                              strand a patient whose fee is in over a rule brought in after
                              they paid. */}
                          {docsRequired && !hasDocs && !alreadyPaid ? (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="cons-docs-required-notice">
                              <div className="flex items-start gap-2.5">
                                <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100">
                                  <FileText className="h-3.5 w-3.5 text-amber-700" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Paperwork first</p>
                                  <p className="mt-0.5 text-xs leading-5 text-amber-900/80">
                                    The consultation scan is the record that it happened. Upload it and the fee can be collected.
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:pl-[2.375rem]">
                                <Button
                                  size="sm"
                                  className={`bg-amber-500 text-white shadow-sm transition hover:bg-amber-600 hover:shadow ${ACT_BTN}`}
                                  onClick={() => openDetail("documents")}
                                  data-testid="cons-docs-required-hint"
                                >
                                  <FileText className="mr-1 h-3.5 w-3.5" />
                                  Upload Documents
                                </Button>
                                {/* Kept on screen and kept dead, so the order of the two is
                                    visible: this is the thing waiting on the one beside it. */}
                                <Button size="sm" disabled className={`bg-white/70 text-amber-700/50 ${ACT_BTN}`} data-testid="cons-open-collect-fee">
                                  <IndianRupee className="mr-1 h-3.5 w-3.5" />
                                  Collect Payment
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                className={`bg-sky-600 text-white shadow-sm transition hover:bg-sky-700 hover:shadow ${ACT_BTN}`}
                                onClick={openCollectFeeDraft}
                                data-testid="cons-open-collect-fee"
                              >
                                <IndianRupee className="mr-1 h-3.5 w-3.5" />
                                {alreadyPaid ? "Update Payment" : "Collect Payment"}
                              </Button>
                              {/* Says the gate is satisfied, where the warning used to be. A
                                  branch that has just been stopped by this rule is owed the
                                  moment it is met, rather than the block simply vanishing. */}
                              {docsRequired && hasDocs && !alreadyPaid && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700" data-testid="cons-docs-satisfied">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Paperwork on file
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </StagePanel>
                  );
                }

                if (stage === "Fee Collected") {
                  const ConsultationFeeSummary = (
                    <div className="rounded-md border border-slate-200 bg-white p-2.5" data-testid="cons-fee-collected-consultation-summary">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-xs text-slate-500">Consultation Fee</span>
                        <span className="font-semibold text-slate-800">
                          {selectedLead.package_price != null ? `Rs.${selectedLead.package_price}` : "—"}
                          <span className="ml-1 capitalize text-emerald-600">({selectedLead.package_payment_mode})</span>
                        </span>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> Already Collected
                      </p>
                    </div>
                  );

                  if (decision === "consultation_only") {
                    return (
                      <div
                        className="overflow-hidden rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-emerald-50/60 to-white shadow-sm ring-1 ring-inset ring-white/60"
                        data-testid="cons-stage-panel-fee-collected"
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-emerald-100 px-4 py-2.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700">
                              <ClipboardCheck className="h-4 w-4" />
                            </span>
                            <span className="truncate text-xs font-semibold uppercase tracking-wider text-emerald-800">Fee Collected</span>
                          </div>
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" /> Consultation Only
                          </span>
                        </div>
                        <div className="p-4">
                          {ConsultationFeeSummary}
                          {DietStatus}
                          <p className="mt-3 text-xs leading-relaxed text-slate-600">Consultation Only — no treatment sessions. Mark this consultation as completed to close it out.</p>
                          <div className="mt-3 flex flex-wrap items-center gap-2 [&>*]:shrink-0">
                            <Button size="sm" className="bg-emerald-600 text-xs text-white shadow-sm transition hover:bg-emerald-700 hover:shadow" onClick={submitMarkCompleted} disabled={completingConsultation} data-testid="cons-mark-completed">
                              {completingConsultation ? "Saving..." : "Mark Consultation Completed"}
                            </Button>
                            {DietDetailButton}
                            {RehabDetailButton}
                            {CancelButton}
                          </div>
                          {detailBody && <div className="mt-3 border-t border-emerald-100 pt-3">{detailBody}</div>}
                          </div>
                      </div>
                    );
                  }
                  const treatmentPaid = selectedLead.treatment_fee_paid != null;

                  // Where a Partial Payment plan currently stands. Computed once here so the
                  // balance card and the Collect button can be rendered in two different
                  // places — the card with the Treatment Fee it describes, the button down
                  // in the action row — without working the numbers out twice.
                  const partial = hasPendingInstallments ? (() => {
                    const unpaid = savedInstallments.filter((i) => !i.paid);
                    const nextIdx = savedInstallments.findIndex((i) => !i.paid);
                    const next = savedInstallments[nextIdx] || {};
                    return {
                      nextIdx,
                      next,
                      balance: unpaid.reduce((s, i) => s + (i.amount || 0), 0),
                      overdue: !!next.due_date && next.due_date < new Date().toISOString().slice(0, 10),
                    };
                  })() : null;

                  // The next thing to do about money, whatever state the Treatment Fee is
                  // in: collect the next installment, collect the lot, or nothing at all.
                  // Reopening a partially-paid patient is exactly when the rest gets taken,
                  // so Collect stays one click away rather than behind the schedule.
                  const FeeActions = partial ? (
                    <>
                      <Button size="sm" className="bg-emerald-600 text-xs hover:bg-emerald-700" onClick={() => openPartialCollectPopup(partial.nextIdx)} data-testid="cons-collect-next-installment">
                        Collect Rs.{partial.next.amount ?? partial.balance}
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={openPartialScheduleDraft} data-testid="cons-open-partial-schedule-sidebar">
                        View Payment Schedule
                      </Button>
                    </>
                  ) : !treatmentPaid ? (
                    <Button size="sm" className="bg-indigo-600 text-xs hover:bg-indigo-700" onClick={openTreatmentFeeDraft} data-testid="cons-open-treatment-fee">
                      Collect Payment
                    </Button>
                  ) : null;

                  // The three money facts as one divided card, the way the Rehab panel
                  // states its own. They used to be a card for the consultation fee and
                  // then loose rows for treatment under a second heading, so one panel
                  // carried two different shapes for the same kind of fact.
                  const feeRows = [
                    {
                      label: "Consultation Fee",
                      value: selectedLead.package_price != null ? `Rs.${Number(selectedLead.package_price).toLocaleString("en-IN")}` : "—",
                      note: selectedLead.package_payment_mode || "",
                      noteTone: "text-emerald-600",
                    },
                    {
                      label: "Treatment Package",
                      value: `${selectedLead.session_package_name || "—"}${selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}`,
                    },
                    {
                      label: "Treatment Fee",
                      value: selectedLead.session_package_price != null ? `Rs.${Number(selectedLead.session_package_price).toLocaleString("en-IN")}` : "—",
                      note: hasPendingInstallments ? "partial" : (treatmentPaid ? (selectedLead.treatment_fee_payment_mode || "") : ""),
                      noteTone: hasPendingInstallments ? "text-indigo-600" : "text-emerald-600",
                      strong: true,
                    },
                  ];

                  return (
                    <StagePanel
                      tone={detailView ? detailView.tone : "indigo"}
                      icon={detailView ? detailView.icon : ClipboardCheck}
                      title={detailView ? detailView.title : "Fee Collected"}
                      testid="cons-stage-panel-fee-collected"
                      chip={detailView ? (
                        <PanelChip tone={detailView.chip.tone} tick={detailView.chip.tick}>{detailView.chip.label}</PanelChip>
                      ) : partial ? (
                        <PanelChip tone={partial.overdue ? "rose" : "amber"}>{partial.overdue ? "Balance Overdue" : "Part-paid"}</PanelChip>
                      ) : treatmentPaid ? (
                        <PanelChip tone="emerald" tick>Both Fees Collected</PanelChip>
                      ) : (
                        <PanelChip>Treatment Fee Due</PanelChip>
                      )}
                      tabs={
                        <>
                          {FeeActions}
                          {treatmentPaid && <OwnTab label="Assign Physio" short="Physio" icon={Users} active="border-violet-300 bg-violet-50 text-violet-700" />}
                          {DietDetailButton}
                          {RehabDetailButton}
                          {CancelButton}
                        </>
                      }
                    >
                      {detailBody || (
                        <>
                          <PanelCard
                            testid="cons-fee-collected-summary"
                            footer={!partial && treatmentPaid ? (
                              <p className="flex items-center gap-1 border-t border-slate-100 px-3 py-2 text-[11px] font-medium text-emerald-600" data-testid="cons-treatment-fee-already-collected">
                                <CheckCircle2 className="h-3 w-3" /> Already Collected
                              </p>
                            ) : null}
                          >
                            {feeRows.map((row) => (
                              <PanelRow key={row.label} label={row.label} value={row.value} note={row.note} noteTone={row.noteTone} strong={row.strong} />
                            ))}
                          </PanelCard>

                          {/* What is still owed and when it is due. The button that acts on
                              it sits in the row above with everything else. */}
                          {partial && (
                            <>
                              <p className="mt-2 text-[11px] text-slate-500">
                                {savedInstallments.filter((i) => i.paid).length} of {savedInstallments.length} installments collected.
                              </p>
                              <div className={`mt-2 rounded-lg border px-3 py-2 ${partial.overdue ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`} data-testid="cons-partial-balance-summary">
                                <div className="flex items-center justify-between">
                                  <span className={`text-[11px] font-semibold ${partial.overdue ? "text-rose-700" : "text-amber-700"}`}>Balance Amount</span>
                                  <span className={`text-sm font-bold ${partial.overdue ? "text-rose-700" : "text-amber-700"}`}>Rs.{Number(partial.balance).toLocaleString("en-IN")}</span>
                                </div>
                                <p className={`mt-0.5 text-[10px] ${partial.overdue ? "text-rose-600" : "text-amber-600"}`}>
                                  Next · {partialInstallmentLabel(partial.nextIdx)}
                                  {partial.next.sessions ? ` · ${partial.next.sessions} sessions` : ""}
                                  {partial.next.amount != null ? ` · Rs.${partial.next.amount}` : ""}
                                  {partial.next.due_date ? ` · due ${partial.next.due_date}` : ""}
                                  {partial.overdue ? " · OVERDUE" : ""}
                                </p>
                              </div>
                            </>
                          )}

                          {DietStatus}

                          {treatmentPaid && (
                            <>
                              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                                {/* A Partial Payment plan reaches here with money in but a
                                    balance still owed, and this line read "Both fees
                                    collected" over a Balance Amount card saying otherwise. */}
                                {partial
                                  ? "Consultation Fee collected, Treatment Fee part-paid. The physiotherapist can be assigned now."
                                  : "Both fees collected. Choose the physiotherapist who will deliver the sessions."}
                              </p>
                              {/* The act itself lives in the view, not in the tab that opens
                                  the view. A tab that also fired the picker could not be
                                  pressed to come back to what it was showing. */}
                              <div className="mt-3">
                                <Button
                                  size="sm"
                                  className={`bg-violet-600 text-white shadow-sm transition hover:bg-violet-700 hover:shadow ${ACT_BTN}`}
                                  onClick={() => openPhysioModal("treatment")}
                                  data-testid="cons-open-physio-assign-from-fee-collected"
                                >
                                  <Users className="mr-1 h-3.5 w-3.5" />
                                  {selectedLead.assigned_physio_name ? "Reassign Physio" : "Assign Physio & Book Sessions"}
                                </Button>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </StagePanel>
                  );
                }

                if (stage === "Physio Assign") {
                  const assigned = !!selectedLead.assigned_physio_name;
                  return (
                    <StagePanel
                      tone={detailView ? detailView.tone : (assigned ? "emerald" : "violet")}
                      icon={detailView ? detailView.icon : Users}
                      title={detailView ? detailView.title : "Physio Assign"}
                      testid="cons-stage-panel-physio-assign"
                      chip={detailView ? (
                        <PanelChip tone={detailView.chip.tone} tick={detailView.chip.tick}>{detailView.chip.label}</PanelChip>
                      ) : assigned ? (
                        <PanelChip tone="emerald" tick>Sessions In Progress</PanelChip>
                      ) : (
                        <PanelChip>Physio Not Assigned</PanelChip>
                      )}
                      tabs={
                        <>
                          <OwnTab label={assigned ? "Treatment" : "Assign Physio"} short="Physio" icon={Users} active="border-violet-300 bg-violet-50 text-violet-700" />
                          {DietDetailButton}
                          {RehabDetailButton}
                          {CancelButton}
                        </>
                      }
                    >
                      {detailBody || (
                        <>
                          <PanelCard testid="cons-physio-assign-summary">
                            <PanelRow
                              label="Treatment Package"
                              value={`${selectedLead.session_package_name || "—"}${selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}`}
                            />
                            <PanelRow
                              label="Assigned Physio"
                              value={selectedLead.assigned_physio_name || "Not assigned"}
                              tone={assigned ? "" : "text-amber-700"}
                            />
                            {selectedLead.diet_coach_name && (
                              <PanelRow
                                label="Diet Consultation"
                                value={`${selectedLead.diet_coach_name}${selectedLead.diet_appointment_at ? ` · ${dayLabel(selectedLead.diet_appointment_at.split("T")[0])} at ${to12h(selectedLead.diet_appointment_at.split("T")[1])}` : ""}`}
                              />
                            )}
                          </PanelCard>
                          <p className="mt-3 text-xs leading-relaxed text-slate-600">
                            {assigned
                              ? "Treatment sessions are in progress — every day is on this physio's calendar and on their board."
                              : "Treatment Fee collected. Choose the physiotherapist who will deliver the sessions."}
                          </p>
                          <div className="mt-3">
                            <Button
                              size="sm"
                              className={`${assigned ? "bg-white text-violet-700 shadow-sm ring-1 ring-violet-200 hover:bg-violet-50" : "bg-violet-600 text-white shadow-sm hover:bg-violet-700"} ${ACT_BTN}`}
                              onClick={() => openPhysioModal("treatment")}
                              data-testid={assigned ? "cons-reassign-physio" : "cons-open-physio-assign"}
                            >
                              <Users className="mr-1 h-3.5 w-3.5" />
                              {assigned ? "Reassign Physio" : "Assign Physio & Book Sessions"}
                            </Button>
                          </div>
                        </>
                      )}
                    </StagePanel>
                  );
                }

                if (stage === "Consultation Completed") {
                  return (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="cons-stage-panel-completed">
                      <p className="text-sm font-semibold text-slate-700">Consultation completed</p>
                      <p className="mt-1 text-xs text-slate-500">Consultation Only — no treatment sessions were required.</p>
                      {selectedLead.diet_coach_name && (
                        <p className="mt-1 text-xs text-slate-600">Diet Consultation: <span className="font-semibold text-slate-800">{selectedLead.diet_coach_name}</span>
                          {selectedLead.diet_appointment_at && ` · ${dayLabel(selectedLead.diet_appointment_at.split("T")[0])} at ${to12h(selectedLead.diet_appointment_at.split("T")[1])}`}</p>
                      )}
                      {/* A closed consultation can still start a diet plan. "Consultation +
                          Diet" patients land here the moment the consultation is marked
                          completed, and that is exactly when their plan gets booked. */}
                      {(DietButton || RehabButton) && <div className="mt-3 flex items-center gap-1.5 [justify-content:safe_center] [&>*]:shrink-0">{DietButton}{RehabButton}</div>}
                    </div>
                  );
                }

                if (stage === "Cancel") {
                  return (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3" data-testid="cons-stage-panel-cancelled">
                      <p className="text-sm font-semibold text-rose-700">This consultation was cancelled.</p>
                    </div>
                  );
                }

                return null;
              })();

              return (
                <div className="space-y-3">
                  {panel}
                </div>
              );
            })()}

            </>
            )}

            {detailTab === "followup" && (
              <div className="space-y-1.5" data-testid="cons-followups-list">
                {(selectedLead.consultation_follow_ups || []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">No follow-ups scheduled yet.</p>
                ) : (
                  selectedLead.consultation_follow_ups.slice().reverse().map((f) => {
                    const isActive = f.status !== "rescheduled";
                    return (
                      <div
                        key={f.id}
                        className={`flex items-start justify-between gap-3 rounded-lg border p-2.5 text-xs ${isActive ? "border-orange-200 bg-orange-50/60" : "border-slate-200 bg-slate-50 text-slate-400"}`}
                        data-testid={`cons-followup-row-${f.id}`}
                      >
                        <div>
                          <p className={`font-semibold ${isActive ? "text-orange-700" : "text-slate-400 line-through"}`}>{f.date} at {f.time}</p>
                          {f.remarks && <p className="mt-0.5 text-slate-600">{f.remarks}</p>}
                          {f.status === "rescheduled" && f.reschedule_reason && (
                            <p className="mt-0.5 italic text-slate-400">Rescheduled: {f.reschedule_reason}</p>
                          )}
                        </div>
                        {isActive && !isConsultant && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-[11px]"
                            onClick={() => setRescheduleDraft({ followupId: f.id, date: f.date, time: f.time, reason: "" })}
                            data-testid={`cons-followup-reschedule-${f.id}`}
                          >
                            Reschedule
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Physio and Nutrition Coach can read a patient's documents but not add or
                remove them — a report is ordered and filed by the branch or the Head
                Physio, and a treating clinician deleting one is not a workflow. */}
            {detailTab === "documents" && (
              <LeadDocuments
                leadId={selectedLead.id}
                canEdit={["branch_admin", "super_admin", "head_physio"].includes(viewerRole)}
              />
            )}

            {detailTab === "timeline" && (
              <div className="space-y-3" data-testid="cons-lead-timeline">
                {(() => {
                  const events = [
                    ...timelineRemarks.map((r) => ({ ...r, _kind: "remark" })),
                    ...timelineActivity.map((a) => ({ ...a, _kind: "activity" })),
                  ].sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
                  if (events.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No timeline events yet</p>;
                  return (
                    <ol className="ml-3 space-y-4 border-l-2 border-slate-200 py-1 pl-6">
                      {events.map((h) => (
                        <li key={`${h._kind}-${h.id}`} className="relative" data-testid={`cons-timeline-${h._kind}-${h.id}`}>
                          <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white ${h._kind === "remark" ? "bg-amber-400" : "bg-sky-500"}`} />
                          <div className={`rounded-lg border p-3 ${h._kind === "remark" ? "border-amber-100 bg-amber-50/50" : "border-slate-100 bg-slate-50"}`}>
                            <p className="text-sm text-slate-700">{h._kind === "remark" ? h.text : h.details}</p>
                            <p className="mt-1 text-[10px] text-slate-400">{h.created_by} · {h.created_at?.slice(0, 16).replace("T", " ")}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  );
                })()}
              </div>
            )}

            {detailTab === "profile" && (
              <div className="space-y-3" data-testid="cons-lead-profile">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Contact</p>
                  <div className="space-y-1.5 text-xs text-slate-700">
                    <div className="flex items-center justify-between"><span className="text-slate-500">Phone</span><span className="font-medium">{selectedLead.phone || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Alternative Phone</span><span className="font-medium">{selectedLead.alternative_phone || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Email</span><span className="font-medium">{selectedLead.email || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Address</span><span className="font-medium">{selectedLead.address || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">City / State</span><span className="font-medium">{[selectedLead.city, selectedLead.state].filter(Boolean).join(", ") || "—"}</span></div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Profile</p>
                  <div className="space-y-1.5 text-xs text-slate-700">
                    <div className="flex items-center justify-between"><span className="text-slate-500">Age</span><span className="font-medium">{selectedLead.age ?? "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Gender</span><span className="font-medium">{selectedLead.gender || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Occupation</span><span className="font-medium">{selectedLead.occupation || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Department</span><span className="font-medium">{selectedLead.department || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Condition</span><span className="font-medium">{selectedLead.condition || "—"}</span></div>
                    <div className="flex items-center justify-between"><span className="text-slate-500">Months of Pain</span><span className="font-medium">{selectedLead.months_of_pain ?? "—"}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* Collect Fee popup (Branch Admin) — Consultation Visit stage. When the
                Head Physio's decision is "Consultation + Treatment" and the Treatment
                Fee isn't paid yet, its section renders in this same popup so both
                fees are collected together in one action. */}
            {collectFeeDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-collect-fee-modal">
                <div className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">
                      {treatmentFeeDraft ? "Collect Fees" : selectedLead.package_paid != null ? "Update Consultation Fee Payment" : "Collect Consultation Fee"}
                    </p>
                    <button onClick={() => { setCollectFeeDraft(null); setTreatmentFeeDraft(null); }} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-collect-fee-close"><X className="h-4 w-4" /></button>
                  </div>

                  <div className="space-y-3">
                  <div className={`space-y-3 rounded-lg border p-3 ${selectedLead.package_paid != null ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
                    <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${selectedLead.package_paid != null ? "text-emerald-700" : "text-sky-700"}`}>
                      <Stethoscope className="h-3.5 w-3.5" /> Consultation Fee
                    </p>
                    {selectedLead.package_name && (
                      <p className="text-[11px] text-slate-500">
                        Package: <span className="font-semibold text-slate-700">{selectedLead.package_name}</span>
                      </p>
                    )}
                    {selectedLead.package_paid != null ? (
                      <div data-testid="cons-collect-fee-locked">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-xs text-slate-500">Consultation Fee</span>
                          <span className="font-semibold text-slate-800">
                            Rs.{selectedLead.package_price}
                            <span className="ml-1 capitalize text-emerald-600">({selectedLead.package_payment_mode})</span>
                          </span>
                        </div>
                        <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" /> Already Collected
                        </p>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Consultation Fee (₹)</label>
                          <Input
                            type="number"
                            min="0"
                            value={collectFeeDraft.amount}
                            readOnly
                            disabled
                            className="h-9 bg-slate-50 text-slate-600"
                            data-testid="cons-collect-fee-amount"
                          />
                          {selectedLead.package_price != null && (
                            <p className="mt-1 text-[11px] text-slate-400">Assigned package price: Rs.{selectedLead.package_price} — editable in the next step if a different amount was actually collected.</p>
                          )}
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                          <PaymentModeSelect
                            value={collectFeeDraft.payment_mode}
                            options={CONSULTATION_FEE_PAYMENT_MODES}
                            onChange={(v) => setCollectFeeDraft({ ...collectFeeDraft, payment_mode: v })}
                            testId="cons-collect-fee-mode"
                          />
                        </div>
                        <Button
                          className="w-full bg-sky-600 text-xs hover:bg-sky-700"
                          onClick={startCollectConsultationFee}
                          disabled={collectingFee || !(parseFloat(collectFeeDraft.amount) > 0)}
                          data-testid="cons-collect-fee-submit"
                        >
                          {collectingFee ? "Saving..." : "Collect Consultation Fee"}
                        </Button>
                      </>
                    )}
                  </div>

                  {treatmentFeeDraft && (
                    <div className={`space-y-3 rounded-lg border p-3 ${
                      selectedLead.treatment_fee_paid != null && !hasPendingInstallments ? "border-emerald-200 bg-emerald-50"
                      : selectedLead.package_paid == null ? "border-slate-200 bg-slate-50"
                      : "border-indigo-200 bg-indigo-50/40"
                    }`}>
                      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${
                        selectedLead.treatment_fee_paid != null && !hasPendingInstallments ? "text-emerald-700"
                        : selectedLead.package_paid == null ? "text-slate-400"
                        : "text-indigo-700"
                      }`}>
                        <Dumbbell className="h-3.5 w-3.5" /> Treatment Fee
                      </p>
                      {selectedLead.package_paid == null ? (
                        <p className="text-xs text-slate-500" data-testid="cons-treatment-fee-gated">
                          Collect the Consultation Fee above first — Treatment Fee unlocks once it's paid.
                        </p>
                      ) : hasPendingInstallments ? (
                        <div data-testid="cons-treatment-fee-partial-pending">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-xs text-slate-500">Treatment Fee</span>
                            <span className="font-semibold text-slate-800">
                              Rs.{selectedLead.session_package_price}
                              <span className="ml-1 capitalize text-indigo-600">(partial)</span>
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {savedInstallments.filter((i) => i.paid).length} of {savedInstallments.length} installments collected.
                          </p>
                          <Button size="sm" className="mt-2 bg-indigo-600 text-xs hover:bg-indigo-700" onClick={openPartialScheduleDraft} data-testid="cons-open-partial-schedule">
                            View Payment Schedule
                          </Button>
                        </div>
                      ) : selectedLead.treatment_fee_paid != null ? (
                        <div data-testid="cons-treatment-fee-locked">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-xs text-slate-500">Treatment Fee</span>
                            <span className="font-semibold text-slate-800">
                              Rs.{selectedLead.session_package_price}
                              <span className="ml-1 capitalize text-emerald-600">({selectedLead.treatment_fee_payment_mode})</span>
                            </span>
                          </div>
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" /> Already Collected
                          </p>
                        </div>
                      ) : (
                        <>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Treatment Package (chosen by CONSULTANT)</label>
                        <div className="flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700" data-testid="cons-treatment-fee-item-readonly">
                          {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                        <PaymentModeSelect
                          value={treatmentFeeDraft.payment_mode}
                          options={TREATMENT_FEE_PAYMENT_MODES}
                          onChange={chooseTreatmentPaymentMode}
                          testId="cons-treatment-fee-mode"
                        />
                        <p className="mt-1 text-[11px] text-slate-400">Pick a payment method to open its own Collect popup.</p>
                      </div>
                        </>
                      )}
                    </div>
                  )}
                  </div>
                </div>
              </div>
            )}

            {/* Confirm Consultation Fee Payment — second-step popup, only shown when the
                entered amount doesn't match the assigned package price and/or the mode
                (UPI/Card) needs its own fields. Layered above the main popup. */}
            {packageConfirmDraft && collectFeeDraft && (() => {
              const expected = selectedLead.package_price;
              const mode = collectFeeDraft.payment_mode;
              return (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-testid="cons-collect-fee-confirm-modal">
                  <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Confirm Consultation Fee Payment</p>
                      <button onClick={() => setPackageConfirmDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-collect-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    {/* Replaces the old bare amount box and its "differs from" warning: the
                        discount is now worked out for you either way round, and the same
                        panel is what flags an unusually steep one. */}
                    <DiscountCalculator
                      assignedPrice={expected}
                      amount={collectFeeDraft.amount}
                      onAmountChange={(v) => setCollectFeeDraft({ ...collectFeeDraft, amount: v })}
                      label="Consultation Fee (₹)"
                      testPrefix="cons-collect-fee-confirm"
                    />

                    {mode === "upi" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                        <Input
                          value={packageConfirmDraft.upi_transaction_id}
                          onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, upi_transaction_id: e.target.value })}
                          className="h-9"
                          data-testid="cons-collect-fee-upi-txn"
                        />
                      </div>
                    )}

                    {BANK_DETAIL_MODES.includes(mode) && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input
                            value={packageConfirmDraft.account_number}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, account_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-account-number"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input
                            value={packageConfirmDraft.account_holder_name}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, account_holder_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-account-holder"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={packageConfirmDraft.bank_name}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-collect-fee-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input
                            value={packageConfirmDraft.ifsc_code}
                            onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, ifsc_code: e.target.value.toUpperCase() })}
                            className="h-9"
                            data-testid="cons-collect-fee-ifsc"
                          />
                        </div>
                        {mode === "account_transfer" && (
                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">Reference / UTR No.</label>
                            <Input
                              value={packageConfirmDraft.transfer_reference}
                              onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, transfer_reference: e.target.value })}
                              className="h-9"
                              data-testid="cons-collect-fee-transfer-reference"
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={() => setPackageConfirmDraft(null)}
                        disabled={collectingFee}
                        data-testid="cons-collect-fee-confirm-cancel"
                      >
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 bg-sky-600 text-xs hover:bg-sky-700"
                        onClick={confirmCollectConsultationFee}
                        disabled={
                          collectingFee ||
                          !(parseFloat(collectFeeDraft.amount) > 0) ||
                          (BANK_DETAIL_MODES.includes(mode) && (!packageConfirmDraft.account_number.trim() || !packageConfirmDraft.account_holder_name.trim() || !packageConfirmDraft.bank_name.trim() || !packageConfirmDraft.ifsc_code.trim())) ||
                          (mode === "account_transfer" && !packageConfirmDraft.transfer_reference.trim())
                        }
                        data-testid="cons-collect-fee-confirm-submit"
                      >
                        {collectingFee ? "Saving..." : "Confirm & Collect"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Collect Treatment Fee popup (Branch Admin) — fallback: only reachable on
                its own from the Fee Collected panel if it wasn't collected together
                with the Consultation Fee the first time. */}
            {treatmentFeeDraft && !collectFeeDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-treatment-fee-modal">
                <div className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{selectedLead.treatment_fee_paid != null ? "Update Treatment Fee Payment" : "Collect Treatment Fee"}</p>
                    <button onClick={() => setTreatmentFeeDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-treatment-fee-close"><X className="h-4 w-4" /></button>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Treatment Package (chosen by CONSULTANT)</label>
                    <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700" data-testid="cons-treatment-fee-item-readonly">
                      {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                    <PaymentModeSelect
                      value={treatmentFeeDraft.payment_mode}
                      options={TREATMENT_FEE_PAYMENT_MODES}
                      onChange={chooseTreatmentPaymentMode}
                      testId="cons-treatment-fee-mode"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Pick a payment method to open its own Collect popup.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Collect {Mode} Payment — each of the 5 Treatment Fee payment modes gets
                its own dedicated popup here (opened by chooseTreatmentPaymentMode),
                rather than sharing one form with a mode selector. Layered above
                whichever of the two Treatment Fee popups (combined or standalone) is
                currently open. */}
            {treatmentConfirmDraft && treatmentFeeDraft && (() => {
              // When this collection only covers some sessions, the price to measure a
              // discount against is what *those* sessions cost, not the whole package's —
              // so collecting a fair partial amount is never counted as a discount.
              const expectedForSessionsNow = treatmentIsPartialSessions
                ? treatmentComputedAmount
                : selectedLead.session_package_price;
              const mode = treatmentFeeDraft.payment_mode;
              const modeLabel = TREATMENT_FEE_PAYMENT_MODES.find((m) => m.value === mode)?.label || "";
              return (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-testid="cons-treatment-fee-confirm-modal">
                  <div className="max-h-[85dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:max-h-[90vh]">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{mode === "partial" ? "Partial Payment Schedule" : `Collect ${modeLabel} Payment`}</p>
                      <button onClick={() => setTreatmentConfirmDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-treatment-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="cons-treatment-fee-confirm-package">
                      {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                    </div>

                    {mode !== "partial" && (
                      <div>
                        {SETTLED_NOW_MODES.includes(mode) ? (
                          // Discount is measured against what *these* sessions cost, not the
                          // whole package — collecting for fewer sessions is not a discount.
                          <DiscountCalculator
                            assignedPrice={expectedForSessionsNow}
                            amount={treatmentFeeDraft.amount}
                            onAmountChange={(v) => setTreatmentFeeDraft({ ...treatmentFeeDraft, amount: v })}
                            label={`${modeLabel} Amount (₹)`}
                            testPrefix="cons-treatment-fee"
                          />
                        ) : (
                          // Cheque keeps the locked price — nothing to discount, so no
                          // calculator, but it still needs its own label.
                          <>
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">{modeLabel} Amount (₹)</label>
                            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700" data-testid="cons-treatment-fee-amount">
                              {treatmentFeeTotalSessions ? `Rs.${treatmentComputedAmount}` : (selectedLead.session_package_price != null ? `Rs.${selectedLead.session_package_price}` : "—")}
                            </div>
                          </>
                        )}
                        {selectedLead.session_package_sessions && selectedLead.session_package_price != null && (
                          <p className="mt-1 text-[11px] text-slate-500" data-testid="cons-treatment-fee-breakdown">
                            {treatmentIsPartialSessions
                              ? `Collect Now = ${treatmentSessionsNow} of ${treatmentFeeTotalSessions} sessions × Rs.${Math.round(perSessionRate * 100) / 100}/session = Rs.${treatmentComputedAmount}`
                              : `Collect Total Session Fee = ${selectedLead.session_package_sessions} sessions × Rs.${Math.round((selectedLead.session_package_price / selectedLead.session_package_sessions) * 100) / 100}/session = Rs.${selectedLead.session_package_price}`}
                          </p>
                        )}
                      </div>
                    )}

                    {mode !== "partial" && treatmentFeeTotalSessions > 0 && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Sessions Covered Now *</label>
                        <Input
                          type="number"
                          min="1"
                          max={treatmentFeeTotalSessions}
                          value={treatmentFeeDraft.sessions_now}
                          onChange={(e) => setTreatmentSessionsNow(e.target.value)}
                          className="h-9"
                          data-testid="cons-treatment-fee-sessions-now"
                        />
                      </div>
                    )}

                    {treatmentIsPartialSessions && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">
                          Due Date for Balance ({treatmentRemainingSessions} sessions, Rs.{treatmentRemainingAmount}) *
                        </label>
                        {/* Same reason as the schedule's own rows: this field sits low in
                            a modal, so an anchored calendar opens past its edge. */}
                        <MilkDateInput
                          centered
                          title="Due Date for Balance"
                          value={treatmentFeeDraft.balance_due_date}
                          onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, balance_due_date: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-balance-due-date"
                        />
                      </div>
                    )}

                    {treatmentIsPartialSessions && (
                      <div className="rounded-md border border-sky-200 bg-sky-50 p-2.5 text-[11px] text-sky-800" data-testid="cons-treatment-fee-partial-sessions-note">
                        Covers <span className="font-semibold">{treatmentSessionsNow} of {treatmentFeeTotalSessions}</span> sessions. Balance <span className="font-semibold">Rs.{treatmentRemainingAmount}</span> ({treatmentRemainingSessions} sessions) due {treatmentFeeDraft.balance_due_date || "—"}.
                      </div>
                    )}

                    {/* Transaction ID alone. A UPI payment was asking for its UTR as
                        well -- a second reference for the same transfer, typed off the
                        same receipt, on the popup a Branch Admin fills at the desk with
                        the patient waiting. */}
                    {mode === "upi" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                        <Input
                          value={treatmentConfirmDraft.upi_transaction_id}
                          onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, upi_transaction_id: e.target.value })}
                          className="h-9"
                          data-testid="cons-treatment-fee-upi-txn"
                        />
                      </div>
                    )}

                    {BANK_DETAIL_MODES.includes(mode) && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input
                            value={treatmentConfirmDraft.account_number}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, account_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-account-number"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input
                            value={treatmentConfirmDraft.account_holder_name}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, account_holder_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-account-holder"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={treatmentConfirmDraft.bank_name}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-confirm-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input
                            value={treatmentConfirmDraft.ifsc_code}
                            onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, ifsc_code: e.target.value.toUpperCase() })}
                            className="h-9"
                            data-testid="cons-treatment-fee-ifsc"
                          />
                        </div>
                        {mode === "account_transfer" && (
                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">Reference / UTR No.</label>
                            <Input
                              value={treatmentConfirmDraft.transfer_reference}
                              onChange={(e) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, transfer_reference: e.target.value })}
                              className="h-9"
                              data-testid="cons-treatment-fee-transfer-reference"
                            />
                          </div>
                        )}
                      </>
                    )}

                    {mode === "cheque" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={treatmentFeeDraft.bank_name}
                            onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Cheque Number</label>
                          <Input
                            value={treatmentFeeDraft.cheque_number}
                            onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, cheque_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-treatment-fee-cheque-number"
                          />
                        </div>
                      </>
                    )}

                    {mode === "partial" && (
                      <PartialInstallmentsEditor
                        installments={partialInstallments}
                        setInstallments={(next) => setTreatmentFeeDraft({ ...treatmentFeeDraft, partial_installments: next })}
                        totalSessions={treatmentFeeTotalSessions}
                        perSessionRate={perSessionRate}
                        onCollectRow={openPartialCollectPopup}
                        collecting={collectingTreatmentFee}
                      />
                    )}

                    <Button
                      className="w-full bg-indigo-600 text-xs hover:bg-indigo-700"
                      onClick={submitTreatmentModePopup}
                      disabled={
                        collectingTreatmentFee ||
                        selectedLead.session_package_price == null ||
                        (SETTLED_NOW_MODES.includes(mode) && !(parseFloat(treatmentFeeDraft.amount) > 0)) ||
                        (mode === "cheque" && (!treatmentFeeDraft.bank_name.trim() || !treatmentFeeDraft.cheque_number.trim())) ||
                        (mode === "partial" && (!partialAllFilled || partialMismatch)) ||
                        (PART_SESSION_MODES.includes(mode) && treatmentIsPartialSessions && !treatmentFeeDraft.balance_due_date) ||
                        (BANK_DETAIL_MODES.includes(mode) && (!treatmentConfirmDraft.account_number.trim() || !treatmentConfirmDraft.account_holder_name.trim() || !treatmentConfirmDraft.bank_name.trim() || !treatmentConfirmDraft.ifsc_code.trim())) ||
                        (mode === "account_transfer" && !treatmentConfirmDraft.transfer_reference.trim())
                      }
                      data-testid="cons-treatment-fee-confirm-submit"
                    >
                      {collectingTreatmentFee ? "Saving..." : mode === "partial" ? "Save Payment Schedule" : `Collect ${modeLabel} Payment`}
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* Collect Payment #N — the Partial Payment schedule's own per-row Collect
                popup, opened from PartialInstallmentsEditor above. Layered above the
                Partial Payment Schedule popup itself (z-[80] > z-[70]) since that's
                where the row it belongs to is rendered. */}
            {partialCollectDraft && (() => {
              const mode = partialCollectDraft.payment_mode;
              const modeLabel = INSTALLMENT_PAYMENT_MODES.find((m) => m.value === mode)?.label || "";
              return (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" data-testid="cons-partial-collect-modal">
                  <div className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Collect {partialInstallmentLabel(partialCollectDraft.idx)}</p>
                      <button onClick={() => setPartialCollectDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-partial-collect-close"><X className="h-4 w-4" /></button>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Amount (₹) *</label>
                      <Input
                        type="number"
                        min="0"
                        value={partialCollectDraft.amount}
                        onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, amount: e.target.value })}
                        className="h-9"
                        data-testid="cons-partial-collect-amount"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                      <PaymentModeSelect
                        value={mode}
                        options={INSTALLMENT_PAYMENT_MODES}
                        onChange={(v) => setPartialCollectDraft({ ...partialCollectDraft, payment_mode: v })}
                        testId="cons-partial-collect-mode"
                      />
                    </div>

                    {mode === "upi" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                        <Input
                          value={partialCollectDraft.upi_transaction_id}
                          onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, upi_transaction_id: e.target.value })}
                          className="h-9"
                          data-testid="cons-partial-collect-upi-txn"
                        />
                      </div>
                    )}

                    {BANK_DETAIL_MODES.includes(mode) && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input
                            value={partialCollectDraft.account_number}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, account_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-account-number"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input
                            value={partialCollectDraft.account_holder_name}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, account_holder_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-account-holder"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={partialCollectDraft.bank_name}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input
                            value={partialCollectDraft.ifsc_code}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, ifsc_code: e.target.value.toUpperCase() })}
                            className="h-9"
                            data-testid="cons-partial-collect-ifsc"
                          />
                        </div>
                        {mode === "account_transfer" && (
                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">Reference / UTR No.</label>
                            <Input
                              value={partialCollectDraft.transfer_reference}
                              onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, transfer_reference: e.target.value })}
                              className="h-9"
                              data-testid="cons-partial-collect-transfer-reference"
                            />
                          </div>
                        )}
                      </>
                    )}

                    {mode === "cheque" && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input
                            value={partialCollectDraft.bank_name}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, bank_name: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-cheque-bank-name"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Cheque Number</label>
                          <Input
                            value={partialCollectDraft.cheque_number}
                            onChange={(e) => setPartialCollectDraft({ ...partialCollectDraft, cheque_number: e.target.value })}
                            className="h-9"
                            data-testid="cons-partial-collect-cheque-number"
                          />
                        </div>
                      </>
                    )}

                    <Button
                      className="w-full bg-emerald-600 text-xs hover:bg-emerald-700"
                      onClick={submitPartialCollect}
                      disabled={
                        collectingTreatmentFee ||
                        !(parseFloat(partialCollectDraft.amount) > 0) ||
                        (BANK_DETAIL_MODES.includes(mode) && (!partialCollectDraft.account_number.trim() || !partialCollectDraft.account_holder_name.trim() || !partialCollectDraft.bank_name.trim() || !partialCollectDraft.ifsc_code.trim())) ||
                        (mode === "account_transfer" && !partialCollectDraft.transfer_reference.trim()) ||
                        (mode === "cheque" && (!partialCollectDraft.bank_name.trim() || !partialCollectDraft.cheque_number.trim()))
                      }
                      data-testid="cons-partial-collect-submit"
                    >
                      {collectingTreatmentFee ? "Saving..." : `Collect ${modeLabel} Payment`}
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* Collect the Rehab course fee. One step: the course and its price came from
                the consultation, so this asks only how it was paid and how much — the
                amount stays editable for a discount agreed at the desk. */}
            {rehabFeeDraft && (() => {
              const mode = rehabFeeDraft.payment_mode;
              return (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-testid="cons-rehab-fee-modal">
                  <div className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">
                        {selectedLead.rehab_fee_paid != null ? "Update Rehab Fee" : "Collect Rehab Fee"}
                      </p>
                      <button onClick={() => setRehabFeeDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-rehab-fee-close"><X className="h-4 w-4" /></button>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      {selectedLead.rehab_package_name || "Rehab course"}
                      {selectedLead.rehab_package_sessions ? ` · ${selectedLead.rehab_package_sessions} sessions` : ""}
                      {selectedLead.rehab_package_mode ? <> · <span className="capitalize">{selectedLead.rehab_package_mode}</span></> : null}
                    </p>

                    <DiscountCalculator
                      assignedPrice={selectedLead.rehab_package_price}
                      amount={rehabFeeDraft.amount}
                      onAmountChange={(v) => setRehabFeeDraft({ ...rehabFeeDraft, amount: v })}
                      label="Rehab Fee (₹)"
                      testPrefix="cons-rehab-fee"
                    />

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                      <PaymentModeSelect
                        value={rehabFeeDraft.payment_mode}
                        options={CONSULTATION_FEE_PAYMENT_MODES}
                        onChange={(v) => setRehabFeeDraft({ ...rehabFeeDraft, payment_mode: v })}
                        testId="cons-rehab-fee-mode"
                      />
                    </div>

                    {mode === "upi" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                        <Input value={rehabFeeDraft.upi_transaction_id} onChange={(e) => setRehabFeeDraft({ ...rehabFeeDraft, upi_transaction_id: e.target.value })} className="h-9" data-testid="cons-rehab-fee-upi-txn" />
                      </div>
                    )}

                    {BANK_DETAIL_MODES.includes(mode) && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input value={rehabFeeDraft.account_number} onChange={(e) => setRehabFeeDraft({ ...rehabFeeDraft, account_number: e.target.value })} className="h-9" data-testid="cons-rehab-fee-account-number" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input value={rehabFeeDraft.account_holder_name} onChange={(e) => setRehabFeeDraft({ ...rehabFeeDraft, account_holder_name: e.target.value })} className="h-9" data-testid="cons-rehab-fee-account-holder" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input value={rehabFeeDraft.bank_name} onChange={(e) => setRehabFeeDraft({ ...rehabFeeDraft, bank_name: e.target.value })} className="h-9" data-testid="cons-rehab-fee-bank-name" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input value={rehabFeeDraft.ifsc_code} onChange={(e) => setRehabFeeDraft({ ...rehabFeeDraft, ifsc_code: e.target.value.toUpperCase() })} className="h-9" data-testid="cons-rehab-fee-ifsc" />
                        </div>
                        {mode === "account_transfer" && (
                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">Reference / UTR No.</label>
                            <Input value={rehabFeeDraft.transfer_reference} onChange={(e) => setRehabFeeDraft({ ...rehabFeeDraft, transfer_reference: e.target.value })} className="h-9" data-testid="cons-rehab-fee-transfer-reference" />
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 text-xs" onClick={() => setRehabFeeDraft(null)} data-testid="cons-rehab-fee-cancel">Cancel</Button>
                      <Button
                        className="flex-[2] bg-cyan-600 text-xs hover:bg-cyan-700"
                        onClick={confirmCollectRehabFee}
                        disabled={collectingRehabFee || !(parseFloat(rehabFeeDraft.amount) > 0)}
                        data-testid="cons-rehab-fee-submit"
                      >
                        {collectingRehabFee ? "Saving..." : `Confirm Rs.${rehabFeeDraft.amount || 0}`}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Collect Diet Consultation Fee — step 1: which package, at which price, paid
                how. Its own popup rather than a section inside the Consultation Fee one,
                because it is taken at a different moment: diet is decided after the
                consultation, often after treatment has started. */}
            {dietFeeDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-diet-fee-modal">
                <div className="max-h-[85vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <Salad className="h-4 w-4 text-orange-500" />
                      {selectedLead.diet_fee_paid != null ? "Update Diet Consultation Fee" : "Collect Diet Consultation Fee"}
                    </p>
                    <button onClick={() => setDietFeeDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-diet-fee-close"><X className="h-4 w-4" /></button>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Diet Package</label>
                    <select
                      value={dietFeeDraft.item_id}
                      onChange={(e) => setDietFeeDraft({ ...dietFeeDraft, item_id: e.target.value })}
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                      data-testid="cons-diet-fee-package"
                    >
                      {dietItems.map((it) => (
                        <option key={it.id} value={it.id}>{it.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Price</label>
                    <div className="grid grid-cols-2 gap-2">
                      {["offline", "online"].map((m) => {
                        const item = dietItemById(dietFeeDraft.item_id);
                        const price = item ? (m === "online" ? item.price_online : item.price_offline) : null;
                        const active = dietFeeDraft.mode === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setDietFeeDraft({ ...dietFeeDraft, mode: m })}
                            className={`rounded-lg border-2 px-3 py-2 text-left transition ${
                              active ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-orange-300"
                            }`}
                            data-testid={`cons-diet-fee-mode-${m}`}
                          >
                            <span className={`block text-[10px] font-bold uppercase tracking-wider ${active ? "text-orange-700" : "text-slate-400"}`}>{m}</span>
                            <span className={`block text-base font-extrabold ${active ? "text-orange-700" : "text-slate-700"}`}>
                              {price != null ? `Rs.${price}` : "—"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                    <PaymentModeSelect
                      value={dietFeeDraft.payment_mode}
                      options={CONSULTATION_FEE_PAYMENT_MODES}
                      onChange={(v) => setDietFeeDraft({ ...dietFeeDraft, payment_mode: v })}
                      testId="cons-diet-fee-mode-select"
                    />
                  </div>

                  <Button
                    className="w-full bg-orange-600 text-xs hover:bg-orange-700"
                    onClick={startCollectDietFee}
                    disabled={collectingDietFee || !dietFeeDraft.item_id || !(dietListPrice(dietFeeDraft) > 0)}
                    data-testid="cons-diet-fee-submit"
                  >
                    Collect Diet Consultation Fee
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2 — the same confirm the other two fees require before money is
                accepted: the amount is editable here (a discount negotiated on the spot),
                and UPI/Card/Transfer ask for what a dispute would be traced by. */}
            {dietFeeConfirmDraft && dietFeeDraft && (() => {
              const mode = dietFeeDraft.payment_mode;
              return (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-testid="cons-diet-fee-confirm-modal">
                  <div className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Confirm Diet Consultation Fee</p>
                      <button onClick={() => setDietFeeConfirmDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-diet-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      {dietItemById(dietFeeDraft.item_id)?.name || "Diet Package"} · <span className="capitalize">{dietFeeDraft.mode}</span>
                    </p>

                    <DiscountCalculator
                      assignedPrice={dietListPrice(dietFeeDraft)}
                      amount={dietFeeDraft.amount}
                      onAmountChange={(v) => setDietFeeDraft({ ...dietFeeDraft, amount: v })}
                      label="Diet Consultation Fee (₹)"
                      testPrefix="cons-diet-fee-confirm"
                    />

                    {mode === "upi" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID</label>
                        <Input value={dietFeeConfirmDraft.upi_transaction_id} onChange={(e) => setDietFeeConfirmDraft({ ...dietFeeConfirmDraft, upi_transaction_id: e.target.value })} className="h-9" data-testid="cons-diet-fee-upi-txn" />
                      </div>
                    )}

                    {BANK_DETAIL_MODES.includes(mode) && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Number</label>
                          <Input value={dietFeeConfirmDraft.account_number} onChange={(e) => setDietFeeConfirmDraft({ ...dietFeeConfirmDraft, account_number: e.target.value })} className="h-9" data-testid="cons-diet-fee-account-number" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Account Holder Name</label>
                          <Input value={dietFeeConfirmDraft.account_holder_name} onChange={(e) => setDietFeeConfirmDraft({ ...dietFeeConfirmDraft, account_holder_name: e.target.value })} className="h-9" data-testid="cons-diet-fee-account-holder" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Bank Name</label>
                          <Input value={dietFeeConfirmDraft.bank_name} onChange={(e) => setDietFeeConfirmDraft({ ...dietFeeConfirmDraft, bank_name: e.target.value })} className="h-9" data-testid="cons-diet-fee-bank-name" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">IFSC Code</label>
                          <Input value={dietFeeConfirmDraft.ifsc_code} onChange={(e) => setDietFeeConfirmDraft({ ...dietFeeConfirmDraft, ifsc_code: e.target.value.toUpperCase() })} className="h-9" data-testid="cons-diet-fee-ifsc" />
                        </div>
                        {mode === "account_transfer" && (
                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-slate-500">Reference / UTR No.</label>
                            <Input value={dietFeeConfirmDraft.transfer_reference} onChange={(e) => setDietFeeConfirmDraft({ ...dietFeeConfirmDraft, transfer_reference: e.target.value })} className="h-9" data-testid="cons-diet-fee-transfer-reference" />
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 text-xs" onClick={() => setDietFeeConfirmDraft(null)} data-testid="cons-diet-fee-confirm-back">
                        Back
                      </Button>
                      <Button
                        className="flex-[2] bg-orange-600 text-xs hover:bg-orange-700"
                        onClick={confirmCollectDietFee}
                        disabled={collectingDietFee || !(parseFloat(dietFeeDraft.amount) > 0)}
                        data-testid="cons-diet-fee-confirm-submit"
                      >
                        {collectingDietFee ? "Saving..." : `Confirm Rs.${dietFeeDraft.amount || 0}`}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Diet Appointment popup (Branch Admin) — step 1, picks the Nutrition Coach.
                Their days come from that coach's own DIET CALENDAR, so nothing can be
                booked into a time they haven't published. */}
            {showDietModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 sm:p-4" data-testid="cons-diet-modal">
                <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <Salad className="h-4 w-4 text-orange-500" /> Diet Appointment
                    </p>
                    <button onClick={() => setShowDietModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-diet-close">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-3 overflow-y-auto px-4 py-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="cons-diet-context">
                      <p className="font-semibold text-slate-700">{selectedLead.name}</p>
                      <p className="mt-0.5">
                        {selectedLead.diet_recommended
                          ? <span className="font-semibold text-orange-600">Diet recommended by the CONSULTANT</span>
                          : "No diet was recommended at the consultation — a Diet Consultation can still be booked if the patient wants one."}
                      </p>
                      {selectedLead.diet_appointment_at && (
                        <p className="mt-0.5">
                          Booked with <span className="font-semibold text-slate-700">{selectedLead.diet_coach_name}</span>
                          {" "}· {dayLabel(selectedLead.diet_appointment_at.split("T")[0])} at {to12h(selectedLead.diet_appointment_at.split("T")[1])}
                        </p>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-500">Nutritionists in this branch — pick one to choose their consultation time</p>

                    {coachOptions.length === 0 ? (
                      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400" data-testid="cons-diet-no-coaches">
                        No Nutritionist for this branch yet. Add one under HR Admin, then publish their days in MANAGEMENT &gt; DIET CALENDAR.
                      </p>
                    ) : (
                      <div className="max-h-32 space-y-1.5 overflow-y-auto">
                        {coachOptions.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => openDietSlotPickerFor(c.id)}
                            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                              coachPick === c.id ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                            data-testid={`cons-diet-coach-option-${c.id}`}
                          >
                            <span className="truncate">{c.full_name}{c.specialization ? ` · ${c.specialization}` : ""}</span>
                            <span className="ml-1.5 flex shrink-0 items-center gap-1.5">
                              {coachPick === c.id && <CheckCircle2 className="h-3.5 w-3.5" />}
                              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {coachPick && dietSlot && (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3" data-testid="cons-diet-plan-preview">
                        <div className="mb-1.5 flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-700">Consultation time</p>
                          <button
                            type="button"
                            onClick={() => setShowDietSlotPicker(true)}
                            className="text-[11px] font-semibold text-orange-600 underline underline-offset-2 hover:text-orange-800"
                            data-testid="cons-diet-change-slots"
                          >
                            Change
                          </button>
                        </div>
                        <p className="text-xs text-slate-700" data-testid="cons-diet-plan-list">
                          <b>{dayLabel(dietSlotDate)}</b> · {to12h(dietSlotTime)} – {endTime12h(dietSlotTime, dietMinutes)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 px-4 py-3">
                    <Button
                      className="w-full bg-orange-500 text-xs hover:bg-orange-600"
                      onClick={() => (dietSlot ? submitDietAssign() : setShowDietSlotPicker(true))}
                      disabled={assigningDiet || !coachPick}
                      data-testid="cons-diet-submit"
                    >
                      {assigningDiet
                        ? "Booking..."
                        : dietSlot
                        ? "Book Diet Consultation"
                        : "Choose Consultation Date & Time"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2 — Diet Consultation date & time, driven entirely by the picked
                coach's own DIET CALENDAR. One appointment, so one time gets chosen; only
                days that coach has actually published can be picked. */}
            {showDietModal && showDietSlotPicker && coachPick && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2" data-testid="cons-diet-slot-picker-modal">
                <div className="flex h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3 text-white sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-base font-bold text-white sm:h-12 sm:w-12 sm:text-lg">
                        {(coachCalendar?.doctor_name || coachOptions.find((c) => c.id === coachPick)?.full_name || "D").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold sm:text-lg" data-testid="cons-diet-picker-coach">
                          {selectedLead.name} <span className="font-normal text-white/70">with</span>{" "}
                          {coachCalendar?.doctor_name || coachOptions.find((c) => c.id === coachPick)?.full_name || "Diet Head"}
                        </p>
                        <p className="text-[11px] leading-snug text-white/75 sm:text-[13px]">
                          Diet Consultation · {dietMinutes} min · {openCheckinSlotCount} slots open
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setShowDietSlotPicker(false)} className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-diet-picker-close">
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Where the booking stands. The treatment picker's twin counts days
                      against a package; this is one appointment, so it says which one. */}
                  <div className="border-b-2 border-slate-200 bg-slate-100 px-3 py-2 sm:px-6 sm:py-3.5" data-testid="cons-diet-picker-status">
                    <div className="flex flex-wrap items-stretch gap-2">
                      <span className="w-full rounded-md border border-orange-800 bg-orange-600 px-3 py-1 text-center text-[11px] font-bold text-white shadow-sm sm:w-auto sm:rounded-lg sm:border-2 sm:px-4 sm:py-2 sm:text-sm" data-testid="cons-diet-picker-count">
                        {dietSlot
                          ? `${dayLabel(dietSlotDate)} · ${to12h(dietSlotTime)}`
                          : "No time chosen yet"}
                      </span>
                      {selectedLead.diet_appointment_at && selectedLead.diet_appointment_at !== dietSlot && (
                        <span className="hidden w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-1.5 text-center text-xs font-bold text-slate-500 shadow-sm sm:block sm:w-auto sm:px-4 sm:py-2 sm:text-left sm:text-sm">
                          Moving from {dayLabel(selectedLead.diet_appointment_at.split("T")[0])} · {to12h(selectedLead.diet_appointment_at.split("T")[1])}
                        </span>
                      )}
                    </div>
                  </div>

                  {loadingCoachCalendar ? (
                    <p className="px-5 py-14 text-center text-sm text-slate-400">Loading this coach's calendar...</p>
                  ) : (
                    <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
                      {/* Month grid — a dot marks a day this coach has published slots on */}
                      <div className="w-full flex-shrink-0 border-b border-slate-100 p-5 lg:w-[25rem] lg:border-b-0 lg:border-r lg:overflow-y-auto">
                        <div className="mb-3 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => (dietPickerMonth === 0 ? (setDietPickerMonth(11), setDietPickerYear(dietPickerYear - 1)) : setDietPickerMonth(dietPickerMonth - 1))}
                            className="rounded p-1 hover:bg-slate-100"
                            data-testid="cons-diet-prev-month"
                          >
                            <ChevronLeft className="h-5 w-5 text-slate-500" />
                          </button>
                          <h4 className="text-base font-bold text-slate-700">{MONTH_NAMES[dietPickerMonth]} {dietPickerYear}</h4>
                          <button
                            type="button"
                            onClick={() => (dietPickerMonth === 11 ? (setDietPickerMonth(0), setDietPickerYear(dietPickerYear + 1)) : setDietPickerMonth(dietPickerMonth + 1))}
                            className="rounded p-1 hover:bg-slate-100"
                            data-testid="cons-diet-next-month"
                          >
                            <ChevronRight className="h-5 w-5 text-slate-500" />
                          </button>
                        </div>

                        <div className="mb-1 grid grid-cols-7 gap-1">
                          {WEEKDAY_LABELS.map((d) => (
                            <div key={d} className="py-1 text-center text-[13px] font-semibold text-slate-400">{d}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1">
                          {Array.from({ length: new Date(dietPickerYear, dietPickerMonth, 1).getDay() }, (_, i) => (
                            <div key={`pad-${i}`} className="h-12" />
                          ))}
                          {Array.from({ length: new Date(dietPickerYear, dietPickerMonth + 1, 0).getDate() }, (_, i) => {
                            const day = i + 1;
                            const d = isoDate(dietPickerYear, dietPickerMonth, day);
                            const dayOpen = (coachSlotsByDate[d] || []).filter((t) => !checkinSlotFull(`${d}T${t}`)).length;
                            const planned = dietSlotDate === d;
                            const isFocused = dietPickerDate === d;
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => setDietPickerDate(d)}
                                disabled={dayOpen === 0 && !planned}
                                className={`relative h-12 rounded-lg text-base font-semibold transition-all ${
                                  isFocused
                                    ? "bg-orange-500 text-white shadow-md ring-2 ring-orange-200 ring-offset-1"
                                    : planned
                                    ? "border border-orange-300 bg-orange-50 text-orange-700"
                                    : dayOpen > 0
                                    ? "text-slate-600 hover:bg-slate-100"
                                    : "cursor-not-allowed text-slate-300"
                                }`}
                                title={planned
                                  ? `Diet Consultation · ${to12h(dietSlotTime)}`
                                  : dayOpen > 0 ? `${dayOpen} slot${dayOpen > 1 ? "s" : ""} open` : "No slots published"}
                                data-testid={`cons-diet-day-${day}`}
                              >
                                {day}
                                {planned ? (
                                  <span className="absolute -right-1 -top-1 flex h-[1.3rem] w-[1.3rem] items-center justify-center rounded-full bg-orange-500 text-[11px] font-bold text-white shadow-sm">
                                    <Salad className="h-3 w-3" />
                                  </span>
                                ) : dayOpen > 0 && !isFocused ? (
                                  <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-orange-400" />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>

                        <div className="mt-4 hidden space-y-2 border-t border-slate-100 pt-3 sm:block">
                          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-orange-500" /> Consultation</span>
                            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400" /> Slots open</span>
                          </div>
                          <p className="text-[13px] text-slate-400">
                            One Diet Consultation — the coach reads the patient and sets their plan. Only days
                            this coach has opened in <b>MANAGEMENT → DIET CALENDAR</b> can be picked. Picking
                            another time <b>moves</b> the appointment; clicking the chosen one again clears it.
                            Diet usually follows treatment, but a patient can come for this alone.
                          </p>
                        </div>
                      </div>

                      {/* Times published on the focused date */}
                      <div className="w-full flex-shrink-0 p-4 lg:flex-1 lg:overflow-y-auto">
                        {!dietPickerDate ? (
                          <div className="flex h-full items-center justify-center">
                            <div className="text-center">
                              <Calendar className="mx-auto mb-2 h-10 w-10 text-slate-200" />
                              <p className="text-sm text-slate-400">Pick a date to see this coach's open times</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-lg font-bold text-slate-800" data-testid="cons-diet-picker-date">{longDate(dietPickerDate)}</h4>
                              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-400">
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Open</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-500" /> Consultation</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" /> Booked</span>
                              </div>
                            </div>

                            {dietSlotDate === dietPickerDate && (
                              <p className="mb-3 rounded-lg border-2 border-orange-400 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-800 shadow-sm" data-testid="cons-diet-day-fixed">
                                <b>Diet Consultation</b> at {to12h(dietSlotTime)} – {endTime12h(dietSlotTime, dietMinutes)}.
                                <span className="ml-1 font-normal">Pick another time to move it, or click it again to clear it.</span>
                              </p>
                            )}

                            {(coachSlotsByDate[dietPickerDate] || []).length === 0 ? (
                              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-400">
                                Nothing published on this day — open it in MANAGEMENT → DIET CALENDAR first.
                              </p>
                            ) : (
                              <div className="grid grid-cols-3 gap-1.5 sm:gap-2" data-testid="cons-diet-picker-grid">
                                {(coachSlotsByDate[dietPickerDate] || []).map((time) => {
                                  const slot = `${dietPickerDate}T${time}`;
                                  const taken = checkinSlotFull(slot);
                                  const picked = dietSlot === slot;
                                  return (
                                    <button
                                      key={time}
                                      type="button"
                                      onClick={() => pickDietSlot(slot)}
                                      disabled={taken}
                                      className={`overflow-hidden rounded-lg border-2 p-2 text-left transition-all sm:p-3 ${
                                        taken
                                          ? "cursor-not-allowed border-amber-300 bg-amber-50 opacity-70"
                                          : picked
                                          ? "border-orange-500 bg-orange-100 shadow-md ring-2 ring-orange-200"
                                          : "border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:shadow-sm"
                                      }`}
                                      title={taken
                                        ? `Booked · ${checkinSlotHeldBy(slot) || "another patient"}`
                                        : `${to12h(time)} – ${endTime12h(time, dietMinutes)}${picked ? " · Diet Consultation" : ""}`}
                                      data-testid={`cons-diet-pick-${time}`}
                                    >
                                      <p className={`truncate text-[13px] font-bold sm:text-base ${taken ? "text-amber-800" : picked ? "text-orange-900" : "text-emerald-800"}`}>
                                        {to12h(time)}
                                      </p>
                                      <p className={`mt-0.5 truncate text-[10px] font-medium sm:text-xs ${taken ? "text-amber-600" : picked ? "text-orange-700" : "text-emerald-600"}`}>
                                        {taken
                                          ? "Booked"
                                          : picked
                                          ? "Consultation"
                                          : `ends ${endTime12h(time, dietMinutes)}`}
                                      </p>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* The chosen appointment, shown here as well as in the status
                                strip so a time picked in another month is still in front of
                                you when you come back to check it. */}
                            {dietSlot && dietSlotDate !== dietPickerDate && (
                              <div className="mt-4 rounded-xl border-2 border-orange-200 bg-orange-50/70 p-4" data-testid="cons-diet-plan">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-bold uppercase tracking-wider text-orange-700">Diet Consultation</p>
                                    <p className="mt-0.5 text-sm text-slate-600">
                                      {dayLabel(dietSlotDate)} · {to12h(dietSlotTime)} – {endTime12h(dietSlotTime, dietMinutes)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const [y, m] = dietSlotDate.split("-").map(Number);
                                        setDietPickerYear(y);
                                        setDietPickerMonth(m - 1);
                                        setDietPickerDate(dietSlotDate);
                                      }}
                                      className="text-[13px] font-bold text-orange-600 hover:text-orange-800"
                                      data-testid="cons-diet-picker-goto"
                                    >
                                      Go to it
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDietSlot("")}
                                      className="text-[13px] font-bold text-rose-600 hover:text-rose-800"
                                      data-testid="cons-diet-picker-clear"
                                    >
                                      Clear
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2.5 border-t-2 border-slate-200 bg-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 sm:py-4">
                    <div className="text-[12px] leading-snug text-slate-500 sm:text-[13px]">
                      <p className="font-bold text-slate-700">
                        {dietSlot
                          ? `Diet Consultation · ${dayLabel(dietSlotDate)} at ${to12h(dietSlotTime)}.`
                          : "Pick a date, then a time, for the Diet Consultation."}
                      </p>
                      {selectedLead.assigned_physio_name && (
                        <p className="mt-1 text-slate-400">
                          Also on treatment with {selectedLead.assigned_physio_name} — the diet consultation is booked separately from their sessions.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" className="flex-1 text-sm sm:flex-none" onClick={() => setShowDietSlotPicker(false)} data-testid="cons-diet-picker-back">
                        Back
                      </Button>
                      <Button
                        className="flex-[2] bg-orange-500 text-sm hover:bg-orange-600 sm:flex-none"
                        onClick={submitDietAssign}
                        disabled={assigningDiet || !dietSlot}
                        data-testid="cons-diet-picker-submit"
                      >
                        {assigningDiet ? "Booking..." : "Book Diet Consultation"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Physio Assign popup (Branch Admin) — after fees are collected */}
            {showPhysioModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="cons-physio-modal">
                <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Users className="h-4 w-4 text-emerald-600" /> Assign Physio</p>
                    <button onClick={() => setShowPhysioModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-physio-close"><X className="h-4 w-4" /></button>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="cons-physio-package-context">
                    <p className="font-semibold text-slate-700">{courseName}{totalSessionsNeeded ? ` · ${totalSessionsNeeded} ${dayNoun}s` : ""}</p>
                    <p className="mt-0.5">
                      Treatment Fee: {selectedLead.treatment_fee_paid != null ? (
                        <span className="font-semibold text-emerald-700">Rs.{selectedLead.treatment_fee_paid} paid ({selectedLead.treatment_fee_payment_mode || "—"})</span>
                      ) : (
                        <span className="text-amber-600">not paid</span>
                      )}
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-500">Available physios in this branch — pick one to choose their treatment dates</p>

                  {physioOptions.length === 0 ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No physios found for this branch yet.</p>
                  ) : (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {physioOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => openSlotPickerFor(p.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                            physioPick === p.id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                          data-testid={`cons-physio-option-${p.id}`}
                        >
                          <span>{p.full_name}{p.specialization ? ` · ${p.specialization}` : ""}</span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {physioPick === p.id && <CheckCircle2 className="h-3.5 w-3.5" />}
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {physioPick && sortedPickedSlots.length > 0 && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-physio-sessions-preview">
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">Treatment days fixed</p>
                        <button
                          type="button"
                          onClick={() => setShowSlotPicker(true)}
                          className="text-[11px] font-semibold text-violet-600 underline underline-offset-2 hover:text-violet-800"
                          data-testid="cons-physio-change-slots"
                        >
                          Change
                        </button>
                      </div>
                      <div className="max-h-28 space-y-1 overflow-y-auto text-xs" data-testid="cons-physio-sessions-list">
                        {treatmentPlan.map((p) => (
                          <p key={p.slot} className={isPaidSession(p.day) ? "text-emerald-700" : "text-rose-700"}>
                            <b>Day {p.day}</b> · {dayLabel(p.date)} · {to12h(p.time)} – {endTime12h(p.time, sessionMinutes)}
                            <span className="ml-1 font-bold">{isPaidSession(p.day) ? "PAID" : "UNPAID"}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                    onClick={() => (allSessionsPicked ? submitPhysioAssign() : setShowSlotPicker(true))}
                    disabled={assigningPhysio || !physioPick}
                    data-testid="cons-physio-submit"
                  >
                    {assigningPhysio
                      ? "Assigning..."
                      : allSessionsPicked
                      ? `Assign & Book ${openEndedRehab ? sortedPickedSlots.length : totalSessionsNeeded} ${isRehabAssign ? "Rehab Days" : "Sessions"}`
                      : "Choose Treatment Dates & Times"}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2 — Treatment date & time picker, driven entirely by the picked physio's
                own PHYSIO CALENDAR. Every session of the package gets a date and a time the
                Branch Admin fixes by hand; nothing is auto-filled, and only slots that physio
                has actually published are offered. */}
            {showPhysioModal && showSlotPicker && physioPick && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2" data-testid="cons-slot-picker-modal">
                <div className="flex h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                  {/* Wraps on a phone: the title keeps the first line with the close button
                      and the status badge drops to its own beneath. Side by side the badge
                      refuses to shrink and squeezes the name into a one-word column. */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-white sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-base font-bold text-white sm:h-12 sm:w-12 sm:text-lg">
                        {(physioCalendarData?.doctor_name || physioOptions.find((p) => p.id === physioPick)?.full_name || "P").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold sm:text-lg" data-testid="cons-slot-picker-physio">
                          {selectedLead.name} <span className="font-normal text-white/70">with</span>{" "}
                          {physioCalendarData?.doctor_name || physioOptions.find((p) => p.id === physioPick)?.full_name || "Physio"}
                        </p>
                        <p className="text-[11px] leading-snug text-white/75 sm:text-[13px]">
                          {courseName}{totalSessionsNeeded ? ` · ${totalSessionsNeeded} ${dayNoun}s` : ""} ·
                          {" "}one session a day · {sessionMinutes} min each · {openSlotCount} slots open
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setShowSlotPicker(false)} className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-slot-picker-close">
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Treatment Fee standing — which of these treatment days are actually paid
                      for. The balance sessions still get scheduled, but they're marked unpaid
                      so nobody books them believing the money is in. */}
                  {/* One status strip. Scheduling progress used to sit up in the purple
                      header while the two payment badges sat down here, so the three things
                      that describe where this booking stands were split across two bars and
                      lined up with nothing. They read as a set now: a heading row, then the
                      chips beneath it, each chip a full-width row on a phone so the amount
                      and the day range inside it stay on one line. */}
                  <div className="border-b-2 border-slate-200 bg-slate-100 px-3 py-2 sm:px-6 sm:py-3.5" data-testid="cons-slot-picker-payment">
                    <div className="mb-2 hidden items-baseline justify-between gap-2 sm:flex">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Treatment Fee</span>
                      {sessionPayment.price > 0 && (
                        <span className="shrink-0 text-[12px] font-bold text-slate-600 sm:text-[13px]">
                          Rs.{sessionPayment.paidAmount} of Rs.{sessionPayment.price} collected
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-stretch gap-2">
                      <span
                        className="w-full rounded-md border border-emerald-900 bg-emerald-700 px-3 py-1 text-center text-[11px] font-bold text-white shadow-sm sm:w-auto sm:rounded-lg sm:border-2 sm:px-4 sm:py-2 sm:text-sm"
                        data-testid="cons-slot-picker-count"
                      >
                        {openEndedRehab ? `${sortedPickedSlots.length} ${dayNoun}${sortedPickedSlots.length === 1 ? "" : "s"} fixed` : `${sortedPickedSlots.length} of ${totalSessionsNeeded} ${dayNoun}s fixed`}
                      </span>
                      <span className="hidden w-full rounded-lg border-2 border-emerald-400 bg-emerald-50 sm:block px-3 py-1.5 text-center text-xs font-bold text-emerald-700 shadow-sm sm:w-auto sm:px-4 sm:py-2 sm:text-left sm:text-sm" data-testid="cons-payment-paid">
                        {sessionPayment.paid} session{sessionPayment.paid === 1 ? "" : "s"} PAID
                        {sessionPayment.paidAmount > 0 && <span className="ml-2 font-semibold text-emerald-600">Rs.{sessionPayment.paidAmount}</span>}
                        {sessionPayment.paid > 0 && <span className="ml-2 font-medium text-emerald-500">Day 1–{sessionPayment.paid}</span>}
                      </span>
                      {sessionPayment.unpaid > 0 ? (
                        <span className="hidden w-full rounded-lg border-2 border-rose-400 bg-rose-50 sm:block px-3 py-1.5 text-center text-xs font-bold text-rose-700 shadow-sm sm:w-auto sm:px-4 sm:py-2 sm:text-left sm:text-sm" data-testid="cons-payment-unpaid">
                          {sessionPayment.unpaid} session{sessionPayment.unpaid === 1 ? "" : "s"} UNPAID
                          {sessionPayment.dueAmount > 0 && <span className="ml-2 font-semibold text-rose-600">Rs.{sessionPayment.dueAmount}</span>}
                          <span className="ml-2 font-medium text-rose-500">
                            Day {sessionPayment.paid + 1}–{sessionPayment.total}
                            {sessionPayment.dueDate ? ` · due ${dayLabel(sessionPayment.dueDate)}` : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="hidden w-full rounded-lg border-2 border-emerald-400 bg-emerald-100 px-3 py-1.5 text-center text-xs font-bold text-emerald-800 shadow-sm sm:block sm:w-auto sm:px-4 sm:py-2 sm:text-left sm:text-sm">
                          Package fully paid
                        </span>
                      )}
                    </div>
                  </div>

                  {loadingPhysioCalendar ? (
                    <p className="px-5 py-14 text-center text-sm text-slate-400">Loading this physio's calendar...</p>
                  ) : (
                    <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
                      {/* Month grid — a dot marks a day this physio has published slots on */}
                      <div className="w-full flex-shrink-0 border-b border-slate-100 p-5 lg:w-[25rem] lg:border-b-0 lg:border-r lg:overflow-y-auto">
                        <div className="mb-3 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => (pickerMonth === 0 ? (setPickerMonth(11), setPickerYear(pickerYear - 1)) : setPickerMonth(pickerMonth - 1))}
                            className="rounded p-1 hover:bg-slate-100"
                            data-testid="cons-slot-prev-month"
                          >
                            <ChevronLeft className="h-5 w-5 text-slate-500" />
                          </button>
                          <h4 className="text-base font-bold text-slate-700">{MONTH_NAMES[pickerMonth]} {pickerYear}</h4>
                          <button
                            type="button"
                            onClick={() => (pickerMonth === 11 ? (setPickerMonth(0), setPickerYear(pickerYear + 1)) : setPickerMonth(pickerMonth + 1))}
                            className="rounded p-1 hover:bg-slate-100"
                            data-testid="cons-slot-next-month"
                          >
                            <ChevronRight className="h-5 w-5 text-slate-500" />
                          </button>
                        </div>

                        <div className="mb-1 grid grid-cols-7 gap-1">
                          {WEEKDAY_LABELS.map((d) => (
                            <div key={d} className="py-1 text-center text-[13px] font-semibold text-slate-400">{d}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1">
                          {Array.from({ length: new Date(pickerYear, pickerMonth, 1).getDay() }, (_, i) => (
                            <div key={`pad-${i}`} className="h-12" />
                          ))}
                          {Array.from({ length: new Date(pickerYear, pickerMonth + 1, 0).getDate() }, (_, i) => {
                            const day = i + 1;
                            const d = isoDate(pickerYear, pickerMonth, day);
                            const dayOpen = (physioSlotsByDate[d] || []).filter((t) => !slotFull(`${d}T${t}`)).length;
                            const planned = planByDate[d];
                            const isFocused = pickerDate === d;
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => setPickerDate(d)}
                                disabled={dayOpen === 0 && !planned}
                                className={`relative h-12 rounded-lg text-base font-semibold transition-all ${
                                  isFocused
                                    ? "bg-violet-600 text-white shadow-md ring-2 ring-violet-300 ring-offset-1"
                                    : planned
                                    ? isPaidSession(planned.day)
                                      ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
                                      : "border border-rose-300 bg-rose-50 text-rose-700"
                                    : dayOpen > 0
                                    ? "text-slate-600 hover:bg-slate-100"
                                    : "cursor-not-allowed text-slate-300"
                                }`}
                                title={planned
                                  ? `Day ${planned.day} · ${to12h(planned.time)} · ${isPaidSession(planned.day) ? "paid" : "unpaid"}`
                                  : dayOpen > 0 ? `${dayOpen} slot${dayOpen > 1 ? "s" : ""} open` : "No slots published"}
                                data-testid={`cons-slot-day-${day}`}
                              >
                                {day}
                                {planned ? (
                                  <span className={`absolute -right-1 -top-1 flex h-[1.3rem] min-w-[1.3rem] items-center justify-center rounded-full px-1 text-[11px] font-bold shadow-sm ${
                                    isPaidSession(planned.day) ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                                  }`}>
                                    {planned.day}
                                  </span>
                                ) : dayOpen > 0 && !isFocused ? (
                                  <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>

                        <div className="mt-4 hidden space-y-2 border-t border-slate-100 pt-3 sm:block">
                          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-emerald-500" /> Paid day</span>
                            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-rose-500" /> Unpaid day</span>
                            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> Slots open</span>
                          </div>
                          <p className="text-[13px] text-slate-400">
                            One {dayNoun} a day — {totalSessionsNeeded} means {totalSessionsNeeded} separate
                            days. Only days this physio has opened in <b>PHYSIO CALENDAR</b> can be picked. Pick a
                            time and it <b>jumps to the next open date</b> on its own, so the plan is laid out in one
                            run. Picking another time on a day already fixed <b>moves</b> that day's session and stays put.
                          </p>
                        </div>
                      </div>

                      {/* Times published on the focused date */}
                      {/* overflow and flex-1 only from lg, where the calendar and the times
                          are side-by-side columns that scroll independently. Stacked on a
                          phone this was a scroller inside the body's own scroller, which
                          trapped the times in a short box — the date heading was clipped and
                          the slots under it couldn't be reached at all. */}
                      <div className="w-full flex-shrink-0 p-4 lg:flex-1 lg:overflow-y-auto">
                        {!pickerDate ? (
                          <div className="flex h-full items-center justify-center">
                            <div className="text-center">
                              <Calendar className="mx-auto mb-2 h-10 w-10 text-slate-200" />
                              <p className="text-sm text-slate-400">Pick a treatment date to see this physio's open times</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-lg font-bold text-slate-800" data-testid="cons-slot-picker-date">{longDate(pickerDate)}</h4>
                              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-400">
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Open</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Paid day</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> Unpaid day</span>
                                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" /> Booked</span>
                              </div>
                            </div>

                            {planByDate[pickerDate] && (
                              <p
                                className={`mb-3 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold shadow-sm ${
                                  isPaidSession(planByDate[pickerDate].day)
                                    ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                                    : "border-rose-400 bg-rose-50 text-rose-800"
                                }`}
                                data-testid="cons-slot-day-fixed"
                              >
                                <b>Day {planByDate[pickerDate].day}</b> is fixed for {to12h(planByDate[pickerDate].time)} – {endTime12h(planByDate[pickerDate].time, sessionMinutes)} ·{" "}
                                {isPaidSession(planByDate[pickerDate].day) ? "PAID" : "UNPAID"}.
                                <span className="ml-1 font-normal">Pick another time to move it, or click it again to free the day.</span>
                              </p>
                            )}

                            {(physioSlotsByDate[pickerDate] || []).length === 0 ? (
                              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-400">
                                Nothing published on this day — open it in MANAGEMENT → PHYSIO CALENDAR first.
                              </p>
                            ) : (
                              <div className="grid grid-cols-3 gap-1.5 sm:gap-2" data-testid="cons-slot-picker-grid">
                                {(physioSlotsByDate[pickerDate] || []).map((time) => {
                                  const slot = `${pickerDate}T${time}`;
                                  const taken = slotFull(slot);
                                  const seats = slotSeatsTaken(slot);
                                  // Off the table because this patient is already here on
                                  // the other course, rather than because the physio is
                                  // out of seats. Two different problems with two
                                  // different answers, so the tile says which.
                                  const ownClash = slotOwnOtherCourse(slot);
                                  const picked = planByDate[pickerDate]?.slot === slot;
                                  const pickedPaid = picked && isPaidSession(planByDate[pickerDate].day);
                                  return (
                                    <button
                                      key={time}
                                      type="button"
                                      onClick={() => togglePickedSlot(slot)}
                                      disabled={taken}
                                      className={`overflow-hidden rounded-lg border-2 p-2 text-left transition-all sm:p-3 ${
                                        taken
                                          ? "cursor-not-allowed border-amber-300 bg-amber-50 opacity-70"
                                          : picked
                                          ? pickedPaid
                                            ? "border-emerald-500 bg-emerald-100 shadow-md ring-2 ring-emerald-200"
                                            : "border-rose-400 bg-rose-100 shadow-md ring-2 ring-rose-200"
                                          : "border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:shadow-sm"
                                      }`}
                                      title={ownClash
                                        ? `${selectedLead.name} already has a ${ownClash} at ${to12h(time)} — move that first, or pick another time`
                                        : taken
                                        ? `Full · ${seats}/${slotCapacity} · ${slotOccupantNames(slot) || "—"}`
                                        : `${to12h(time)} – ${endTime12h(time, sessionMinutes)} · ${seats}/${slotCapacity} taken${seats ? ` · ${slotOccupantNames(slot)}` : ""}${picked ? ` · Day ${planByDate[pickerDate].day} · ${pickedPaid ? "PAID" : "UNPAID"}` : ""}`}
                                      data-testid={`cons-slot-pick-${time}`}
                                    >
                                      {/* Two lines, always. Both nowrap and sized to a third
                                          of a phone, so "10:00 AM" can't break after the hour
                                          and turn one box into four lines while "8:00 AM"
                                          beside it stays at two. The first line carries only
                                          the time — a Day badge sharing it was what tipped the
                                          longest times over the width. */}
                                      <p className={`truncate text-[13px] font-bold sm:text-base ${taken ? "text-amber-800" : picked ? (pickedPaid ? "text-emerald-900" : "text-rose-900") : "text-emerald-800"}`}>
                                        {to12h(time)}
                                      </p>
                                      {/* Once a slot is picked, which treatment day it became
                                          and whether it's paid matter more than its end time,
                                          which is fixed by the package and named in the header. */}
                                      <p className={`mt-0.5 flex items-center gap-1 truncate text-[10px] font-medium sm:text-xs ${taken ? "text-amber-600" : picked ? (pickedPaid ? "text-emerald-700" : "text-rose-700") : "text-emerald-600"}`}>
                                        {/* A slot says how full it is rather than who is in
                                            it — the physio takes several at once, so the seat
                                            count is what decides whether it's bookable. Names
                                            stay in the tooltip.

                                            Dots on every unpicked slot, not only part-filled
                                            ones: they are how many seats this slot has as much
                                            as how many are gone, and an empty slot that showed
                                            nothing made the row of dots look like a warning
                                            rather than a gauge. A picked slot gives the space
                                            to its day and paid state instead. */}
                                        {picked ? (
                                          `Day ${planByDate[pickerDate].day} · ${pickedPaid ? "PAID" : "UNPAID"}`
                                        ) : (
                                          <>
                                            <SeatDots taken={seats} capacity={slotCapacity} />
                                            {ownClash
                                              ? <span className="min-w-0 truncate">your {ownClash}</span>
                                              : !taken && <span className="min-w-0 truncate">ends {endTime12h(time, sessionMinutes)}</span>}
                                          </>
                                        )}
                                      </p>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {treatmentPlan.length > 0 && (
                              <div className="mt-4 rounded-xl border-2 border-violet-200 bg-violet-50/70 p-4" data-testid="cons-treatment-plan">
                                <div className="mb-2 flex items-center justify-between">
                                  <p className="text-sm font-bold uppercase tracking-wider text-violet-700">Treatment plan</p>
                                  <button
                                    type="button"
                                    onClick={() => setPickedSessionSlots([])}
                                    className="text-[13px] font-bold text-rose-600 hover:text-rose-800"
                                    data-testid="cons-slot-picker-clear"
                                  >
                                    Clear all
                                  </button>
                                </div>
                                {/* Grouped the way the package is sold — "03 Week · 9 sessions" reads back
                                    as 3 weeks of treatment days, each day one session. Each day carries
                                    whether the Treatment Fee actually covers it. */}
                                <div className="max-h-48 space-y-2.5 overflow-y-auto">
                                  {[...new Set(treatmentPlan.map((p) => p.week))].map((week) => (
                                    <div key={week}>
                                      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-violet-500">Week {week}</p>
                                      {/* Three to a row. As pills on one flowing line each
                                          carried the day, the date, both ends of the slot and
                                          its paid state on a single line, which no phone has
                                          the width for — stacked inside a card, the same
                                          facts fit a third of the screen. */}
                                      <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-4">
                                        {treatmentPlan.filter((p) => p.week === week).map((p) => {
                                          const paid = isPaidSession(p.day);
                                          return (
                                            <button
                                              key={p.slot}
                                              type="button"
                                              onClick={() => togglePickedSlot(p.slot)}
                                              className={`relative flex flex-col items-center gap-0.5 rounded-lg border-2 bg-white px-1 py-1.5 text-[10px] font-bold leading-tight transition ${
                                                paid
                                                  ? "border-emerald-300 text-emerald-700 hover:border-emerald-500"
                                                  : "border-rose-300 text-rose-700 hover:border-rose-500"
                                              }`}
                                              title={`${dayLabel(p.date)} · ${to12h(p.time)} – ${endTime12h(p.time, sessionMinutes)} · ${paid ? "paid" : "unpaid"} — tap to remove`}
                                              data-testid={`cons-slot-picked-${p.slot}`}
                                            >
                                              <X className="absolute right-0.5 top-0.5 h-3 w-3 text-slate-300" />
                                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] text-white ${paid ? "bg-emerald-600" : "bg-rose-600"}`}>Day {p.day}</span>
                                              <span className="text-slate-600">{shortDayLabel(p.date)}</span>
                                              <span className="text-slate-500">{to12h(p.time)}</span>
                                              <span className={`text-[9px] font-extrabold ${paid ? "text-emerald-600" : "text-rose-600"}`}>{paid ? "PAID" : "UNPAID"}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Stacked on a phone. On one line the two buttons take what they need
                      and the note beside them is left a column barely a word wide. */}
                  <div className="flex flex-col gap-2.5 border-t-2 border-slate-200 bg-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 sm:py-4">
                    <div className="text-[12px] leading-snug text-slate-500 sm:text-[13px]">
                      <p className="font-bold text-slate-700">
                        {allSessionsPicked
                          ? `All ${totalSessionsNeeded} ${dayNoun}s are fixed${treatmentPlan.length > 0 ? ` · ${dayLabel(treatmentPlan[0].date)} to ${dayLabel(treatmentPlan[treatmentPlan.length - 1].date)}` : ""}.`
                          : `${totalSessionsNeeded - sortedPickedSlots.length} more ${dayNoun}${totalSessionsNeeded - sortedPickedSlots.length === 1 ? "" : "s"} still need a date and time.`}
                      </p>
                      {sessionPayment.unpaid > 0 && (
                        <p className="mt-1 font-bold text-rose-600" data-testid="cons-slot-picker-unpaid-note">
                          Day {sessionPayment.paid + 1}–{sessionPayment.total} are booked against an unpaid balance of Rs.{sessionPayment.dueAmount}
                          {sessionPayment.dueDate ? ` · due ${dayLabel(sessionPayment.dueDate)}` : ""}.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" className="flex-1 text-sm sm:flex-none" onClick={() => setShowSlotPicker(false)} data-testid="cons-slot-picker-back">
                        Back
                      </Button>
                      <Button
                        className="flex-[2] bg-emerald-600 text-sm hover:bg-emerald-700 sm:flex-none"
                        onClick={submitPhysioAssign}
                        disabled={assigningPhysio || !allSessionsPicked}
                        data-testid="cons-slot-picker-submit"
                      >
                        {assigningPhysio ? "Assigning..." : `Assign & Book ${openEndedRehab ? sortedPickedSlots.length : totalSessionsNeeded} ${isRehabAssign ? "Rehab Days" : "Sessions"}`}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Schedule Follow-Up popup */}
            {followUpDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" data-testid="cons-followup-modal">
                <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5" />
                      <p className="text-base font-semibold">Schedule Follow-Up</p>
                    </div>
                    <button onClick={() => setFollowUpDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-followup-close">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-4 p-5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
                      <MilkDateInput
                        value={followUpDraft.date}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setFollowUpDraft({ ...followUpDraft, date: e.target.value })}
                        data-testid="cons-followup-date"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                      <MilkTimeInput
                        value={followUpDraft.time}
                        onChange={(e) => setFollowUpDraft({ ...followUpDraft, time: e.target.value })}
                        data-testid="cons-followup-time"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
                      <textarea
                        rows={3}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="What to discuss in the next follow-up..."
                        value={followUpDraft.remarks}
                        onChange={(e) => setFollowUpDraft({ ...followUpDraft, remarks: e.target.value })}
                        data-testid="cons-followup-remarks"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                    <Button variant="outline" onClick={() => setFollowUpDraft(null)} data-testid="cons-followup-cancel">Cancel</Button>
                    <Button
                      className="bg-amber-500 text-white hover:bg-amber-600"
                      onClick={async () => {
                        if (!followUpDraft.date || !followUpDraft.time) {
                          toast.error("Date and time are required");
                          return;
                        }
                        try {
                          const updated = await scheduleConsultationFollowUp(selectedLead.id, followUpDraft);
                          setFollowUpDraft(null);
                          // Close the lead card instantly, same as a plain stage move.
                          setSelectedLead(null);
                          setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => l.id === updated.id ? updated : l) }));
                          toast.success(`Follow-up scheduled for ${followUpDraft.date} at ${followUpDraft.time}`);
                        } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                      }}
                      data-testid="cons-followup-save"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm & Move
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Reschedule Follow-Up popup */}
            {rescheduleDraft && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" data-testid="cons-reschedule-modal">
                <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5" />
                      <p className="text-base font-semibold">Reschedule Follow-Up</p>
                    </div>
                    <button onClick={() => setRescheduleDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-reschedule-close">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-4 p-5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">New Date *</label>
                      <MilkDateInput
                        value={rescheduleDraft.date}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, date: e.target.value })}
                        data-testid="cons-reschedule-date"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">New Time *</label>
                      <MilkTimeInput
                        value={rescheduleDraft.time}
                        onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })}
                        data-testid="cons-reschedule-time"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Reason for Reschedule *</label>
                      <textarea
                        rows={3}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="Why is this being rescheduled..."
                        value={rescheduleDraft.reason}
                        onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, reason: e.target.value })}
                        data-testid="cons-reschedule-reason"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                    <Button variant="outline" onClick={() => setRescheduleDraft(null)} data-testid="cons-reschedule-cancel">Cancel</Button>
                    <Button
                      className="bg-amber-500 text-white hover:bg-amber-600"
                      onClick={async () => {
                        if (!rescheduleDraft.date || !rescheduleDraft.time || !rescheduleDraft.reason.trim()) {
                          toast.error("Date, time and reason are required");
                          return;
                        }
                        try {
                          const updated = await rescheduleConsultationFollowUp(selectedLead.id, rescheduleDraft.followupId, {
                            date: rescheduleDraft.date, time: rescheduleDraft.time, reason: rescheduleDraft.reason,
                          });
                          applyUpdatedLead(updated);
                          setRescheduleDraft(null);
                          toast.success(`Follow-up rescheduled to ${rescheduleDraft.date} at ${rescheduleDraft.time}`);
                        } catch (e) { toast.error(e?.response?.data?.detail || "Failed to reschedule"); }
                      }}
                      data-testid="cons-reschedule-save"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Reschedule
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment receipt — the acknowledgement the client is handed. Rendered here rather
          than inside the lead dialog because collecting the last outstanding fee closes
          that dialog, and the receipt has to outlive it. */}
      {/* The confirmation, over the patient it belongs to. Same shape as the payment
          receipt below — a status header, the facts, then the actions — because it does
          the same job: says what was just recorded and offers the few things anyone wants
          next. z-[70] to clear the lead popup it opens above. */}
      {decisionReceipt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setDecisionReceipt(null); }} data-testid="cons-decision-receipt">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 bg-emerald-600 px-4 py-3 text-white">
              <div className="flex min-w-0 items-center gap-2.5">
                <CheckCircle2 className="h-7 w-7 shrink-0" />
                <div className="min-w-0">
                  <p className="text-base font-bold leading-tight">
                    {decisionReceipt.rehab ? "Moved to Rehab" : "Treatment Confirmed"}
                  </p>
                  <p className="truncate text-xs text-white/80">
                    {decisionReceipt.name}{decisionReceipt.patientNo ? ` · ${decisionReceipt.patientNo}` : ""}
                  </p>
                </div>
              </div>
              <button onClick={() => setDecisionReceipt(null)} className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-decision-receipt-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Plan</span>
                <span className="text-right text-xs font-bold text-slate-800">{decisionReceipt.planLabel}</span>
              </div>
              {decisionReceipt.packageName && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Package</span>
                  <span className="text-right text-xs font-bold text-slate-800">{decisionReceipt.packageName}</span>
                </div>
              )}
              {decisionReceipt.perWeek > 0 && decisionReceipt.weeks > 0 && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sessions</span>
                  <span className="text-right text-xs font-bold text-slate-800">
                    {decisionReceipt.perWeek} weekly × {decisionReceipt.weeks} weeks = {decisionReceipt.perWeek * decisionReceipt.weeks}
                  </span>
                </div>
              )}
              <p className="pt-1 text-[11px] text-slate-500">
                {decisionReceipt.rehab ? "Waiting on a package in Rehab." : "Sent to Branch Admin — Consultation Visit."}
              </p>
            </div>

            {/* Submit finishes: it closes the patient as well as this popup and puts the
                board back. Cancel only dismisses the popup, leaving the patient open —
                the difference being whether there is anything else to do here. Edit and
                Share both keep the record on screen because they act on it. */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDecisionReceipt(null)} data-testid="cons-decision-receipt-cancel">
                Cancel
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => shareDecision(decisionReceipt)} data-testid="cons-decision-receipt-share">
                <Share2 className="mr-1 h-3 w-3" />Share
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => beginEditDecision(selectedLead)} data-testid="cons-decision-receipt-edit">
                <Pencil className="mr-1 h-3 w-3" />Edit
              </Button>
              <Button
                size="sm"
                className="h-8 bg-emerald-600 text-xs hover:bg-emerald-700"
                onClick={() => { setDecisionReceipt(null); setSelectedLead(null); }}
                data-testid="cons-decision-receipt-submit"
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />Submit
              </Button>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" data-testid="cons-receipt-modal">
          {/* 88%, this dialog only. zoom rather than transform: scale — zoom shrinks the
              layout box itself, so the flex centring above and the max-h below still work
              on the size actually drawn. scale would leave the box at full size, centring
              the card off its own bounds and reserving space nothing occupies. */}
          <div
            className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            style={{ zoom: 0.88 }}
          >
            {/* items-center, not items-start: the title block is shorter than the logo, so
                aligning to the top left a band of empty green under the transaction line.
                Padding and logo come down with it. */}
            <div className={`flex items-center justify-between gap-3 px-4 py-3 text-white ${isSchedule(receipt) ? "bg-amber-600" : "bg-emerald-600"}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                {/* A status mark rather than the logo: the logo already opens the body
                    two lines below, and the header's job is to say what happened. */}
                {isSchedule(receipt)
                  ? <Calendar className="h-7 w-7 shrink-0" />
                  : <CheckCircle2 className="h-7 w-7 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-base font-bold leading-tight">{isSchedule(receipt) ? "Payment Schedule Created" : "Payment Received"}</p>
                  <p className="truncate text-xs text-white/80">{isSchedule(receipt) ? "Reference" : "Txn"} {receipt.receiptNo}</p>
                </div>
              </div>
              <button onClick={() => setReceipt(null)} className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="cons-receipt-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 flex items-center justify-center gap-2 text-center">
                <img src={LOGO_URL} alt="" className="h-7 w-7 object-contain" />
                <div className="text-left">
                  <p className="text-base font-extrabold tracking-wide text-slate-800">FITSIOMAX</p>
                  <p className="text-[10px] text-slate-400">{receipt.branch || "Physiotherapy & Rehabilitation"}</p>
                </div>
              </div>

              {/* With a discount, the hero shows what it was worth as well as what came
                  in — billed, off, collected. Rs.780 on its own is unarguable but says
                  nothing about the Rs.1,200 it started from, and that is the number a
                  patient queries. Both figures were already on the receipt, several rows
                  further down, which is not where anyone looks first.
                  No discount, or a schedule where nothing has been collected: the single
                  figure stays: a "discount Rs.0" column is noise on most receipts. */}
              {(() => {
                const billed = receipt.originalAmount;
                const off = Number(receipt.discount) || 0;
                const showSplit = !isSchedule(receipt) && off > 0 && billed > 0;
                if (!showSplit) {
                  return (
                    <div className={`rounded-xl border-2 px-4 py-5 text-center ${isSchedule(receipt) ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                      <p className={`text-xs font-bold uppercase tracking-widest ${isSchedule(receipt) ? "text-amber-600" : "text-emerald-600"}`}>
                        {isSchedule(receipt) ? "Total Payable" : "Amount Paid"}
                      </p>
                      <p className={`mt-1 text-4xl font-extrabold ${isSchedule(receipt) ? "text-amber-700" : "text-emerald-700"}`} data-testid="cons-receipt-amount">Rs.{receipt.amount}</p>
                      <p className={`mt-1 text-sm font-semibold ${isSchedule(receipt) ? "text-amber-600" : "text-emerald-600"}`}>{receipt.modeLabel}</p>
                      {isSchedule(receipt) && (
                        <p className="mt-2 text-xs font-medium text-amber-700">Nothing collected yet — each installment gets its own receipt.</p>
                      )}
                    </div>
                  );
                }
                // round2, the same helper the collect form's own discount readout uses, so
                // the percentage on the receipt cannot disagree with the one shown while
                // the amount was being entered. 35% off, not 35.00%; 12.5% stays 12.5%.
                const pct = round2((off / billed) * 100);
                return (
                  <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-4" data-testid="cons-receipt-amount-split">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-[11px] font-medium text-slate-500">Total Amount</p>
                        <p className="mt-1 text-xl font-extrabold text-slate-700">Rs.{billed}</p>
                      </div>
                      <div>
                        {/* The percentage sits in the heading rather than on a third line —
                            "32% Discount" is one fact, and splitting it made the middle
                            column a line taller than the two either side of it. */}
                        <p className="text-[11px] font-medium text-amber-600">{pct}% Discount</p>
                        <p className="mt-1 text-xl font-extrabold text-amber-700" data-testid="cons-receipt-discount">−Rs.{off}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-emerald-600">Paid Amount</p>
                        <p className="mt-1 text-xl font-extrabold text-emerald-700" data-testid="cons-receipt-amount">Rs.{receipt.amount}</p>
                        <p className="text-[10px] font-semibold text-emerald-600">{receipt.modeLabel}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <dl className="mt-5 space-y-2 text-sm">
                {receiptPopupRows(receipt).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className={`text-right font-semibold ${
                      k === "Amount Paid" ? "text-emerald-700"
                      : k === "Total Payable" ? "text-amber-700"
                      : k === "Discount" ? "text-rose-600"
                      : k === "Balance Due" ? "text-rose-600"
                      : "text-slate-700"}`}>{v}</dd>
                  </div>
                ))}
              </dl>

              {receipt.installments.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Installments</p>
                  <div className="space-y-1.5">
                    {receipt.installments.map((i, n) => (
                      <div key={n} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs">
                        <span className="text-slate-600">
                          #{n + 1}{i.sessions ? ` · ${i.sessions} sessions` : ""} · due {i.due_date || "—"}
                        </span>
                        <span className={`font-bold ${i.paid ? "text-emerald-600" : "text-amber-600"}`}>
                          Rs.{i.amount}{i.paid ? " · PAID" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Icons only. With four on one row, "Download" was arriving as "Dow…", and a
                truncated word is worse than no word — the glyph at least survives. Every
                label moves to title and aria-label, so a hover still says what each does
                and a screen reader still announces it.
                Square and centred rather than four stretched quarters: an icon adrift in
                the middle of a wide button reads as a mis-render. */}
            {/* Three actions. Done went with the tick — the header X already closes this,
                and a fourth button that only dismisses was the one control here that did
                nothing to the receipt. */}
            {/* All plain but WhatsApp. Print and Share used to swap an emerald fill
                between them depending on whether the payment was cash — with WhatsApp's
                own brand green in the row, a second green next to it would have read as
                two competing defaults rather than one branded button. The green here now
                belongs to WhatsApp and means WhatsApp, nothing else. */}
            <div className="flex items-center justify-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:gap-3 sm:px-6">
              <Button
                variant="outline"
                className="h-10 w-10 shrink-0 p-0"
                onClick={() => printReceipt(receipt)}
                title={isSchedule(receipt) ? "Print Schedule" : "Print Bill"}
                aria-label={isSchedule(receipt) ? "Print Schedule" : "Print Bill"}
                data-testid="cons-receipt-print"
              >
                <Printer className="h-4 w-4" />
              </Button>
              {/* The one the branch actually reaches for: the receipt is nearly always
                  going to the number already printed on it. */}
              <Button
                className="h-10 w-10 shrink-0 bg-[#25D366] p-0 text-white hover:bg-[#1da851]"
                onClick={() => whatsappReceipt(receipt)}
                title="Send on WhatsApp"
                aria-label="Send on WhatsApp"
                data-testid="cons-receipt-whatsapp"
              >
                <WhatsAppIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-10 w-10 shrink-0 p-0"
                onClick={() => shareReceipt(receipt)}
                title="Share"
                aria-label="Share"
                data-testid="cons-receipt-share"
              >
                <Share2 className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-10 w-10 shrink-0 p-0"
                onClick={() => downloadReceipt(receipt)}
                title={isSchedule(receipt) ? "Download Schedule" : "Download Receipt"}
                aria-label={isSchedule(receipt) ? "Download Schedule" : "Download Receipt"}
                data-testid="cons-receipt-download"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Colored, centered replacement for a native <select> of payment modes —
// every option is shown inline as its own button (no click-to-open dropdown),
// since native <option> backgrounds also can't be reliably styled cross-browser.
function PaymentModeSelect({ value, options, onChange, testId }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map((o) => {
        const selected = o.value === value;
        const hex = PAYMENT_MODE_COLORS[o.value] || "#64748b";
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`h-9 min-w-[64px] flex-1 rounded-md text-center text-xs font-semibold transition ${
              selected ? "text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            style={selected ? { backgroundColor: hex } : undefined}
            data-testid={`${testId}-option-${o.value}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Partial Payment schedule, split by session count rather than a raw rupee amount —
 * each installment's amount is computed from how many sessions it covers at the
 * package's own per-session rate, so it always agrees with "N sessions x rate/session"
 * shown elsewhere. The first installment's due date defaults to today (set by the
 * caller); later ones are scheduled ahead.
 *
 * Only a row whose due date is today can be collected right here — clicking its
 * Collect button saves the whole schedule (every other row stays unpaid) and marks
 * just that one row paid, in one action. Future-dated rows have no Collect button;
 * they're picked up later from Accountant Manage's Outstanding Amount / Payment
 * Schedules boards once their date arrives.
 */
function PartialInstallmentsEditor({ installments, setInstallments, totalSessions, perSessionRate, onCollectRow, collecting }) {
  const sessionsTotal = installments.reduce((sum, i) => sum + (parseInt(i.sessions, 10) || 0), 0);
  const mismatch = totalSessions > 0 && sessionsTotal !== totalSessions;
  const allFilled = installments.length >= 2 && installments.every((i) => parseInt(i.sessions, 10) > 0 && i.due_date);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-600">Payment Schedule</p>
        <button
          type="button"
          onClick={() => setInstallments([...installments, { sessions: "", due_date: "" }])}
          className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-700"
          data-testid="cons-treatment-fee-partial-add"
        >
          <Plus className="h-3.5 w-3.5" /> Add Payment
        </button>
      </div>
      {installments.map((inst, idx) => {
        const sessionsNum = parseInt(inst.sessions, 10) || 0;
        const amount = Math.round(sessionsNum * perSessionRate);
        const isToday = !!inst.due_date && inst.due_date === todayIso;
        const overdue = !!inst.due_date && inst.due_date < todayIso;
        const isPaid = !!inst.paid;
        return (
          // Which installment this is, and its state, are named on their own line rather
          // than inside the Sessions label. As "First Payment Sessions *" that label wrapped
          // four lines deep on a phone and dragged its own column out of line with the two
          // beside it, while pushing Collect off the right edge.
          <div
            key={idx}
            className="rounded-lg border border-slate-200 p-2 sm:rounded-none sm:border-0 sm:border-t sm:border-slate-100 sm:p-0 sm:pt-2"
            data-testid={`cons-treatment-fee-partial-row-${idx}`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-700">{partialInstallmentLabel(idx)}</span>
              <div className="flex items-center gap-1.5">
                {isPaid ? (
                  <span className="rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700" data-testid={`cons-treatment-fee-partial-paid-${idx}`}>
                    PAID
                  </span>
                ) : (
                  // The due date is when the money is expected, not the only day it can be
                  // taken — a patient who walks in early still has to be collectable, so Due
                  // is a state the row wears, not a lock on the button below it.
                  <span
                    className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                      overdue ? "bg-rose-100 text-rose-700" : isToday ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                    }`}
                    data-testid={`cons-treatment-fee-partial-due-${idx}`}
                  >
                    {overdue ? "OVERDUE" : isToday ? "DUE TODAY" : "DUE"}
                  </span>
                )}
                {installments.length > 2 && !isPaid && (
                  <button
                    type="button"
                    onClick={() => setInstallments(installments.filter((_, i) => i !== idx))}
                    className="rounded p-1 text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                    data-testid={`cons-treatment-fee-partial-remove-${idx}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Two columns on a phone — Sessions beside Amount, then the date and the
                button full width under them. Squeezing all three fields onto one line
                leaves the date box too narrow to read at 360px, which is most phones. */}
            <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap sm:gap-1.5">
              <div className="min-w-0 sm:flex-1">
                <label className="mb-1 block text-[11px] font-medium text-slate-500">Sessions *</label>
                <Input
                  type="number"
                  min="1"
                  max={totalSessions || undefined}
                  value={inst.sessions}
                  disabled={isPaid}
                  onChange={(e) => {
                    const next = [...installments];
                    next[idx] = { ...next[idx], sessions: e.target.value };
                    setInstallments(next);
                  }}
                  className="h-9"
                  data-testid={`cons-treatment-fee-partial-sessions-${idx}`}
                />
              </div>
              <div className="min-w-0 sm:w-[62px] sm:shrink-0">
                <label className="mb-1 block text-[11px] font-medium text-slate-500">Amount</label>
                <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700" data-testid={`cons-treatment-fee-partial-computed-amount-${idx}`}>
                  {sessionsNum > 0 ? `₹${amount}` : "—"}
                </div>
              </div>
              <div className="col-span-2 min-w-0 sm:col-auto sm:min-w-[126px] sm:flex-[1.4]">
                <label className="mb-1 block text-[11px] font-medium text-slate-500">Due Date *</label>
                {/* centered, so the calendar opens as its own dialog in the middle of the
                    screen. Anchored to the field it hung off the bottom of the schedule
                    popup and was cut in half — the last rows of the month and the Today
                    link were simply unreachable, which is the case this mode exists for. */}
                <MilkDateInput
                  centered
                  title="Due Date"
                  value={inst.due_date}
                  disabled={isPaid}
                  onChange={(e) => {
                    const next = [...installments];
                    next[idx] = { ...next[idx], due_date: e.target.value };
                    setInstallments(next);
                  }}
                  className="h-9"
                  data-testid={`cons-treatment-fee-partial-date-${idx}`}
                />
              </div>
              {!isPaid && (
                <Button
                  size="sm"
                  onClick={() => onCollectRow(idx)}
                  disabled={collecting || !allFilled || mismatch}
                  className="col-span-2 h-9 w-full bg-emerald-600 text-xs hover:bg-emerald-700 sm:col-auto sm:w-auto"
                  data-testid={`cons-treatment-fee-partial-collect-${idx}`}
                >
                  Collect
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {sessionsTotal > 0 && mismatch && (
        <p className="text-[11px] text-rose-600" data-testid="cons-treatment-fee-partial-mismatch">
          Installments total ({sessionsTotal} sessions) must equal the Total Sessions ({totalSessions})
        </p>
      )}
    </div>
  );
}

/**
 * Saved wording for a report box, picked from a list the Head Physios build themselves.
 *
 * Choosing one fills the box and nothing more — the text stays editable, so what ends up
 * on the patient's record is what was actually written for them, not a fixed value from a
 * list. That is the whole reason this is a picker over a textarea rather than a select
 * that replaces it: a lower back strain reads much the same each time, right up until the
 * patient it doesn't.
 *
 * The list is org-wide, so deleting an option takes it away from every Head Physio. It is
 * only wording though — no report already written is touched by removing the preset it
 * started from.
 */
function PresetPicker({ kind, onPick, currentText, testPrefix }) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  const load = useCallback(() => {
    listTextPresets(kind)
      .then((r) => setPresets(r.presets || []))
      .catch(() => setPresets([]));
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  // Click-away, because this is a plain absolutely-positioned panel rather than a
  // Popover — without it the list stays open behind whatever gets clicked next.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const save = async () => {
    const text = (currentText || "").trim();
    if (!text) { toast.error("Write something first, then save it as an option"); return; }
    setBusy(true);
    try {
      await addTextPreset(kind, text);
      load();
      toast.success("Saved as an option");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save that option");
    }
    setBusy(false);
  };

  const remove = async (id) => {
    setBusy(true);
    try { await deleteTextPreset(id); load(); }
    catch { toast.error("Could not remove that option"); }
    setBusy(false);
  };

  return (
    <div className="relative mb-2" ref={boxRef}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 hover:bg-slate-50"
          data-testid={`${testPrefix}-preset-toggle`}
        >
          <span className="truncate">{presets.length ? "Choose a saved option" : "No saved options yet"}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          title="Save what's written as a reusable option"
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          data-testid={`${testPrefix}-preset-save`}
        >
          <Plus className="h-3.5 w-3.5" /> Save
        </button>
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 top-9 z-20 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          data-testid={`${testPrefix}-preset-list`}
        >
          {presets.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-slate-400">
              Write a report, then press Save to keep it here for next time.
            </p>
          ) : presets.map((p) => (
            <div key={p.id} className="group flex items-start gap-1 rounded px-1 hover:bg-slate-50">
              <button
                type="button"
                onClick={() => { onPick(p.text); setOpen(false); }}
                className="min-w-0 flex-1 px-1 py-1.5 text-left text-[11px] text-slate-700"
                data-testid={`${testPrefix}-preset-${p.id}`}
              >
                <span className="line-clamp-2">{p.text}</span>
              </button>
              <button
                type="button"
                onClick={() => remove(p.id)}
                disabled={busy}
                title="Remove this option for everyone"
                className="mt-1 shrink-0 rounded p-1 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                data-testid={`${testPrefix}-preset-remove-${p.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A text box that auto-saves (debounced, silent) while typing — "Done" just exits
 * edit mode, it isn't a save action. Pre-existing records saved under the old
 * Save & Lock flow may still carry a locked flag; the Edit button calls the
 * backend unlock endpoint for those before reopening them for editing.
 */
/**
 * The stored text is one treatment per line.
 *
 * A line that exactly matches a catalogue name is a ticked treatment; anything else is
 * text somebody wrote before the catalogue existed, or after it while it was empty. Both
 * are kept: the split never discards a line, and the join puts the unmatched ones back.
 * Splitting on commas instead would have shredded existing prose into fake treatments.
 */
const splitSummaryLines = (text) => String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);

/**
 * Treatment Summary as a tick-list off the Super Admin catalogue.
 *
 * Checked items are written back in catalogue order rather than click order, so the saved
 * text is the same whichever order they were ticked in and a re-open does not look edited.
 * Free text that predates the catalogue rides along at the end, shown but not editable
 * here — it is somebody's clinical note and this control has no business rewriting it.
 */
function TreatmentChecklist({ options, value, onChange, testPrefix }) {
  const names = options.map((o) => o.name);
  const lines = splitSummaryLines(value);
  const known = new Set(names);
  const checked = new Set(lines.filter((l) => known.has(l)));
  const picked = names.filter((n) => checked.has(n));

  /**
   * Lines that are not catalogue names: prose written before the catalogue existed, or
   * through the written box that used to sit under this control.
   *
   * Carried through every save rather than dropped. There is no longer any way to edit it
   * from here, but somebody's clinical note is not this control's to delete — without
   * this, the first tick on an old consultation would silently wipe whatever the
   * CONSULTANT had written. It stays visible in the saved view of the field.
   */
  const carried = lines.filter((l) => !known.has(l));

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const panelRef = useRef(null);

  // Clearing on close rather than in each of the three things that close it — the chevron,
  // Escape and a click outside — so the field cannot come back still holding a
  // filter from last time with the full list showing behind it.
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Scrolling inside the panel must not dismiss it. The house dropdown closes on any
    // scroll because it is a short single-select; this one has its own scrollbar, and
    // closing on that would put everything past the sixth treatment out of reach.
    const onScroll = (e) => { if (!panelRef.current?.contains(e.target)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Positioned fixed off a measurement, the same way ColorSelect does it: the panel lives
  // inside a scrolling modal, and an absolutely-placed one would be clipped by it. Flips
  // above the trigger when there is no room below, and is pinned inside the viewport.
  const openPanel = () => {
    const r = wrapRef.current.getBoundingClientRect();
    // Half the rows now that the list is two columns, so the panel is shorter as well as
    // wider. Both still clamp: never past 320px tall, never wider than the viewport.
    const height = Math.min(80 + Math.ceil(options.length / 2) * 34, 320);
    const room = window.innerHeight - r.bottom;
    const width = Math.min(Math.max(r.width, 440), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({
      left,
      width,
      ...(room > height ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    });
    setOpen(true);
  };

  // Split from openPanel because the search field only ever opens — typing into a box
  // that closes the list it is filtering is not a thing anyone wants. The chevron is the
  // only control that closes.
  const togglePanel = () => { if (open) setOpen(false); else openPanel(); };

  // Ticks first in catalogue order, then anything carried — one field, rebuilt the same
  // way whichever box was ticked.
  const commit = (nextChecked) =>
    onChange([...names.filter((n) => nextChecked.has(n)), ...carried].join("\n"));

  const toggle = (name) => {
    const next = new Set(checked);
    if (next.has(name)) next.delete(name); else next.add(name);
    commit(next);
  };

  // Numbered off the catalogue, not off the filtered view, so "3. Sciatica" is still
  // number 3 after a search narrows the list to one row. Display only — the stored value
  // is the plain name, or the number would end up in the patient's treatment summary.
  const numbered = options.map((o, i) => ({ ...o, n: i + 1 }));
  const q = query.trim().toLowerCase();
  const shown = q ? numbered.filter((o) => (o.name || "").toLowerCase().includes(q)) : numbered;
  const numberOf = (name) => (numbered.find((o) => o.name === name)?.n) || "";

  // Operates on what is on screen. With no search that is the whole catalogue; with one
  // it is the matches, which is what "select all" means when a filter is showing.
  const allShownChecked = shown.length > 0 && shown.every((o) => checked.has(o.name));
  const toggleAll = () => {
    const next = new Set(checked);
    if (allShownChecked) shown.forEach((o) => next.delete(o.name));
    else shown.forEach((o) => next.add(o.name));
    commit(next);
  };


  return (
    <div data-testid={`${testPrefix}-checklist`}>
      {/* The bar is only ever a search field now — what is selected is listed under it,
          not held inside it. The chevron is walled off behind a divider on the right and
          is what closes the list; the field itself only ever opens, since typing into a
          box that closes the list it is filtering helps nobody. */}
      <div
        className={`flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 transition ${open ? "border-indigo-400 ring-1 ring-indigo-100" : "border-slate-200"}`}
        ref={wrapRef}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!open) openPanel(); }}
          onFocus={() => { if (!open) openPanel(); }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          placeholder="Search treatments..."
          className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-xs text-slate-700 outline-none placeholder:text-slate-400"
          data-testid={`${testPrefix}-search`}
        />

        <div className="shrink-0 border-l border-slate-200 pl-2">
          <button
            type="button"
            onClick={togglePanel}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label={open ? "Hide treatments" : "Show treatments"}
            data-testid={`${testPrefix}-trigger`}
          >
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && pos && (
        // Above the lead modal's own z-50, or it would open behind the popup it sits in.
        <div
          ref={panelRef}
          className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          style={pos}
          data-testid={`${testPrefix}-panel`}
        >
          {/* Select All on the left, the running count on the right. The count is of the
              whole selection, not of what the search is showing — it is what gets saved,
              and a number that dropped every time you typed would be alarming. */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700" data-testid={`${testPrefix}-select-all`}>
              <input
                type="checkbox"
                checked={allShownChecked}
                onChange={toggleAll}
                disabled={shown.length === 0}
                className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
              />
              Select All
            </label>
            <span className="text-[11px] font-semibold text-teal-600" data-testid={`${testPrefix}-count`}>
              {picked.length} Selected
            </span>
          </div>

          {/* Two columns, numbered as in the catalogue. Fifteen treatments across two
              columns is eight rows rather than fifteen, so the whole list is on screen
              without scrolling — which is the point of the wider panel. One column below
              sm, where two would leave about 90px a name. */}
          <div className="max-h-64 overflow-y-auto p-1">
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-slate-400" data-testid={`${testPrefix}-no-match`}>
                No treatment matches "{query.trim()}".
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {shown.map((o) => {
                  const on = checked.has(o.name);
                  return (
                    <label
                      key={o.id}
                      className={`flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-xs transition ${on ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-700 hover:bg-slate-50"}`}
                      data-testid={`${testPrefix}-option-${o.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(o.name)}
                        className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
                      />
                      <span className="min-w-0 flex-1 truncate">{o.n}. {o.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

      {/* What is selected, under the bar rather than inside it, one per line. Stacked
          rather than wrapped into chips so a long name reads whole and the list can be
          counted down at a glance — which is what someone about to Confirm & Save is
          doing. Every one of them shows: with a row each there is no need to hide the
          fourth behind a "+N", and it scrolls past eight rather than growing the card. */}
      {picked.length > 0 ? (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto" data-testid={`${testPrefix}-selected`}>
          {picked.map((n) => (
            <div
              key={n}
              className="flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1.5"
              data-testid={`${testPrefix}-selected-${n}`}
            >
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-indigo-800">{numberOf(n)}. {n}</span>
              <button
                type="button"
                onClick={() => toggle(n)}
                className="shrink-0 text-indigo-400 transition hover:text-rose-600"
                aria-label={`Remove ${n}`}
                data-testid={`${testPrefix}-remove-${n}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-slate-400">Tick every treatment this patient is going away with.</p>
      )}
    </div>
  );
}

function LockableTextBox({
  icon: Icon, label, accent, value, onChange, editing, locked, savedText,
  saving, canEdit, onEdit, onUnlock, rows, placeholder, testPrefix, presetKind,
  choices,
}) {
  const colors = {
    sky: { border: "border-sky-200", bg: "bg-sky-50", text: "text-sky-700", btn: "bg-sky-600 hover:bg-sky-700" },
    indigo: { border: "border-indigo-200", bg: "bg-indigo-50", text: "text-indigo-700", btn: "bg-indigo-600 hover:bg-indigo-700" },
  }[accent] || { border: "border-sky-200", bg: "bg-sky-50", text: "text-sky-700", btn: "bg-sky-600 hover:bg-sky-700" };

  const showEditor = canEdit && (editing || !savedText);
  const hasChoices = Array.isArray(choices) && choices.length > 0;

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-3`} data-testid={testPrefix}>
      <div className="mb-1.5 flex items-center justify-between">
        <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${colors.text}`}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </p>
        {locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
      </div>

      {showEditor ? (
        <>
          {/* Tick-list when a catalogue exists, free text when it does not. The fallback is
              load-bearing rather than tidy: Confirm & Save refuses an empty Treatment
              Summary, so a clinic that has not filled Super Admin > Treatment yet would be
              unable to finish any consultation if the box had no other way to be written. */}
          {hasChoices ? (
            <TreatmentChecklist options={choices} value={value} onChange={onChange} testPrefix={testPrefix} />
          ) : (
            <>
              {presetKind && (
                <PresetPicker
                  kind={presetKind}
                  currentText={value}
                  onPick={onChange}
                  testPrefix={testPrefix}
                />
              )}
              <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={rows}
                placeholder={placeholder}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                data-testid={`${testPrefix}-input`}
              />
            </>
          )}
          {/* No Done button: the box saves as you type and flushes whatever is left when
              the popup closes, so there was nothing for it to do that wasn't already
              happening. The status line renders only when it has something to say —
              otherwise an empty strip would hold the space the button used to. */}
          {(saving || value.trim()) && (
            <div className="mt-1.5 flex items-center" data-testid={`${testPrefix}-autosave-status`}>
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                {saving ? "Saving..." : (
                  <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Auto-saved</>
                )}
              </span>
            </div>
          )}
        </>
      ) : savedText ? (
        <>
          <p className="whitespace-pre-wrap text-xs text-slate-700">{savedText}</p>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 text-xs"
              onClick={locked ? onUnlock : onEdit}
              data-testid={`${testPrefix}-edit`}
            >
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-400">Not written yet.</p>
      )}
    </div>
  );
}

export default ConsultationsBoard;
