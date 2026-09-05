import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, FileText, Calendar, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, XCircle, Search, Phone, Stethoscope, ClipboardList, Lock, Pencil, Dumbbell, Users, X, Bell, Plus, Trash2, Ban, ClipboardCheck, IndianRupee, Printer, Share2, Download, Salad, HeartPulse, Music2, Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { StageTabBar } from "@/components/ui/stage-tab";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { LeadDocuments } from "@/components/LeadDocuments";
import { ProgressionTab } from "@/components/ProgressionTab";
import { LeadMarks, RescheduledTag } from "@/components/ui/lead-marks";
import {
  getConsultationsBoard, moveConsultationStage, listStoreItems, collectRehabFee,
  collectPackagePayment, collectTreatmentFee, markInstallmentPaid, savePhysioDiagnosis, unlockPhysioDiagnosis,
  saveTreatmentSummary, unlockTreatmentSummary, stagesList, getDoctors,
  assignPhysioWithSessions, assignRehab, getDoctorCalendar, getLeadPhysioProgress,
  listNutritionCoaches, bookDietAppointment, collectDietFee, collectDietChartFee,
  listDietStoreItems,
  scheduleConsultationFollowUp, rescheduleConsultationFollowUp,
  getLeadRemarks, getLeadActivity, leadDocuments,
  saveConsultationDecision, markConsultationCompleted, getBranches,
  listTextPresets, addTextPreset, deleteTextPreset,
  getTreatmentTypes, bulkHardDeleteLeads,
} from "@/lib/api";
import { waNumber } from "@/lib/phone";
import { loadSession } from "@/lib/session";
import { endTime12h, to12h } from "@/lib/time";
import { LOGO_URL, PRINTABLE_STYLES, escapeHtml, openPrintable, downloadPrintable, sharePrintable } from "@/lib/printable";
import { isCourseComplete } from "@/lib/leadStage";
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
// What a Treatment Fee split can be made of, for both of its Collect popups. A split
// is money settled at the desk today, so Cheque (which clears when it clears) and
// Partial Payment (a plan, not a payment) are not pieces of one.
const TREATMENT_SPLIT_MODES = TREATMENT_FEE_PAYMENT_MODES.filter((m) => SETTLED_NOW_MODES.includes(m.value));
// The per-tender half of the Treatment Fee's Collect popup: the fields that belong to
// the one payment being entered, and nothing that belongs to the collection as a whole.
//
// A collection can now be made of several tenders (Rs.5000 cash, then Rs.2000 UPI), and
// each of them starts from these. Cleared between tenders on purpose -- a UPI
// transaction id left over from the last one would be filed against this one.
const BLANK_TREATMENT_TENDER = {
  upi_transaction_id: "",
  account_number: "",
  account_holder_name: "",
  bank_name: "",
  ifsc_code: "",
  transfer_reference: "",
  cash_notes: {},
};
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
  // Printed because the count is the half of a cash payment that can be checked against
  // a till later; the figure on its own cannot be.
  r.cashCounted ? ["Cash Counted", r.cashCounted] : null,
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
 * Whether the viewport is below Tailwind's `sm`, watched rather than read once.
 *
 * The board draws this list two ways -- stacked cards for a phone, a table for a desk --
 * and it used to build both every render and let CSS hide the one that didn't apply. That
 * is every row rendered twice, into twice the DOM, on a screen that can only ever show one
 * of them: a branch with a few hundred consultations paid for its whole phone list on a
 * desktop and its whole table on a phone, on the first paint and on every re-render after.
 *
 * So the choice is made here and only the list that will be seen is built. The classes that
 * used to do it are left in place, which costs nothing and keeps the right one showing
 * through the frame between a drag across the breakpoint and this listener firing.
 */
const SM_BREAKPOINT = "(max-width: 639.98px)";
const useBelowSm = () => {
  const [below, setBelow] = useState(() => (
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(SM_BREAKPOINT).matches
      : false
  ));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mql = window.matchMedia(SM_BREAKPOINT);
    const sync = () => setBelow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);
  return below;
};

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
// The icons are the ones the rest of the OS already gives these five — see the revenue
// and category tables in branch/AccountantManageTab.jsx. Picked from there rather than
// chosen fresh: a Salad meaning Diet on the money board and something else meaning it here
// is two vocabularies for one clinic, and the icon stops being worth reading.
const CONSULTATION_ADDONS = [
  { key: "treatment", label: "Treatment", tone: "#1baf7a", icon: Activity },
  { key: "diet", label: "Diet", tone: "#eb6834", icon: Salad },
  { key: "rehab", label: "Rehab", tone: "#0891b2", icon: HeartPulse },
  { key: "fitness", label: "Fitness", tone: "#7c3aed", icon: Dumbbell },
  { key: "zumba", label: "Zumba", tone: "#db2777", icon: Music2 },
];

/**
 * The two things a Diet referral can actually be, revealed once Diet is ticked.
 *
 * Independent ticks rather than a choice of one: a patient can be booked in with a
 * Nutritionist and sold a chart to take home on the same day, and they are two different
 * products on two different shelves — a Diet Consultation is the timed, bookable `diet`
 * store item, a Diet Chart the flat-priced `diet_package` one.
 *
 * Names only at this stage, deliberately. Each has a shelf waiting for it, so linking a
 * package to either is a field beside these rather than a rewrite of what is recorded.
 *
 * One of them is required once Diet is ticked, the same way a Treatment Package is once
 * Treatment is. What stays optional is Diet itself.
 *
 * `key` is the draft's spelling, `field` the wire's. Both are written down here rather
 * than converted where they are used: addonsLabel is handed the raw draft in one place and
 * a lead's saved fields in another, and a name that changes shape between those two is how
 * a label comes out reading "Diet" over a patient who was sent for a chart.
 */
const DIET_KINDS = [
  { key: "dietConsultation", field: "diet_consultation", label: "Diet Consultation" },
  { key: "dietChart", field: "diet_chart", label: "Diet Chart" },
];

// A store item's name, reduced to the letters in it. The branch types these by hand, so
// "Diet Chart", "diet chart " and "Diet-Chart" all have to arrive at one key -- the same
// reasoning jobKey uses for department names on the HR side, and for the same reason: a
// stray space or bracket must not turn one product into two.
const normDietName = (name) => String(name || "").toLowerCase().replace(/[^a-z]+/g, "");

/**
 * The two diet fees, and every place their wording and their fields differ.
 *
 * One table rather than two copies of the collect flow. The popup is the same popup — pick
 * a package, pick a price, pick a payment mode, confirm — and the only things that actually
 * differ are which lead fields the money lands on, what the button says, and which endpoint
 * takes it. Duplicating 180 lines of form to change three words is how the second one drifts
 * from the first, and a payment form that has drifted is a payment form nobody can audit.
 *
 * `paidField` is what makes a kind answer "has this been collected"; everything else hangs
 * off it. They are separate fields on the lead on purpose — a patient can be sold both on
 * one visit, so a shared field would have the second collection erase the first.
 */
/**
 * Where each fee keeps its schedule, matching FEE_SCHEDULES on the server.
 *
 * Any of the five can be collected in part, and each records what is still owed as an
 * unpaid installment on its own payment_details. The name on the left is what
 * mark-paid is told, so it collects against the right one.
 */
const FEE_DETAIL_FIELDS = {
  consultation: "package_payment_details",
  treatment: "treatment_fee_payment_details",
  rehab: "rehab_fee_payment_details",
  diet: "diet_fee_payment_details",
  diet_chart: "diet_chart_fee_payment_details",
};

const FEE_LABELS = {
  consultation: "Consultation Fee",
  treatment: "Treatment Fee",
  rehab: "Rehab Fee",
  diet: "Diet Consultation Fee",
  diet_chart: "Diet Chart Fee",
};

const DIET_FEE_KINDS = {
  consultation: {
    label: "Diet Consultation Fee",
    // The product on the shelf this fee is collected against. See dietItemFor.
    product: "Diet Consultation",
    receiptPrefix: "DIET",
    paidField: "diet_fee_paid",
    itemField: "diet_package_id",
    nameField: "diet_package_name",
    priceField: "diet_package_price",
    packageModeField: "diet_package_mode",
    // Where the discount that was agreed and any balance still owed are kept — the two
    // fees are separate money and keep separate records of both.
    detailsField: "diet_fee_payment_details",
    fee: "diet",
    testid: "diet-fee",
  },
  chart: {
    label: "Diet Chart Fee",
    product: "Diet Chart",
    receiptPrefix: "DIETCHART",
    paidField: "diet_chart_fee_paid",
    itemField: "diet_chart_package_id",
    nameField: "diet_chart_package_name",
    priceField: "diet_chart_package_price",
    packageModeField: "diet_chart_package_mode",
    detailsField: "diet_chart_fee_payment_details",
    fee: "diet_chart",
    testid: "diet-chart-fee",
  },
};

/**
 * Which product on the Diet shelf a given fee is for.
 *
 * By name, because nothing else on a store item says. Both products sit under Diet Package,
 * both carry the same category, and item_type cannot tell them apart either — what
 * separates a Diet Consultation from a Diet Chart is only what the branch typed when they
 * priced it.
 *
 * Exact match first, then a containing one, so "Diet Chart Package" still resolves. The two
 * names cannot cross-match, since neither contains the other.
 *
 * The last resort is the shelf holding exactly one product — but only where that product is
 * not plainly the OTHER one. A branch that has priced a Diet Chart and nothing else must not
 * have its price quoted as the Diet Consultation Fee just for being the only row there;
 * that is the guess this is meant to avoid, and it would be quoting one product's price
 * under the other's name.
 *
 * Nothing matched returns null, and the card shows "—" rather than a figure it cannot stand
 * behind. This panel is what Branch Admin reads to take money.
 */
const pickDietItem = (items, kind) => {
  const want = normDietName(DIET_FEE_KINDS[kind]?.product);
  if (!want) return null;
  const named = (items || []).map((i) => [normDietName(i.name), i]);
  const find = (n) => named.find(([name]) => name === n)?.[1] || named.find(([name]) => name.includes(n))?.[1] || null;

  const hit = find(want);
  if (hit) return hit;
  if ((items || []).length !== 1) return null;
  const other = normDietName(DIET_FEE_KINDS[kind === "chart" ? "consultation" : "chart"]?.product);
  return find(other) ? null : items[0];
};

// "Consultation" first always, then whichever add-ons are on — same shape read back from
// a saved lead (decisionSummaryOf) as from the draft mid-edit, so a label built one way
// can never say something the other way wouldn't.
//
// Diet names which of the two was picked, and falls back to plain "Diet" for the
// consultations recorded before naming one was required — they are still perfectly good
// referrals, and a label is not the place to demand they be reopened.
const dietLabels = ({ diet, dietConsultation, dietChart }) => {
  if (!diet) return [];
  const on = { dietConsultation, dietChart };
  const picked = DIET_KINDS.filter((k) => on[k.key]);
  return picked.length ? picked.map((k) => k.label) : ["Diet"];
};

const addonParts = ({ treatment, diet, dietConsultation, dietChart, rehab, fitness, zumba, sessions }) => [
  "Consultation",
  // The session count rides along only where it was asked for. Nobody passes it from the
  // popup or the WhatsApp message, which name the package on their own line, so those two
  // read exactly as they did.
  treatment ? `Treatment${sessions ? ` (${sessions} Session${sessions === 1 ? "" : "s"})` : ""}` : null,
  ...dietLabels({ diet, dietConsultation, dietChart }),
  rehab ? "Rehab" : null,
  fitness ? "Fitness" : null,
  zumba ? "Zumba" : null,
].filter(Boolean);

const addonsLabel = (decision) => addonParts(decision).join(" + ");

// One colour per service on the plan line under a patient's name, so
// "Consultation | Treatment (35 Sessions)" reads as two things that were sold rather than
// one grey sentence nobody stops on. The tones are the ones this board already gives these
// services -- the addon chips in CONSULTATION_ADDONS, the Consultant fee tab in FEE_TABS --
// picked from there rather than chosen fresh, so a green "Treatment" on this line means the
// same Treatment a green chip means in the decision popup.
//
// No red among them, deliberately: on a list of patients a red word reads as something
// wrong with that row, and every part of this line is a service the clinic agreed to give.
//
// Order matters. These are matched by prefix, and "Diet Consultation" starts with both
// "Diet" and, further in, the word Consultation -- it is Diet sitting above Consultation
// here that makes it colour as the Diet part it is.
const PLAN_PART_TONES = [
  ["Diet", "#eb6834"],
  ["Rehab", "#0891b2"],
  ["Fitness", "#7c3aed"],
  ["Zumba", "#db2777"],
  ["Treatment", "#1baf7a"],
  ["Consultation", "#0284c7"],
];

const planPartTone = (part) => PLAN_PART_TONES.find(([label]) => part.startsWith(label))?.[1] || "#64748b";

// What this consultation decided, read off a saved lead for the row under their name.
// Built from addonParts like everything else, so the line in the list cannot name a
// different plan from the one the popup shows when you open it.
//
// Exported so other boards showing the same leads -- the Head Physio's merged All list,
// for one -- can print the identical line rather than inventing their own reading of the
// same decision fields.
export const leadPlanParts = (lead) => addonParts({
  treatment: lead.consultation_decision === "consultation_treatment",
  diet: !!lead.diet_recommended,
  dietConsultation: !!lead.diet_consultation,
  dietChart: !!lead.diet_chart,
  rehab: !!lead.rehab_referred,
  fitness: !!lead.fitness_recommended,
  zumba: !!lead.zumba_recommended,
  sessions: lead.session_package_sessions || 0,
});

// The plan line itself, under a patient's name -- "Consultation | Treatment (4 Sessions)",
// each part tinted by planPartTone. Pulled out so every board that lists these leads
// renders it identically instead of each keeping its own copy of the markup.
export const PlanLine = ({ parts, testId, className = "" }) => {
  if (!parts || parts.length === 0) return null;
  const plan = parts.join(" | ");
  return (
    <span
      className={`mt-0.5 block truncate text-[10px] font-normal text-slate-400 ${className}`}
      title={plan}
      data-testid={testId}
    >
      {parts.map((part, n) => {
        const tone = planPartTone(part);
        return (
          <span key={part}>
            {n > 0 && <span className="px-1 text-slate-300">|</span>}
            <span className="rounded-[3px] px-1 py-px font-semibold" style={{ background: `${tone}14`, color: tone }}>
              {part}
            </span>
          </span>
        );
      })}
    </span>
  );
};

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

// Shortest course first, so a row of durations reads 01, 02, 03 ... 10.
//
// These pickers took the store's own order, which is the order the packages happened to be
// added in — so the Treatment Package row opened on "10 Week, 09, 08, 07, 06, 01, 02...",
// a list of numbers with no order in it at all. Somebody reaching for 03 Week has to read
// every pill to find it, and the one they land on is decided by whoever added the shelf.
//
// Sorted on the leading number rather than the name, because "10 Week" sorts before
// "02 Week" as text. Anything not named that way has no duration to sort by and keeps its
// place at the end, in the order the store gave it — sort is stable, so a shelf of them
// stays as it was rather than being shuffled by a comparator that cannot tell them apart.
const byDuration = (a, b) => {
  const wa = weeksFromPackageName(a?.name);
  const wb = weeksFromPackageName(b?.name);
  if (wa == null && wb == null) return 0;
  if (wa == null) return 1;
  if (wb == null) return -1;
  return wa - wb;
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

/**
 * "Rs.4000 · due 2026-09-15" off any fee's schedule — what a receipt prints under
 * Balance Due. Blank when nothing is left owing, so the row drops off the receipt
 * rather than printing a zero the patient has to work out the meaning of.
 */
const balanceDueLabel = (installments) => {
  const unpaid = (installments || []).filter((i) => !i.paid);
  if (!unpaid.length) return "";
  const total = round2(unpaid.reduce((sum, i) => sum + (i.amount || 0), 0));
  return `Rs.${total}${unpaid[0]?.due_date ? ` · due ${unpaid[0].due_date}` : ""}`;
};

// A discount above this reads as a mistyped amount (120 for 1200) more often than a real
// decision, so it's called out — but never blocked. Talking a price down is the Branch
// Admin's call to make; the popup's job is to make sure they meant it.
const STEEP_DISCOUNT_PCT = 25;

// The notes a branch desk actually takes, largest first. Kept in step with DENOMINATIONS
// in backend/routers/v3_packages.py, which drops anything it does not list when a payment
// settles -- so a count in a note this desk does not hold cannot quietly join the total.
//
// Goes down to the ten because a fee is not always round: a discount can land on Rs.1230,
// and a ladder that stops at fifty could not count it out.
const DENOMINATIONS = [500, 200, 100, 50, 20, 10];

/** The last rung of the ladder. Below it there are only coins, which no branch counts
 *  into a fee and this grid has no box for. */
const SMALLEST_NOTE = DENOMINATIONS[DENOMINATIONS.length - 1];

/** What a counted pile of notes comes to. Blanks and anything that is not a positive
 *  whole number of notes count as none -- "3.5 x 500" is a typo, and reading it as 1750
 *  would put a figure in the drawer nobody counted. */
const noteTotal = (notes) => DENOMINATIONS.reduce((sum, d) => {
  const n = Number(notes?.[d]);
  return sum + (Number.isInteger(n) && n > 0 ? d * n : 0);
}, 0);

/** The count as it is sent and stored: only the notes actually seen, keyed by the note's
 *  value as a string, because that is what survives a JSON round trip. Undefined when
 *  nothing was counted -- an empty map would read as "counted nothing" rather than "did
 *  not count". */
const countedNotes = (notes) => {
  const clean = {};
  for (const d of DENOMINATIONS) {
    const n = Number(notes?.[d]);
    if (Number.isInteger(n) && n > 0) clean[String(d)] = n;
  }
  return Object.keys(clean).length ? clean : undefined;
};

/** A stored count written out for a receipt or a history line: "2xRs.500 + 1xRs.200".
 *  Empty string when nothing was counted, so callers can drop the row entirely. */
const notesLabel = (counted) => DENOMINATIONS
  .filter((d) => Number(counted?.[d]) > 0)
  .map((d) => `${counted[d]}xRs.${d}`)
  .join(" + ");

/** The fewest notes that make an amount, for the button that fills the grid in.
 *  A remainder below the smallest note is left over rather than rounded away -- the
 *  count then reads short, which is the truth, instead of claiming notes nobody held. */
const noteBreakdown = (amount) => {
  let left = Math.round(Number(amount) || 0);
  const out = {};
  for (const d of DENOMINATIONS) {
    const n = Math.floor(left / d);
    if (n > 0) { out[d] = n; left -= n * d; }
  }
  return out;
};

/** Whether a cash count is in a state that may be submitted: the notes have to be counted,
 *  and to account for the cash being taken down to the last note. Blank, short by a note or
 *  more, and over are all refused -- each of them banks a figure nobody physically checked,
 *  and between a count and an amount that disagree there is no telling which of the two is
 *  the wrong one.
 *
 *  True while there is no amount to count against yet. An empty or zero fee is the amount
 *  box's complaint to make, and answering it here as well would grey the collect button out
 *  over a count that has nothing to be right about. */
const notesSettled = (notes, amount) => {
  const target = parseFloat(amount);
  if (!Number.isFinite(target) || target <= 0) return true;
  const counted = noteTotal(notes);
  // Over the amount is always wrong -- there is no such thing as taking more notes than
  // the money. Under it is only right by less than one note: a discount can put the fee
  // on Rs.800.04, and no pile of notes comes to that, so the last few rupees are coins
  // this grid has no box for rather than a count somebody left half-finished.
  if (counted > target + 0.01) return false;
  return target - counted < SMALLEST_NOTE - 0.01;
};

/** What is left when the notes are counted out and the rest is coins -- 0 when the notes
 *  cover it exactly. Only ever under one note, because more than that is an unfinished
 *  count rather than change. */
const coinRemainder = (notes, amount) => {
  const target = parseFloat(amount);
  if (!Number.isFinite(target) || target <= 0) return 0;
  const left = round2(target - noteTotal(notes));
  return left > 0 && left < SMALLEST_NOTE ? left : 0;
};

// What identifies a tender, per mode. Cash has nothing to quote, so it asks for nothing.
const SPLIT_REFERENCE_LABEL = {
  upi: "UPI Transaction ID",
  card: "Card / Approval Reference",
  account_transfer: "Reference / UTR No.",
  cheque: "Cheque Number",
};

/**
 * What the cash was actually made of.
 *
 * "Rs.1200 cash" cannot be checked against a till at the end of the day; "2x500, 1x200"
 * can. The count is the thing somebody physically looked at, so it is worth keeping
 * beside the figure -- and counting it out at the desk, with the patient still there, is
 * when a wrong note is cheap to notice.
 *
 * Required before cash may be banked. The count is the only thing that makes a cash figure
 * checkable against a till, so the collect button stays inactive until the notes are in and
 * account for the amount being taken. Blank is refused along with short and over: a fee
 * recorded as "Rs.1200 cash" with nothing behind it is exactly the row that cannot be
 * settled at the end of the day. What a discount leaves below the smallest note is coins,
 * and is shown as such rather than held against the count.
 *
 * The amount stays the authority and is never driven from here. It is arrived at above,
 * through the discount the Branch Admin agreed, and letting a mistyped note count rewrite
 * it would move the fee being collected without anyone asking for it.
 */
const CashDenominations = ({ amount, notes, onChange, testPrefix }) => {
  const counted = noteTotal(notes);
  const target = parseFloat(amount);
  const hasTarget = Number.isFinite(target) && target > 0;
  const short = hasTarget ? round2(target - counted) : 0;
  const settled = notesSettled(notes, amount);
  const coins = coinRemainder(notes, amount);

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5" data-testid={`${testPrefix}-notes`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Cash counted
          <span className="ml-1 font-normal normal-case text-rose-500">— required</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {hasTarget && (
            <button
              type="button"
              onClick={() => onChange(noteBreakdown(target))}
              className="text-[11px] font-medium text-sky-600 underline hover:text-sky-800"
              data-testid={`${testPrefix}-notes-fill`}
            >
              Fill from amount
            </button>
          )}
          {counted > 0 && (
            <button
              type="button"
              onClick={() => onChange({})}
              className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
              data-testid={`${testPrefix}-notes-clear`}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {DENOMINATIONS.map((d) => (
          <div key={d}>
            <label className="mb-0.5 block text-center text-[10px] font-bold text-slate-500">Rs.{d}</label>
            <Input
              value={notes?.[d] ?? ""}
              onChange={(e) => onChange({ ...notes, [d]: e.target.value.replace(/\D/g, "") })}
              inputMode="numeric"
              placeholder="0"
              className="h-9 px-1 text-center text-xs"
              data-testid={`${testPrefix}-notes-${d}`}
            />
          </div>
        ))}
      </div>

      {/* Shown from the first moment there is an amount to count against, not only once
          counting has started. The collect button is inactive until this line reads
          settled, and a button that greys out with nothing on screen saying why sends the
          desk hunting for the field it missed. */}
      {(hasTarget || counted > 0) && (
        <div
          className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold ${
            settled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
          data-testid={`${testPrefix}-notes-total`}
        >
          <span className="truncate">
            {counted > 0
              ? DENOMINATIONS.filter((d) => Number(notes?.[d]) > 0).map((d) => `${notes[d]}x${d}`).join(" + ")
              : "Count the notes to collect"}
          </span>
          <span className="shrink-0">
            Rs.{counted.toLocaleString("en-IN")}
            {settled
              ? coins > 0 ? ` + Rs.${coins.toLocaleString("en-IN")} in coins` : ""
              : short > 0 ? ` — short by Rs.${short.toLocaleString("en-IN")}` : ` — Rs.${Math.abs(short).toLocaleString("en-IN")} over`}
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * The fee as it actually arrived, when it arrived in more than one piece -- Rs.600 in
 * cash and Rs.600 by UPI is two tenders, not one payment under a mode that is half true.
 *
 * The fee above stays the authority and these have to add up to it. Driving the fee from
 * the lines instead would let a mistyped part silently rewrite the amount being
 * collected, and the discount worked out above it with it.
 *
 * One reference box per line rather than the four-field bank block the single-payment
 * path collects. A split is typed at the desk with the patient standing there, and the
 * full block per line is more than anyone will fill in -- so a split records what each
 * tender was and what identifies it, and the bank's own details stay with the
 * single-payment flow that has room to ask for them.
 *
 * `countCash` opts a caller into counting the notes behind each cash line. Off by
 * default: the fee flows that ask for a count are the ones whose money lands in the
 * branch drawer today, and turning it on for every split would put a note grid under a
 * cheque schedule that has nothing to count yet.
 */
const SplitPaymentLines = ({ lines, modes, expected, onChange, testPrefix, countCash = false }) => {
  const total = lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
  const target = parseFloat(expected);
  const matches = Number.isFinite(target) && Math.abs(total - target) < 0.01;
  const setLine = (i, patch) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5" data-testid={`${testPrefix}-split`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Paid in parts</p>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
          data-testid={`${testPrefix}-split-off`}
        >
          Single payment
        </button>
      </div>

      {lines.map((line, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2">
          <div className="flex items-center gap-1.5">
            <select
              value={line.mode}
              onChange={(e) => setLine(i, { mode: e.target.value, reference: "", notes: {} })}
              className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs"
              data-testid={`${testPrefix}-split-mode-${i}`}
            >
              {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <Input
              value={line.amount}
              onChange={(e) => setLine(i, { amount: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="h-9 w-24 text-xs"
              data-testid={`${testPrefix}-split-amount-${i}`}
            />
            {/* Never below two. One tender in a split is a single payment, and the way
                back to one is the link above, which keeps whichever mode was chosen. */}
            {lines.length > 2 && (
              <button
                type="button"
                onClick={() => onChange(lines.filter((_, n) => n !== i))}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                title="Remove this payment"
                data-testid={`${testPrefix}-split-remove-${i}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {SPLIT_REFERENCE_LABEL[line.mode] && (
            <Input
              value={line.reference}
              onChange={(e) => setLine(i, { reference: e.target.value })}
              placeholder={SPLIT_REFERENCE_LABEL[line.mode]}
              className="h-8 text-xs"
              data-testid={`${testPrefix}-split-reference-${i}`}
            />
          )}
          {/* Counted against this line's own amount, not the whole fee: the cash half of
              a Rs.600 cash + Rs.600 UPI split is Rs.600, and checking the notes against
              Rs.1200 would call a correct count short every time. */}
          {countCash && line.mode === "cash" && (
            <CashDenominations
              amount={line.amount}
              notes={line.notes}
              onChange={(notes) => setLine(i, { notes })}
              testPrefix={`${testPrefix}-split-${i}`}
            />
          )}
        </div>
      ))}

      <div
        className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold ${
          matches ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}
        data-testid={`${testPrefix}-split-total`}
      >
        <span>{matches ? "Adds up" : "Does not add up yet"}</span>
        <span>
          Rs.{total.toLocaleString("en-IN")}
          {Number.isFinite(target) ? ` of Rs.${target.toLocaleString("en-IN")}` : ""}
        </span>
      </div>
    </div>
  );
};

/**
 * Fee amount entry: the discount is typed, and what is short of the fee is a balance
 * the patient still owes. Every fee on this board is collected through it.
 *
 * It replaced a DiscountCalculator, which read a short amount backwards as a discount --
 * enter Rs.3000 against a Rs.5000 fee and the Rs.2000 the patient was coming back to pay
 * was written off on the spot, with nothing left on the record to collect. They are two
 * different facts and are entered as two: the Discount boxes are the only way to reduce
 * what is owed, and the amount box says only how much of it is being handed over now.
 * The rest is the balance (see BalanceDueBlock, and settle_fee_money on the server,
 * which schedules it as an unpaid installment collectable later under any payment mode).
 *
 * `lockAmount` is for the fees nobody at the counter gets to name: the amount box is
 * replaced by the figure itself, and it follows the net payable instead of being typed,
 * so the discount boxes are the only way to move it. The Consultation Fee is collected
 * that way -- its price is assigned upstream and a short collection there was never a
 * thing Branch Admin should be deciding on the spot.
 *
 * `discount` (rupees) and `amount` are both the parent's, and both go to the server.
 * The percentage box is a way of arriving at the rupee discount and nothing more, so it
 * keeps its own text state -- a half-typed "1." must survive to the "12" it is becoming
 * -- with `selfEdit` stopping the sync back from overwriting the box being typed into.
 */
const FeeAmountEntry = ({ assignedPrice, discount, amount, onChange, label, testPrefix, lockAmount = false }) => {
  const price = Number(assignedPrice);
  const hasPrice = Number.isFinite(price) && price > 0;
  const discountRs = Math.max(0, parseFloat(discount) || 0);
  const netPayable = hasPrice ? round2(price - discountRs) : NaN;
  const amt = parseFloat(amount);
  const validAmt = Number.isFinite(amt);

  const [pctText, setPctText] = useState("");
  const selfEdit = useRef(false);

  // Re-derive the percentage whenever the rupee discount changes from outside this box.
  useEffect(() => {
    if (selfEdit.current) { selfEdit.current = false; return; }
    if (!hasPrice || !discountRs) { setPctText(""); return; }
    setPctText(String(round2((discountRs / price) * 100)));
  }, [discount, price, hasPrice, discountRs]);

  // Agreeing a discount moves the net payable, and the amount follows it -- but only
  // while it is still sitting on it. An amount already typed short is a part payment
  // somebody chose, and re-agreeing the discount is no reason to quietly collect the
  // rest of it.
  const applyDiscount = (raw) => {
    const off = parseFloat(raw);
    const patch = { discount: raw };
    // A locked amount has no part payment to protect -- it is the net payable by
    // definition, so it follows the discount every time rather than only while it
    // still happens to be sitting on it.
    if (hasPrice && (lockAmount || !validAmt || Math.abs(amt - netPayable) < 0.01)) {
      patch.amount = String(round2(price - (Number.isFinite(off) ? round2(off) : 0)));
    }
    onChange(patch);
  };

  const onPct = (v) => {
    setPctText(v);
    if (!hasPrice) return;
    selfEdit.current = true;
    const pct = parseFloat(v);
    applyDiscount(Number.isFinite(pct) ? String(round2((price * pct) / 100)) : "");
  };

  const overDiscounted = hasPrice && discountRs > price;
  const overpaid = hasPrice && validAmt && amt > netPayable + 0.01;

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
            <Input type="number" min="0" value={discount ?? ""} onChange={(e) => applyDiscount(e.target.value)} className="h-9" placeholder="0" data-testid={`${testPrefix}-discount-rs`} />
          </div>
        </div>
      )}

      {/* Spelled out the moment a discount exists, because it is the figure the amount
          below is measured against -- not the assigned price it came off. */}
      {hasPrice && discountRs > 0 && !overDiscounted && (
        <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800" data-testid={`${testPrefix}-net-payable`}>
          <span>Net Payable <span className="opacity-70">(after Rs.{discountRs} discount, {round2((discountRs / price) * 100)}%)</span></span>
          <span className="font-semibold">Rs.{netPayable}</span>
        </div>
      )}

      {overDiscounted && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800" data-testid={`${testPrefix}-discount-too-big`}>
          A discount of <span className="font-semibold">Rs.{discountRs}</span> is more than the Rs.{price} being collected for.
        </div>
      )}

      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-500">{label}</label>
        {lockAmount && hasPrice ? (
          // Nothing here is the collector's to decide: the fee is the assigned price
          // less whatever discount was agreed above, and that is the whole sum. Shown
          // rather than typed so the figure still reads back before it is banked.
          <>
            <div
              className="flex h-9 items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 text-sm font-semibold text-slate-700"
              data-testid={`${testPrefix}-amount`}
            >
              <span>Rs.{Number.isFinite(amt) ? amt.toLocaleString("en-IN") : netPayable.toLocaleString("en-IN")}</span>
              <Lock className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <p className="mt-1 text-[11px] text-slate-400" data-testid={`${testPrefix}-amount-hint`}>
              Fixed at the assigned price{discountRs > 0 ? " less the discount" : ""}. Use the Discount boxes above to reduce what is payable.
            </p>
          </>
        ) : (
          <>
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => onChange({ amount: e.target.value })}
              className="h-9"
              data-testid={`${testPrefix}-amount`}
            />
            {hasPrice && (
              <p className="mt-1 text-[11px] text-slate-400" data-testid={`${testPrefix}-amount-hint`}>
                Collecting less than Rs.{netPayable} leaves a balance to collect later — it is not a discount.
              </p>
            )}
          </>
        )}
      </div>

      {overpaid && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800" data-testid={`${testPrefix}-overpaid-warning`}>
          <span className="font-semibold">Rs.{round2(amt - netPayable)}</span> above the Rs.{netPayable} payable. Please confirm this is correct.
        </div>
      )}
    </div>
  );
};

/**
 * What is still owed after a collection, and when it is due.
 *
 * The other half of FeeAmountEntry, and the reason a short amount is safe to allow: it
 * names the money as a balance, dates it, and says out loud that it is collectable later
 * under any payment mode. The date is required whenever there is a balance -- the server
 * refuses the collection without one -- because a debt nobody put a date on is a debt
 * nobody chases.
 *
 * `note` is whatever else the fee counts the balance in (the Treatment Fee's remaining
 * sessions); `leading` is anything that has to be said before it (which sessions this
 * money bought). Both empty for the fees that are one price paid once.
 */
const BalanceDueBlock = ({ balance, dueDate, onDueDateChange, amount, discount, note = "", leading = null, testPrefix }) => {
  if (!(balance > 0.009)) return null;
  return (
    <>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-500">
          Due Date for Balance ({note ? `${note}, ` : ""}Rs.{balance}) *
        </label>
        {/* Centered rather than anchored: this sits low in a modal, and a calendar
            hanging off the field opens past the modal's edge. */}
        <MilkDateInput
          centered
          title="Due Date for Balance"
          value={dueDate}
          onChange={(e) => onDueDateChange(e.target.value)}
          className="h-9"
          data-testid={`${testPrefix}-balance-due-date`}
        />
      </div>
      <div className="rounded-md border border-sky-200 bg-sky-50 p-2.5 text-[11px] text-sky-800" data-testid={`${testPrefix}-balance-note`}>
        {leading}
        Collecting <span className="font-semibold">Rs.{round2(amount)}</span>
        {discount > 0 && <> after a <span className="font-semibold">Rs.{round2(discount)}</span> discount</>}
        . Balance <span className="font-semibold">Rs.{balance}</span>
        {note ? ` (${note})` : ""} stays due {dueDate || "—"} and can be collected later under any payment mode.
      </div>
    </>
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

// Patient No. is the column all four sets were re-cut around. It was the narrowest thing
// on the table — six to eight per cent — and a patient number is a fixed-width mono string
// of about fifteen characters, so every row on every stage read "ANN-260831-0…". A record
// id truncated before its serial identifies nobody, which is the one job that column has.
// The points came off the columns that were paying for whitespace instead: S.No, which
// holds two digits; Consultant, which holds one name; and Stage, whose badge is its own
// width. Nothing that was readable before is narrower than what its content needs now.
//
// The percentages below must total 100 under table-fixed. All three sets are written out
// literally because Tailwind reads the source for class names and would compile nothing
// from a template.
const COLS_WITH_DISCOUNT = {
  sno: "w-[3%]", patient: "w-[18%]", appt: "w-[9%]", expert: "w-[10%]", stage: "w-[11%]",
  phone: "w-[9%]", pno: "w-[10%]", collected: "w-[11%]", discount: "w-[9%]", total: "w-[10%]",
};

// Fee Collected ends its rows with a fee action on every tab, so it needs a set of its own
// — every other column gives up a point or two to pay for it. The table widens by the same
// amount at its min-width, so nothing is squeezed on a laptop.
const COLS_WITH_ACTION = {
  sno: "w-[3%]", patient: "w-[16%]", appt: "w-[8%]", expert: "w-[9%]", stage: "w-[10%]",
  phone: "w-[8%]", pno: "w-[9%]", collected: "w-[10%]", discount: "w-[8%]", total: "w-[9%]",
  action: "w-[10%]",
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
 *
 * `action` is which fee the button at the end of the row collects on that tab. Every tab
 * has one now. Three of them used to end their rows with nothing at all: the Physio, Rehab
 * and Diet lists could say a fee had not come in and offered no way to take it, so the desk
 * read the shortfall on one screen and went to another to do something about it — and a
 * balance left by a short collection, which is the whole reason those lists are read, had
 * to be chased through the patient popup one at a time.
 *
 * Each tab collects its own fee, except Consultant, which collects the Treatment Fee: that
 * list is everyone whose consultation money is already in, so its own fee is the one column
 * that is never outstanding and treatment is what is due from them next. That pairing is
 * what this row of buttons has always done, and it is left as it was.
 *
 * `scope` is who the tab is about at all -- the patients sent to that desk.
 *
 * Without it the four tabs were four names over one list: with the dropdown on All every
 * tab showed the stage entire, so a stage of seven read Consultant 7 | Physio 7 | Rehab 7
 * | Diet 7 -- the same seven counted four times -- and the Diet tab listed six people who
 * had never been referred for a diet, each with "Not collected" against a fee they do not
 * owe. A tab is a desk, and a desk's list has to be that desk's own patients before the
 * dropdown can say anything useful about which of them have paid.
 *
 * Read off the referral the Head Physio's decision records -- the tick IS the referral,
 * see CONSULTATION_ADDONS -- widened to anyone already carrying that desk's package or its
 * money. A patient sold a rehab package, or one whose diet fee is already in, belongs on
 * that desk's list whatever the flag currently says: a later edit can clear a tick and it
 * cannot unmake a payment, and a paid row vanishing off the only tab that reports it is
 * money the branch cannot find.
 *
 * Consultant's is everyone, and that is not an omission: the consultation fee is what puts
 * a patient in this stage, so every row here was seen by that desk.
 */
const FEE_TABS = [
  {
    key: "consultation",
    label: "Consultant",
    tone: "#0284c7",
    scope: () => true,
    paid: (l) => Number(l.package_paid) || 0,
    item: (l) => l.package_name || l.consultation_item_name || "",
    mode: (l) => l.package_payment_mode || "",
    action: "treatment",
  },
  {
    key: "treatment",
    label: "Physio",
    tone: "#059669",
    // Treatment is the one addon with a package to pick, so it is recorded as the decision
    // itself rather than as a flag beside it -- see CONSULTATION_ADDONS.
    scope: (l) => l.consultation_decision === "consultation_treatment"
      || !!l.session_package_id
      || Number(l.treatment_fee_paid) > 0,
    paid: (l) => Number(l.treatment_fee_paid) || 0,
    item: (l) => l.session_package_name || "",
    mode: (l) => l.treatment_fee_payment_mode || "",
    action: "treatment",
  },
  {
    key: "rehab",
    label: "Rehab",
    tone: "#0891b2",
    scope: (l) => !!l.rehab_referred || !!l.rehab_package_id || Number(l.rehab_fee_paid) > 0,
    paid: (l) => Number(l.rehab_fee_paid) || 0,
    item: (l) => l.rehab_package_name || "",
    mode: (l) => l.rehab_fee_payment_mode || "",
    action: "rehab",
  },
  {
    key: "diet",
    label: "Diet",
    tone: "#d97706",
    // Both halves of a diet referral count, and either fee does. The tab reports the Diet
    // Consultation fee, but a patient sent away with a chart alone is still this desk's --
    // dropping them here would leave a Diet Chart sale on no list at all. See DIET_KINDS.
    scope: (l) => !!l.diet_recommended
      || !!l.diet_consultation
      || !!l.diet_chart
      || !!l.diet_package_id
      || !!l.diet_chart_package_id
      || Number(l.diet_fee_paid) > 0
      || l.diet_chart_fee_paid != null,
    paid: (l) => Number(l.diet_fee_paid) || 0,
    item: (l) => l.diet_package_name || "",
    mode: (l) => l.diet_fee_payment_mode || "",
    action: "diet",
  },
];

/**
 * Whether the open tab's own fee is in, still owed, or not being asked about at all.
 *
 * The four tabs used to be four lists of who had already paid, which made three of them
 * read as near-empty beside Consultant: everyone standing in Fee Collected has paid to be
 * seen, and only some of them went on to buy treatment, rehab or a diet plan. So a stage
 * badge saying five sat over a Physio tab showing two -- and the three patients whose
 * treatment fee is still owed, the ones the desk is here to chase, were on no list at all.
 *
 * `all` is the default for that reason. The question the desk actually asks of this stage
 * is "where does each of my five stand with this desk", and the other two options are that
 * same list cut to one side of it -- what came in, and what is still out.
 *
 * `match` is handed the amount rather than a flag because there is no flag: the amount
 * being present is what "collected" means, and 0 is not a collection. The two halves are
 * written as exact complements so that the counts on the tabs always add up to `all` --
 * a patient who is on neither list is a patient the branch cannot account for.
 */
const FEE_STATUSES = [
  { key: "all", label: "All", match: () => true },
  { key: "collected", label: "Fee Collected", match: (paid) => paid > 0 },
  { key: "pending", label: "Fees Non Collected", match: (paid) => paid <= 0 },
];

// Deliberately not here: Fitness. A gym membership is a `fitness_registrations` row with
// its own name and phone and no lead_id on it at all — a fitness member is not a patient
// on this board, so there is nothing on these rows to filter by and a Fitness option would
// report zero for everyone forever. Those takings are counted in Finance, which reads that
// collection directly.

const rupees = (n) => `Rs.${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

// Everything this patient has paid, all three fees together. The fee column beside it
// shows only the one the open tab is about, so somebody who paid to be seen and then
// bought a diet plan reads as two separate figures on two separate tabs and never as
// what they came to in total. Summed off FEE_TABS so a fee added there is counted here
// without this needing to know about it.
const totalPaid = (l) => FEE_TABS.reduce((sum, t) => sum + t.paid(l), 0);

/**
 * What each fee a row can collect is called, where it keeps its money, and who owes it.
 *
 * One table rather than four copies of the same twelve lines. The reading is identical for
 * every fee — an unpaid installment means a balance, an amount on the paid field means it
 * is in, otherwise it is due at the listed price — and the only things that differ are
 * which four fields to look at and which patients the fee applies to at all.
 *
 * `applies` is what keeps a button off a row that never bought the thing. Quoting a rehab
 * price to a patient nobody referred, or a treatment price to a Consultation Only one, is a
 * figure nobody agreed presented as an amount owed.
 *
 * `label` is the column heading, and is deliberately not FEE_LABELS' wording: that table
 * calls this one "Diet Consultation Fee", which is the right name in a receipt and two
 * words too many for a heading over a tenth of the table.
 */
const ROW_FEES = {
  consultation: {
    label: "Consultation Fee",
    details: "package_payment_details",
    paid: (l) => l.package_paid,
    mode: (l) => l.package_payment_mode,
    price: (l) => l.package_price,
    // No `applies` gate: every patient on this board was booked to be seen, so the
    // consultation fee is due from all of them. There is nobody to show a dash to.
    applies: () => true,
    tone: "bg-sky-600 text-white hover:bg-sky-700",
  },
  treatment: {
    label: "Treatment Fee",
    details: "treatment_fee_payment_details",
    paid: (l) => l.treatment_fee_paid,
    mode: (l) => l.treatment_fee_payment_mode,
    price: (l) => l.session_package_price,
    applies: (l) => l.consultation_decision === "consultation_treatment",
    noneHint: "Consultation Only — no treatment sessions were sold",
    tone: "bg-emerald-600 text-white hover:bg-emerald-700",
  },
  rehab: {
    label: "Rehab Fee",
    details: "rehab_fee_payment_details",
    paid: (l) => l.rehab_fee_paid,
    mode: (l) => l.rehab_fee_payment_mode,
    price: (l) => l.rehab_package_price,
    applies: (l) => !!l.rehab_referred,
    noneHint: "Not referred for rehab — there is no rehab fee to collect",
    tone: "bg-cyan-600 text-white hover:bg-cyan-700",
  },
  diet: {
    label: "Diet Fee",
    details: "diet_fee_payment_details",
    paid: (l) => l.diet_fee_paid,
    mode: (l) => l.diet_fee_payment_mode,
    // Often null until the fee is taken: the Diet Package is chosen in the collect popup
    // rather than at the consultation, so there is no price on the lead to quote yet.
    price: (l) => l.diet_package_price,
    applies: (l) => !!l.diet_recommended,
    noneHint: "Not referred for diet — there is no diet fee to collect",
    tone: "bg-orange-500 text-white hover:bg-orange-600",
  },
};

/**
 * Where one lead stands with one fee, read off the lead alone.
 *
 * The popup works this out through half a dozen values derived from `selectedLead`, none of
 * which exist for a row: a list renders every patient at once and none of them is selected.
 * So a row asks the lead directly — the same four answers, in the order they happen in —
 * and the popup is left exactly as it was.
 *
 * An unpaid installment beats the paid field, which is the reason this is read in this
 * order. A Treatment Fee Partial Payment plan sets `treatment_fee_paid` to the full price
 * the moment the plan is made, and a short collection on any other fee sets that fee's
 * field to the amount actually taken — either read on its own ticks a patient off as
 * settled with the balance still owed, which is exactly the patient this column is for.
 */
const feeStateOf = (l, fee) => {
  const spec = ROW_FEES[fee];
  if (!spec.applies(l)) return { kind: "none", hint: spec.noneHint };
  const rows = l[spec.details]?.installments || [];
  const nextIdx = rows.findIndex((i) => !i.paid);
  if (nextIdx >= 0) {
    const next = rows[nextIdx];
    return {
      kind: "balance",
      nextIdx,
      due: next?.due_date || "",
      balance: round2(rows.filter((i) => !i.paid).reduce((sum, i) => sum + (i.amount || 0), 0)),
      overdue: !!next?.due_date && next.due_date < new Date().toISOString().slice(0, 10),
    };
  }
  if (spec.paid(l) != null) return { kind: "paid", mode: spec.mode(l) || "" };
  return { kind: "due", amount: spec.price(l) };
};

const treatmentFeeStateOf = (l) => feeStateOf(l, "treatment");
const consultationFeeStateOf = (l) => feeStateOf(l, "consultation");

/**
 * What stands between this row and the fee it is offering to collect, if anything.
 *
 * A button that says "Collect" and comes back with the server's refusal is a click spent
 * learning what the row already knew, so the row says it instead — and the button still
 * works, going to the screen where the missing step is actually done. Same shape as the
 * prescription gate on the Consultation Fee button, which is the one gate that was already
 * here.
 *
 * Each arm is one of the server's own refusals, worded as the thing to do about it rather
 * than as the complaint: collect_rehab_fee and collect_diet_fee both refuse until the
 * Consultation Fee is in, and rehab and treatment both refuse without something priced to
 * collect against. Nothing is gated here that the server would allow — a row that reads as
 * blocked when the money would have gone through is the worse mistake of the two, because
 * nobody presses the button to find out.
 *
 * Only asked about a fee that is genuinely still due. A balance exists because money was
 * already taken against this fee, so nothing it might have waited on is outstanding.
 */
const rowFeeGate = (l, fee) => {
  if (fee === "consultation") return null;
  // The physio pipeline reaches this fee through the stage, which this whole list already
  // satisfies, so treatment is not gated on the consultation money the way the two parallel
  // programmes are — it is gated on the package the Consultant was meant to choose.
  if (fee === "treatment") {
    return !l.session_package_id || l.session_package_price == null
      ? { label: "Open", note: "No package chosen", hint: "The CONSULTANT has not chosen a treatment package yet", to: null }
      : null;
  }
  if (l.package_paid == null) {
    return { label: "Consultation", note: "Consultation fee first", hint: "Collect the Consultation Fee before this one", to: null };
  }
  if (fee === "rehab" && (!l.rehab_package_id || l.rehab_package_price == null)) {
    return { label: "Open Rehab", note: "No course chosen", hint: "Choose the rehab course before collecting the Rehab Fee", to: "rehab" };
  }
  return null;
};
// Patient carries two lines now — the name, and what the consultation decided under it —
// so it is the widest column rather than one of the middle ones. The room comes from Email,
// which was thirteen per cent showing "dinezramyasri.008@g..." on every row: an address cut
// off before the domain identifies nobody, and the whole of it is on the row's own popup.
//
// These must still total 100 under table-fixed, and the two sets are written out literally
// because Tailwind reads the source for class names and compiles nothing from a template.
//
// Patient No. was widened here the same way and for the same reason as in the two sets
// above — see the note over COLS_WITH_DISCOUNT.
const COLS_PLAIN = {
  sno: "w-[4%]", patient: "w-[24%]", appt: "w-[13%]", expert: "w-[15%]", stage: "w-[16%]",
  phone: "w-[14%]", pno: "w-[14%]",
};

// Every stage but Fee Collected ends its rows with a Consultation Fee action, so the plain
// table needs its own set too — the seven reporting columns each give up a point or two to
// pay for it, and the table widens at its min-width so nothing is squeezed on a laptop.
// Must total 100, same as the other three.
const COLS_PLAIN_WITH_ACTION = {
  sno: "w-[4%]", patient: "w-[21%]", appt: "w-[12%]", expert: "w-[13%]", stage: "w-[14%]",
  phone: "w-[12%]", pno: "w-[12%]", action: "w-[12%]",
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

/**
 * One physio's spell with a patient: who they were, when they held it, and how much of the
 * course they got through while they did.
 *
 * Drawn for the physio the patient is with now and for every physio before them, oldest
 * first. A reassignment does not undo the days the last one worked — they keep the days
 * they ran and the branch reading this card is usually asking exactly that: where did the
 * previous physio leave off, and what has the new one picked up.
 *
 * `packageSessions` is the course as sold, so every spell's bar is a share of the same
 * course rather than of its own booking, and two spells side by side add up.
 */
const PhysioSpell = ({ spell, packageSessions, testid }) => {
  const current = !!spell.is_current;
  const total = packageSessions || spell.sessions_assigned || 0;
  const pct = total > 0 ? Math.min(100, Math.round((spell.sessions_completed / total) * 100)) : 0;
  const from = spell.assigned_at ? dayLabel(String(spell.assigned_at).slice(0, 10)) : null;
  const to = spell.ended_at ? dayLabel(String(spell.ended_at).slice(0, 10)) : null;
  return (
    <div
      className={`rounded-lg border p-2.5 ${current ? "border-violet-200 bg-violet-50/70" : "border-slate-200 bg-slate-50"}`}
      data-testid={testid}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`min-w-0 truncate text-sm font-semibold ${current ? "text-violet-800" : "text-slate-600"}`} title={spell.physio_name}>
          {spell.physio_name || "Unknown physio"}
        </p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${current ? "bg-violet-600 text-white" : "bg-slate-200 text-slate-600"}`}>
          {current ? "Current" : "Previous"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-600">
        <span className={`font-bold ${spell.sessions_completed ? "text-emerald-700" : "text-slate-400"}`}>{spell.sessions_completed}</span>
        {` of ${total || "—"} sessions completed`}
        {spell.first_day && spell.last_day
          ? ` · Day ${spell.first_day}${spell.last_day !== spell.first_day ? `–${spell.last_day}` : ""}`
          : ""}
        {spell.sessions_upcoming > 0 ? ` · ${spell.sessions_upcoming} still booked` : ""}
      </p>
      {/* No days at all is not an empty row to hide — it is a physio who was replaced
          before they ran one, and saying so is the whole point of keeping the entry. */}
      {spell.sessions_assigned === 0 && (
        <p className="mt-0.5 text-[11px] italic text-slate-400">Replaced before any session was delivered.</p>
      )}
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${current ? "bg-violet-500" : "bg-slate-400"}`} style={{ width: `${pct}%` }} />
      </div>
      {(from || to) && (
        <p className="mt-1.5 text-[10px] text-slate-500">
          {from || "—"} → {current ? "now" : (to || "—")}
          {!current && spell.handed_over_by ? ` · handed over by ${spell.handed_over_by}` : ""}
        </p>
      )}
    </div>
  );
};

/**
 * The colour an appointment wears in the list.
 *
 * Meant rather than decorative: what someone scanning this column wants is which of these
 * is today, and the three read apart at a glance instead of needing the date parsed. Today
 * is amber because it is the one being worked; still to come is sky; already gone is grey,
 * because a date in the past is context rather than a thing to do.
 *
 * Local midnight, not UTC — toISOString would call an early-morning appointment yesterday's
 * for the five and a half hours the clinic is ahead of it.
 */
const APPOINTMENT_TONE = {
  today: "border-amber-200 bg-amber-50 text-amber-700",
  upcoming: "border-sky-200 bg-sky-50 text-sky-700",
  past: "border-slate-200 bg-slate-50 text-slate-500",
};

const appointmentTone = (date) => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const on = String(date || "").slice(0, 10);
  if (!on) return APPOINTMENT_TONE.past;
  if (on === today) return APPOINTMENT_TONE.today;
  return on > today ? APPOINTMENT_TONE.upcoming : APPOINTMENT_TONE.past;
};

const ConsultationsBoardInner = ({ branchId, viewerRole, externalStageFilter, showOwnStageBar = true, autoOpenLeadId, onAutoOpened, externalDate, hideDateFilter = false, onCountChange, onRowsChange, externalSearch, externalDateFilter, externalMarkFilter, reloadToken, mobileCards = false, onlineArm = false }) => {
  // Whether the board this is mounted on runs an arm with no room in it — one of the two
  // online admins. It gates one thing: whether a physio with no video room recorded is
  // worth remarking on when they are assigned. Passed in rather than worked out here for
  // the reason HeadPhysioCalendar takes the same prop — the answer is a fact about whose
  // board this is, and only the parent is holding it.
  const isConsultant = viewerRole === "head_physio";
  // Head Physio tracks progress on their own independent pipeline (head_consultation_stage),
  // fully separate from Branch's own consultation_stage pipeline.
  const stageField = isConsultant ? "head_consultation_stage" : "consultation_stage";
  const [board, setBoard] = useState({ leads: [], stage_counts: {}, rx_lead_ids: [] });
  // Everyone whose prescription is on file, as the board answered it. The Consultation Fee
  // waits on that page, and the Collect button at the end of a row has to know before it is
  // pressed — the per-patient count below only ever exists for the patient who is open.
  //
  // Held beside the leads rather than on them, which is how the board sends it: collecting
  // a fee or moving a stage replaces the row it touched with the lead that endpoint
  // returned, and a flag riding on the lead would be dropped by every one of them.
  //
  // Uploads are folded in as they happen (see notePrescriptionCount) so a row unlocks the
  // moment the page is filed, without waiting for a reload.
  const [rxLeadIds, setRxLeadIds] = useState(() => new Set());
  const noteRxFiled = useCallback((leadId, filed) => {
    setRxLeadIds((prev) => {
      if (prev.has(leadId) === !!filed) return prev;
      const next = new Set(prev);
      if (filed) next.add(leadId); else next.delete(leadId);
      return next;
    });
  }, []);
  const [stages, setStages] = useState([]); // dynamic Consultation Stages, from Super Admin > Pipeline Stage Management
  const [stageFilter, setStageFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null — filters by appointment date
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  // What a row button asked for — `{ id, fee }` for a payment, `{ id, view }` for the
  // programme view a blocked one sends you to — held across the draft reset that selecting
  // its patient triggers. See openRowFee, which parks it, and the effect that picks it up.
  const pendingRowFeeRef = useRef(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [timelineRemarks, setTimelineRemarks] = useState([]);
  const [timelineActivity, setTimelineActivity] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, time, remarks } | null
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [loading, setLoading] = useState(false);

  // Bulk hard-delete — Select mode swaps the row number for a checkbox rather than adding
  // a column, so the table's hand-tuned widths (COLS_PLAIN/COLS_WITH_DISCOUNT, which must
  // total 100%) don't need a slice carved out of them for something off most of the time.
  // Scoped to whatever `filtered` is currently showing, so narrowing first with a stage
  // pill/search/date filter is what narrows what "select all" can reach.
  //
  // Gated on the real signed-in session, not `viewerRole` — this board is mounted with
  // viewerRole="branch_admin"/"head_physio" for a Super Admin browsing Operations just as
  // much as for the real thing signed in as one, and the delete endpoint underneath this is
  // super_admin-only. Reading the actual role is what keeps the button from ever appearing
  // for someone the backend would just 403.
  const isRealSuperAdmin = loadSession()?.user?.role === "super_admin";
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleteConfirming, setBulkDeleteConfirming] = useState(false);
  const [bulkDeleteTyped, setBulkDeleteTyped] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
  const makeReceipt = ({ lead, payload, prefix, paidFor, packageName, assignedPrice, discount: agreedDiscount, kind = "paid", sessionsCovered, balanceDue, installments, transactionId }) => {
    const amount = payload.amount;
    const splitLines = payload.payment_lines && payload.payment_lines.length ? payload.payment_lines : null;
    // A Branch-Admin-negotiated amount below the assigned price is a discount, and the
    // receipt has to show both numbers or it reads as though the price was simply lower.
    // Inferred that way only for the fees that settle in a single payment; the Treatment
    // Fee passes the discount that was actually agreed, because there an amount below
    // the price is a balance still owed and printing it as a discount would tell the
    // patient their bill was settled.
    const discount = agreedDiscount !== undefined
      ? (agreedDiscount > 0 ? round2(agreedDiscount) : null)
      : assignedPrice != null && assignedPrice > amount
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
      // A split is named by its parts. payment_mode still carries whichever mode the
      // popup opened on, so reading it here printed "Cash" across a receipt for money
      // that came half by UPI — the one line on the page a patient checks against what
      // they actually handed over.
      modeLabel: splitLines
        ? splitLines.map((l) => `${ALL_PAYMENT_MODE_LABELS[l.mode] || l.mode} Rs.${Number(l.amount).toLocaleString("en-IN")}`).join(" + ")
        : ALL_PAYMENT_MODE_LABELS[payload.payment_mode] || payload.payment_mode,
      reference: splitLines
        ? splitLines.map((l) => (l.reference || "").trim()).filter(Boolean).join(", ")
        : paymentReference(payload),
      collectedBy: "Branch Admin",
      isCash: splitLines ? splitLines.every((l) => l.mode === "cash") : payload.payment_mode === "cash",
      // "2x500 + 1x200" — what was handed over, not just what it added up to. Blank
      // whenever nobody counted, which is allowed.
      cashCounted: splitLines
        ? splitLines.map((l) => notesLabel(l.denominations)).filter(Boolean).join(" | ")
        : notesLabel(payload.denominations),
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
  // The "Balance Amount" fork. Raised when the desk presses Collect with less money on
  // the popup than the sessions being bought cost -- Rs.5000 cash against a Rs.10000
  // fee -- because that gap is two completely different facts and only the person at
  // the desk knows which one it is:
  //
  //   - the rest of the money is here, in another form (the patient is paying the
  //     remaining Rs.5000 by UPI), which is one collection made of several tenders; or
  //   - the rest of the money is not here at all, and the patient is coming back with
  //     it, which is a balance with a due date on it.
  //
  // Guessing between them is how a part payment gets banked as a completed one, or a
  // second tender gets written off as a debt. So it is asked, once, with both figures
  // on screen. { collected, balance } | null.
  const [treatmentBalanceChoice, setTreatmentBalanceChoice] = useState(null);

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
  // `kind` is "consultation" or "chart" — see DIET_FEE_KINDS. One draft for both, because
  // only one fee is ever being collected at a time and two drafts would be two ways for the
  // popup to be open.
  const [dietFeeDraft, setDietFeeDraft] = useState(null); // { kind, item_id, mode, payment_mode, amount } | null
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
  // Who has actually delivered this patient's treatment days, and how far each of them
  // got. Fetched rather than read off the lead because the lead carries one physio — the
  // one on it now — and a patient who has been reassigned has a physio before that whose
  // completed days are still theirs. null until asked for; `null` and "no physio yet" are
  // told apart by the lead's own stage, not by this.
  const [physioProgress, setPhysioProgress] = useState(null);
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
  // The prescription is counted on its own, because it is the one the fee is gated on.
  // Off the general count it could not be: that number goes up for a scheme letter or an
  // old MRI report, so a patient with paperwork on file and no prescription would have
  // opened the gate with somebody else's document.
  const [leadRxCount, setLeadRxCount] = useState(null);
  // Bumped by the uploaders whenever anything is filed or removed, which is what makes the
  // two counts above a live figure instead of the one that happened to be true when the
  // card was opened. Without it the tab said "Documents (0)" with the page the reader had
  // just filed sitting on screen underneath it: the only count ever taken predated the
  // upload, and nothing asked for another.
  const [docTick, setDocTick] = useState(0);
  const noteDocsChanged = useCallback(() => setDocTick((t) => t + 1), []);
  // Cleared on the way to a different patient, and only there. A refresh must not blank
  // them: the counts are what the fee gate reads, so a flash of "not counted yet" straight
  // after an upload relocks the step that upload had just cleared.
  useEffect(() => { setLeadDocCount(null); setLeadRxCount(null); }, [selectedLead?.id]);
  useEffect(() => {
    if (!selectedLead?.id) return;
    let cancelled = false;
    leadDocuments(selectedLead.id)
      .then((r) => { if (!cancelled) setLeadDocCount((r?.documents || []).length); })
      // Counted as none rather than left unknown: an upload screen that cannot say whether
      // anything is there should ask for one, not quietly wave the patient through.
      .catch(() => { if (!cancelled) setLeadDocCount(0); });
    leadDocuments(selectedLead.id, "prescription")
      .then((r) => {
        if (cancelled) return;
        const count = (r?.documents || []).length;
        setLeadRxCount(count);
        // The row behind this patient reads the board's answer, which was taken when the
        // list loaded. This one is fresher, so it corrects it — including downwards, for a
        // prescription that has since been deleted.
        noteRxFiled(selectedLead.id, count > 0);
      })
      .catch(() => { if (!cancelled) setLeadRxCount(0); });
    return () => { cancelled = true; };
  }, [selectedLead?.id, docTick, noteRxFiled]);
  // Closed whenever a different patient is opened: a Diet card left standing would
  // otherwise read as the new patient's, with the previous one's figures still in it.
  useEffect(() => { setProgrammeDetail("own"); }, [selectedLead?.id]);

  // Whether one lead still owes the prescription the Consultation Fee waits on — the same
  // question the endpoint asks before it takes the money, asked of a row.
  //
  // Any lead, not the open one: the list draws a Collect button on every row, and reads the
  // board's answer for each of them. The patient who is open is the one case where a fresher
  // answer exists (the count fetched above), and noteRxFiled folds that back into the set,
  // so both readers agree without this needing to know which patient is which.
  //
  // Only at Consultation Visit, and only while the fee is unpaid: a fee already taken is
  // corrected from the popup, and holding a correction hostage to a page nobody filed at
  // the time would strand it. Same two conditions the server gate applies.
  const rxDue = useCallback(
    (lead) => (
      !!lead
      && lead[stageField] === "Consultation Visit"
      && lead.package_paid == null
      && !rxLeadIds.has(lead.id)
    ),
    [stageField, rxLeadIds],
  );

  // Whether the patient on screen is at that point. Computed up here rather than inside the
  // stage panel because the panel is rendered inside a branch, and both the effect below and
  // the tab row need the answer.
  const docsGateOpen = (
    selectedLead?.[stageField] === "Consultation Visit"
    && (leadRxCount || 0) === 0
    && selectedLead?.package_paid == null
  );

  // Opens on Documents while that gate is shut. The panel used to open on Collect Fees
  // with the collect button dead in it, which is a screen that asks for something and
  // refuses it in the same breath; the first thing on screen should be the thing that can
  // actually be done. Waits for the count to arrive — leadDocCount is null until then, and
  // jumping tabs on a guess would move somebody off a step they had already finished.
  useEffect(() => {
    if (leadRxCount === null) return;
    if (docsGateOpen) setProgrammeDetail("documents");
  }, [selectedLead?.id, leadRxCount, docsGateOpen]);

  // And moves on by itself once the page is filed. The tab opened on Documents because
  // the fee was waiting on the prescription; the moment the prescription is on file that
  // reason is gone, and leaving the reader on a finished uploader makes them hunt for the
  // step the panel just unlocked.
  //
  // Only on the change from none to one, reported by the uploader itself: a reload that
  // finds the scan already there, or somebody opening Documents to read it after the
  // money is in, is left where they are. `lastRxCount` is a ref rather than the state
  // above because the reporter is a callback the uploader holds — it fires from a fetch,
  // and the state it closed over can be a render behind.
  const lastRxCount = useRef(null);
  useEffect(() => { lastRxCount.current = null; }, [selectedLead?.id]);
  const notePrescriptionCount = (count) => {
    const had = lastRxCount.current;
    lastRxCount.current = count;
    setLeadRxCount(count);
    // And the row on the list behind the popup, so its Collect button unlocks with the
    // upload rather than on the next reload.
    if (selectedLead?.id) noteRxFiled(selectedLead.id, count > 0);
    // A prescription is a document like any other, so filing one moves the general count
    // too — the uploader only reports its own kind, and the tab beside it counts them all.
    noteDocsChanged();
    // Nothing to move on to once the fee is in: the tab is a receipt then, not a step.
    if (had === 0 && count > 0 && selectedLead?.package_paid == null) {
      setProgrammeDetail((cur) => (cur === "documents" ? "own" : cur));
    }
  };
  const [assignTrack, setAssignTrack] = useState("treatment"); // "treatment" | "rehab"
  const [physioOptions, setPhysioOptions] = useState([]);
  const [physioPick, setPhysioPick] = useState("");
  const [assigningPhysio, setAssigningPhysio] = useState(false);
  const [physioCalendarData, setPhysioCalendarData] = useState(null);
  const [loadingPhysioCalendar, setLoadingPhysioCalendar] = useState(false);
  // The physio being booked, and the video room they hold their sessions in.
  //
  // Read off the expert's own record, which is where the room lives — one link per
  // physio, recorded on the Physiotherapist Calendar. Nothing here can set it, and
  // deliberately: a booking screen that could name the room would be a booking screen that
  // could send a patient anywhere. It shows what the record says.
  //
  // It is shown at all because the patient is about to be given it. The portal joins this
  // same link onto every session still to come, so booking six days here is booking six
  // days the patient will be told to join at this address — and until now this screen was
  // the one place in that chain that never mentioned it.
  //
  // Blank for a branch's own physio, who is seen in a treatment room and has no room
  // recorded. That is the normal state offline and nothing is shown for it.
  const pickedPhysio = physioOptions.find((p) => p.id === physioPick) || null;
  const pickedMeetLink = (pickedPhysio?.meet_link || "").trim();
  // An online arm meets every patient over video, so a physio there with no room recorded
  // is an oversight worth catching before six days are booked against it — the patient's
  // portal would show those days with no way to join. Offline this is silent: the whole
  // list is expected to carry no link.
  const meetLinkMissing = onlineArm && !!physioPick && !pickedMeetLink;
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

  // Treatment (Head Physio only) — "Move to Admin": Diagnosis Report + Treatment Summary
  // have to be written first, but no add-on has to be picked — every toggle starts off,
  // which submits as a plain Consultation, the same as a patient who needs nothing else.
  // Picking Treatment reveals the Treatment Package (names only, no prices shown here).
  const [decisionDraft, setDecisionDraft] = useState({ treatment: false, diet: false, dietConsultation: false, rehab: false, fitness: false, zumba: false, item_id: "", rehab_item_id: "", zumba_item_id: "", mode: "offline", sessionsPerWeek: "" });
  const [savingDecision, setSavingDecision] = useState(false);
  // Which service's picker is open over the form, by addon key, or null for none.
  // The pickers used to stack down the form, one block per ticked service, which is what
  // pushed Confirm below the fold and made picking a second service a scroll. Only one is
  // ever being answered at a time, so only one is ever on screen.
  const [addonPicker, setAddonPicker] = useState(null);
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
        if (!cancelled) { setBoard(res); setRxLeadIds(new Set(res?.rx_lead_ids || [])); }
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
      setRxLeadIds(new Set(res?.rx_lead_ids || []));
    } catch (err) {
      console.error("Consultations board load error:", err);
      toast.error("Failed to load consultations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  };

  const toggleSelectOne = (leadId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  // Same "permanent, no-guard, everywhere" delete as the single-patient one — Branch
  // Leads, appointments, sessions, fees, all of it — just for however many are checked.
  const runBulkDelete = async () => {
    if (bulkDeleteTyped.trim().toUpperCase() !== "DELETE") { toast.error('Type "DELETE" to confirm'); return; }
    setBulkDeleting(true);
    try {
      const ids = [...selectedIds];
      const res = await bulkHardDeleteLeads(ids, "DELETE");
      toast.success(`${res.deleted ?? ids.length} patient${(res.deleted ?? ids.length) === 1 ? "" : "s"} deleted`);
      setBulkDeleteConfirming(false);
      setBulkDeleteTyped("");
      setSelectedIds(new Set());
      setSelectMode(false);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete patients");
    }
    setBulkDeleting(false);
  };

  // Everything except the stage pill: the Date Filter, the search, and the VIP/attention
  // mark. Deliberately excludes the pill so this can also drive the per-stage counts below
  // — counting by stage after narrowing to "everyone in the date range", not after already
  // narrowing to one stage. Every narrowing that belongs to the whole board goes in here
  // rather than onto the rows alone, which is what keeps each pill's count describing the
  // list it opens.
  const preStageFiltered = useMemo(() => {
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
    // Driven from the Branch Leads toolbar above rather than from a control of this
    // board's own: these stages are shown inside that board's stage bar, and two mark
    // filters on one screen would be two answers to the same question.
    if (externalMarkFilter === "vip") rows = rows.filter((l) => l.is_vip);
    else if (externalMarkFilter === "attention") rows = rows.filter((l) => l.needs_attention);
    return rows;
  }, [board.leads, dateFilter, search, externalMarkFilter]);

  // "Treatments" (Head Physio's own board only) is a cross-cutting view, not a real
  // position in the head_consultation_stage pipeline — a lead shows up here the moment
  // any Treatment Fee amount is collected, while staying visible under "Consultation
  // Visit" too, since head_consultation_stage itself never actually changes to
  // "Treatments" (there's nothing to "leave" for it to count as a real stage move).
  const matchesStage = useCallback((lead, stageName) => {
    if (isConsultant && stageName === "Treatments") return lead.treatment_fee_paid != null;
    // Diet Consultation is a stage nothing writes: the backend sets consultation_stage to
    // Consultation Booked, Consultation Visit, Fee Collected, Physio Assign and Treatment Fee, and
    // never to this one — so the pill could only ever read 0 however many diet patients the
    // branch had. It is read off the lead instead, and off the fee rather than the
    // recommendation: a consultation that ticks the box starts the conversation; the
    // patient is on the programme once the fee is in and a Nutrition Coach has them.
    //
    // Deliberately NOT done by moving consultation_stage. Diet runs alongside treatment
    // rather than instead of it, so a patient moved into this stage would vanish from Fee
    // Collected or Physio Assign, where their physio course still lives.
    //
    // Gated to the branch pipeline: the Head Physio's own board runs on
    // head_consultation_stage and has no such stage, so this must not fire there.
    if (!isConsultant && stageName === "Diet Consultation") {
      return lead.diet_fee_paid != null && !!lead.diet_coach_id;
    }
    // Diet Chart, on the same footing as Diet Consultation beside it — a separate product
    // with its own fee (see DIET_FEE_KINDS.chart), so a patient is on this pill because
    // that fee is in, not because a coach was assigned or a consultation was booked.
    if (!isConsultant && stageName === "Diet Chart") {
      return lead.diet_chart_fee_paid != null;
    }
    // Rehab reads off the fee for the same reason Diet reads off its own — nothing ever
    // writes the stage. Branch pipeline only: the Consultant's own board has no such stage.
    if (!isConsultant && stageName === "Rehab") return lead.rehab_fee_paid != null;
    // Nothing left to attend. This is the only implementation of it now: the Branch Leads
    // bar counts its Consultation pills from this board's own rows (onCountChange) rather
    // than from a second copy of these rules over a differently-filtered list, which is
    // what it used to do. Branch pipeline only: the Consultant's own board has no such stage.
    if (!isConsultant && stageName === "Completed") return isCourseComplete(lead);
    // And a finished patient leaves every other position in the pipeline, which is the half
    // that makes the line above true. Nothing ever writes "Completed" onto a lead, so the
    // stage field goes on reading whatever the branch last moved them to -- Fee Collected,
    // Physio Assign -- long after there is nothing left for them to attend. Read raw, they
    // were counted in both places at once and the row's own chip contradicted the pill that
    // had just listed it: "moved to Completed, still in Fee Collected".
    //
    // Above the three cross-cutting stages on purpose, not below them: Rehab, Diet
    // Consultation and Diet Chart are facts about a patient rather than positions, and they
    // run alongside the pipeline by design, so they are meant to hold whoever they describe.
    //
    // Cancel keeps whatever it holds. Abandoning a course is not finishing one, and the
    // branch pipeline reads it the same way.
    if (!isConsultant && lead[stageField] !== "Cancel" && isCourseComplete(lead)) return false;
    return lead[stageField] === stageName;
  }, [isConsultant, stageField]);

  /**
   * What a row's stage chip says.
   *
   * The field for everybody the pipeline still holds, and "Completed" for a patient it no
   * longer does. The same reading matchesStage above filters by, so the chip on a row and
   * the pill it was listed under cannot say different things about one patient.
   */
  const rowStageName = useCallback((lead) => (
    !isConsultant && lead[stageField] !== "Cancel" && isCourseComplete(lead)
      ? "Completed"
      : lead[stageField]
  ), [isConsultant, stageField]);

  const inStage = useMemo(() => {
    if (!stageFilter) return preStageFiltered;
    return preStageFiltered.filter((l) => matchesStage(l, stageFilter));
  }, [preStageFiltered, stageFilter, matchesStage]);

  const showDiscountColumn = stageFilter === "Fee Collected";

  // Which of the two renderings of `filtered` to build -- see useBelowSm. A board that was
  // not asked for phone cards has only ever had the table, so it is unaffected.
  const narrow = useBelowSm();
  const showMobileCards = mobileCards && narrow;
  const showDeskTable = !mobileCards || !narrow;

  // Which of the four fees the Fee Collected list is showing. Consultation first: it is
  // the fee that puts a patient in this stage, so it is the one that answers "everyone".
  const [feeTab, setFeeTab] = useState("consultation");
  const activeFee = FEE_TABS.find((t) => t.key === feeTab) || FEE_TABS[0];

  // And which side of that fee -- see FEE_STATUSES. `all` to open with, so each tab starts
  // as the whole stage seen through one desk rather than as that desk's takings alone.
  const [feeStatus, setFeeStatus] = useState("all");
  const activeStatus = FEE_STATUSES.find((s) => s.key === feeStatus) || FEE_STATUSES[0];

  // The open tab's fee, collected from the row it is owed on -- see FEE_TABS' `action` for
  // which fee that is on each tab.
  //
  // Taking a fee meant opening each patient in turn to reach the card the popup already
  // carries. The button at the end of the row is that card's button, on the row, opening
  // the same popup.
  //
  // On all four tabs now. It used to be the Consultant tab alone, on the reasoning that
  // Physio was already reading the treatment fee as a column and that Rehab and Diet were
  // other desks' money. But the column those two read is what has come in, the dropdown
  // above it is set to Fees Non Collected half the time, and the row it lists then is a
  // patient who owes this branch money with nothing on the row to take it -- so the desk
  // that came here to chase a shortfall had to leave the list to do anything about it.
  // A balance left by a short collection is the same story and worse: it is invisible in
  // the amount column, which shows the part that was paid.
  const showFeeAction = showDiscountColumn && !isConsultant;
  // Which fee that button collects, and everything about how it reads -- see ROW_FEES.
  const rowFee = activeFee.action;
  const rowFeeSpec = ROW_FEES[rowFee];

  // The Consultation Fee, collected from the row it is owed on — the same shortcut the
  // Treatment Fee button above is, for the fee that comes first.
  //
  // Taking it meant opening each patient in turn to reach the Fee Collected card the popup
  // already lives on, on a list where every row is somebody who owes it. The button at the
  // end of the row is that card's button, on the row, opening the same popup.
  //
  // Off on Fee Collected, which is the one stage where it would say nothing: that list is
  // filtered to patients whose fee is already in, and the amount, the item and the mode are
  // three columns of it. The Treatment Fee action owns the end of the row there instead.
  //
  // Off for the Consultant too. Collecting is the Branch Admin's, and the Head Physio's
  // board tracks its own pipeline rather than the branch's money.
  //
  // Off on Consultation Booked as well. That stage is the appointment diary and nothing
  // more -- the patient has a slot and has not walked in yet, so there is no consultation
  // to charge for and the fee is not owed until they arrive. A Collect button on sixty
  // booked rows is money taken before the visit it belongs to, and the column it needs
  // costs the seven reporting ones a point or two each to say nothing. The fee is
  // collected from Consultation Visit onward, where it is real.
  const showConsultationAction = !showDiscountColumn && !isConsultant && stageFilter !== "Consultation Booked";
  const cols = showFeeAction
    ? COLS_WITH_ACTION
    : showDiscountColumn
      ? COLS_WITH_DISCOUNT
      : showConsultationAction
        ? COLS_PLAIN_WITH_ACTION
        : COLS_PLAIN;

  // How many patients are behind each fee, counted off the stage's own rows. Carried on the
  // tab itself as a badge, so that Rehab holds eight and Diet five is readable from the row
  // without opening either.
  const feeCounts = useMemo(() => {
    if (!showDiscountColumn) return {};
    const out = {};
    // Counted through the tab's own scope and then through the dropdown, in that order --
    // the same two cuts `filtered` makes, so the badge is always the length of the list the
    // tab would open. A badge that keeps saying 2 while the row under it lists 5 is the
    // badge being read as the wrong number rather than as a different question.
    //
    // Scope first is what stops the four badges from repeating one number: they count four
    // different sets of patients now, not the stage over and over.
    for (const t of FEE_TABS) {
      out[t.key] = inStage.filter((l) => t.scope(l) && activeStatus.match(t.paid(l))).length;
    }
    return out;
  }, [inStage, showDiscountColumn, activeStatus]);
  // The open tab's own patients -- the stage cut to the desk they were sent to, then cut
  // again to the side of that desk's fee the dropdown is asking about. Outside Fee Collected
  // neither the tabs nor the dropdown exist, so the stage's rows pass through whole.
  const filtered = useMemo(() => {
    const rows = showDiscountColumn
      ? inStage.filter((l) => activeFee.scope(l) && activeStatus.match(activeFee.paid(l)))
      : inStage;
    // In the order the day is actually worked: 10:45 before 2:30 before 5:00. The server
    // sends these newest-updated first, which puts whoever was last edited at the top —
    // a useful order for a change log and the wrong one for a list somebody works down.
    //
    // Date first, so a range still reads day by day rather than collapsing every 9am
    // together. Times are 24-hour "HH:MM" and zero-padded, so they compare as text.
    //
    // Anyone without an appointment goes last rather than sorting as an empty string,
    // which would put the unbooked at the head of the running order. A row booked on the
    // day with no time set stands in at the end of that day for the same reason: empty
    // sorts before "09:00", so it would otherwise open the list.
    const at = (l) => `${l.appointment_date}T${l.appointment_time || "99:99"}`;
    return [...rows].sort((a, b) => {
      if (!a.appointment_date) return b.appointment_date ? 1 : 0;
      if (!b.appointment_date) return -1;
      return at(a).localeCompare(at(b));
    });
  }, [inStage, showDiscountColumn, activeFee, activeStatus]);

  // Stage counts for the head bar — derived client-side from the Date Filter/search-only
  // list so they always match whichever pipeline (branch vs. head physio) is active for
  // this viewer, and reflect the active filters rather than all-time totals.
  const derivedStageCounts = useMemo(() => {
    const counts = {};
    stages.forEach((s) => { counts[s.name] = preStageFiltered.filter((l) => matchesStage(l, s.name)).length; });
    return counts;
  }, [preStageFiltered, stages, matchesStage]);

  // Lets a parent label its own cards without fetching the board's data a second time.
  // The per-stage counts go up too, so a parent that has replaced this board's stage bar
  // with its own controls can still say how many sit behind each one.
  // The stage names go up in pipeline order as well. They're configured in Pipeline Stage
  // Management and get renamed, so a parent driving its own controls has to read them from
  // here rather than hardcoding what they were called when it was written.
  const stageNames = useMemo(() => stages.map((st) => st.name), [stages]);

  useEffect(() => {
    if (onCountChange) onCountChange(preStageFiltered.length, derivedStageCounts, stageNames);
  }, [preStageFiltered.length, derivedStageCounts, stageNames, onCountChange]);

  // The rows themselves, for a parent that merges this board's leads into a list of its
  // own. Safe to depend on directly: it's a useMemo, so its identity only changes when
  // the underlying set does.
  useEffect(() => {
    if (onRowsChange) onRowsChange(preStageFiltered);
  }, [preStageFiltered, onRowsChange]);

  // Asked for immediately, and ahead of the catalogues below. Every summary card over this
  // board is counted per stage, so a board holding its rows and not yet its stage list has
  // nothing to count them into -- the cards read 0 over a table with rows in it until this
  // lands. It is served from the shared cache in lib/api, so where a parent board has
  // already asked for the same pipeline this costs no request at all.
  useEffect(() => {
    stagesList(isConsultant ? "head_consultation" : "consultation").then(setStages).catch(() => setStages([]));
  }, [isConsultant]);

  // The three shelves, fetched after the browser has drawn the list rather than alongside
  // it. Nothing on screen reads them: they are the Treatment Package, Rehab and Zumba
  // choices, the Diet Fee quote and the report presets, all of which live inside the
  // patient popup and none of which can be reached without first clicking a row. Firing
  // them with the board put four catalogue requests in front of the one request the stage
  // cards are waiting on, which is a slow bar over a table that had already loaded.
  //
  // requestIdleCallback where there is one, with a timeout so a busy tab still gets them
  // promptly; a plain task otherwise. Either way they are in long before a row is opened.
  useEffect(() => {
    let cancelled = false;
    const fetchCatalogues = () => {
      if (cancelled) return;
      listStoreItems().then((d) => { if (!cancelled) setStoreItems(d || []); }).catch(() => { if (!cancelled) setStoreItems([]); });
      listDietStoreItems().then((d) => { if (!cancelled) setDietItems(d || []); }).catch(() => { if (!cancelled) setDietItems([]); });
      getTreatmentTypes().then((d) => { if (!cancelled) setTreatmentTypes(d || []); }).catch(() => { if (!cancelled) setTreatmentTypes([]); });
    };
    const idle = typeof window !== "undefined" && window.requestIdleCallback;
    const handle = idle
      ? window.requestIdleCallback(fetchCatalogues, { timeout: 1500 })
      : setTimeout(fetchCatalogues, 0);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle); else clearTimeout(handle);
    };
  }, []);

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
    setTreatmentConfirmDraft(null);
    setTreatmentBalanceChoice(null);
    setDecisionDraft({ treatment: false, diet: false, dietConsultation: false, rehab: false, fitness: false, zumba: false, item_id: "", rehab_item_id: "", zumba_item_id: "", mode: "offline", sessionsPerWeek: "" });
    setDecisionReceipt(null);
    setEditingDecision(false);
    setAddonPicker(null);
    setPhysioProgress(null);
  }, [selectedLead?.id]);

  useEffect(() => {
    if (!selectedLead?.id || detailTab !== "timeline") return;
    getLeadRemarks(selectedLead.id).then(setTimelineRemarks).catch(() => setTimelineRemarks([]));
    getLeadActivity(selectedLead.id).then(setTimelineActivity).catch(() => setTimelineActivity([]));
  }, [selectedLead?.id, detailTab]);

  // The treatment's own history, asked for only once there is treatment to have a history
  // of. Before Physio Assign the lead's assigned_physio is whoever took the consultation,
  // which owes this patient no days and belongs on no progress bar — the same test the
  // panel below and the backend both use.
  //
  // physio_assigned_at is in the dependencies so a reassignment refetches: it is stamped
  // on every assign, including one that keeps the same physio, where the id alone would
  // not have changed and the days would have been re-dated behind a stale card.
  useEffect(() => {
    if (!selectedLead?.id || selectedLead.consultation_stage !== "Physio Assign") {
      setPhysioProgress(null);
      return;
    }
    let cancelled = false;
    getLeadPhysioProgress(selectedLead.id)
      .then((d) => { if (!cancelled) setPhysioProgress(d); })
      .catch(() => { if (!cancelled) setPhysioProgress(null); });
    return () => { cancelled = true; };
  }, [selectedLead?.id, selectedLead?.consultation_stage, selectedLead?.assigned_physio_id, selectedLead?.physio_assigned_at]);

  // Session packages (weeks/session-count items) — the Treatment Package chosen
  // as part of the Consultation Decision (Consultation + Treatment only).
  //
  // Physiotherapy only. Rehab, Zumba and Fitness are written as session items too, so a
  // bare item_type check offered a Zumba class as a Treatment Package. An item saved
  // before the other shelves existed carries no category and is a treatment package by
  // definition, so it keeps its place here.
  const treatmentPackageItems = useMemo(() => storeItems.filter((i) => i.item_type === "session" && (i.category || "physiotherapy") === "physiotherapy").sort(byDuration), [storeItems]);
  // The Rehab shelf, offered beside the referral itself. A rehab course is a session item
  // under its own category and is priced the same way — a per-session rate whose total is
  // the rate times the course's session count.
  const rehabPackageItems = useMemo(() => storeItems.filter((i) => i.item_type === "session" && i.category === "rehab").sort(byDuration), [storeItems]);
  // The Zumba shelf. Its plan amount is stored divided down to a per-class rate, exactly
  // like a rehab course, so the same rate-times-count arithmetic returns the plan price.
  const zumbaPackageItems = useMemo(() => storeItems.filter((i) => i.item_type === "session" && i.category === "zumba").sort(byDuration), [storeItems]);

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

  // ---- Consultation Decision (Head Physio) — "Move to Admin" ----
  const submitConsultationDecision = async () => {
    if (!(selectedLead.physio_diagnosis_report || "").trim()) { toast.error("Write the Diagnosis Report first"); return; }
    if (!(selectedLead.treatment_summary || "").trim()) { toast.error("Write the Treatment Summary first"); return; }

    if (!decisionDraft.treatment) { toast.error("Pick Treatment before moving to Admin"); return; }

    // Always a treatment now. "consultation_only" is a legacy value some already-saved
    // leads still carry — the server still accepts it, and Edit on one of those reopens
    // this form with nothing ticked — but nothing written from here takes it any more.
    const decision = "consultation_treatment";
    let payload = {
      decision,
      // A Diet referral is a referral to the Nutritionist's consultation and nothing else,
      // so this one flag says all of it. The server derives diet_consultation from it and
      // no longer accepts a chart here at all: whether the patient needs one is decided at
      // that consultation, by the Nutritionist, and recommended from their own board.
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
      toast.success(decisionDraft.rehab ? "Moved to Branch Admin — with a Rehab referral" : "Moved to Branch Admin");
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
        dietConsultation: !!lead.diet_consultation,
        dietChart: !!lead.diet_chart,
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
      dietConsultation: !!lead.diet_consultation,
      dietChart: !!lead.diet_chart,
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
  // The amount is the assigned package_price and is not Branch Admin's to retype
  // (see `lockAmount` on FeeAmountEntry) — a discount agreed in the popup is the one
  // thing that moves it. If the Head Physio's decision was "Consultation + Treatment"
  // and the Treatment Fee hasn't been paid yet, its draft opens alongside this one so
  // both fees are collected together in one popup.
  //
  // `leadArg` is for the Consultation Fee button on the table's rows, which opens this on a
  // patient who is not selected yet: `setSelectedLead` has not landed by the time this runs,
  // so the row hands over the lead it already holds rather than reading a `selectedLead`
  // that is still the last one — or nobody. Guarded on `.id` because the Fee Collected
  // panel passes this straight to onClick, where the argument is a click event.
  const openCollectFeeDraft = (leadArg) => {
    const lead = leadArg?.id ? leadArg : selectedLead;
    const existing = lead.package_payment_details?.installments;
    setCollectFeeDraft({
      payment_mode: lead.package_payment_mode || "cash",
      amount: lead.package_paid ?? lead.package_price ?? "",
      // Typed by hand or not at all -- see FeeAmountEntry. Reloaded from what was
      // actually agreed and recorded, never worked back out of what was collected.
      discount: lead.package_payment_details?.discount_amount ?? "",
      // The date already promised for a balance still outstanding, so correcting a
      // collection doesn't make somebody re-agree a date the patient was given.
      balance_due_date: (existing || []).find((i) => !i.paid)?.due_date || "",
    });
    if (lead.consultation_decision === "consultation_treatment" && lead.treatment_fee_paid == null) {
      openTreatmentFeeDraft(lead);
    }
  };

  // ---- Collect Treatment Fee (Branch Admin) — for "Consultation + Treatment"
  // patients only. The Treatment Package and its price are locked in from what the
  // Head Physio already chose at Move to Admin — neither is editable here. Normally
  // opened together with the Consultation Fee draft above; also independently
  // reachable from the Fee Collected panel as a fallback if it wasn't collected
  // together the first time.
  // `leadArg` is for the Treatment Fee button on the Consultant tab's rows, which opens
  // this on a patient who is not selected yet: `setSelectedLead` has not landed by the time
  // this runs, so the row hands over the lead it already holds rather than reading a
  // `selectedLead` that is still the last one — or nobody. Guarded on `.id` because the
  // popup's own card passes this straight to onClick, where the argument is a click event.
  function openTreatmentFeeDraft(leadArg) {
    const lead = leadArg?.id ? leadArg : selectedLead;
    // A Partial Payment schedule that already exists on the lead (whether or not
    // every installment is collected yet) is reloaded from the real saved rows —
    // never reset back to two blank ones — so reopening this always shows what's
    // actually still owed, with already-collected rows carrying their paid flag.
    const total = lead.session_package_sessions || 0;
    const rate = total ? (lead.session_package_price || 0) / total : 0;
    const existing = lead.treatment_fee_payment_details?.installments;
    setTreatmentFeeDraft({
      payment_mode: lead.treatment_fee_payment_mode || "cash",
      amount: lead.treatment_fee_paid ?? lead.session_package_price ?? "",
      // Typed by hand or not at all -- see FeeAmountEntry. Nothing about a short
      // amount infers one, so a reopened draft carries only the discount that was
      // actually agreed and recorded, never one worked back out of what was collected.
      discount: lead.treatment_fee_payment_details?.discount_amount ?? "",
      bank_name: "",
      cheque_number: "",
      // Cash/UPI/Card/Cheque default to covering every session (today's full
      // Collect behavior) — reducing this reveals a Due Date for the balance.
      sessions_now: lead.session_package_sessions ?? "",
      // The date already promised for a balance still outstanding, so correcting a
      // collection doesn't make somebody re-agree a date the patient was given.
      balance_due_date: (existing || []).find((i) => !i.paid)?.due_date || "",
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
    setTreatmentConfirmDraft({ ...BLANK_TREATMENT_TENDER, tenders: [], balance_partial: false, picking_mode: false });
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
  // What is still owed on every fee, worked out once. Any of them can be part collected
  // with the rest scheduled, so each card has to be able to say so and to collect it —
  // and the Outstanding/Payment Schedules panels read the same rows from the server.
  const feeBalances = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const out = {};
    for (const [fee, field] of Object.entries(FEE_DETAIL_FIELDS)) {
      const rows = selectedLead?.[field]?.installments || [];
      const nextIdx = rows.findIndex((i) => !i.paid);
      if (nextIdx < 0) continue;
      out[fee] = {
        fee,
        rows,
        nextIdx,
        next: rows[nextIdx],
        balance: round2(rows.filter((i) => !i.paid).reduce((sum, i) => sum + (i.amount || 0), 0)),
        overdue: !!rows[nextIdx]?.due_date && rows[nextIdx].due_date < today,
      };
    }
    return out;
  }, [selectedLead]);

  // Everything owed across every fee, for the one card that answers "what is still due
  // on this patient" — null when nothing is, so the card stays off.
  const allBalances = useMemo(() => {
    const plans = Object.values(feeBalances);
    if (!plans.length) return null;
    return {
      plans,
      total: round2(plans.reduce((sum, p) => sum + p.balance, 0)),
      overdue: plans.some((p) => p.overdue),
    };
  }, [feeBalances]);

  const savedInstallments = selectedLead?.treatment_fee_payment_details?.installments || [];
  // Keyed off the schedule itself, not the mode that was recorded against it — the same
  // rule the server reads it by. A Treatment Fee collected short in cash leaves an
  // unpaid balance row exactly like a Partial Payment plan does, and gating this on
  // mode === "partial" ticked that patient green with the balance still owed and no way
  // to collect it from this board.
  const hasPendingInstallments = savedInstallments.some((i) => !i.paid);
  // A plan agreed up front names its rows First/Second/…; a schedule that exists only
  // because a collection came up short is a payment and a balance, and calling that
  // balance "Second Payment" hides what it is.
  const isPlannedSchedule = selectedLead?.treatment_fee_payment_mode === "partial";
  const installmentLabelFor = (idx) => (isPlannedSchedule ? partialInstallmentLabel(idx) : idx === 0 ? "Amount Collected" : "Balance");

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

  // The Consultation Fee's own three figures, worked out the same way the Treatment
  // Fee's are below: a discount that was typed, the money being handed over now, and
  // whatever of the price that leaves still owed.
  const consultationPrice = selectedLead?.package_price || 0;
  const consultationDiscountRs = Math.max(0, parseFloat(collectFeeDraft?.discount) || 0);
  const consultationAmountNow = parseFloat(collectFeeDraft?.amount) || 0;
  const consultationBalanceDue = round2(consultationPrice - consultationDiscountRs - consultationAmountNow);
  const consultationHasBalance = consultationBalanceDue > 0.009;

  // The Rehab Fee's and the Diet fees' three figures, worked out exactly as the
  // Consultation Fee's above are. Each fee is one price paid once, so the whole of what
  // is not discounted and not collected today is the balance.
  const rehabPrice = selectedLead?.rehab_package_price || 0;
  const rehabDiscountRs = Math.max(0, parseFloat(rehabFeeDraft?.discount) || 0);
  const rehabAmountNow = parseFloat(rehabFeeDraft?.amount) || 0;
  const rehabBalanceDue = round2(rehabPrice - rehabDiscountRs - rehabAmountNow);
  const rehabHasBalance = !!rehabFeeDraft && rehabBalanceDue > 0.009;

  // Hand-entered, and the only thing that comes off the bill -- see FeeAmountEntry.
  const treatmentDiscount = Math.max(0, parseFloat(treatmentFeeDraft?.discount) || 0);
  // What these sessions actually cost once that discount is off it. The amount being
  // collected is measured against this, never against the undiscounted price.
  const treatmentNetPayable = round2(treatmentComputedAmount - treatmentDiscount);
  // The tenders already accepted on this collection: Rs.5000 in cash, then Rs.2000 by
  // UPI, each committed as it was taken. Empty for the ordinary collection that arrives
  // in one piece, which is still most of them.
  //
  // They are money the desk has said it has, not money that is banked -- nothing is
  // sent until the popup is submitted -- so a tender can still be taken back off the
  // list if it was entered against the wrong patient or in the wrong mode.
  const treatmentTenders = treatmentConfirmDraft?.tenders || [];
  const treatmentTendersTotal = round2(treatmentTenders.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0));
  // Cheque never edits its amount -- it pays for the sessions covered, at the locked
  // price -- so read it from the same figure the popup displays rather than from a
  // draft another mode may have left short.
  const treatmentTenderAmount = treatmentFeeDraft?.payment_mode === "cheque"
    ? treatmentComputedAmount
    : (parseFloat(treatmentFeeDraft?.amount) || 0);
  // Every rupee this collection is taking, across every tender -- the figure the receipt
  // prints and the server is sent. The amount box holds only the tender being typed
  // right now, so on its own it understates a collection paid in two or three pieces.
  const treatmentAmountNow = treatmentConfirmDraft?.picking_mode
    // Between tenders there is no tender being typed, and the stale amount left in the
    // box is the previous one -- counting it again would double it.
    ? treatmentTendersTotal
    : round2(treatmentTendersTotal + treatmentTenderAmount);
  // What is left of the bill for the sessions being bought today, once every tender on
  // the popup is counted. This is the gap the Balance Amount fork asks about: it is the
  // money that has not been tendered, and it is the whole of what the patient could
  // still hand over right now.
  const treatmentOutstanding = round2(treatmentNetPayable - treatmentAmountNow);
  // Everything still owed once this money is in: the whole package, less the discount
  // that was agreed, less what is being handed over now. Short by sessions, short by
  // amount, or both -- it is one balance either way, and it is never a discount.
  const treatmentBalanceDue = round2(treatmentFeeTotal - treatmentDiscount - treatmentAmountNow);
  const treatmentHasBalance = treatmentFeeDraft?.payment_mode !== "partial" && treatmentBalanceDue > 0.009;
  // Whether the balance is settled enough to ask for its due date. A shortfall the desk
  // has not answered for yet is not a balance -- it is a question -- and putting a date
  // field under it invites an answer to a question that was never asked. Two ways it
  // becomes a real balance: the desk chose to leave it as one at the fork, or there is
  // no fork to reach because every rupee of today's bill is tendered and what remains
  // is simply the sessions this collection did not buy.
  const treatmentBalanceSettled = !!treatmentConfirmDraft?.balance_partial || treatmentOutstanding <= 0.009;

  // Changing "Sessions Covered Now" re-computes the Treatment Fee amount to match, less
  // whatever discount has been agreed on those sessions. Still hand-editable afterward
  // — but editing it down now leaves a balance rather than deepening the discount.
  const setTreatmentSessionsNow = (value) => {
    const sessionsNum = value === "" ? treatmentFeeTotalSessions : (parseInt(value, 10) || 0);
    const computed = treatmentFeeTotalSessions ? Math.round(sessionsNum * perSessionRate * 100) / 100 : treatmentFeeTotal;
    setTreatmentFeeDraft({ ...treatmentFeeDraft, sessions_now: value, amount: round2(Math.max(0, computed - treatmentDiscount)) });
  };

  // Attaches the hand-entered discount, plus sessions_now/balance_due_date, to a
  // Cash/UPI/Card/Account Transfer/Cheque payload. The due date is required whenever
  // anything is still owed after this collection — fewer sessions than the package,
  // less money than those sessions cost, or both. Returns null (after a toast) if the
  // date is missing.
  const attachSessionsSplit = (payload) => {
    const next = { ...payload };
    if (SETTLED_NOW_MODES.includes(payload.payment_mode) && treatmentDiscount > 0) {
      next.discount_amount = treatmentDiscount;
    }
    if (treatmentIsPartialSessions) next.sessions_now = treatmentSessionsNow;
    if (treatmentHasBalance) {
      if (!treatmentFeeDraft.balance_due_date) {
        toast.error("Enter a Due Date for the balance amount");
        return null;
      }
      next.balance_due_date = treatmentFeeDraft.balance_due_date;
    }
    return next;
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
    setPackageConfirmDraft({ upi_transaction_id: "", account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "", transfer_reference: "", payment_lines: null, cash_notes: {} });
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
    // The discount that was agreed, and the date the rest is promised for. The server
    // takes only what is sent here as a discount and schedules the rest as a balance,
    // so a missing date is a refusal rather than a silent write-off.
    if (consultationDiscountRs > 0) payload.discount_amount = consultationDiscountRs;
    if (consultationHasBalance) {
      if (!collectFeeDraft.balance_due_date) {
        toast.error("Enter a Due Date for the balance amount");
        return;
      }
      payload.balance_due_date = collectFeeDraft.balance_due_date;
    }
    // A split carries its own modes, so none of the single-mode detail blocks below
    // apply. amount still rides along: the server checks the parts against it rather
    // than trusting either on its own.
    if (packageConfirmDraft.payment_lines) {
      payload.payment_lines = packageConfirmDraft.payment_lines.map((l) => ({
        mode: l.mode,
        amount: parseFloat(l.amount),
        reference: (l.reference || "").trim(),
        // Only for cash, and only what was actually counted. Left off entirely when the
        // desk skipped the count, so "did not count" stays distinguishable from
        // "counted, and it came to nothing".
        denominations: l.mode === "cash" ? countedNotes(l.notes) : undefined,
      }));
      submitConsultationFee(payload);
      return;
    }
    if (mode === "cash") {
      payload.denominations = countedNotes(packageConfirmDraft.cash_notes);
    } else if (mode === "upi") {
      // The reference is the only thing that ties this money to the bank statement, so a
      // blank one is refused rather than saved as a collection nobody can trace back.
      if (!packageConfirmDraft.upi_transaction_id.trim()) {
        toast.error("UPI Transaction ID is required");
        return;
      }
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
      discount: payload.discount_amount || 0,
      balanceDue: balanceDueLabel(res.lead?.package_payment_details?.installments),
      transactionId: res.transaction_id,
    }));
  }

  // Clicking one of the 5 Payment Mode buttons opens that mode's own dedicated
  // popup — every mode (including Cash) now goes through its own explicit
  // "Collect" step there, rather than sharing one form with a mode selector.
  const chooseTreatmentPaymentMode = (mode) => {
    setTreatmentFeeDraft({ ...treatmentFeeDraft, payment_mode: mode });
    setTreatmentConfirmDraft({ ...BLANK_TREATMENT_TENDER, tenders: [], balance_partial: false, picking_mode: false });
  };

  // What identifies the tender currently on the popup, per mode -- the one string a
  // payment line can carry (see V3PaymentLineInput on the server, which takes one
  // reference rather than a bank block per line). Cash identifies itself by the notes
  // that were counted, which travel separately, so it quotes nothing.
  const treatmentTenderReference = (mode, draft) => {
    if (mode === "upi") return (draft.upi_transaction_id || "").trim();
    if (mode === "account_transfer") return (draft.transfer_reference || "").trim();
    if (mode === "card") return (draft.account_number || "").trim();
    return "";
  };

  /**
   * The tender as it stands on the popup right now, or null (after a toast) if it is
   * not yet fit to accept.
   *
   * Checked against exactly what the single-payment Collect button already checks, so
   * taking a payment as one of several is held to the same standard as taking it alone
   * -- no more, so the desk is not asked for new fields halfway through a collection,
   * and no less, so a second tender cannot slip past a count the first would have had
   * to finish.
   */
  const buildTreatmentTender = () => {
    const mode = treatmentFeeDraft.payment_mode;
    const amount = round2(parseFloat(treatmentFeeDraft.amount) || 0);
    if (!(amount > 0)) {
      toast.error("Enter the amount being paid");
      return null;
    }
    if (mode === "cash" && !notesSettled(treatmentConfirmDraft.cash_notes, amount)) {
      toast.error(noteTotal(treatmentConfirmDraft.cash_notes) === 0
        ? "Count the cash being taken before collecting it"
        : "The cash counted does not match the amount being taken");
      return null;
    }
    if (BANK_DETAIL_MODES.includes(mode)
      && (!treatmentConfirmDraft.account_number.trim() || !treatmentConfirmDraft.account_holder_name.trim()
        || !treatmentConfirmDraft.bank_name.trim() || !treatmentConfirmDraft.ifsc_code.trim())) {
      toast.error("Account Number, Account Holder Name, Bank Name and IFSC Code are required");
      return null;
    }
    if (mode === "account_transfer" && !treatmentConfirmDraft.transfer_reference.trim()) {
      toast.error("Reference / UTR No. is required");
      return null;
    }
    return {
      mode,
      amount,
      reference: treatmentTenderReference(mode, treatmentConfirmDraft),
      notes: mode === "cash" ? treatmentConfirmDraft.cash_notes : {},
      // The whole form as it was filled in, kept with the tender rather than thrown away
      // when the popup is reset for the next one. A collection that turns out to have
      // only one tender after all -- the desk accepted a Rs.5000 cash payment, went to
      // pick a second method, then decided the rest is coming later -- goes in as that
      // single payment, and a single payment records its full bank block and its cash
      // count. Reading those off a popup that has since been cleared would file the
      // payment with neither.
      detail: Object.fromEntries(Object.keys(BLANK_TREATMENT_TENDER).map((k) => [k, treatmentConfirmDraft[k]])),
    };
  };

  // The dedicated popup's own submit button — dispatches to whichever path
  // already handles that mode (Cheque/Partial build their own payload directly;
  // Cash/UPI/Card go through the shared confirm-and-collect path).
  //
  // With one stop in front of it: a settle-now collection that is short of what today's
  // sessions cost does not go anywhere until the desk has said which kind of short it
  // is. See treatmentBalanceChoice.
  const submitTreatmentModePopup = () => {
    const mode = treatmentFeeDraft.payment_mode;
    if (mode === "cheque" || mode === "partial") {
      const payload = buildTreatmentFeePayload();
      if (!payload) return;
      submitTreatmentFee(payload);
      return;
    }
    if (!treatmentConfirmDraft.picking_mode && treatmentOutstanding > 0.009 && !treatmentConfirmDraft.balance_partial) {
      // Held to the same checks the Collect button applies, before the fork rather than
      // after it: a tender that cannot be accepted is not a tender the desk should be
      // choosing what to do about the rest of.
      const tender = buildTreatmentTender();
      if (!tender) return;
      setTreatmentBalanceChoice({ collected: treatmentAmountNow, balance: treatmentOutstanding });
      return;
    }
    confirmCollectTreatmentFee();
  };

  // "Collect by another payment method" at the fork. The tender on screen is accepted
  // onto the list and the popup goes back to the mode buttons for the next one, with
  // the balance already worked out and the running total in view.
  const addTreatmentTenderAndPickNext = () => {
    const tender = buildTreatmentTender();
    if (!tender) return;
    setTreatmentConfirmDraft({
      ...BLANK_TREATMENT_TENDER,
      tenders: [...treatmentTenders, tender],
      balance_partial: false,
      // What the next tender is paid by is the patient's to say, so nothing is
      // preselected — the mode buttons come back and the desk picks from them.
      picking_mode: true,
    });
    setTreatmentBalanceChoice(null);
  };

  // "Leave the balance as a Partial Payment" at the fork. Nothing more is being taken
  // today, so the shortfall becomes a real balance and BalanceDueBlock appears to date
  // it. The money already on the popup stays exactly where it is.
  const leaveTreatmentBalanceAsPartial = () => {
    setTreatmentConfirmDraft({ ...treatmentConfirmDraft, balance_partial: true });
    setTreatmentBalanceChoice(null);
  };

  // Choosing the next tender's mode, back on the mode buttons. Its amount starts at the
  // whole of what is left, because settling the balance in one go is what usually
  // happens — typing it down to Rs.2000 raises the fork again for the Rs.3000 that
  // leaves, which is the loop the desk is already in.
  const pickNextTreatmentTenderMode = (mode) => {
    setTreatmentFeeDraft({ ...treatmentFeeDraft, payment_mode: mode, amount: String(treatmentOutstanding) });
    setTreatmentConfirmDraft({ ...treatmentConfirmDraft, ...BLANK_TREATMENT_TENDER, picking_mode: false });
  };

  // Taking an accepted tender back off the list — the wrong mode, the wrong patient, or
  // the patient changing their mind at the desk. Safe because nothing has been sent:
  // every tender here is still only on the popup until it is submitted.
  const removeTreatmentTender = (idx) => {
    const next = treatmentTenders.filter((_, n) => n !== idx);
    // Nothing accepted and nothing on the popup is not a state the form can be in, so
    // taking the last tender back off starts the collection over: the whole fee in the
    // amount box, the mode buttons behind it, exactly as it opened.
    if (!next.length && treatmentConfirmDraft.picking_mode) {
      setTreatmentFeeDraft({ ...treatmentFeeDraft, amount: String(treatmentNetPayable) });
      setTreatmentConfirmDraft({ ...BLANK_TREATMENT_TENDER, tenders: [], balance_partial: false, picking_mode: false });
      return;
    }
    setTreatmentConfirmDraft({
      ...treatmentConfirmDraft,
      tenders: next,
      // The balance it left is no longer the balance that was agreed to, so the fork is
      // asked again rather than answered with a stale yes.
      balance_partial: false,
    });
  };

  // Confirm button inside the second "Confirm Payment" popup — validates
  // UPI/Card's own fields (Cash just needed the mismatch acknowledged).
  function confirmCollectTreatmentFee() {
    // Everything being taken, in the order it was taken: the tenders already accepted,
    // plus whatever is on the popup now. Between tenders (picking_mode) there is
    // nothing on the popup, so the list is the accepted ones alone.
    const current = treatmentConfirmDraft.picking_mode ? null : buildTreatmentTender();
    if (!treatmentConfirmDraft.picking_mode && !current) return;
    const tenders = current ? [...treatmentTenders, current] : treatmentTenders;
    if (!tenders.length) {
      toast.error("Enter the amount being paid");
      return;
    }
    const amount = round2(tenders.reduce((sum, t) => sum + t.amount, 0));
    // One tender is a single payment, not a split of one, and goes in under its own mode
    // with its own full bank block. Only a collection that actually arrived in pieces
    // becomes payment_lines, because that is the only shape that can say so.
    const isSplit = tenders.length > 1;
    const only = isSplit ? null : tenders[0];
    // The headline mode of a split is the mode it started in -- the first money through
    // the door. The parts carry the truth; this is what the row reads as at a glance.
    const payload = { payment_mode: isSplit ? tenders[0].mode : only.mode, amount, confirmed: true };
    if (isSplit) {
      // A split carries its own modes, so none of the single-mode detail blocks below
      // apply to it. amount still rides along: the server sums the parts and refuses them
      // when they disagree with the fee this popup was collecting.
      payload.payment_lines = tenders.map((t) => ({
        mode: t.mode,
        amount: t.amount,
        reference: t.reference || "",
        // Only for cash, and only what was actually counted -- left off entirely when
        // the desk skipped it, so "did not count" stays distinguishable from "counted,
        // and it came to nothing".
        denominations: t.mode === "cash" ? countedNotes(t.notes) : undefined,
      }));
    } else {
      // Off the tender's own kept copy of the form -- see buildTreatmentTender. It is
      // the same object the popup is showing when the tender is still on it, and the
      // only surviving copy when it is not.
      const detail = only.detail;
      if (only.mode === "cash") {
        payload.denominations = countedNotes(detail.cash_notes);
      } else if (only.mode === "upi") {
        payload.upi_transaction_id = (detail.upi_transaction_id || "").trim();
      } else if (BANK_DETAIL_MODES.includes(only.mode)) {
        if (!attachBankDetails(payload, detail, only.mode)) return;
      }
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
    setTreatmentBalanceChoice(null);

    const totalSessions = selectedLead.session_package_sessions || 0;
    const savedInst = res.lead?.treatment_fee_payment_details?.installments || [];
    const scheduleOnly = payload.payment_mode === "partial";
    // Cash/UPI/Card/Cheque can cover only some of the package's sessions now, with the
    // rest scheduled — the receipt has to say which sessions this money bought, or it
    // reads as payment for the whole package.
    const partOfPackage = !scheduleOnly && payload.sessions_now != null && totalSessions && payload.sessions_now < totalSessions;
    showReceipt(() => makeReceipt({
      lead: selectedLead, payload,
      prefix: scheduleOnly ? "TS" : "TF",
      kind: scheduleOnly ? "schedule" : "paid",
      paidFor: "Treatment Fee",
      discount: payload.discount_amount || 0,
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
      balanceDue: balanceDueLabel(savedInst),
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
  // `leadArg`, as on openTreatmentFeeDraft, is the row button's way in: the schedule is
  // read off the lead it hands over rather than off derived state that still belongs to
  // whoever was selected before. A saved row is the whole answer there — a plan reached
  // from a row exists already, or the row would not be showing a balance to collect.
  const openPartialCollectPopup = (idx, fee = "treatment", leadArg = null) => {
    // Only the Treatment Fee is ever collected against a schedule that has not been
    // saved yet (its Partial Payment plan is built in the popup and stored on first
    // collect). Every other fee's schedule exists already, because a collection is what
    // created it, so the saved row is the whole answer.
    const saved = leadArg
      ? (leadArg[FEE_DETAIL_FIELDS[fee]]?.installments || [])[idx]
      : (fee === "treatment" ? savedInstallments : (feeBalances[fee]?.rows || []))[idx];
    const inst = !leadArg && fee === "treatment" ? (partialInstallments[idx] || {}) : {};
    const amount = saved?.amount ?? Math.round((parseInt(inst.sessions, 10) || 0) * perSessionRate);
    setPartialCollectDraft({
      idx,
      fee,
      amount: amount > 0 ? String(amount) : "",
      payment_mode: "cash",
      upi_transaction_id: "",
      account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "",
      cheque_number: "", transfer_reference: "",
      payment_lines: null,
      cash_notes: {},
    });
  };

  // Opens whichever Treatment Fee popup a lead is owed: the installment one for a part-paid
  // plan, the full Collect draft for everything else. The same fork the popup's own
  // Treatment Fee card makes, taking the lead as an argument so a row can make it too.
  const openTreatmentFeeFor = (lead) => {
    const state = treatmentFeeStateOf(lead);
    if (state.kind === "balance") openPartialCollectPopup(state.nextIdx, "treatment", lead);
    else openTreatmentFeeDraft(lead);
  };

  // Opens whichever Consultation Fee popup a lead is owed: the installment one for a
  // part-paid fee, the full Collect draft for everything else. The same fork the popup's own
  // Consultation Fee card makes, taking the lead as an argument so a row can make it too.
  const openConsultationFeeFor = (lead) => {
    const state = consultationFeeStateOf(lead);
    if (state.kind === "balance") openPartialCollectPopup(state.nextIdx, "consultation", lead);
    else openCollectFeeDraft(lead);
  };

  // What the table's Consultation Fee row button does — same handoff as the Treatment Fee
  // one beside it.
  const openRowConsultationFee = (lead) => openRowFee(lead, "consultation");

  // The same fork again for the two parallel programmes, so the Rehab and Diet tabs' row
  // buttons reach the popups the panel's own cards reach.
  //
  // Both take their balance the way every other fee does — a balance is one figure against
  // a schedule that already exists, and markInstallmentPaid is told which fee it is. A first
  // collection is where they differ: rehab is priced against the course the Consultant chose
  // (rowFeeGate holds the button back until there is one), and diet's package is picked
  // inside the popup itself, so neither needs anything from the row but the patient.
  //
  // Neither draft takes a lead: they read `selectedLead`, which openRowFee has already moved
  // to this one — directly when the patient was open, and through the parked request when it
  // was not, which is what the effect below is for.
  const openRehabFeeFor = (lead) => {
    const state = feeStateOf(lead, "rehab");
    if (state.kind === "balance") openPartialCollectPopup(state.nextIdx, "rehab", lead);
    else openRehabFeeDraft();
  };

  const openDietFeeFor = (lead) => {
    const state = feeStateOf(lead, "diet");
    if (state.kind === "balance") openPartialCollectPopup(state.nextIdx, "diet", lead);
    else openDietFeeDraft("consultation");
  };

  // Which of the four openers a fee name reaches. Read in openRowFee and in the effect
  // that finishes the job once the patient is selected, so the two cannot disagree about
  // what a button was asking for.
  const feeOpeners = {
    consultation: openConsultationFeeFor,
    treatment: openTreatmentFeeFor,
    rehab: openRehabFeeFor,
    diet: openDietFeeFor,
  };

  /**
   * What a row's fee button does: open the patient, and open that fee on top of them.
   *
   * Selecting the lead as well is not incidental. Every popup on this board renders inside
   * `selectedLead`, and collecting patches that lead and the row behind it — so the two have
   * to move together or the popup opens over nobody. It also leaves the right thing behind:
   * close the fee and the patient is open on the card the button came from, which is where
   * somebody who has just taken one fee goes looking for the next.
   *
   * But selecting a lead is also what clears every draft on this board — the effect keyed on
   * selectedLead.id, which is there so a half-typed collection never follows you to the next
   * patient, and which runs after this click. A popup opened here and now would be wiped
   * between the click and the paint. So the request is parked on a ref, which that reset
   * cannot reach, and the effect below picks it up once the patient is actually selected.
   */
  function openRowFee(lead, fee) {
    setDetailTab("overview");
    // Paperwork before money, on the row as well as in the panel.
    //
    // The panel has always held the Consultation Fee behind the prescription — its Collect
    // tab is locked until the page is filed. This button opened the popup straight off the
    // lead and went round the whole of that, so a fee the panel would not take was taken
    // from the list instead. It now does what the panel does: opens the patient on the
    // uploader, which is the step that can actually be done.
    //
    // No popup is parked for afterwards. Filing the page is a job with a person at the desk
    // in the middle of it, and a payment popup springing open behind the uploader would be
    // collecting on a decision nobody has come back to.
    if (fee === "consultation" && rxDue(lead)) {
      // Said, not warned. The button this came from already reads "Prescription" and the
      // screen it opens is the uploader, so the only thing left to explain is why the
      // payment popup did not appear.
      toast.info("Upload the prescription before collecting the Consultation Fee");
      pendingRowFeeRef.current = null;
      if (selectedLead?.id === lead.id) setProgrammeDetail("documents");
      else setSelectedLead(lead); // the docs gate opens it on Documents by itself
      return;
    }
    // Money in order, on the row as well as on the panel: the server refuses every fee
    // after the first until the Consultation Fee is in, and refuses the Rehab Fee until a
    // course has been chosen to price it against. Same handling as the prescription above —
    // say what is missing, and open the patient on the view where it can be dealt with
    // rather than on a payment popup for a payment that would be refused.
    //
    // `view` rather than `fee` on the parked request: the step in the way has a decision or
    // a payment of its own in the middle of it, and a second popup springing open behind
    // that one collects on something nobody has come back to.
    const gate = rowFeeGate(lead, fee);
    if (gate) {
      toast.info(gate.hint);
      pendingRowFeeRef.current = null;
      if (selectedLead?.id === lead.id) setProgrammeDetail(gate.to || "own");
      else if (gate.to) {
        pendingRowFeeRef.current = { id: lead.id, view: gate.to };
        setSelectedLead(lead);
      } else {
        setSelectedLead(lead); // opens on its own overview, where the Consultation Fee card is
      }
      return;
    }
    // Already open on this patient: the id does not change, so neither the reset nor the
    // effect will fire and there is nothing to park.
    if (selectedLead?.id === lead.id) {
      feeOpeners[fee](lead);
      return;
    }
    pendingRowFeeRef.current = { id: lead.id, fee };
    setSelectedLead(lead);
  }

  // Declared here rather than up with the reset it works around, because effects run in the
  // order they are called and this one has to run second — after the reset has cleared the
  // drafts, or it would open a popup for the reset to close. The programme view is reset by
  // that same pass, which is why a parked `view` has to be re-applied here too.
  useEffect(() => {
    const pending = pendingRowFeeRef.current;
    if (!selectedLead?.id || pending?.id !== selectedLead.id) return;
    pendingRowFeeRef.current = null;
    if (pending.view) setProgrammeDetail(pending.view);
    else feeOpeners[pending.fee](selectedLead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

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
    // Same as the fee itself: a split brings its own modes, so the single-mode blocks
    // below are not its to fill in.
    if (draft.payment_lines) {
      payload.payment_lines = draft.payment_lines.map((l) => ({
        mode: l.mode,
        amount: parseFloat(l.amount),
        reference: (l.reference || "").trim(),
        denominations: l.mode === "cash" ? countedNotes(l.notes) : undefined,
      }));
    } else if (mode === "cash") {
      payload.denominations = countedNotes(draft.cash_notes);
    } else if (mode === "upi") {
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
      const fee = draft.fee || "treatment";
      const detailsField = FEE_DETAIL_FIELDS[fee];
      let lead = selectedLead;
      // Only the Treatment Fee can reach here with its schedule still unsaved — its
      // Partial Payment plan is built in the popup and stored on the first collect.
      // Every other fee's schedule was created by the collection that left the balance.
      const scheduleExists = (lead[detailsField]?.installments || []).length > 0;
      if (fee === "treatment" && !scheduleExists) {
        const schedulePayload = buildTreatmentFeePayload();
        if (!schedulePayload) {
          setCollectingTreatmentFee(false);
          return;
        }
        const res = await collectTreatmentFee(lead.id, schedulePayload);
        lead = res.lead;
      }
      payload.fee = fee;
      const paidRes = await markInstallmentPaid(lead.id, draft.idx + 1, payload);
      const installments = (lead[detailsField]?.installments || []).map((inst, i) =>
        i === draft.idx ? { ...inst, paid: true, amount, payment_mode: draft.payment_lines ? "split" : mode, transaction_id: paidRes?.transaction_id } : inst
      );
      const updatedLead = { ...lead, [detailsField]: { ...lead[detailsField], installments } };
      toast.success(`${FEE_LABELS[fee]} · Rs.${amount.toLocaleString("en-IN")} collected`);
      setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === updatedLead.id ? updatedLead : l)) }));
      setPartialCollectDraft(null);

      const thisInst = installments[draft.idx] || {};
      showReceipt(() => makeReceipt({
        lead: updatedLead, payload, prefix: `${fee === "treatment" ? "TF" : "BAL"}${draft.idx + 1}`,
        paidFor: `${FEE_LABELS[fee]} · Payment #${draft.idx + 1} of ${installments.length}`,
        packageName: fee === "treatment"
          ? (updatedLead.session_package_name
            ? `${updatedLead.session_package_name} · ${updatedLead.session_package_sessions || 0} sessions`
            : "")
          : "",
        sessionsCovered: thisInst.sessions ? `${thisInst.sessions} sessions` : "",
        balanceDue: balanceDueLabel(installments),
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
  const packageSessions = (isRehabAssign
    ? selectedLead?.rehab_package_sessions
    : selectedLead?.session_package_sessions) || 0;
  // Days this patient has already had. A reassignment part-way through a course is not a
  // fresh course: those days were worked, they stay on the physio who worked them, and
  // only what is left of the package is being placed here. Asking for the whole package
  // again was how a 12-session patient moved after day 5 ended up holding 17 days.
  //
  // Rehab replaces its course outright (the backend clears the old days first), so it has
  // nothing already-done to carry.
  const sessionsAlreadyDone = isRehabAssign ? 0 : (selectedLead?.completed_sessions || 0);
  const totalSessionsNeeded = Math.max(0, packageSessions - sessionsAlreadyDone);
  // And the weeks with them. The plan preview groups its days by week, and a resumed
  // course opening a second "Week 1" beside the one already worked reads as a restart —
  // the backend numbers the rows it writes the same way, off the same number.
  const weeksAlreadyDone = isRehabAssign ? 0 : (physioProgress?.weeks_completed || 0);
  // Whether this run of the picker is picking up a course somebody else started.
  const resumingCourse = sessionsAlreadyDone > 0;
  // What the picker calls a booked day, so its copy reads as the course being booked.
  const dayNoun = isRehabAssign ? "rehab day" : "treatment day";
  const courseName = (isRehabAssign
    ? selectedLead?.rehab_package_name
    : selectedLead?.session_package_name) || (isRehabAssign ? "Rehab course" : "Session package");

  // What the picker calls itself, and which money it quotes. The same popup books two
  // courses, and every word of its chrome was written for the treatment one: a rehab
  // booking opened onto "Assign Physio" over "Treatment Fee: not paid" — the wrong fee,
  // and a false alarm besides. The Rehab tab is only reachable once the Rehab Fee is in,
  // so the one figure this popup showed was the one figure with nothing to do with the
  // days being booked, sitting under a heading that named the other course.
  const assignTitle = isRehabAssign ? "Assign Rehab Physio" : "Assign Physio";
  const assignFeeLabel = isRehabAssign ? "Rehab Fee" : "Treatment Fee";
  const assignFeePaid = isRehabAssign ? selectedLead?.rehab_fee_paid : selectedLead?.treatment_fee_paid;
  const assignFeeMode = isRehabAssign ? selectedLead?.rehab_fee_payment_mode : selectedLead?.treatment_fee_payment_mode;

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
    // The whole course, not the part of it being placed now: the per-session rate is the
    // package price over the package's own sessions, and "Day 6–12 unpaid" has to count
    // in the days the patient's plan is numbered in.
    const total = packageSessions;
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
  }, [selectedLead, packageSessions, isRehabAssign]);

  // Days are numbered in date order, so the first `paid` of them are the ones covered.
  const isPaidSession = (dayNumber) => dayNumber <= sessionPayment.paid;

  // The plan itself: one treatment session per day, numbered Day 1, Day 2 … in date order
  // and stamped with the week it falls in — the same week rule the backend records, so a
  // "03 Week · 9 sessions" package reads as 3 weeks of 3 treatment days.
  const treatmentPlan = useMemo(() => {
    if (sortedPickedSlots.length === 0) return [];
    const firstDay = sortedPickedSlots[0].split("T")[0];
    // Numbered in the course, not in the picker. Day 1 of what is being placed here is Day
    // 6 of a nine-session package five days in, and it is the course's number that the
    // paid/unpaid split, the physio's board and the backend's own rows all speak in.
    return sortedPickedSlots.map((slot, i) => {
      const [date, time] = slot.split("T");
      return { slot, date, time, day: sessionsAlreadyDone + i + 1, week: weeksAlreadyDone + weekOf(date, firstDay) };
    });
  }, [sortedPickedSlots, sessionsAlreadyDone, weeksAlreadyDone]);

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

  const dietItemFor = useCallback((kind) => pickDietItem(dietItems, kind), [dietItems]);

  /** The price this patient would be quoted for one diet product, at their own mode. */
  const dietPriceOf = useCallback((item) => {
    if (!item) return null;
    const mode = selectedLead?.package_mode || selectedLead?.appointment_mode || "offline";
    const price = mode === "online" ? item.price_online : item.price_offline;
    return price != null ? Number(price) : null;
  }, [selectedLead]);
  // Which of the two fees the popup is currently taking. Falls back to the consultation so
  // a draft saved before `kind` existed still opens as the fee it was.
  const dietFeeCfg = DIET_FEE_KINDS[dietFeeDraft?.kind] || DIET_FEE_KINDS.consultation;

  /**
   * What to quote for each diet fee before it has been collected.
   *
   * The lead only carries the price once the fee is actually taken — the package is named
   * at collection — so until then it comes off the shelf, from the product that fee is for.
   *
   * It used to quote only when the shelf held exactly one product, on the reasoning that
   * any figure picked out of several was a guess. That was true while nothing could tell
   * the products apart. Now that dietItemFor can, the shelf holding both of them is the
   * normal case rather than the ambiguous one — and refusing to quote there left both cards
   * reading "—" for every branch that had priced its two products, which is all of them.
   */
  const dietFeeDue = useMemo(() => (
    selectedLead?.diet_package_price != null
      ? Number(selectedLead.diet_package_price)
      : dietPriceOf(dietItemFor("consultation"))
  ), [selectedLead, dietItemFor, dietPriceOf]);

  const dietChartFeeDue = useMemo(() => (
    selectedLead?.diet_chart_package_price != null
      ? Number(selectedLead.diet_chart_package_price)
      : dietPriceOf(dietItemFor("chart"))
  ), [selectedLead, dietItemFor, dietPriceOf]);

  const dietListPrice = (draft) => {
    const item = dietItemById(draft?.item_id);
    if (!item) return null;
    const price = draft.mode === "online" ? item.price_online : item.price_offline;
    return price != null ? Number(price) : null;
  };

  // The Diet fee's three figures, worked out as every other fee's are — down here rather
  // than beside them because the listed price is whatever the chosen package costs at
  // the chosen mode, which dietListPrice just above is what answers.
  const dietPrice = dietFeeDraft ? (dietListPrice(dietFeeDraft) || 0) : 0;
  const dietDiscountRs = Math.max(0, parseFloat(dietFeeDraft?.discount) || 0);
  const dietAmountNow = parseFloat(dietFeeDraft?.amount) || 0;
  const dietBalanceDue = round2(dietPrice - dietDiscountRs - dietAmountNow);
  const dietHasBalance = !!dietFeeDraft && dietBalanceDue > 0.009;

  function openRehabFeeDraft() {
    const agreedDiscount = Number(selectedLead.rehab_fee_payment_details?.discount_amount) || 0;
    const price = selectedLead.rehab_package_price;
    setRehabFeeDraft({
      payment_mode: selectedLead.rehab_fee_payment_mode || "cash",
      // Opens on what is payable after a discount already agreed, not on the list price:
      // otherwise reopening a discounted fee shows a balance nobody owes.
      amount: price != null ? String(round2(price - agreedDiscount)) : "",
      // Typed by hand or not at all -- see FeeAmountEntry -- and reloaded from what was
      // agreed, alongside the date any balance was already promised for.
      discount: selectedLead.rehab_fee_payment_details?.discount_amount ?? "",
      balance_due_date: (selectedLead.rehab_fee_payment_details?.installments || []).find((i) => !i.paid)?.due_date || "",
      upi_transaction_id: "",
      account_number: "",
      account_holder_name: "",
      bank_name: "",
      ifsc_code: "",
      transfer_reference: "",
    });
  }

  const confirmCollectRehabFee = async () => {
    const amount = parseFloat(rehabFeeDraft.amount);
    if (!(amount > 0)) { toast.error("Enter the amount collected"); return; }
    // Named rather than carried across by the spread below: the draft calls it `discount`
    // and the server calls it `discount_amount`, and a balance with no date is refused
    // there — so it is caught here, with what was typed still on the screen.
    if (rehabHasBalance && !rehabFeeDraft.balance_due_date) {
      toast.error("Enter a Due Date for the balance amount");
      return;
    }
    setCollectingRehabFee(true);
    try {
      const res = await collectRehabFee(selectedLead.id, {
        ...rehabFeeDraft,
        amount,
        confirmed: true,
        discount_amount: rehabDiscountRs > 0 ? rehabDiscountRs : undefined,
        balance_due_date: rehabHasBalance ? rehabFeeDraft.balance_due_date : undefined,
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

  async function openDietFeeDraft(kind = "consultation") {
    const cfg = DIET_FEE_KINDS[kind];
    let items = dietItems;
    if (!items.length) {
      try {
        // Both shelves. A branch may have priced its Diet Consultation and its Diet Chart
        // under either item type and the server takes an item off either, so asking for one
        // is how this told a branch to add a package they had already added.
        items = (await listDietStoreItems()) || [];
        setDietItems(items);
      } catch {
        items = [];
      }
    }
    if (!items.length) {
      toast.error("No Diet Package priced yet — add one in Services and Products > Diet Package.");
      return;
    }
    // Off the list just loaded rather than off `dietItems`, which the setState above has
    // not landed in yet on the first open.
    const match = pickDietItem(items, kind);

    setDietFeeDraft({
      kind,
      // Re-collecting keeps whatever was chosen last time, so a correction doesn't
      // silently move the patient onto a different package. Read off this kind's own
      // fields: the chart and the consultation remember different packages.
      //
      // Otherwise it opens on the product this fee is actually for. It used to open on
      // whichever item sorted first, for both fees — so collecting a Diet Chart Fee
      // pre-selected the Diet Consultation, and one confirm without reading the dropdown
      // put the money against the wrong product.
      item_id: selectedLead[cfg.itemField] || match?.id || items[0].id,
      mode: selectedLead[cfg.packageModeField] || "offline",
      payment_mode: "cash",
      amount: "",
      // Typed by hand or not at all -- see FeeAmountEntry -- read off this kind's own
      // fee, since the chart and the consultation are separate money.
      discount: selectedLead[cfg.detailsField]?.discount_amount ?? "",
      balance_due_date: (selectedLead[cfg.detailsField]?.installments || []).find((i) => !i.paid)?.due_date || "",
    });
  }

  const startCollectDietFee = () => {
    const price = dietListPrice(dietFeeDraft);
    if (!dietFeeDraft.item_id) { toast.error("Choose a Diet Package"); return; }
    if (!(price > 0)) { toast.error(`This Diet Package has no ${dietFeeDraft.mode} price set`); return; }
    // Net of any discount already agreed, for the same reason the Rehab Fee's is.
    setDietFeeDraft((d) => ({ ...d, amount: String(round2(price - (Math.max(0, parseFloat(d.discount) || 0)))) }));
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
    // The discount that was agreed, and the date the rest is promised for — the server
    // takes only what is sent here as a discount and schedules the rest as a balance.
    if (dietDiscountRs > 0) payload.discount_amount = dietDiscountRs;
    if (dietHasBalance) {
      if (!dietFeeDraft.balance_due_date) {
        toast.error("Enter a Due Date for the balance amount");
        return;
      }
      payload.balance_due_date = dietFeeDraft.balance_due_date;
    }
    if (mode === "upi") {
      if (!dietFeeConfirmDraft.upi_transaction_id.trim()) {
        toast.error("UPI Transaction ID is required");
        return;
      }
      payload.upi_transaction_id = dietFeeConfirmDraft.upi_transaction_id.trim();
    } else if (BANK_DETAIL_MODES.includes(mode)) {
      if (!attachBankDetails(payload, dietFeeConfirmDraft, mode)) return;
    }

    const cfg = DIET_FEE_KINDS[dietFeeDraft.kind] || DIET_FEE_KINDS.consultation;
    const collect = dietFeeDraft.kind === "chart" ? collectDietChartFee : collectDietFee;

    setCollectingDietFee(true);
    // Only the call is guarded: a fault while building the receipt below must never be
    // reported as a failure to collect, because the money is already recorded.
    let res;
    try {
      res = await collect(selectedLead.id, payload);
    } catch (err) {
      toast.error(err?.response?.data?.detail || `Failed to collect the ${cfg.label}`);
      setCollectingDietFee(false);
      return;
    }
    toast.success(`${cfg.label} collected — Rs.${amount}`);
    setDietFeeConfirmDraft(null);
    setDietFeeDraft(null);
    setSelectedLead(res.lead);
    setBoard((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === res.lead.id ? res.lead : l)) }));
    showReceipt(() => makeReceipt({
      lead: res.lead,
      payload,
      prefix: cfg.receiptPrefix,
      paidFor: cfg.label,
      packageName: res.lead[cfg.nameField] || "",
      assignedPrice: res.lead[cfg.priceField],
      discount: payload.discount_amount || 0,
      balanceDue: balanceDueLabel(res.lead[cfg.detailsField]?.installments),
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

  // The fee picker for the Fee Collected stage: one sub-tab per desk, on a row of its own
  // under the toolbar — the same shape every other board's sub-tabs take (see Packages'
  // sessions-subtabs), which is the shape this one had before it was folded into a select.
  //
  // Tabs rather than a dropdown because all four answers are the point. The branch reads
  // this row to see what came in from each desk today, and a dropdown shows one desk at a
  // time and hides the other three behind a click. Four desk names and four badges fit a
  // laptop row with room to spare; they wrap on a phone rather than overflow.
  const feeTabsBar = (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1" data-testid="cons-fee-tabs">
          {/* Which side of each desk's fee the row below is about, where the caption used
              to be. A dropdown rather than three more tabs: the desk is the thing being
              switched between all day and the four tabs stay tabs for that reason, while
              this one is set once and read back -- and seven controls on one line is a line
              nobody finds the desk on. It sits ahead of the tabs because it qualifies all
              four of them at once, and it says the phrase the caption used to say, so the
              row still names itself. */}
          <select
            value={feeStatus}
            onChange={(e) => setFeeStatus(e.target.value)}
            aria-label="Which fees to list"
            className="ml-1 mr-1 h-8 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            data-testid="cons-fee-status"
          >
            {FEE_STATUSES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
          </select>
          {FEE_TABS.map((t) => {
            const on = t.key === activeFee.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFeeTab(t.key)}
                aria-pressed={on}
                // The visible label is one word now, so the full question goes on the
                // accessible name — "Physio" alone tells a screen reader nothing, and
                // "Physio Fee Collected" is the wrong sentence on two of the three
                // dropdown settings.
                aria-label={`${t.label} — ${activeStatus.label} (${feeCounts[t.key] ?? 0})`}
                // flex-1 below sm so four tabs share a phone's width evenly instead of
                // leaving a ragged last row; at sm+ each takes only the width of its label.
                className={`flex-1 rounded-md px-3 py-2 text-left transition sm:flex-none ${on ? "text-white" : "text-slate-600 hover:bg-slate-50"}`}
                style={on ? { background: t.tone } : undefined}
                data-testid={`cons-fee-tab-${t.key}`}
              >
                <span className="block whitespace-nowrap text-xs font-semibold">
                  {t.label}
                  <span className={`ml-1.5 rounded px-1.5 py-px text-[10px] font-bold ${on ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
                    {feeCounts[t.key] ?? 0}
                  </span>
                </span>
              </button>
            );
          })}
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
          totalCount={preStageFiltered.length}
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
        {/* Super Admin only, same as the single-patient delete this bulk version shares
            its endpoint's cascade with — a Branch Admin still has the safer bulk-delete
            elsewhere, the one that refuses anyone with paid-for history. */}
        {isRealSuperAdmin && (
          <Button
            onClick={toggleSelectMode}
            variant={selectMode ? "default" : "outline"}
            title={selectMode ? "Stop selecting" : "Select patients to delete"}
            className={`h-8 shrink-0 px-2.5 text-xs ${selectMode ? "bg-rose-600 text-white hover:bg-rose-700" : ""}`}
            data-testid="cons-select-toggle"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> {selectMode ? "Cancel" : "Select"}
          </Button>
        )}
      </div>

      {/* Only while selecting — scoped to `filtered`, the same list the rows below render,
          so "select all" only ever reaches what the current stage/date/search has left on
          screen, not the whole branch. */}
      {selectMode && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2" data-testid="cons-select-bar">
          <label className="flex items-center gap-2 text-xs font-medium text-rose-700">
            <input
              type="checkbox"
              checked={filtered.length > 0 && selectedIds.size === filtered.length}
              onChange={(e) => setSelectedIds(e.target.checked ? new Set(filtered.map((l) => l.id)) : new Set())}
              data-testid="cons-select-all"
            />
            Select all ({filtered.length})
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-rose-700">{selectedIds.size} selected</span>
            <Button
              size="sm"
              className="h-7 bg-rose-600 text-xs text-white hover:bg-rose-700"
              disabled={selectedIds.size === 0}
              onClick={() => setBulkDeleteConfirming(true)}
              data-testid="cons-bulk-delete-open"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete Selected
            </Button>
          </div>
        </div>
      )}

      {bulkDeleteConfirming && (() => {
        const picked = board.leads.filter((l) => selectedIds.has(l.id));
        const feesAtStake = picked.reduce((sum, l) => sum + totalPaid(l), 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget && !bulkDeleting) setBulkDeleteConfirming(false); }}>
            <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-2xl" data-testid="cons-bulk-delete-modal">
              <p className="text-sm font-semibold text-rose-700">Delete {picked.length} patient{picked.length === 1 ? "" : "s"} permanently?</p>
              <p className="text-xs text-slate-600">
                Erases every one of them and everything on file — appointments, sessions, fees, their spot on Branch Leads, the Consultant queue and Physio's board. This cannot be undone.
                {feesAtStake > 0 && <> Rs.{feesAtStake.toLocaleString("en-IN")} on file across them will no longer trace back to a real record.</>}
              </p>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={bulkDeleteTyped}
                  onChange={(e) => setBulkDeleteTyped(e.target.value)}
                  placeholder="Type DELETE"
                  className="h-9 flex-1 text-sm"
                  data-testid="cons-bulk-delete-input"
                />
                <Button
                  className="h-9 bg-rose-600 text-xs text-white hover:bg-rose-700"
                  onClick={runBulkDelete}
                  disabled={bulkDeleting || bulkDeleteTyped.trim().toUpperCase() !== "DELETE"}
                  data-testid="cons-bulk-delete-confirm"
                >
                  {bulkDeleting ? "Deleting..." : "Delete Permanently"}
                </Button>
                <Button
                  variant="outline"
                  className="h-9 text-xs"
                  onClick={() => { setBulkDeleteConfirming(false); setBulkDeleteTyped(""); }}
                  disabled={bulkDeleting}
                  data-testid="cons-bulk-delete-cancel"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Which fee the Fee Collected list is showing, and which side of it. Only here:
          this stage is the one place where a patient may owe or have paid up to four
          separate things, and everywhere else there is nothing yet to split. Each tab
          carries its own count under the current dropdown setting, so the questions the
          branch actually asks of this stage — who still owes physio, what came in from
          diet, where all five stand with rehab — are answered without opening a row, and
          at a glance rather than one desk per click.

          A row of its own under the toolbar, not inside it. Four tabs will not share that
          line with the search box and the range buttons at any width worth designing for,
          and this is a sub-tab bar over the list below — the same place, and the same
          shape, every other board puts one.

          Above both the phone cards and the desk table, because it governs both: it filters
          `filtered`, which each of them renders. */}
      {showDiscountColumn && feeTabsBar}

      {showMobileCards && (
        <div className="space-y-2 sm:hidden" data-testid="cons-mobile-cards">
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">
              {/* Head Physio browses this a day at a time; Branch Admin arrives filtered
                  by stage, where "on this day" would be describing a filter it isn't using.
                  A fee tab that has emptied says so first either way: on the phone as on the
                  desk, an empty Diet tab is nobody referred for a diet, not an empty day. */}
              {loading
                ? "Loading…"
                : showDiscountColumn && activeFee.key !== "consultation"
                  ? `No patients referred to ${activeFee.label} in this stage.`
                  : externalDate
                    ? "No patients on this day."
                    : "No patients in this stage yet."}
            </p>
          ) : filtered.map((l, i) => {
            const rowStage = rowStageName(l);
            const hex = stageColor(rowStage);
            const wa = waNumber(l.phone);
            return (
              // A div, not a button: the Call and WhatsApp actions below are interactive
              // themselves, and a button inside a button is markup the browser resolves
              // by dropping one of them.
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => { if (selectMode) toggleSelectOne(l.id); else { setSelectedLead(l); setDetailTab("overview"); } }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (selectMode) toggleSelectOne(l.id); else { setSelectedLead(l); setDetailTab("overview"); }
                }}
                className={`w-full cursor-pointer rounded-xl border p-3 text-left active:bg-slate-50 ${selectMode && selectedIds.has(l.id) ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}
                data-testid={`cons-card-${l.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {selectMode ? (
                        <input type="checkbox" checked={selectedIds.has(l.id)} readOnly className="mr-1.5 align-middle" data-testid={`cons-card-select-${l.id}`} />
                      ) : (
                        <span className="mr-1.5 font-semibold text-slate-300">{i + 1}.</span>
                      )}
                      {l.name || "—"}<LeadMarks lead={l} className="ml-1.5" /><RescheduledTag lead={l} className="ml-1.5" />
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
      {showDeskTable && (
      <Card className={`overflow-hidden border-slate-200 ${mobileCards ? "hidden sm:block" : ""}`}>
        {/* The rows scroll, the header does not. Capping the height here is what makes
            that possible: a sticky header sticks to its nearest scrolling ancestor, and
            with the old overflow-x-auto alone that ancestor grew with the table, so there
            was no vertical scroll of its own to stick against and the header rode up the
            page with the rows. Same shape as the Branch Leads list. */}
        <CardContent className="max-h-[65vh] overflow-auto p-0">
          {/* These percentages must add up to 100 — table-fixed scales every column down
              by any overage, so no column ends up the width it declared. The min-width is
              what lets the wrapper scroll on a narrow screen instead of crushing them. */}
          {/* Fee Collected is the stage where a negotiated Consultation Fee has become a
              fact, so the discount and total columns are added there alone — on every
              earlier stage there is no payment yet and they would be a row of dashes. */}
          <table className={`w-full table-fixed text-sm ${showFeeAction ? "min-w-[1160px]" : showDiscountColumn ? "min-w-[1060px]" : showConsultationAction ? "min-w-[980px]" : "min-w-[880px]"}`}>
            <thead className="sticky top-0 z-10 bg-slate-500 text-xs uppercase text-white">
              <tr>
                <th className={`${cols.sno} px-3 py-2 text-left align-middle`}>S.No</th>
                <th className={`${cols.patient} px-4 py-2 text-left align-middle`}>Patient Name</th>
                <th className={`${cols.appt} px-3 py-2 text-left align-middle`}>Appointment</th>
                <th className={`${cols.expert} px-4 py-2 text-left align-middle`}>
                  {showDiscountColumn ? "Consultant" : "Consultant Name"}
                </th>
                {/* Shortened on Fee Collected alone: that list carries three more columns than any
                    other stage, and the words the headings lose there — Consultation, Expert,
                    Applied — are the ones the column below already makes obvious. Every other
                    stage has the room and keeps the full wording. */}
                <th className={`${cols.stage} px-4 py-2 text-left align-middle`}>
                  {isConsultant ? "Live Stage" : showDiscountColumn ? "Stage" : "Consultation Stage"}
                </th>
                <th className={`${cols.phone} px-4 py-2 text-left align-middle`}>Phone</th>
                <th className={`${cols.pno} px-4 py-2 text-left align-middle`}>Patient No.</th>
                {/* Named for the tab rather than a bare "Collected": three tabs showing a
                    column of the same name is three lists that look identical. */}
                {showDiscountColumn && <th className={`${cols.collected} px-3 py-2 text-left align-middle`}>{activeFee.label} Fee</th>}
                {showDiscountColumn && <th className={`${cols.discount} px-3 py-2 text-left align-middle`}>Discount</th>}
                {showDiscountColumn && <th className={`${cols.total} px-3 py-2 text-left align-middle`}>Total Amount</th>}
                {/* The one column on this table that does something rather than reports
                    something, so it sits at the end where a row is finished being read. */}
                {/* Named for the fee the button under it actually collects, which is not
                    always the tab's own — see FEE_TABS' `action`. */}
                {showFeeAction && <th className={`${cols.action} px-3 py-2 text-left align-middle`}>{rowFeeSpec.label}</th>}
                {showConsultationAction && <th className={`${cols.action} px-3 py-2 text-left align-middle`}>Consultation Fee</th>}
              </tr>
            </thead>
            {/* Every cell top-aligns, and every single-line one carries leading-5 so its
                line box is the same twenty pixels as the name's. Patient is the only column
                with two lines in it — the name, then the plan under it — and align-middle
                centred that whole block while centring one line in each of its neighbours,
                which left the name sitting a third of a row above the Consultant, Phone and
                Patient No. it belongs to. Reading across a row meant reading a zigzag.

                The chips take vertical-align: top for the same reason: an inline-flex sits
                on the text baseline by default, so a bordered two-line chip hangs below the
                line everything else starts on. The appointment chip's py came down with it —
                py-1 put its first line three pixels under the name, py-0.5 puts it on it. */}
            <tbody>
              {filtered.map((l, i) => {
                const rowStage = rowStageName(l);
                const hex = stageColor(rowStage);
                return (
                  <tr
                    key={l.id}
                    onClick={() => { if (selectMode) toggleSelectOne(l.id); else { setSelectedLead(l); setDetailTab("overview"); } }}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selectMode && selectedIds.has(l.id) ? "bg-rose-50" : ""}`}
                    data-testid={`cons-row-${l.id}`}
                  >
                    <td className="px-3 py-3 align-top leading-5 text-slate-400">
                      {selectMode ? (
                        <input type="checkbox" checked={selectedIds.has(l.id)} readOnly data-testid={`cons-row-select-${l.id}`} />
                      ) : (
                        i + 1
                      )}
                    </td>
                    <td className="truncate px-4 py-3 align-top font-medium text-slate-800" title={l.name}>
                      <span className="block truncate">{l.name || "—"}<LeadMarks lead={l} className="ml-1.5" /><RescheduledTag lead={l} className="ml-1.5" /></span>
                      {/* What they are going away with, under the name. Reading it meant
                          opening every row: the Stage column says where the paperwork has
                          got to, not what was decided, and those are different questions.
                          Truncated with the whole of it on hover — this column is a tenth
                          of the table, and a plan can run to four services. */}
                      <PlanLine parts={leadPlanParts(l)} testId={`cons-plan-${l.id}`} />
                    </td>
                    {/* Date and time each own a line rather than wrapping wherever the
                        column happens to run out — so the dates stack in a straight
                        edge down the column instead of breaking at a different word
                        on every row. */}
                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs">
                      {l.appointment_date ? (
                        <span
                          className={`inline-flex max-w-full flex-col items-start rounded-md border px-2 py-0.5 align-top font-semibold ${appointmentTone(l.appointment_date)}`}
                          data-testid={`cons-appt-${l.id}`}
                        >
                          {/* Stacked, because this column is a narrow slice of a
                              fixed-layout table and the two on one line ran the chip
                              past its edge. The width is what the stacked pair was
                              sized for. */}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 shrink-0" />
                            {l.appointment_date}
                          </span>
                          {l.appointment_time && (
                            <span className="pl-4 text-[11px] font-bold opacity-90">{to12h(l.appointment_time)}</span>
                          )}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="truncate px-4 py-3 align-top leading-5 text-slate-600" title={l.assigned_physio_name}>{l.assigned_physio_name || "—"}</td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className="inline-flex max-w-full items-center gap-1 truncate rounded-[5px] px-2 py-0.5 align-top text-xs font-semibold"
                        style={{ background: `${hex}14`, color: hex, border: `1px solid ${hex}33` }}
                        title={rowStage || ""}
                      >
                        {rowStage || "—"}
                      </span>
                    </td>
                    <td className="truncate px-4 py-3 align-top leading-5 text-slate-600" title={l.phone}>{l.phone || "—"}</td>
                    <td className="truncate px-4 py-3 align-top font-mono text-xs leading-5 text-slate-500" title={l.patient_number}>{l.patient_number || "—"}</td>
                    {showDiscountColumn && (
                      // The amount this row contributes to the tab's total, with what it
                      // bought under it — a column of figures with no idea what was sold
                      // is a number nobody can check.
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs" data-testid={`cons-fee-${activeFee.key}-${l.id}`}>
                        {activeFee.paid(l) > 0 ? (
                          <span className="font-semibold leading-5" style={{ color: activeFee.tone }}>{rupees(activeFee.paid(l))}</span>
                        ) : (
                          // Nothing has come in at this desk for this patient. "Rs.0" reads
                          // as a fee of nothing that was collected rather than as a fee
                          // still owed, and on the Fees Non Collected list every row would
                          // be a column of zeroes saying it.
                          <span className="font-semibold leading-5 text-amber-600" data-testid={`cons-fee-pending-${l.id}`}>Not collected</span>
                        )}
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
                        <td className="whitespace-nowrap px-3 py-3 align-top text-xs">
                          {d ? (
                            <span
                              className="inline-flex items-center rounded-[5px] border border-amber-200 bg-amber-50 px-2 py-0.5 align-top font-semibold text-amber-700"
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
                    {showDiscountColumn && (
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-semibold leading-5 text-slate-700" data-testid={`cons-total-${l.id}`}>
                        {rupees(totalPaid(l))}
                      </td>
                    )}
                    {showFeeAction && (() => {
                      const t = feeStateOf(l, rowFee);
                      // Only asked about a fee that is genuinely still due — see rowFeeGate.
                      const gate = t.kind === "due" ? rowFeeGate(l, rowFee) : null;
                      return (
                        // stopPropagation on the cell, not just the button: the whole row
                        // opens the patient, and a click that lands a pixel beside the
                        // button would otherwise open the popup this button is a shortcut
                        // past. Nothing in here wants the row's own click.
                        <td
                          className="whitespace-nowrap px-3 py-3 align-top text-xs"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`cons-row-${rowFee}-${l.id}`}
                        >
                          {t.kind === "none" ? (
                            <span className="text-slate-300" title={t.hint}>—</span>
                          ) : t.kind === "paid" ? (
                            // Says so and stops there, exactly as the popup's card does. A
                            // fee that is in is not a thing to press.
                            <>
                              <span className="inline-flex items-center gap-1 rounded-[5px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 align-top font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> Paid
                              </span>
                              {t.mode && (
                                <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-300">{t.mode}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                // A blocked fee keeps its button — it is the way to the step
                                // that is blocking it — but drops out of the filled colours
                                // the collectable ones wear, so a row that cannot take money
                                // does not look like one that can.
                                className={`w-full ${gate
                                  ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  : t.kind === "balance"
                                  ? "bg-amber-500 text-white hover:bg-amber-600"
                                  : rowFeeSpec.tone} shadow-sm ${ACT_BTN}`}
                                title={gate?.hint}
                                onClick={() => openRowFee(l, rowFee)}
                                data-testid={`cons-row-${rowFee}-collect-${l.id}`}
                              >
                                {gate
                                  ? <AlertCircle className="mr-1 h-3.5 w-3.5 shrink-0" />
                                  : <IndianRupee className="mr-1 h-3.5 w-3.5 shrink-0" />}
                                {gate ? gate.label : t.kind === "balance" ? "Collect Balance" : "Collect"}
                              </Button>
                              {/* The figure the button is about, under it. A part-paid plan
                                  is the one case where "Collect" alone is a question rather
                                  than an instruction — how much, and by when. A blocked one
                                  names what is missing instead: the figure is not the thing
                                  standing in the way. */}
                              <span
                                className={`mt-1 block truncate text-[10px] font-medium ${gate ? "text-amber-600" : t.kind === "balance" && t.overdue ? "text-rose-600" : t.kind === "balance" ? "text-amber-600" : "text-slate-400"}`}
                                title={gate ? gate.hint : t.kind === "balance" && t.due ? `Due ${t.due}` : undefined}
                              >
                                {gate
                                  ? gate.note
                                  : t.kind === "balance"
                                  ? `${rupees(t.balance)} due${t.overdue ? " · overdue" : ""}`
                                  : t.amount != null ? rupees(t.amount) : "—"}
                              </span>
                            </>
                          )}
                        </td>
                      );
                    })()}
                    {showConsultationAction && (() => {
                      const c = consultationFeeStateOf(l);
                      // The prescription this fee waits on, still missing. The button stays
                      // on the row and stays pressable — it is the way to the uploader — but
                      // it says what it will actually do, in the same amber the panel's
                      // Documents tab wears while the same page is outstanding. A button
                      // labelled "Collect" that will not collect is the thing being fixed.
                      const rxMissing = c.kind !== "paid" && rxDue(l);
                      return (
                        // stopPropagation on the cell, not just the button: the whole row
                        // opens the patient, and a click that lands a pixel beside the
                        // button would otherwise open the popup this button is a shortcut
                        // past. Nothing in here wants the row's own click.
                        <td
                          className="whitespace-nowrap px-3 py-3 align-top text-xs"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`cons-row-consultation-${l.id}`}
                        >
                          {c.kind === "paid" ? (
                            // Says so and stops there, exactly as the popup's card does. A
                            // fee that is in is not a thing to press; correcting one is done
                            // from the patient, where the figure it is correcting is on screen.
                            <>
                              <span className="inline-flex items-center gap-1 rounded-[5px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 align-top font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> Paid
                              </span>
                              {c.mode && (
                                <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-300">{c.mode}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                className={`w-full ${rxMissing
                                  ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  : c.kind === "balance"
                                  ? "bg-amber-500 text-white hover:bg-amber-600"
                                  : "bg-sky-600 text-white hover:bg-sky-700"} shadow-sm ${ACT_BTN}`}
                                title={rxMissing ? "Upload the prescription before collecting the Consultation Fee" : undefined}
                                onClick={() => openRowConsultationFee(l)}
                                data-testid={`cons-row-consultation-collect-${l.id}`}
                              >
                                {rxMissing
                                  ? <FileText className="mr-1 h-3.5 w-3.5 shrink-0" />
                                  : <IndianRupee className="mr-1 h-3.5 w-3.5 shrink-0" />}
                                {rxMissing ? "Prescription" : c.kind === "balance" ? "Collect Balance" : "Collect"}
                              </Button>
                              {/* The figure the button is about, under it. A part-paid fee
                                  is the one case where "Collect" alone is a question rather
                                  than an instruction — how much, and by when. While the
                                  prescription is outstanding it says so instead: the figure
                                  is not the thing standing in the way. */}
                              <span
                                className={`mt-1 block truncate text-[10px] font-medium ${rxMissing ? "text-amber-600" : c.kind === "balance" && c.overdue ? "text-rose-600" : c.kind === "balance" ? "text-amber-600" : "text-slate-400"}`}
                                title={rxMissing ? "Upload the prescription before collecting the Consultation Fee" : c.kind === "balance" && c.due ? `Due ${c.due}` : undefined}
                              >
                                {rxMissing
                                  ? "Required first"
                                  : c.kind === "balance"
                                  ? `${rupees(c.balance)} due${c.overdue ? " · overdue" : ""}`
                                  : c.amount != null ? rupees(c.amount) : "—"}
                              </span>
                            </>
                          )}
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={showFeeAction ? 11 : showDiscountColumn ? 10 : showConsultationAction ? 8 : 7} className="px-4 py-8 text-center text-sm text-slate-400">
                  {loading
                    ? "Loading…"
                    // An empty tab is not an empty stage: saying "no leads in consultations"
                    // under a Diet tab reads as the board being broken rather than as nobody
                    // having bought a diet plan. Each dropdown setting empties for its own
                    // reason, so each says its own -- "nothing collected" under Fees Non
                    // Collected would be the opposite of what emptied it.
                    : showDiscountColumn
                      ? feeStatus === "pending"
                        ? `Every ${activeFee.label.toLowerCase()} fee here is collected.`
                        : feeStatus === "collected"
                          ? `No ${activeFee.label.toLowerCase()} fee collected${stageFilter ? "" : " yet"}.`
                          // On All a tab now empties because nobody was sent to that desk,
                          // which is not the same as the stage being empty -- and the
                          // Consultant tab, whose list is everyone here, can only mean it
                          // the old way. See FEE_TABS' `scope`.
                          : activeFee.key === "consultation"
                            ? "No patients in this stage yet."
                            : `No patients referred to ${activeFee.label} in this stage.`
                      : "No leads in consultations yet. Book an appointment with a CONSULTANT to populate this list."}
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      )}

      {/* Detail / move-stage dialog */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-2" onClick={(e) => { if (e.target === e.currentTarget) setSelectedLead(null); }} data-testid="cons-detail-dialog">
          {/* A floating card rather than a full-bleed sheet on a phone: edge to edge reads
              as a page you navigated to, with no backdrop to show it sits above the list
              and nothing beside it to tap to dismiss. Capped height, and tapping the
              backdrop closes — the same behaviour as every other popup on this board. */}
          <div className="max-h-[85dvh] w-full space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:max-h-[calc(100vh-1rem)] sm:w-[96vw] sm:max-w-5xl sm:p-5">
            {/* Who this is, then where they stand, side by side. The expert and the fee
                badge used to hang below the phone number, where stacked under the contact
                line they read as two more of the patient's details rather than as the
                state of their consultation.

                They sit against the identity block rather than out at the right margin: a
                header is read left to right, and pinning them to the far edge left a hand
                of white space in the middle and made two related blocks look like two
                unrelated ones. The rule between them is what marks them as a separate
                thing — which is the job the distance was failing to do. */}
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold text-slate-900" data-testid="cons-detail-title">
                  <span className="truncate">{selectedLead.name || "Lead"}</span>
                  {selectedLead.patient_number && (
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-500" data-testid="cons-detail-patient-number">{selectedLead.patient_number}</span>
                  )}
                </h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><Phone className="h-3 w-3 shrink-0" /> {selectedLead.phone || "—"}</span>
                  {selectedLead.appointment_date && (
                    <span className="flex items-center gap-1.5"><Calendar className="h-3 w-3 shrink-0" /> {selectedLead.appointment_date} {to12h(selectedLead.appointment_time)}</span>
                  )}
                </p>
              </div>
              {/* self-stretch runs the rule the full height of the identity block beside
                  it, so it reads as a division of the header rather than a tick mark
                  floating next to one line of it. */}
              {(selectedLead.assigned_physio_name || isConsultant) && (
                <div className="flex shrink-0 flex-col items-start gap-1 self-stretch border-l border-slate-200 pl-3" data-testid="cons-detail-standing">
                  {selectedLead.assigned_physio_name && (
                    <p className="text-xs font-medium text-emerald-600" data-testid="cons-detail-expert">Expert: {selectedLead.assigned_physio_name}</p>
                  )}
                  {isConsultant && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[10px] font-semibold ${
                        selectedLead.consultation_fee ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}
                      data-testid="cons-consultation-paid-badge"
                    >
                      {selectedLead.consultation_fee ? "Consultation Paid" : "Consultation Pending"}
                    </span>
                  )}
                </div>
              )}
              {/* Still the corner it has always been in, so ml-auto rather than a place in
                  the row — with nothing between it and the rule, the two blocks stay
                  together whatever width the header has. */}
              <button onClick={() => setSelectedLead(null)} className="ml-auto shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-detail-close"><XCircle className="h-4 w-4" /></button>
            </div>

            {/* Sub tabs */}
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-3" data-testid="cons-detail-tabs">
              {[
                { key: "overview", label: "Overview" },
                // Not for the Consultant, for the same reason the Timeline is not: chasing
                // a patient who did not pick up is the branch's errand, and scheduling the
                // next call is theirs to schedule. A Consultant is here to write up the
                // consultation in front of them.
                ...(isConsultant ? [] : [{ key: "followup", label: "Follow up" }]),
                { key: "documents", label: "Documents" },
                // The four uploads a case sheet closes on, and the only screen that can
                // verify them: the physio delivering the course gathers the clips, and
                // checking their own work would make the requirement prove nothing.
                { key: "progression", label: "Progression" },
                // Not for the Consultant. The timeline is every stage move, call attempt
                // and save on the lead — a branch's working record of how the patient got
                // here, and the people who wrote it are the ones who read it back. A
                // Consultant opening this popup is here to write a diagnosis, and eight
                // rows of "Branch stage: 'Branch Assign' -> 'RNR'" is not the case they
                // are being asked about.
                ...(isConsultant ? [] : [{ key: "timeline", label: "Timeline" }]),
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
                    /* No preset picker here. A diagnosis is written about one patient, so
                       a saved phrase to drop in is a phrase that fits somebody else — and
                       the dropdown and its Save sat above the box making the one thing
                       this card is for look like the second thing to do. The text saves
                       itself as it is typed, so there is nothing else to press. */
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

            {/* Treatment — Head Physio's own "Move to Admin". Requires Diagnosis Report +
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
              // Treatment is not one of five optional add-ons any more. What leaves this
              // form for Branch Admin is a treatment plan — sessions to book and a package
              // to collect against — so the tick, its package and its sessions/week are as
              // required as the two reports above. Ticked with no package, or a package
              // with no sessions/week, is the same gap as never having ticked it: the
              // branch gets a patient with nothing to book.
              const treatmentReady = !!decisionDraft.treatment
                && !!decisionDraft.item_id
                && !!selectedPackageWeeks
                && !!parseInt(decisionDraft.sessionsPerWeek, 10);
              // Diet asks nothing: the referral is to the Nutritionist's consultation,
              // which is the whole of what a Consultant decides on that side.
              //
              // Rehab does ask. It is a course of a named length at a named price, so a
              // patient referred to it with no package chosen reaches the branch with
              // nothing to book and nothing to collect -- the same gap Move to Admin is
              // held open for on the Treatment package above, held here the same way.
              const rehabReady = !decisionDraft.rehab || !!decisionDraft.rehab_item_id;
              const canSave = diagnosisReady && summaryReady && treatmentReady && rehabReady;

              // What the Consultant has ticked, in the shelf's own order. The detail column
              // is built from this rather than from five separate conditionals, so a card
              // can never appear for a service that is off, and the two columns cannot
              // disagree about what is selected.
              const selectedAddons = CONSULTATION_ADDONS.filter((a) => decisionDraft[a.key]);

              // Whether ticking a service opens a picker at all. Fitness has nothing to
              // decide, so clicking it selects and stops there rather than opening a popup
              // whose only content is a line saying there is nothing in it.
              const hasPicker = (key) => key !== "fitness";

              // Taking a service off clears whatever was picked under it, so an abandoned
              // choice can't be submitted once the picker holding it is gone.
              const clearAddon = (key) => {
                setDecisionDraft((d) => ({
                  ...d,
                  [key]: false,
                  ...(key === "treatment" ? { item_id: "", sessionsPerWeek: "" } : {}),
                  ...(key === "rehab" ? { rehab_item_id: "" } : {}),
                  ...(key === "zumba" ? { zumba_item_id: "" } : {}),
                  ...(key === "diet" ? { dietConsultation: false } : {}),
                }));
                setAddonPicker((cur) => (cur === key ? null : cur));
              };

              // Ticking a service is the same act as asking what it should be, so the
              // picker opens with it, and clicking a service already on is how you get
              // back to that picker. Nothing here turns a service off: removal is the ×
              // on its row in Selected, beside the choice actually being thrown away.
              const pickAddon = (key) => {
                // Ticking Diet is the referral, whole: there is nothing under it left to
                // answer, so the flag the wire and the labels read is set with it rather
                // than by a picker that would only ever have had one button in it.
                if (!decisionDraft[key]) setDecisionDraft((d) => ({ ...d, [key]: true, ...(key === "diet" ? { dietConsultation: true } : {}) }));
                if (hasPicker(key)) setAddonPicker(key);
              };

              /**
               * What one ticked service reads as in the Selected column: the choice in
               * words, and whether it is still missing something.
               *
               * Read off the same draft the pickers write to, so a row can never name a
               * package that was cleared. `incomplete` is the condition Confirm is
               * disabled on, said on the row it belongs to -- with the pickers behind a
               * popup, a form greyed out over an unanswered question would otherwise have
               * nothing on screen saying which question.
               */
              const addonSummary = (key) => {
                if (key === "treatment") {
                  const item = treatmentPackageItems.find((i) => i.id === decisionDraft.item_id);
                  if (!item) return { text: "Choose a package", incomplete: true };
                  const weeks = weeksFromPackageName(item.name);
                  const perWeek = parseInt(decisionDraft.sessionsPerWeek, 10) || 0;
                  if (!perWeek) return { text: `${item.name} — choose sessions/week`, incomplete: true };
                  return {
                    text: `${item.name} · ${perWeek}/week${weeks ? ` · ${weeks * perWeek} sessions` : ""}`,
                    incomplete: false,
                  };
                }
                if (key === "diet") {
                  // Nothing left to be missing. A Diet Chart, where the Nutritionist later
                  // calls for one, is recorded on the patient and shown on the branch's own
                  // panel — it was never something this form could answer.
                  return { text: "Diet Consultation", incomplete: false };
                }
                if (key === "rehab" || key === "zumba") {
                  const items = key === "rehab" ? rehabPackageItems : zumbaPackageItems;
                  const id = key === "rehab" ? decisionDraft.rehab_item_id : decisionDraft.zumba_item_id;
                  const item = items.find((i) => i.id === id);
                  // Zumba is a standing referral: the classes run either way, so no
                  // package there means the patient was sent to them without one bought up
                  // front. Rehab is a course or it is nothing -- ticked with no package it
                  // names no sessions, no price and nothing for the branch to book or
                  // collect, so the tick on its own is a gap rather than an answer.
                  if (!item) return key === "rehab"
                    ? { text: "Choose a package", incomplete: true }
                    : { text: "No package", incomplete: false };
                  const count = decisionDraft.mode === "online" ? item.sessions_online : item.sessions_offline;
                  const unit = key === "zumba" ? "classes" : "sessions";
                  return { text: `${item.name}${count ? ` · ${count} ${unit}` : ""}`, incomplete: false };
                }
                // Fitness, and anything added to the shelf later that carries no picker.
                return { text: "Referral only", incomplete: false };
              };

              /**
               * What one ticked service still needs decided.
               *
               * One function rather than five blocks stacked in the markup, because the
               * caller now renders these in a loop -- headed, coloured and ordered by the
               * shelf. The bodies are the pickers that were already here; what changed is
               * where they are drawn, not what they do or what they are called in a test.
               *
               * A service with nothing to choose says so rather than rendering an empty
               * card. Fitness is a referral and nothing else, and a card with a blank body
               * reads as a picker that failed to load.
               */
              const addonDetail = (key) => {
                if (key === "diet") {
                  return (
                    <div data-testid="cons-decision-diet-kinds">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Diet</label>
                      {/* One thing to refer for, so nothing to pick. This asked the
                          Consultant to choose between a Diet Consultation and a Diet Chart,
                          which is a question they are in no position to answer: a chart is
                          decided ON at the consultation, by the Nutritionist who sees the
                          patient. Ticked here it let the branch collect a Chart Fee for a
                          chart nobody had yet said was needed, and left the coach owing a
                          document somebody else had already sold.

                          So this says what the referral is and what follows it. The chart
                          re-enters from the Nutritionist's own board -- see
                          recommend_diet_chart -- and only then does a Diet Chart Fee appear
                          for the branch to collect. */}
                      <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] leading-relaxed text-orange-800" data-testid="cons-decision-diet-note">
                        The branch collects the Diet Consultation Fee and books the
                        Nutritionist. If this patient needs a Diet Chart, the Nutritionist
                        recommends it after seeing them — and the Diet Chart Fee is
                        collected then.
                      </p>
                    </div>
                  );
                }

                if (key === "rehab") {
                  return (
                    <div data-testid="cons-decision-rehab-package">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Rehab Package</label>
                      <div className="flex flex-wrap gap-2" data-testid="cons-decision-rehab-options">
                        {rehabPackageItems.map((i) => {
                          const selected = decisionDraft.rehab_item_id === i.id;
                          return (
                            <button
                              key={i.id}
                              type="button"
                              // Always a selection, never a clear. Rehab has to carry a
                              // package, so clicking the chosen one again would only put
                              // the form back into the state Confirm refuses -- the way
                              // out of Rehab is Remove Rehab, which says so on the button.
                              onClick={() => setDecisionDraft((prev) => ({ ...prev, rehab_item_id: i.id }))}
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
                      {/* Session count only, never the price -- the same rule the Treatment
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
                  );
                }

                if (key === "zumba") {
                  return (
                    <div data-testid="cons-decision-zumba-package">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Zumba Package <span className="font-normal text-slate-400">(optional)</span></label>
                      <div className="flex flex-wrap gap-2" data-testid="cons-decision-zumba-options">
                        {zumbaPackageItems.map((i) => {
                          const selected = decisionDraft.zumba_item_id === i.id;
                          return (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => setDecisionDraft((prev) => ({ ...prev, zumba_item_id: selected ? "" : i.id }))}
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
                  );
                }

                if (key === "treatment") {
                  return (
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Treatment Package</label>
                      <div className="flex flex-wrap gap-2" data-testid="cons-decision-package-options">
                        {treatmentPackageItems.map((i) => {
                          const selected = decisionDraft.item_id === i.id;
                          return (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => setDecisionDraft((prev) => ({ ...prev, item_id: i.id, sessionsPerWeek: "" }))}
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
                        // Head Physio sees the session count only -- never the price.
                        // The Treatment Fee amount is derived server-side from
                        // sessions_override and shown to Branch Admin at fee collection.
                        const weeks = weeksFromPackageName(item.name);
                        const perWeek = parseInt(decisionDraft.sessionsPerWeek, 10) || 0;
                        const totalSessions = weeks && perWeek ? weeks * perWeek : 0;
                        return (
                          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/70 p-3" data-testid="cons-decision-package-summary">
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
                                      onClick={() => setDecisionDraft((prev) => ({ ...prev, sessionsPerWeek: String(n) }))}
                                      className={`h-8 w-8 rounded-md border text-xs font-semibold transition ${
                                        selected ? "border-sky-500 bg-sky-500 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
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
                  );
                }

                // Fitness, and anything added to the shelf later that carries no picker.
                // Names itself, because the coloured edge is the only other thing marking
                // this block and a colour on its own is not a label.
                const addon = CONSULTATION_ADDONS.find((a) => a.key === key);
                return (
                  <p className="text-xs text-slate-500" data-testid={`cons-decision-detail-none-${key}`}>
                    <span className="font-semibold text-slate-600">{addon?.label || key}</span>
                    {" — nothing to choose here, recorded as a referral."}
                  </p>
                );
              };

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
                        dietConsultation: !!selectedLead.diet_consultation,
                        dietChart: !!selectedLead.diet_chart,
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
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="cons-decision-form">
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-800">
                    <ClipboardCheck className="h-4 w-4 text-sky-600" /> Treatment
                  </p>
                  {/* The thing standing between this form and Save, so it is a block that
                      stops the eye rather than a coloured line of text among other lines.
                      Rose over amber for the same reason: amber is the colour half this
                      panel already uses for asides nobody has to act on. */}
                  {(!diagnosisReady || !summaryReady || !treatmentReady) && (
                    <p
                      className="mb-3 rounded-md border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
                      data-testid="cons-decision-required-hint"
                    >
                      {/* One thing at a time, in the order the form is worked down: the two
                          reports are above this panel, Treatment is inside it, and naming
                          both at once sends the eye to the wrong half of the screen. */}
                      {!diagnosisReady || !summaryReady
                        ? "Write the Diagnosis Report and Treatment Summary above before Move to Admin."
                        : "Pick Treatment, its package and its sessions/week before Move to Admin."}
                    </p>
                  )}
                  {/* Consultation itself needs no toggle — writing this form up is the
                      consultation. Treatment is required: a consultation reaches Branch
                      Admin as a plan to book and collect against, so it is picked here and
                      cannot then be taken off. The other four are what else the patient is
                      going away with, and any combination of those is valid, including
                      none of them.

                      Two columns: the shelf on the left, what has actually been chosen on
                      the right, and the pickers themselves over the form in a popup. They
                      used to unroll under the shelf, one block per ticked service, so a
                      patient going away with three things meant three stacked pickers and
                      a Confirm button below all of them — picking the third service was a
                      scroll past the answers to the first two. Only one service is ever
                      being answered at a time, so only one picker is ever on screen, and
                      the form stays the height of its two short columns. */}
                  <div className="mb-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium text-slate-500">Services</label>
                      {/* A column rather than the row of five this was, so each service
                          lines up with its own answer opposite and the words are never
                          squeezed to a fifth of half the panel. */}
                      <div className="space-y-1.5" data-testid="cons-decision-plan-options">
                        {CONSULTATION_ADDONS.map((p) => {
                          const selected = !!decisionDraft[p.key];
                          const Icon = p.icon;
                          return (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => pickAddon(p.key)}
                              className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition hover:brightness-95"
                              style={selected
                                ? { background: `${p.tone}22`, color: p.tone, borderColor: p.tone, boxShadow: `inset 0 0 0 1px ${p.tone}` }
                                : { background: `${p.tone}14`, color: p.tone, borderColor: `${p.tone}33` }}
                              data-testid={`cons-decision-plan-${p.key}`}
                            >
                              <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{p.label}</span>
                              {/* The one service that has to be picked says so on the chip
                                  itself, where the choice is made. The hint at the top of
                                  the panel names the reports first while they are unwritten,
                                  so on a fresh consultation it is not saying this yet.
                                  Gone once Treatment is on — the tick says the rest. */}
                              {p.key === "treatment" && !selected && (
                                <span className="ml-auto shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-600">
                                  Required
                                </span>
                              )}
                              {selected && <CheckCircle2 aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* The answers, one row per ticked service, in the shelf's own order so
                        the rows read down in the order the services read down opposite. A
                        row is the way back into its picker; the × beside it is the only way
                        an optional service comes off, which puts removing one next to the
                        choice being thrown away rather than on the chip that turned it on.

                        Treatment's row has no ×. It is required, so the only thing its row
                        offers is the way back into the picker to change the package — a
                        cross there would be a button whose only outcome is a form that
                        cannot be submitted. */}
                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium text-slate-500">Selected Services</label>
                      {selectedAddons.length === 0 ? (
                        /* Nothing picked is not a valid outcome any more — Treatment is
                           required — so this column reads as the gap it is rather than as
                           a note about what saving now would do. Rose to match the hint at
                           the top of the panel: they are the same missing thing. */
                        <p
                          className="rounded-lg border border-dashed border-rose-200 bg-rose-50/40 px-3 py-3 text-[11px] font-medium text-rose-600"
                          data-testid="cons-decision-selected-empty"
                        >
                          Pick Treatment to move this patient to Admin.
                        </p>
                      ) : (
                        <div className="space-y-1.5" data-testid="cons-decision-details">
                          {selectedAddons.map((a) => {
                            const summary = addonSummary(a.key);
                            return (
                              <div
                                key={a.key}
                                className="flex items-center gap-1.5 rounded-r-lg border-l-2 bg-slate-50/70 py-1.5 pl-2.5 pr-1.5"
                                style={{ borderLeftColor: a.tone }}
                                data-testid={`cons-decision-detail-${a.key}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => pickAddon(a.key)}
                                  disabled={!hasPicker(a.key)}
                                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                                  data-testid={`cons-decision-selected-${a.key}`}
                                >
                                  <span className="block text-[11px] font-semibold" style={{ color: a.tone }}>{a.label}</span>
                                  <span
                                    className={`block truncate text-[11px] ${summary.incomplete ? "font-medium text-rose-600" : "text-slate-600"}`}
                                    title={summary.text}
                                  >
                                    {summary.text}
                                  </span>
                                </button>
                                {a.key === "treatment" ? (
                                  /* A pencil where every other row has its ×. Treatment
                                     cannot come off, so the only thing this row does is
                                     reopen the picker — and a row that ends in nothing
                                     reads as a row that does nothing. Decorative: the press
                                     target is the whole row beside it. */
                                  <Pencil aria-hidden className="mr-1.5 h-3 w-3 shrink-0 text-slate-400" />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => clearAddon(a.key)}
                                    className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                                    title={`Remove ${a.label}`}
                                    data-testid={`cons-decision-remove-${a.key}`}
                                  >
                                    <X aria-hidden className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* One service's picker, over the form. Rendered from inside the same
                      block that built addonDetail, so the popup can never open on a service
                      the form has since had turned off — it closes itself instead. */}
                  {addonPicker && (() => {
                    const a = CONSULTATION_ADDONS.find((x) => x.key === addonPicker);
                    if (!a || !decisionDraft[addonPicker]) return null;
                    // What this service still needs, read off the same helper the row in
                    // the form reads, so the popup and the row can never disagree about
                    // whether the choice has been made.
                    const pickerSummary = addonSummary(addonPicker);
                    const Icon = a.icon;
                    return (
                      <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                        onClick={(e) => { if (e.target === e.currentTarget) setAddonPicker(null); }}
                        data-testid="cons-decision-picker-modal"
                      >
                        <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
                          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                            <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: a.tone }}>
                              <Icon aria-hidden className="h-4 w-4" /> {a.label}
                            </p>
                            <button
                              type="button"
                              onClick={() => setAddonPicker(null)}
                              className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                              data-testid="cons-decision-picker-close"
                            >
                              <X aria-hidden className="h-4 w-4" />
                            </button>
                          </div>
                          {/* The pickers themselves, unchanged — same bodies, same test
                              ids, drawn here instead of down the form. */}
                          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{addonDetail(addonPicker)}</div>
                          <div className="flex shrink-0 justify-between gap-2 border-t border-slate-100 px-4 py-3">
                            {/* Required, so there is nothing to remove it with — the same
                                reason its row in Selected carries no ×. The empty span
                                holds Done on the right, where it is on every other
                                service's picker. */}
                            {addonPicker === "treatment" ? <span /> : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-rose-200 text-xs text-rose-600 hover:bg-rose-50"
                                onClick={() => clearAddon(addonPicker)}
                                data-testid="cons-decision-picker-remove"
                              >
                                Remove {a.label}
                              </Button>
                            )}
                            {/* Shut while the open picker is still missing something, so
                                the popup cannot be dismissed by the one button that reads
                                like the choice was made. The X and the backdrop still
                                close it -- this is not a trap, it is the difference
                                between leaving and finishing. */}
                            <Button
                              size="sm"
                              className="h-8 bg-blue-700 px-5 text-xs font-semibold hover:bg-blue-800"
                              onClick={() => setAddonPicker(null)}
                              disabled={pickerSummary.incomplete}
                              title={pickerSummary.incomplete ? pickerSummary.text : undefined}
                              data-testid="cons-decision-picker-done"
                            >
                              Done
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <Button
                    size="sm"
                    className="mt-4 h-9 bg-blue-700 px-5 text-xs font-semibold hover:bg-blue-800"
                    onClick={submitConsultationDecision}
                    disabled={savingDecision || !canSave}
                    data-testid="cons-decision-save"
                  >
                    {/* One label now, because there is one outcome. This branched three
                        ways over which services were ticked, back when a consultation
                        could leave here with no Treatment on it; with Treatment required,
                        every save hands the patient to Branch Admin — to collect the fees
                        and book the sessions — whatever else is ticked beside it. So the
                        button names the desk the patient lands on. */}
                    {savingDecision ? "Saving..." : "Move to Admin"}
                  </Button>
                </div>
              );
            })()}

            {/* What the Consultant decided, read back for the branch — sitting between the
                consultation's own two boxes and the panel that collects money against it.
                The Consultant has this card already (cons-decision-summary, above), but
                only they could see it: a Branch Admin opening a patient to take a fee saw
                the diagnosis and the treatment list and then a payment panel, with the
                plan those fees are FOR named nowhere on the screen. Read-only here — the
                decision is the Consultant's to change, and Edit stays on their card. */}
            {!isConsultant && !!selectedLead.consultation_decision && (() => {
              const weeks = weeksFromPackageName(selectedLead.session_package_name);
              const total = selectedLead.session_package_sessions || 0;
              const perWeek = weeks && total ? Math.round(total / weeks) : 0;
              const onTreatment = selectedLead.consultation_decision === "consultation_treatment";

              // One row per service the patient is going away with, in the shelf's own
              // order — built off the same lead fields addonsLabel reads, so the headline
              // and the rows under it cannot name different plans.
              const rows = [
                onTreatment && {
                  icon: Activity,
                  label: "Treatment Package",
                  value: selectedLead.session_package_name || "Not named",
                  note: perWeek && weeks
                    ? `${perWeek} weekly × ${weeks} week${weeks === 1 ? "" : "s"} = ${total} sessions`
                    : total ? `${total} sessions` : null,
                },
                selectedLead.diet_recommended && {
                  icon: Salad,
                  label: "Diet",
                  value: dietLabels({
                    diet: true,
                    dietConsultation: !!selectedLead.diet_consultation,
                    dietChart: !!selectedLead.diet_chart,
                  }).join(" + "),
                  note: null,
                },
                selectedLead.rehab_referred && {
                  icon: HeartPulse,
                  label: "Rehab Package",
                  value: selectedLead.rehab_package_name || "Referred",
                  note: selectedLead.rehab_package_sessions ? `${selectedLead.rehab_package_sessions} sessions` : null,
                },
                selectedLead.fitness_recommended && {
                  icon: Dumbbell,
                  label: "Fitness",
                  value: "Referred",
                  note: null,
                },
                selectedLead.zumba_recommended && {
                  icon: Music2,
                  label: "Zumba Plan",
                  value: selectedLead.zumba_package_name || "Referred",
                  note: null,
                },
              ].filter(Boolean);

              return (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="cons-treatment-suggestions">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                      <ClipboardCheck className="h-3.5 w-3.5" /> Treatment Suggestions
                    </p>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      From the Consultant
                    </span>
                  </div>

                  {/* The plan in one line first, then what each part of it actually is —
                      the same order the Consultant confirmed it in. */}
                  <p className="text-sm font-semibold text-slate-800" data-testid="cons-treatment-suggestions-plan">
                    {addonsLabel({
                      treatment: onTreatment,
                      diet: !!selectedLead.diet_recommended,
                      dietConsultation: !!selectedLead.diet_consultation,
                      dietChart: !!selectedLead.diet_chart,
                      rehab: !!selectedLead.rehab_referred,
                      fitness: !!selectedLead.fitness_recommended,
                      zumba: !!selectedLead.zumba_recommended,
                    })}
                  </p>

                  {rows.length > 0 ? (
                    <div className="mt-2 rounded-md border border-emerald-100 bg-white">
                      <dl className="divide-y divide-emerald-50">
                        {rows.map((r) => {
                          const Icon = r.icon;
                          return (
                            <div key={r.label} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                              <dt className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                                <Icon className="h-3 w-3 text-slate-400" /> {r.label}
                              </dt>
                              <dd className="min-w-0 truncate text-right text-xs font-semibold text-slate-800" title={r.value}>
                                {r.value}
                                {r.note && <span className="ml-1 font-medium text-slate-400">· {r.note}</span>}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">A plain consultation — nothing else was recommended.</p>
                  )}
                </div>
              );
            })()}

            {!isConsultant && (() => {
              const stage = selectedLead.consultation_stage;
              const decision = selectedLead.consultation_decision;
              // Cancel belongs before the consultation, not after it. A patient who has
              // not come in yet can call the appointment off, and that is what cancelling
              // one means. Once they have been seen the visit is a fact: the paperwork is
              // being filed against it and the fee taken for it, and a Cancel sitting in
              // that panel offers to call off something that already happened -- next to
              // the money it was collected with.
              //
              // So the stages before the visit keep it and the stages from the visit on do
              // not. CancelButton is null there, which is what the {CancelButton} slots in
              // those panels already render.
              // "Follow Up" is this stage's former name — see the panel below for why both
              // are still matched.
              const cancellable = ["New Appointment", "Consultation Booked", "Follow Up"].includes(stage);
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
              // The chart half of the referral, and no longer the Consultant's to start.
              // `chartReferred` comes on when the NUTRITIONIST recommends a chart, having
              // seen the patient — which is the only thing that puts a Diet Chart Fee on
              // this panel. It also comes on once such a fee is taken or a chart is sent, so
              // a chart sold or written off somebody's own judgement still shows here.
              const chartReferred = !!selectedLead.diet_chart;
              const dietChartFeePaid = selectedLead.diet_chart_fee_paid != null;
              const chartSent = !!selectedLead.diet_chart_sent_at;
              const DietButton = selectedLead.package_paid != null ? (
                <Button
                  size="sm"
                  variant={dietFeePaid && dietBooked ? "outline" : undefined}
                  className={`${dietFeePaid && dietBooked
                    ? "border-orange-200 text-orange-700 hover:bg-orange-50"
                    : "bg-orange-500 text-white hover:bg-orange-600"} ${ACT_BTN}`}
                  onClick={!dietFeePaid ? () => openDietFeeDraft("consultation") : openDietModal}
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
              const RehabButton = (selectedLead.package_paid != null && selectedLead.rehab_referred && selectedLead.rehab_package_id && !rehabFeePaid) ? (
                <Button
                  size="sm"
                  className={`bg-cyan-600 text-white hover:bg-cyan-700 ${ACT_BTN}`}
                  onClick={openRehabFeeDraft}
                  data-testid="cons-open-rehab-fee"
                >
                  <Activity className="mr-1 h-3.5 w-3.5" />{" "}
                  <Lbl full="Collect Rehab Fee" short="Rehab Fee" />
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
                      {/* The chart's own three rows, and only once a chart has actually been
                          called for. A Diet Chart is a second product on a second shelf at a
                          second price, so it gets its own fee line rather than sharing the
                          one above — which is also what the lead stores.

                          Nothing here until the Nutritionist recommends one. Until then
                          there is no chart to price, and a fee line offered against one
                          would be asking the desk to collect for a decision nobody has made.

                          The last row is the one the desk is actually asked about. A chart
                          the coach sent is not a chart the patient can see: unpaid, it is
                          held, and the person who has to say so is standing at this screen. */}
                      {chartReferred && (
                        <>
                          <DetailRow label="Diet Chart Package" value={selectedLead.diet_chart_package_name || "Not chosen yet"} />
                          <DetailRow
                            label="Diet Chart Fee"
                            value={dietChartFeePaid
                              ? `Rs.${Number(selectedLead.diet_chart_fee_paid).toLocaleString("en-IN")}${selectedLead.diet_chart_fee_payment_mode ? ` (${selectedLead.diet_chart_fee_payment_mode})` : ""}`
                              : (dietChartFeeDue != null ? `Rs.${Number(dietChartFeeDue).toLocaleString("en-IN")} — not collected` : "Not collected")}
                            tone={dietChartFeePaid ? "text-emerald-700" : "text-amber-700"}
                          />
                          <DetailRow
                            label="Diet Chart"
                            value={!chartSent
                              ? "Not sent yet"
                              : dietChartFeePaid
                              ? `Sent${selectedLead.diet_chart_sent_by ? ` by ${selectedLead.diet_chart_sent_by}` : ""}`
                              : "Sent — held until the fee is collected"}
                            tone={!chartSent ? "text-slate-500" : dietChartFeePaid ? "text-emerald-700" : "text-amber-700"}
                          />
                        </>
                      )}
                    </dl>
                  </div>
                  {/* The fee first and the nutritionist after it, because that is the order
                      the backend enforces — assign-diet refuses an unpaid patient, so
                      offering assignment first would be offering a dead end.

                      Once it is collected the fee button goes rather than turning into
                      "Update Diet Fee". Collecting is a step in that sequence and it is
                      done; what is left on this card is the appointment. The compact Diet
                      button above has always worked this way — it moves on to Assign and
                      then Reschedule — so this card was the one place still offering to
                      reopen a settled fee, next to a badge saying it was collected. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 [&>*]:shrink-0">
                    {!dietFeePaid && (
                      <Button
                        size="sm"
                        className={`bg-orange-500 text-white shadow-sm hover:bg-orange-600 ${ACT_BTN}`}
                        onClick={() => openDietFeeDraft("consultation")}
                        data-testid="cons-diet-detail-fee"
                      >
                        <IndianRupee className="mr-1 h-3.5 w-3.5" />
                        Collect Diet Fee
                      </Button>
                    )}
                    {/* Offered only once the Nutritionist has recommended a chart, and it
                        goes once collected — the same way the fee button above does, and for
                        the same reason: collecting is a step in a sequence and it is done.

                        Which puts it, in practice, after the consultation rather than beside
                        it: the recommendation is made at the appointment the fee above pays
                        for. It is not gated on that fee here, because the recommendation
                        cannot exist without it having happened. */}
                    {chartReferred && !dietChartFeePaid && (
                      <Button
                        size="sm"
                        className={`bg-orange-500 text-white shadow-sm hover:bg-orange-600 ${ACT_BTN}`}
                        onClick={() => openDietFeeDraft("chart")}
                        data-testid="cons-diet-detail-chart-fee"
                      >
                        <IndianRupee className="mr-1 h-3.5 w-3.5" />
                        Collect Diet Chart Fee
                      </Button>
                    )}
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
                    {/* Only while the course is unpaid. The Rehab Fee is taken in one go —
                        anything short of the listed price is recorded as a discount, not a
                        balance — so once it is in there is no rehab money left to collect,
                        and a button offering to take it again beside a line reading
                        "Rs.20,800 (cash)" only invites someone to overwrite the record. */}
                    {!rehabFeePaid && (
                      <Button
                        size="sm"
                        className={`bg-cyan-600 text-white shadow-sm hover:bg-cyan-700 ${ACT_BTN}`}
                        onClick={openRehabFeeDraft}
                        data-testid="cons-rehab-detail-fee"
                      >
                        <IndianRupee className="mr-1 h-3.5 w-3.5" />
                        Collect Rehab Fee
                      </Button>
                    )}
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
              // What the fee waits on. Not "has any document": that count goes up for a
              // scheme letter or an old MRI report, so a patient with paperwork on file
              // and no prescription would have opened the gate with somebody else's page.
              const hasRx = (leadRxCount || 0) > 0;

              // Step one, and only step one. No fees on this screen: somebody filing a
              // scan is filing a scan, and the figures belong to the step that can act on
              // them. What it does carry is the way on to that step, once there is
              // something on file to carry them there.
              const DocumentsBody = (
                <div className="space-y-4" data-testid="cons-documents-body">
                  {docsRequired && !hasRx && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>Upload the prescription before collecting the fee — the photo or scan is the record of what the Consultant prescribed.</span>
                    </p>
                  )}
                  {/* Its own uploader above the general pile, not a row inside it. This is
                      the document the fee waits on, so it is asked for by name: a panel
                      that says "documents" and means one particular document is how a
                      scheme letter gets filed and the gate stays shut with nothing on
                      screen explaining why. */}
                  <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3" data-testid="cons-prescription-block">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-sky-800">
                        <FileText className="h-3.5 w-3.5" />Prescription
                        {docsRequired && <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-sky-700">Required to collect the fee</span>}
                      </p>
                      {hasRx && <span className="shrink-0 text-[11px] font-semibold text-emerald-600" data-testid="cons-prescription-done">On file</span>}
                    </div>
                    <LeadDocuments
                      leadId={selectedLead.id}
                      kind="prescription"
                      fixedLabel="Prescription"
                      canEdit={["branch_admin", "super_admin", "head_physio"].includes(viewerRole)}
                      onChanged={notePrescriptionCount}
                    />
                  </div>
                  {/* Only the prescription lives here. Everything else the patient has on
                      file — reports, scans, scheme letters — is filed and read in the
                      Documents tab at the top of the card: this panel exists to clear the
                      one page the fee waits on, and a second uploader beside it invites
                      the scheme letter that leaves the gate shut with nothing on screen
                      explaining why. */}
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
                  className={`${programmeDetail === "diet" ? "border-orange-600 bg-orange-600 text-white shadow-sm hover:bg-orange-700 hover:text-white" : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"} ${ACT_BTN}`}
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
                  className={`${programmeDetail === "rehab" ? "border-cyan-600 bg-cyan-600 text-white shadow-sm hover:bg-cyan-700 hover:text-white" : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"} ${ACT_BTN}`}
                  onClick={() => openDetail("rehab")}
                  data-testid="cons-open-rehab-detail"
                >
                  <Activity className="mr-1 h-3.5 w-3.5" />
                  <Lbl full="Rehab Details" short="Rehab" />
                </Button>
              ) : null;

              // A panel's own tab is only a tab when there is somewhere else to go. On a
              // patient with no diet and no rehab it was a tab bar of one: a button that
              // takes you to the view you are already looking at, sitting in the row above
              // the button that does the panel's actual work -- so Fee Collected showed
              // "Assign Physio" up top and "Reassign Physio" below, and only one of them
              // assigned anybody.
              //
              // The second half is what keeps it safe. Off the own view -- Documents is
              // reachable with no diet and no rehab in sight -- this tab is the only way
              // back, so it returns the moment it is the way back rather than a no-op.
              const showOwnTab = !!(DietDetailButton || RehabDetailButton) || programmeDetail !== "own";

              // The tab for a panel's own stage. Each panel names it for what it holds —
              // "Assign Physio" on Fee Collected — because "Overview" would tell the reader
              // nothing about which of the three views they are on.
              // Filled, so which step is open is read at a glance rather than found. Used by every
  // tab on this row so the selected one always looks the same, whichever it is.
  const TAB_ON = "border-sky-600 bg-sky-600 text-white shadow-sm hover:bg-sky-700 hover:text-white";

  const OwnTab = ({ label, short, icon: TabIcon, active, locked = false, lockedTitle }) => (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked}
                  title={locked ? lockedTitle : undefined}
                  className={`${locked
                    ? "border-slate-200 bg-slate-50 text-slate-400"
                    : programmeDetail === "own" ? active : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"} ${ACT_BTN}`}
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

              // Every fee this patient has been quoted, one card each, in the order the
              // fees are taken. It lives out here rather than inside a stage branch
              // because collecting the Consultation Fee moves the lead from Consultation
              // Visit to Fee Collected, and the Branch Admin who just took that fee is
              // still standing in front of the person who owes the next one. Fee Collected
              // used to answer with a panel of a different shape — the same fees as flat
              // rows, the collect button moved up into the tab row — so taking two fees off
              // one patient meant reading two screens for the same job. The cards stay put
              // now: the fee just paid ticks over, and the next one lights up where it
              // already was.
              const consultationPaid = selectedLead.package_paid != null;
              const treatmentFeePaid = selectedLead.treatment_fee_paid != null;

              // Where a Partial Payment plan currently stands — the next installment, what
              // is still owed, and whether it is late. Worked out once, for the Treatment
              // Fee card here and for the balance note Fee Collected prints under the grid.
              const partialPlan = feeBalances.treatment || null;

              // What a card says and does when that fee has been part collected: it is
              // neither settled nor untouched, so it names the balance instead of ticking
              // itself green, and its button collects that balance under any mode.
              const balanceStep = (fee, fallbackAct, fallbackLabel) => {
                const plan = feeBalances[fee];
                if (!plan) return { paid: undefined, pending: null, pendingTone: "text-amber-600", act: fallbackAct, actLabel: fallbackLabel };
                return {
                  paid: false,
                  pending: `Rs.${Number(plan.balance).toLocaleString("en-IN")} balance${plan.next?.due_date ? ` · due ${plan.next.due_date}` : ""}`,
                  pendingTone: plan.overdue ? "text-rose-600" : "text-amber-600",
                  act: () => openPartialCollectPopup(plan.nextIdx, fee),
                  actLabel: "Collect Balance",
                };
              };

              // Each fee is gated on the patient actually being on that programme —
              // quoting diet or rehab to everyone would overstate what is owed.
              const feeSteps = [
                {
                  key: "consultation",
                  label: "Consultation Fee",
                  amount: selectedLead.package_price,
                  paid: consultationPaid,
                  note: consultationPaid ? selectedLead.package_payment_mode : null,
                  show: true,
                  ...balanceStep("consultation", openCollectFeeDraft, "Collect"),
                  // A part-paid fee is still "paid" for everything gated on it — the
                  // patient is through the door — so the tick is only withheld while a
                  // balance is actually outstanding.
                  ...(feeBalances.consultation ? {} : { paid: consultationPaid }),
                },
                {
                  key: "treatment",
                  label: "Treatment Fee",
                  sub: selectedLead.session_package_name
                    ? `${selectedLead.session_package_name}${selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}`
                    : null,
                  amount: selectedLead.session_package_price,
                  // A part-paid plan has money in and a balance still owed, so it is
                  // neither collected nor untouched: the card keeps its button and names
                  // the installment that is due instead of ticking itself green.
                  paid: treatmentFeePaid && !partialPlan,
                  note: treatmentFeePaid ? selectedLead.treatment_fee_payment_mode : null,
                  pending: partialPlan
                    ? `${savedInstallments.filter((i) => i.paid).length} of ${savedInstallments.length} in · balance Rs.${Number(partialPlan.balance).toLocaleString("en-IN")}`
                    : null,
                  pendingTone: partialPlan && partialPlan.overdue ? "text-rose-600" : "text-amber-600",
                  show: decision === "consultation_treatment",
                  act: partialPlan ? () => openPartialCollectPopup(partialPlan.nextIdx) : openTreatmentFeeDraft,
                  actLabel: partialPlan ? `Collect ${installmentLabelFor(partialPlan.nextIdx)}` : "Collect",
                },
                {
                  key: "rehab",
                  label: "Rehab Fee",
                  sub: selectedLead.rehab_package_name,
                  amount: selectedLead.rehab_fee_paid != null ? selectedLead.rehab_fee_paid : selectedLead.rehab_package_price,
                  paid: selectedLead.rehab_fee_paid != null,
                  note: selectedLead.rehab_fee_paid != null ? selectedLead.rehab_fee_payment_mode : null,
                  show: !!selectedLead.rehab_referred,
                  // Collected on the Rehab tab, which carries the course as well as the
                  // figure — this card is the pointer to it. A balance is different: it
                  // is one figure to take, so the card takes it.
                  ...balanceStep("rehab", () => openDetail("rehab"), "Open"),
                  ...(feeBalances.rehab ? {} : { paid: selectedLead.rehab_fee_paid != null }),
                },
                {
                  key: "diet",
                  label: "Diet Fee",
                  sub: selectedLead.diet_package_name,
                  amount: selectedLead.diet_fee_paid != null ? selectedLead.diet_fee_paid : dietFeeDue,
                  paid: selectedLead.diet_fee_paid != null,
                  note: selectedLead.diet_fee_paid != null ? selectedLead.diet_fee_payment_mode : null,
                  show: !!selectedLead.diet_recommended,
                  // Straight into the collect popup, not across to the Diet tab. This card
                  // sits under a heading that says Collect a Payment, on a panel opened to
                  // take money — so "Open" spent a click moving the Branch Admin to a
                  // programme view whose only unpaid action was the same button under
                  // another name. The Rehab card still points at its tab because the course
                  // is chosen there; the Diet Package is chosen inside the popup itself.
                  ...balanceStep("diet", () => openDietFeeDraft("consultation"), "Collect"),
                  ...(feeBalances.diet ? {} : { paid: selectedLead.diet_fee_paid != null }),
                },
                {
                  // Its own card rather than a second figure inside the Diet one. A patient
                  // sold both would otherwise read one total they cannot match against
                  // either receipt, on the card whose whole job is saying what they owe.
                  //
                  // Shown only where the chart was actually ticked, so it stays off every
                  // patient who was referred for the consultation alone.
                  key: "diet_chart",
                  label: "Diet Chart Fee",
                  sub: selectedLead.diet_chart_package_name,
                  amount: selectedLead.diet_chart_fee_paid != null ? selectedLead.diet_chart_fee_paid : dietChartFeeDue,
                  paid: selectedLead.diet_chart_fee_paid != null,
                  note: selectedLead.diet_chart_fee_paid != null ? selectedLead.diet_chart_fee_payment_mode : null,
                  show: !!selectedLead.diet_chart,
                  ...balanceStep("diet_chart", () => openDetail("diet"), "Open"),
                  ...(feeBalances.diet_chart ? {} : { paid: selectedLead.diet_chart_fee_paid != null }),
                },
              ].filter((f) => f.show);

              // The one fee that can be taken right now. Everything after the Consultation
              // Fee waits on it — the server's rule, not a habit of this screen — so only
              // that card gets the filled button and the rest stay quiet outlines.
              const nextFeeStep = feeSteps.find((f) => !f.paid && (f.key === "consultation" || consultationPaid));

              // And the Consultation Fee itself waits on the prescription — the server's
              // rule too, since collect-package-payment refuses without it.
              //
              // The tab above these cards is already locked while the page is missing, but
              // that lock only closes once the count has arrived: leadRxCount is null until
              // the fetch lands, the effect that jumps to Documents waits for it, and the
              // cards render in the meantime with a live Collect button on them. Reading the
              // null as "no prescription" here is the safe way round — a card that waits a
              // moment for an answer costs nothing, and one that collects before the answer
              // arrives is the bug.
              const consultationRxBlocked = docsRequired && !consultationPaid && !hasRx;

              const FeeSteps = (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="cons-fee-steps">
                  {feeSteps.map((f, i) => (
                    <div
                      key={f.key}
                      className={`flex flex-col gap-2 rounded-lg border p-3 ${
                        f.paid ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"
                      }`}
                      data-testid={`cons-fee-step-${f.key}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          f.paid ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
                        }`}>
                          {f.paid ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-700">{f.label}</p>
                          {f.sub ? <p className="truncate text-[11px] text-slate-400" title={String(f.sub)}>{f.sub}</p> : null}
                        </div>
                      </div>
                      <p className="text-lg font-extrabold leading-none text-slate-800">
                        {f.amount != null ? `Rs.${Number(f.amount).toLocaleString("en-IN")}` : "—"}
                      </p>
                      {f.paid ? (
                        <span className="text-[11px] font-medium capitalize text-emerald-700">
                          {f.note ? `Paid · ${f.note}` : "Paid"}
                        </span>
                      ) : (
                        <>
                          {f.pending ? <span className={`text-[11px] font-medium ${f.pendingTone}`}>{f.pending}</span> : null}
                          <Button
                            size="sm"
                            variant={nextFeeStep && f.key === nextFeeStep.key ? undefined : "outline"}
                            /* Everything after the consultation fee waits on it, and the
                               consultation fee waits on the prescription. Both say so
                               rather than failing when pressed. */
                            disabled={f.key === "consultation" ? consultationRxBlocked : !consultationPaid}
                            title={f.key === "consultation"
                              ? (consultationRxBlocked ? "Upload the prescription first" : undefined)
                              : (!consultationPaid ? "Collect the consultation fee first" : undefined)}
                            className={`w-full ${nextFeeStep && f.key === nextFeeStep.key ? "bg-sky-600 text-white hover:bg-sky-700" : ""} ${ACT_BTN}`}
                            onClick={f.act}
                            data-testid={`cons-fee-act-${f.key}`}
                          >
                            {f.actLabel}
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              );

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

                // Diet Consultation and Diet Chart are the same kind of pill as Rehab —
                // nothing writes either, a patient is under one because they are on a diet
                // plan — so both open the diet programme rather than whatever stage the
                // lead happens to sit at. One panel because they are one programme with two
                // fee lines, not two — see DietDetailBody below.
                if ((stageFilter === "Diet Consultation" || stageFilter === "Diet Chart") && selectedLead.diet_recommended) {
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
                      // A fee part collected is neither of the two states this chip had:
                      // it is not due from scratch, and it is not collected. It says what
                      // is left, because that is the number somebody has to chase.
                      chip={
                        programmeDetail === "rehab" ? (
                          <PanelChip tone={feeBalances.rehab || selectedLead.rehab_fee_paid == null ? "amber" : "emerald"} tick={!feeBalances.rehab && selectedLead.rehab_fee_paid != null}>
                            {feeBalances.rehab
                              ? `Balance Rs.${Number(feeBalances.rehab.balance).toLocaleString("en-IN")}`
                              : selectedLead.rehab_fee_paid != null ? "Fee Collected" : "Rehab Fee Due"}
                          </PanelChip>
                        ) : (
                          <PanelChip tone={feeBalances.diet || !dietFeePaid ? "amber" : "emerald"} tick={!feeBalances.diet && dietFeePaid}>
                            {feeBalances.diet
                              ? `Balance Rs.${Number(feeBalances.diet.balance).toLocaleString("en-IN")}`
                              : dietFeePaid ? "Fee Collected" : "Diet Fee Due"}
                          </PanelChip>
                        )
                      }
                      tabs={
                        programmeDetail === "rehab" ? (
                          <>
                            <OwnTab label="Rehab Details" short="Rehab" icon={Activity} active="border-cyan-600 bg-cyan-600 text-white shadow-sm hover:bg-cyan-700 hover:text-white" />
                            {DietDetailButton}
                            {CancelButton}
                          </>
                        ) : (
                          <>
                            <OwnTab label="Diet Details" short="Diet" icon={Salad} active="border-orange-600 bg-orange-600 text-white shadow-sm hover:bg-orange-700 hover:text-white" />
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

                // "Follow Up" is the name this stage used to carry, and is still matched:
                // the rename happens in a backend migration on its own restart, so for a
                // window either label can be on a lead. Matching one alone would leave the
                // patients booked in that window looking at a card with no panel under it.
                if (stage === "Consultation Booked" || stage === "Follow Up") {
                  // What the patient was actually booked for. A consultation follow-up
                  // scheduled from this board writes one of these entries; an appointment
                  // booked from Branch Leads -- which is how most patients arrive at this
                  // stage -- writes the lead's own appointment fields and no entry at all,
                  // so reading the entry alone left the commonest case saying nothing about
                  // when the patient is expected.
                  const bookedFor = activeFollowUp
                    ? `${activeFollowUp.date} at ${activeFollowUp.time}`
                    : selectedLead.appointment_date
                      ? `${selectedLead.appointment_date}${selectedLead.appointment_time ? ` at ${selectedLead.appointment_time}` : ""}`
                      : null;
                  return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="cons-stage-panel-followup">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                        <Bell className="h-3.5 w-3.5" /> Consultation Booked
                      </p>
                      <p className="mb-2 text-xs text-slate-600">
                        {bookedFor ? `Booked for ${bookedFor} — waiting on the CONSULTANT.` : "Waiting on the CONSULTANT."}
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
                  return (
                    <StagePanel
                      tone={detailView ? detailView.tone : "sky"}
                      icon={detailView ? detailView.icon : IndianRupee}
                      title={detailView ? detailView.title : "Collect a Payment"}
                      testid="cons-stage-panel-consultation-visit"
                      chip={detailView ? (
                        <PanelChip tone={detailView.chip.tone} tick={detailView.chip.tick}>{detailView.chip.label}</PanelChip>
                      ) : consultationPaid ? (
                        <PanelChip tone="emerald" tick>Consultation Fee In</PanelChip>
                      ) : (
                        <PanelChip>Payment Due</PanelChip>
                      )}
                      tabs={
                        <>
                          {/* The order is the order it happens in: the paperwork is filed,
                              then the money is taken against it. Documents leads because it
                              is the step that gates the other one — a row that opens on a
                              payment it will not let you take is a row that reads as
                              broken. */}
                          <Button
                            size="sm"
                            variant="outline"
                            className={`${programmeDetail === "documents"
                              ? TAB_ON
                              : hasRx
                              ? "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"
                              : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"} ${ACT_BTN}`}
                            onClick={() => openDetail("documents")}
                            data-testid="cons-open-documents"
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            {/* Amber until the prescription is in, whatever else is on
                                file: the colour is about the step that is outstanding, and
                                a scheme letter does not finish this one. */}
                            <Lbl full={!hasRx ? "Prescription — required" : leadDocCount == null ? "Documents" : `Documents (${leadDocCount})`} short="Docs" />
                          </Button>
                          {/* Always on screen, and shut until the scan is filed. This panel
                              is a sequence — paperwork, then money — so a step that
                              disappears once you reach it takes the shape of the sequence
                              with it, and one that opens on a payment it will not take asks
                              for something and refuses it in the same breath. */}
                          <OwnTab
                            label={consultationPaid ? "Payment" : "Collect Fees"}
                            short="Fees"
                            icon={IndianRupee}
                            active={TAB_ON}
                            locked={docsRequired && !hasRx && !consultationPaid}
                            lockedTitle="Upload the prescription first"
                          />
                          {DietDetailButton}
                          {RehabDetailButton}
                          {CancelButton}
                        </>
                      }
                    >
                      {/* Each tab is its own step and shows only that step. The fees do not
                          appear over the uploader: somebody filing a scan is filing a scan,
                          and a figure on that screen is a figure they cannot act on yet. */}
                      {detailBody || FeeSteps}
                    </StagePanel>
                  );
                }

                if (stage === "Fee Collected") {
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
                          {FeeSteps}
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
                  // Money is taken on the cards below, each fee on its own. What is left
                  // for the tab row is the schedule behind a part-paid Treatment Fee —
                  // a view of what was agreed, not another way to collect it.
                  const FeeActions = partialPlan ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className={`border-slate-200 bg-white/70 text-slate-600 hover:bg-white ${ACT_BTN}`}
                      onClick={openPartialScheduleDraft}
                      data-testid="cons-open-partial-schedule-sidebar"
                    >
                      <Calendar className="mr-1 h-3.5 w-3.5" />
                      <Lbl full="Payment Schedule" short="Schedule" />
                    </Button>
                  ) : null;

                  return (
                    <StagePanel
                      /* The heading follows the work rather than the stage name. A lead
                         lands here the moment the Consultation Fee is taken, usually with
                         the Treatment Fee still to come — and the Branch Admin taking it
                         is mid-job, not looking at a receipt. While a fee is still due
                         this stays the payment screen it was a click ago; once the last
                         one is in it becomes what the pipeline calls it. */
                      tone={detailView ? detailView.tone : nextFeeStep ? "sky" : "indigo"}
                      icon={detailView ? detailView.icon : nextFeeStep ? IndianRupee : ClipboardCheck}
                      title={detailView ? detailView.title : nextFeeStep ? "Collect a Payment" : "Fee Collected"}
                      testid="cons-stage-panel-fee-collected"
                      chip={detailView ? (
                        <PanelChip tone={detailView.chip.tone} tick={detailView.chip.tick}>{detailView.chip.label}</PanelChip>
                      ) : partialPlan ? (
                        <PanelChip tone={partialPlan.overdue ? "rose" : "amber"}>{partialPlan.overdue ? "Balance Overdue" : "Part-paid"}</PanelChip>
                      ) : treatmentFeePaid ? (
                        <PanelChip tone="emerald" tick>Both Fees Collected</PanelChip>
                      ) : (
                        <PanelChip>Treatment Fee Due</PanelChip>
                      )}
                      tabs={
                        <>
                          {FeeActions}
                          {treatmentFeePaid && showOwnTab && <OwnTab label="Assign Physio" short="Physio" icon={Users} active="border-violet-600 bg-violet-600 text-white shadow-sm hover:bg-violet-700 hover:text-white" />}
                          {/* No Diet tab on this row. The Diet Fee card below is the way
                              into the diet programme from here — a button in the tab row
                              as well put the same view two doors apart on one screen,
                              above a panel whose job right now is the fee that is due. */}
                          {RehabDetailButton}
                          {CancelButton}
                        </>
                      }
                    >
                      {detailBody || (
                        <>
                          {FeeSteps}

                          {/* What is still owed and when it is due, across every fee that
                              has a balance — the cards above are what collect them. */}
                          {allBalances && (
                            <div className={`mt-2 rounded-lg border px-3 py-2 ${allBalances.overdue ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`} data-testid="cons-partial-balance-summary">
                              <div className="flex items-center justify-between">
                                <span className={`text-[11px] font-semibold ${allBalances.overdue ? "text-rose-700" : "text-amber-700"}`}>Balance Amount</span>
                                <span className={`text-sm font-bold ${allBalances.overdue ? "text-rose-700" : "text-amber-700"}`}>Rs.{Number(allBalances.total).toLocaleString("en-IN")}</span>
                              </div>
                              {/* One line per fee still owed, because a patient can owe on
                                  two at once and a single total says nothing about which
                                  card to press. */}
                              {allBalances.plans.map((plan) => (
                                <p key={plan.fee} className={`mt-0.5 text-[10px] ${plan.overdue ? "text-rose-600" : "text-amber-600"}`}>
                                  {FEE_LABELS[plan.fee]} · {plan.fee === "treatment" ? installmentLabelFor(plan.nextIdx) : "Balance"}
                                  {plan.next.sessions ? ` · ${plan.next.sessions} sessions` : ""}
                                  {plan.next.amount != null ? ` · Rs.${plan.next.amount}` : ""}
                                  {plan.next.due_date ? ` · due ${plan.next.due_date}` : ""}
                                  {plan.overdue ? " · OVERDUE" : ""}
                                </p>
                              ))}
                            </div>
                          )}

                          {DietStatus}

                          {treatmentFeePaid && (
                            <>
                              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                                {/* A Partial Payment plan reaches here with money in but a
                                    balance still owed, and this line read "Both fees
                                    collected" over a Balance Amount card saying otherwise. */}
                                {partialPlan
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
                                  {/* Never "Reassign" here. assigned_physio_name is written
                                      when the appointment is booked -- it is the physio who
                                      took the consultation, set by the Branch Admin long
                                      before anyone picks who delivers the treatment -- so
                                      reading it as "a physio is already assigned" made this
                                      button say Reassign for every patient who ever had a
                                      consultation, which is all of them.

                                      The stage is the honest test and it needs no field:
                                      assign-consultation-physio is what moves a lead off
                                      Fee Collected, so a lead sitting on this panel has no
                                      treatment physio yet. Reassigning belongs to the
                                      Physio Assign panel below, where the name does mean
                                      what it says. */}
                                  Assign Physio
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
                  // The course as sold and the course as delivered. Both are counted off
                  // the session rows themselves — the board stamps them onto every lead it
                  // returns (see _stamp_session_progress), and the physio-progress fetch
                  // recounts the same rows — so this panel and the physio's own board can
                  // never disagree about how far in a patient is.
                  const totalCourseSessions = physioProgress?.package_sessions
                    || selectedLead.session_package_sessions
                    || selectedLead.total_sessions
                    || 0;
                  const courseCompleted = physioProgress?.completed_sessions ?? (selectedLead.completed_sessions || 0);
                  const courseRemaining = Math.max(0, totalCourseSessions - courseCompleted);
                  const coursePct = totalCourseSessions > 0
                    ? Math.min(100, Math.round((courseCompleted / totalCourseSessions) * 100))
                    : 0;
                  const courseDone = totalCourseSessions > 0 && courseRemaining === 0;
                  // No tab row on this panel. Physio Assign is one view -- the course and
                  // who is delivering it -- so the Treatment / Diet Details pair sitting
                  // above it was a tab bar whose first tab only ever returned to the view
                  // already on screen. With nothing left to switch to, the panel renders
                  // its own stage whatever programmeDetail is carrying from the last lead
                  // that was open, rather than a diet body with no way back.
                  return (
                    <StagePanel
                      tone={assigned ? "emerald" : "violet"}
                      icon={Users}
                      title="Physio Assign"
                      testid="cons-stage-panel-physio-assign"
                      chip={assigned ? (
                        <PanelChip tone="emerald" tick>Sessions In Progress</PanelChip>
                      ) : (
                        <PanelChip>Physio Not Assigned</PanelChip>
                      )}
                    >
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
                        {/* The two numbers this card is opened for. Sessions Completed
                            carries what is left rather than making the reader subtract,
                            because "4 left" is the thing the branch acts on. */}
                        <PanelRow label="Total Sessions" value={totalCourseSessions || "—"} />
                        <PanelRow
                          label="Sessions Completed"
                          value={`${courseCompleted} of ${totalCourseSessions || "—"}`}
                          tone={courseCompleted > 0 ? "text-emerald-700" : ""}
                          note={totalCourseSessions > 0 ? (courseDone ? "course complete" : `${courseRemaining} left`) : ""}
                          noteTone={courseDone ? "text-emerald-600" : "text-slate-500"}
                        />
                        {selectedLead.diet_coach_name && (
                          <PanelRow
                            label="Diet Consultation"
                            value={`${selectedLead.diet_coach_name}${selectedLead.diet_appointment_at ? ` · ${dayLabel(selectedLead.diet_appointment_at.split("T")[0])} at ${to12h(selectedLead.diet_appointment_at.split("T")[1])}` : ""}`}
                          />
                        )}
                      </PanelCard>

                      {/* The same two numbers as one length, so how far in the patient
                          is reads at a glance instead of by subtraction. */}
                      {totalCourseSessions > 0 && (
                        <div className="mt-2" data-testid="cons-physio-assign-progress">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${coursePct}%` }} />
                          </div>
                          <p className="mt-1 text-[10px] font-medium text-slate-500">
                            {coursePct}% of the course delivered
                            {courseRemaining > 0 ? ` · ${courseRemaining} session${courseRemaining === 1 ? "" : "s"} to go` : ""}
                          </p>
                        </div>
                      )}

                      {/* Who delivered it, in the order the patient had them: every
                          physio before this one, then this one. A reassignment leaves
                          the previous physio's completed days behind it, and the branch
                          needs to see where they left off before it reads what the new
                          physio has picked up. */}
                      {physioProgress && (physioProgress.previous.length > 0 || physioProgress.current) && (
                        <div className="mt-3 space-y-1.5" data-testid="cons-physio-assign-journey">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            {physioProgress.reassigned
                              ? `Physio History · ${physioProgress.previous.length + (physioProgress.current ? 1 : 0)} physios`
                              : "Delivered By"}
                          </p>
                          {physioProgress.previous.map((spell, i) => (
                            <PhysioSpell
                              key={`${spell.physio_id}-${i}`}
                              spell={spell}
                              packageSessions={totalCourseSessions}
                              testid={`cons-physio-spell-previous-${i}`}
                            />
                          ))}
                          {physioProgress.current && (
                            <PhysioSpell
                              spell={physioProgress.current}
                              packageSessions={totalCourseSessions}
                              testid="cons-physio-spell-current"
                            />
                          )}
                        </div>
                      )}

                      <p className="mt-3 text-xs leading-relaxed text-slate-600">
                        {!assigned
                          ? "Treatment Fee collected. Choose the physiotherapist who will deliver the sessions."
                          : courseDone
                            ? "Every session of this course has been delivered."
                            : "Treatment sessions are in progress — every day is on this physio's calendar and on their board."}
                      </p>
                      {/* Said before the picker is opened rather than discovered inside
                          it: reassigning mid-course re-dates only what is left, and the
                          branch is about to be asked for exactly that many dates. */}
                      {assigned && !courseDone && courseCompleted > 0 && (
                        <p className="mt-1 text-xs leading-relaxed text-violet-700" data-testid="cons-physio-reassign-note">
                          Reassigning keeps the {courseCompleted} session{courseCompleted === 1 ? "" : "s"} already delivered with the physio who ran them — only the remaining {courseRemaining} get new dates.
                        </p>
                      )}
                      <div className="mt-3">
                        <Button
                          size="sm"
                          disabled={assigned && courseDone}
                          title={assigned && courseDone ? "The course is finished — there are no sessions left to reassign" : undefined}
                          className={`${assigned ? "bg-white text-violet-700 shadow-sm ring-1 ring-violet-200 hover:bg-violet-50" : "bg-violet-600 text-white shadow-sm hover:bg-violet-700"} ${ACT_BTN}`}
                          onClick={() => openPhysioModal("treatment")}
                          data-testid={assigned ? "cons-reassign-physio" : "cons-open-physio-assign"}
                        >
                          <Users className="mr-1 h-3.5 w-3.5" />
                          {assigned ? "Reassign Physio" : "Assign Physio & Book Sessions"}
                        </Button>
                      </div>
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
                /* Read here, filed elsewhere. The Consultant's card is where a
                   consultation is written up, and the reports and scans on a patient's
                   file are ordered and filed by the branch — so this popup shows the pile
                   without an uploader on top of it. The branch's own board keeps one. */
                canUpload={["branch_admin", "super_admin"].includes(viewerRole)}
                /* Filing or deleting a page here moves the same count the stage panel's
                   Documents tab shows, so it is retaken rather than left as it was when
                   the card opened. */
                onChanged={noteDocsChanged}
              />
            )}

            {/* canVerify carries the same list the backend gates on, so a role that cannot
                verify is not shown a button that would come back refused. The physio's own
                page renders this tab with canVerify off for the same reason. */}
            {detailTab === "progression" && (
              <ProgressionTab
                leadId={selectedLead.id}
                /* The Consultant verifies but does not gather. The clips and the review
                   come from the physio delivering the course, and this tab is on the
                   Consultant's popup so somebody other than the person who filmed them
                   says they count — checking your own work makes the requirement prove
                   nothing. So: view and verify here, upload elsewhere. */
                canUpload={["branch_admin", "super_admin"].includes(viewerRole)}
                canVerify={["branch_admin", "super_admin", "head_physio"].includes(viewerRole)}
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
                            <span className={`ml-1 capitalize ${feeBalances.consultation ? "text-amber-600" : "text-emerald-600"}`}>({selectedLead.package_payment_mode})</span>
                          </span>
                        </div>
                        {/* Part collected is not collected. Ticking this green over a
                            balance the patient still owes is how the money gets lost. */}
                        {feeBalances.consultation ? (
                          <>
                            <p className="mt-1 text-[11px] font-medium text-amber-600" data-testid="cons-collect-fee-balance">
                              Rs.{Number(feeBalances.consultation.balance).toLocaleString("en-IN")} balance
                              {feeBalances.consultation.next?.due_date ? ` · due ${feeBalances.consultation.next.due_date}` : ""}
                            </p>
                            <Button
                              size="sm"
                              className="mt-2 bg-sky-600 text-xs hover:bg-sky-700"
                              onClick={() => openPartialCollectPopup(feeBalances.consultation.nextIdx, "consultation")}
                              data-testid="cons-collect-fee-collect-balance"
                            >
                              Collect Balance
                            </Button>
                          </>
                        ) : (
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" /> Already Collected
                          </p>
                        )}
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
                            <p className="mt-1 text-[11px] text-slate-400">Assigned package price: Rs.{selectedLead.package_price} — a discount can be agreed in the next step; the fee itself is not editable.</p>
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
                              <span className="ml-1 capitalize text-indigo-600">({isPlannedSchedule ? "partial" : selectedLead.treatment_fee_payment_mode})</span>
                            </span>
                          </div>
                          {/* Names the money still owed rather than only counting rows:
                              a balance left by a short collection is one unpaid row, and
                              "1 of 2 collected" does not say how much is outstanding. */}
                          <p className="mt-1 text-[11px] text-slate-500">
                            {isPlannedSchedule
                              ? `${savedInstallments.filter((i) => i.paid).length} of ${savedInstallments.length} installments collected.`
                              : `Rs.${savedInstallments.filter((i) => i.paid).reduce((sum, i) => sum + (i.amount || 0), 0)} collected · balance Rs.${savedInstallments.filter((i) => !i.paid).reduce((sum, i) => sum + (i.amount || 0), 0)} still due.`}
                          </p>
                          {/* A planned schedule opens the schedule; a balance left by a
                              short collection has one row to take, so it goes straight to
                              that row's own Collect popup — which offers every payment
                              mode, the balance being no more tied to how the first part
                              was paid than any other collection is. */}
                          <Button
                            size="sm"
                            className="mt-2 bg-indigo-600 text-xs hover:bg-indigo-700"
                            onClick={isPlannedSchedule
                              ? openPartialScheduleDraft
                              : () => openPartialCollectPopup(savedInstallments.findIndex((i) => !i.paid))}
                            data-testid="cons-open-partial-schedule"
                          >
                            {isPlannedSchedule ? "View Payment Schedule" : "Collect Balance"}
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
                  <div className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">Confirm Consultation Fee Payment</p>
                      <button onClick={() => setPackageConfirmDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-collect-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    {/* Replaces the old bare amount box and its "differs from" warning:
                        a discount is typed into its own boxes, and nothing else moves the
                        fee. `lockAmount` is why the fee itself is shown rather than typed
                        — it is the assigned price less that discount, which is not Branch
                        Admin's to overtype, so there is no box to overtype it in. */}
                    <FeeAmountEntry
                      assignedPrice={expected}
                      discount={collectFeeDraft.discount}
                      amount={collectFeeDraft.amount}
                      onChange={(patch) => setCollectFeeDraft({ ...collectFeeDraft, ...patch })}
                      label="Consultation Fee (₹)"
                      testPrefix="cons-collect-fee-confirm"
                      lockAmount
                    />

                    <BalanceDueBlock
                      balance={consultationBalanceDue}
                      dueDate={collectFeeDraft.balance_due_date}
                      onDueDateChange={(v) => setCollectFeeDraft({ ...collectFeeDraft, balance_due_date: v })}
                      amount={consultationAmountNow}
                      discount={consultationDiscountRs}
                      testPrefix="cons-collect-fee-confirm"
                    />

                    {/* Cash chosen on the popup behind this one lands here: the fee is
                        settled above, and this is where it gets counted out. Sits under
                        the amount because the amount is what it is counted against, and
                        it moves while the discount is still being agreed. */}
                    {!packageConfirmDraft.payment_lines && mode === "cash" && (
                      <CashDenominations
                        amount={collectFeeDraft.amount}
                        notes={packageConfirmDraft.cash_notes}
                        onChange={(cash_notes) => setPackageConfirmDraft({ ...packageConfirmDraft, cash_notes })}
                        testPrefix="cons-collect-fee-confirm"
                      />
                    )}

                    {packageConfirmDraft.payment_lines && (
                      <>
                        <SplitPaymentLines
                          lines={packageConfirmDraft.payment_lines}
                          modes={CONSULTATION_FEE_PAYMENT_MODES}
                          expected={collectFeeDraft.amount}
                          onChange={(next) => setPackageConfirmDraft({ ...packageConfirmDraft, payment_lines: next })}
                          testPrefix="cons-collect-fee"
                          countCash
                        />
                        <button
                          type="button"
                          onClick={() => setPackageConfirmDraft({
                            ...packageConfirmDraft,
                            payment_lines: [...packageConfirmDraft.payment_lines, { mode: "cash", amount: "", reference: "", notes: {} }],
                          })}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
                          data-testid="cons-collect-fee-split-more"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add another payment
                        </button>
                      </>
                    )}

                    {!packageConfirmDraft.payment_lines && mode === "upi" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">UPI Transaction ID <span className="text-rose-500">*</span></label>
                        <Input
                          value={packageConfirmDraft.upi_transaction_id}
                          onChange={(e) => setPackageConfirmDraft({ ...packageConfirmDraft, upi_transaction_id: e.target.value })}
                          className="h-9"
                          data-testid="cons-collect-fee-upi-txn"
                        />
                      </div>
                    )}

                    {!packageConfirmDraft.payment_lines && BANK_DETAIL_MODES.includes(mode) && (
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

                    {/* Started from whatever was already chosen: the mode picked on the
                        popup behind this one becomes the first tender, carrying the full
                        amount, and the second opens empty for the rest. Nothing typed is
                        thrown away by pressing it, and "Single payment" inside comes
                        straight back.

                        Last on the popup, under the card/transfer details rather than
                        above them, because it is the way out of the single payment being
                        filled in: the desk finishes the tender in front of it -- notes
                        counted, UPI reference, account and IFSC -- and only then decides
                        the rest is coming in something else. Sitting above those fields
                        it read as a step to take before them. */}
                    {!packageConfirmDraft.payment_lines && (
                      <button
                        type="button"
                        onClick={() => setPackageConfirmDraft({
                          ...packageConfirmDraft,
                          payment_lines: [
                            // Notes already counted come across with the mode that was
                            // counted in. Pressing "Add another payment" is not a reason
                            // to make somebody count the same drawer twice.
                            { mode, amount: collectFeeDraft.amount, reference: mode === "upi" ? packageConfirmDraft.upi_transaction_id : "", notes: mode === "cash" ? packageConfirmDraft.cash_notes : {} },
                            { mode: mode === "cash" ? "upi" : "cash", amount: "", reference: "", notes: {} },
                          ],
                        })}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-400 hover:text-sky-700"
                        data-testid="cons-collect-fee-split-add"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add another payment
                      </button>
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
                          // Money still owed has to be dated, and a discount bigger than
                          // the fee it comes off is a typo rather than a gift.
                          (consultationHasBalance && !collectFeeDraft.balance_due_date) ||
                          consultationDiscountRs > consultationPrice ||
                          // A split answers for itself: every part above zero, and the
                          // parts adding up to the fee. The single-mode requirements
                          // below are not its to satisfy.
                          // Cash is counted before it is banked, and the count has to come
                          // out right. Not counted, short of what is being taken, and over
                          // it all leave a figure going into the drawer that nobody
                          // physically checked.
                          (packageConfirmDraft.payment_lines
                            ? (packageConfirmDraft.payment_lines.some((l) => !(parseFloat(l.amount) > 0)) ||
                               packageConfirmDraft.payment_lines.some((l) => l.mode === "cash" && !notesSettled(l.notes, l.amount)) ||
                               Math.abs(packageConfirmDraft.payment_lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0) - parseFloat(collectFeeDraft.amount)) > 0.01)
                            : ((mode === "cash" && !notesSettled(packageConfirmDraft.cash_notes, collectFeeDraft.amount)) ||
                               (mode === "upi" && !packageConfirmDraft.upi_transaction_id.trim()) ||
                               (BANK_DETAIL_MODES.includes(mode) && (!packageConfirmDraft.account_number.trim() || !packageConfirmDraft.account_holder_name.trim() || !packageConfirmDraft.bank_name.trim() || !packageConfirmDraft.ifsc_code.trim())) ||
                               (mode === "account_transfer" && !packageConfirmDraft.transfer_reference.trim())))
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
              // Between tenders: the last payment is accepted, the next one has no mode
              // yet, and the popup is showing the mode buttons rather than a form.
              const picking = !!treatmentConfirmDraft.picking_mode;
              // Second tender onward. The discount was agreed once, on the whole fee, and
              // the boxes for it do not come back — what is being typed now is one more
              // payment against a bill that is already settled.
              const continuing = treatmentTenders.length > 0;
              const outstandingLabel = Math.max(0, treatmentOutstanding).toLocaleString("en-IN");
              // How many payments this collection is actually made of: the tenders already
              // accepted, plus the one still on the popup if the desk is typing one.
              const tenderCount = treatmentTenders.length + (picking ? 0 : 1);
              return (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-testid="cons-treatment-fee-confirm-modal">
                  <div className="max-h-[85dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:max-h-[90vh]">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">
                        {mode === "partial"
                          ? "Partial Payment Schedule"
                          : picking
                          ? "Choose a Payment Method for the Balance"
                          : continuing
                          ? `Collect Balance by ${modeLabel}`
                          : `Collect ${modeLabel} Payment`}
                      </p>
                      <button onClick={() => { setTreatmentConfirmDraft(null); setTreatmentBalanceChoice(null); }} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-treatment-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="cons-treatment-fee-confirm-package">
                      {selectedLead.session_package_name || "—"}{selectedLead.session_package_sessions ? ` · ${selectedLead.session_package_sessions} sessions` : ""}
                    </div>

                    {/* What has been taken so far, and what is left of today's bill.
                        Shown from the second tender on, because up to then there is
                        nothing to keep track of — one payment against one fee needs no
                        running total. Every figure the desk has to say out loud to the
                        patient ("that's Rs.10,000, you've given me Rs.5,000, so Rs.5,000
                        left") is on it, in that order. */}
                    {continuing && mode !== "partial" && (
                      <div className="space-y-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2.5" data-testid="cons-treatment-fee-tenders">
                        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                          <span>Collection so far</span>
                          <span>Total Rs.{treatmentNetPayable.toLocaleString("en-IN")}</span>
                        </div>
                        {treatmentTenders.map((t, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-md border border-indigo-100 bg-white px-2 py-1.5 text-xs" data-testid={`cons-treatment-fee-tender-${i}`}>
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: PAYMENT_MODE_COLORS[t.mode] || "#64748b" }}
                            />
                            <span className="font-semibold text-slate-700">{ALL_PAYMENT_MODE_LABELS[t.mode] || t.mode}</span>
                            {t.reference && <span className="min-w-0 truncate text-[11px] text-slate-400">{t.reference}</span>}
                            <span className="ml-auto font-semibold text-slate-800">Rs.{t.amount.toLocaleString("en-IN")}</span>
                            {/* Nothing here has been sent yet, so a tender entered in the
                                wrong mode is taken back off rather than corrected after
                                the fact in Accountant Manage. */}
                            <button
                              type="button"
                              onClick={() => removeTreatmentTender(i)}
                              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                              title="Remove this payment"
                              data-testid={`cons-treatment-fee-tender-remove-${i}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <div
                          className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold ${
                            treatmentOutstanding > 0.009 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                          data-testid="cons-treatment-fee-tender-balance"
                        >
                          <span>{treatmentOutstanding > 0.009 ? "Balance to collect" : "Fully collected"}</span>
                          <span>Rs.{outstandingLabel}</span>
                        </div>
                      </div>
                    )}

                    {/* The next tender's mode. The same buttons the first one was chosen
                        from, minus Cheque and Partial Payment: a split is money settling
                        at the desk today, and neither of those is (see
                        TREATMENT_SPLIT_MODES). The way out of the loop without taking any
                        more money is the link underneath. */}
                    {picking && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Method for the Rs.{outstandingLabel} balance</label>
                          <PaymentModeSelect
                            value=""
                            options={TREATMENT_SPLIT_MODES}
                            onChange={pickNextTreatmentTenderMode}
                            testId="cons-treatment-fee-next-mode"
                          />
                        </div>
                        {/* Stays on this screen rather than dropping back into the last
                            tender's form: that tender is already accepted, and putting
                            its amount back in the box would count the same money twice.
                            What changes is that the balance is now a real one, so the
                            due date and the Collect button appear underneath. */}
                        {!treatmentConfirmDraft.balance_partial && (
                          <button
                            type="button"
                            onClick={() => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, balance_partial: true })}
                            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-400 hover:text-rose-700"
                            data-testid="cons-treatment-fee-next-partial"
                          >
                            Nothing more today — leave Rs.{outstandingLabel} as a Partial Payment
                          </button>
                        )}
                      </>
                    )}

                    {!picking && mode !== "partial" && (
                      <div>
                        {SETTLED_NOW_MODES.includes(mode) ? (
                          continuing ? (
                            // No discount boxes on a continuing tender — see `continuing`
                            // above. What is left of the bill is the figure this payment is
                            // measured against, and it is already on the strip.
                            <>
                              <label className="mb-1 block text-[11px] font-medium text-slate-500">{modeLabel} Amount (₹)</label>
                              <Input
                                type="number"
                                min="0"
                                value={treatmentFeeDraft.amount}
                                onChange={(e) => setTreatmentFeeDraft({ ...treatmentFeeDraft, amount: e.target.value })}
                                className="h-9"
                                data-testid="cons-treatment-fee-amount"
                              />
                              <p className="mt-1 text-[11px] text-slate-400" data-testid="cons-treatment-fee-amount-hint">
                                Rs.{Math.max(0, round2(treatmentNetPayable - treatmentTendersTotal)).toLocaleString("en-IN")} of this fee is still to be collected. Less than that leaves a balance again.
                              </p>
                            </>
                          ) : (
                            // Discount is measured against what *these* sessions cost, not the
                            // whole package — collecting for fewer sessions is not a discount.
                            // Neither is collecting less than they cost: that is the balance
                            // below, and only the Discount boxes reduce what is owed.
                            <FeeAmountEntry
                              assignedPrice={expectedForSessionsNow}
                              discount={treatmentFeeDraft.discount}
                              amount={treatmentFeeDraft.amount}
                              onChange={(patch) => setTreatmentFeeDraft({ ...treatmentFeeDraft, ...patch })}
                              label={`${modeLabel} Amount (₹)`}
                              testPrefix="cons-treatment-fee"
                            />
                          )
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
                        {!continuing && selectedLead.session_package_sessions && selectedLead.session_package_price != null && (
                          <p className="mt-1 text-[11px] text-slate-500" data-testid="cons-treatment-fee-breakdown">
                            {treatmentIsPartialSessions
                              ? `Collect Now = ${treatmentSessionsNow} of ${treatmentFeeTotalSessions} sessions × Rs.${Math.round(perSessionRate * 100) / 100}/session = Rs.${treatmentComputedAmount}`
                              : `Collect Total Session Fee = ${selectedLead.session_package_sessions} sessions × Rs.${Math.round((selectedLead.session_package_price / selectedLead.session_package_sessions) * 100) / 100}/session = Rs.${selectedLead.session_package_price}`}
                          </p>
                        )}
                      </div>
                    )}

                    {/* How many of the package's sessions this collection is buying —
                        settled once, on the first tender. A second tender is more money
                        against the same sessions, not a second purchase, so the box does
                        not come back to be re-answered. */}
                    {!picking && !continuing && mode !== "partial" && treatmentFeeTotalSessions > 0 && (
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

                    {/* Only once the shortfall has an answer — see treatmentBalanceSettled.
                        A gap the desk has not been asked about yet is a question, not a
                        debt, and a due-date field under it asks them to date something they
                        may be about to collect in full a moment later. */}
                    {mode !== "partial" && treatmentBalanceSettled && (
                      <BalanceDueBlock
                        balance={treatmentBalanceDue}
                        dueDate={treatmentFeeDraft.balance_due_date}
                        onDueDateChange={(v) => setTreatmentFeeDraft({ ...treatmentFeeDraft, balance_due_date: v })}
                        amount={treatmentAmountNow}
                        discount={treatmentDiscount}
                        note={treatmentIsPartialSessions && treatmentRemainingSessions > 0 ? `${treatmentRemainingSessions} sessions` : ""}
                        leading={treatmentIsPartialSessions ? (
                          <>Covers <span className="font-semibold">{treatmentSessionsNow} of {treatmentFeeTotalSessions}</span> sessions. </>
                        ) : null}
                        testPrefix="cons-treatment-fee"
                      />
                    )}

                    {/* Counted last, under the sessions fields rather than under the
                        amount the way the Consultation Fee's is. The amount here is not
                        settled until "Sessions Covered Now" is: a count entered above
                        that box would be checked against a figure the next keystroke
                        changes, and would read as short through no fault of the person
                        counting. Cheque and Partial never reach this -- one clears at a
                        bank and the other is a schedule, and neither is notes on a desk
                        today. */}
                    {!picking && mode === "cash" && (
                      <CashDenominations
                        amount={treatmentFeeDraft.amount}
                        notes={treatmentConfirmDraft.cash_notes}
                        onChange={(cash_notes) => setTreatmentConfirmDraft({ ...treatmentConfirmDraft, cash_notes })}
                        testPrefix="cons-treatment-fee-confirm"
                      />
                    )}

                    {/* Transaction ID alone. A UPI payment was asking for its UTR as
                        well -- a second reference for the same transfer, typed off the
                        same receipt, on the popup a Branch Admin fills at the desk with
                        the patient waiting. */}
                    {!picking && mode === "upi" && (
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

                    {!picking && BANK_DETAIL_MODES.includes(mode) && (
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

                    {/* Hidden while a mode is still being chosen for the balance: there is
                        no payment on the popup to collect, and the buttons above are the
                        only thing to press. It comes back the moment the desk says the
                        rest is coming later, because then what is on the popup — every
                        tender already accepted — is the whole collection. */}
                    {(!picking || treatmentConfirmDraft.balance_partial) && (
                      <Button
                        className="w-full bg-indigo-600 text-xs hover:bg-indigo-700"
                        onClick={submitTreatmentModePopup}
                        disabled={
                          collectingTreatmentFee ||
                          selectedLead.session_package_price == null ||
                          // Everything from here to the discount check belongs to the tender
                          // being typed, and there isn't one while `picking` — the accepted
                          // ones passed these on their way onto the list.
                          (!picking && SETTLED_NOW_MODES.includes(mode) && !(parseFloat(treatmentFeeDraft.amount) > 0)) ||
                          (mode === "cheque" && (!treatmentFeeDraft.bank_name.trim() || !treatmentFeeDraft.cheque_number.trim())) ||
                          (mode === "partial" && (!partialAllFilled || partialMismatch)) ||
                          // Only once the shortfall is settled as a balance — until then the
                          // button's job is to raise the fork, and it cannot ask for a date
                          // on a debt nobody has agreed exists yet.
                          (PART_SESSION_MODES.includes(mode) && treatmentHasBalance && treatmentBalanceSettled && !treatmentFeeDraft.balance_due_date) ||
                          // A discount bigger than the fee it comes off is a typo, not a gift.
                          (SETTLED_NOW_MODES.includes(mode) && treatmentNetPayable < 0) ||
                          // Cash is counted before it is banked, and counted against the
                          // amount of this tender rather than the fee it is a part of.
                          (!picking && mode === "cash" && !notesSettled(treatmentConfirmDraft.cash_notes, treatmentFeeDraft.amount)) ||
                          (!picking && BANK_DETAIL_MODES.includes(mode) && (!treatmentConfirmDraft.account_number.trim() || !treatmentConfirmDraft.account_holder_name.trim() || !treatmentConfirmDraft.bank_name.trim() || !treatmentConfirmDraft.ifsc_code.trim())) ||
                          (!picking && mode === "account_transfer" && !treatmentConfirmDraft.transfer_reference.trim())
                        }
                        data-testid="cons-treatment-fee-confirm-submit"
                      >
                        {collectingTreatmentFee
                          ? "Saving..."
                          : mode === "partial"
                          ? "Save Payment Schedule"
                          // Says what pressing it does. Short of the fee and unanswered, it
                          // opens the fork rather than banking anything, and a button that
                          // said "Collect Cash Payment" there would be promising to finish a
                          // collection it is about to ask a question about.
                          : treatmentOutstanding > 0.009 && !treatmentConfirmDraft.balance_partial
                          ? `Continue — Rs.${outstandingLabel} balance`
                          : continuing
                          ? `Collect Rs.${treatmentAmountNow.toLocaleString("en-IN")}${tenderCount > 1 ? ` (${tenderCount} payments)` : ""}`
                          : `Collect ${modeLabel} Payment`}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}


            {/* Balance Amount — the fork. Raised by submitTreatmentModePopup when the
                money on the Collect popup is short of what today's sessions cost, and
                the only thing standing between a part payment and being banked as a
                whole one. See treatmentBalanceChoice for why it is asked rather than
                guessed. Above the Collect popup it interrupts (z-[90] > z-[70]). */}
            {treatmentBalanceChoice && treatmentFeeDraft && (
              <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" data-testid="cons-treatment-fee-balance-modal">
                <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">Balance Amount</p>
                    <button
                      onClick={() => setTreatmentBalanceChoice(null)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100"
                      data-testid="cons-treatment-fee-balance-close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* The three figures, in the order they are said at the desk. Every
                      tender is named by its own mode rather than lumped into one "paid"
                      line -- "paid via Cash Rs.5,000" is what the patient can check
                      against what they actually handed over. */}
                  <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs" data-testid="cons-treatment-fee-balance-summary">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Total Payable</span>
                      <span className="font-semibold text-slate-800">Rs.{treatmentNetPayable.toLocaleString("en-IN")}</span>
                    </div>
                    {[...treatmentTenders, { mode: treatmentFeeDraft.payment_mode, amount: round2(parseFloat(treatmentFeeDraft.amount) || 0) }].map((t, i) => (
                      <div key={i} className="flex items-center justify-between" data-testid={`cons-treatment-fee-balance-paid-${i}`}>
                        <span className="text-slate-500">Paid via {ALL_PAYMENT_MODE_LABELS[t.mode] || t.mode}</span>
                        <span className="font-semibold text-emerald-700">Rs.{t.amount.toLocaleString("en-IN")}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1.5">
                      <span className="font-semibold text-slate-600">Balance</span>
                      <span className="font-semibold text-amber-700" data-testid="cons-treatment-fee-balance-amount">Rs.{treatmentBalanceChoice.balance.toLocaleString("en-IN")}</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500">How is the Rs.{treatmentBalanceChoice.balance.toLocaleString("en-IN")} balance being settled?</p>

                  {/* The money is here, in another form. Takes the tender on the popup
                      onto the list and comes back for the next one. */}
                  <Button
                    className="w-full bg-indigo-600 text-xs hover:bg-indigo-700"
                    onClick={addTreatmentTenderAndPickNext}
                    data-testid="cons-treatment-fee-balance-another"
                  >
                    Paying now by another method
                  </Button>

                  {/* The money is not here. The shortfall becomes a dated balance the
                      patient can settle later under any mode -- see BalanceDueBlock. */}
                  <Button
                    variant="outline"
                    className="w-full text-xs"
                    onClick={leaveTreatmentBalanceAsPartial}
                    data-testid="cons-treatment-fee-balance-partial"
                  >
                    Partial payment — collect the balance later
                  </Button>

                  <button
                    type="button"
                    onClick={() => setTreatmentBalanceChoice(null)}
                    className="w-full text-center text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
                    data-testid="cons-treatment-fee-balance-back"
                  >
                    Back — change the amount
                  </button>
                </div>
              </div>
            )}

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
                      <p className="text-sm font-semibold text-slate-800">
                        Collect {partialCollectDraft.fee && partialCollectDraft.fee !== "treatment"
                          ? `${FEE_LABELS[partialCollectDraft.fee]} Balance`
                          : installmentLabelFor(partialCollectDraft.idx)}
                      </p>
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

                    {/* The one mode this installment came in — replaced by the lines
                        themselves once it turns out to have come in several. */}
                    {!partialCollectDraft.payment_lines && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">Payment Mode</label>
                        <PaymentModeSelect
                          value={mode}
                          options={INSTALLMENT_PAYMENT_MODES}
                          // The count goes with the mode that was counted in. Switching
                          // away from Cash and back would otherwise leave the old notes
                          // sitting under a tender nobody counted -- the same reason a
                          // split line clears its own on a mode change. The Treatment Fee
                          // popup gets this for free: choosing a mode there rebuilds the
                          // whole confirm draft.
                          onChange={(v) => setPartialCollectDraft({ ...partialCollectDraft, payment_mode: v, cash_notes: {} })}
                          testId="cons-partial-collect-mode"
                        />
                      </div>
                    )}

                    {/* An installment is the Treatment Fee arriving in pieces, and it
                        crosses the same desk in the same notes -- so it is counted the
                        same way. The amount here is typed directly rather than derived
                        from sessions, so the count sits straight under it. */}
                    {mode === "cash" && !partialCollectDraft.payment_lines && (
                      <CashDenominations
                        amount={partialCollectDraft.amount}
                        notes={partialCollectDraft.cash_notes}
                        onChange={(cash_notes) => setPartialCollectDraft({ ...partialCollectDraft, cash_notes })}
                        testPrefix="cons-partial-collect"
                      />
                    )}

                    {/* Started from what was already chosen: the mode this popup opened
                        on becomes the first tender, carrying the whole amount, and the
                        second opens empty for the rest. Nothing typed is thrown away by
                        pressing it, and "Single payment" inside comes straight back. */}
                    {SETTLED_NOW_MODES.includes(mode) && !partialCollectDraft.payment_lines && (
                      <button
                        type="button"
                        onClick={() => setPartialCollectDraft({
                          ...partialCollectDraft,
                          payment_lines: [
                            { mode, amount: partialCollectDraft.amount, reference: mode === "upi" ? partialCollectDraft.upi_transaction_id : "", notes: mode === "cash" ? partialCollectDraft.cash_notes : {} },
                            { mode: mode === "cash" ? "upi" : "cash", amount: "", reference: "", notes: {} },
                          ],
                        })}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700"
                        data-testid="cons-partial-collect-split-add"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add another payment
                      </button>
                    )}

                    {partialCollectDraft.payment_lines && (
                      <>
                        <SplitPaymentLines
                          lines={partialCollectDraft.payment_lines}
                          modes={TREATMENT_SPLIT_MODES}
                          expected={partialCollectDraft.amount}
                          onChange={(next) => setPartialCollectDraft({ ...partialCollectDraft, payment_lines: next })}
                          testPrefix="cons-partial-collect"
                          countCash
                        />
                        <button
                          type="button"
                          onClick={() => setPartialCollectDraft({
                            ...partialCollectDraft,
                            payment_lines: [...partialCollectDraft.payment_lines, { mode: "cash", amount: "", reference: "", notes: {} }],
                          })}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700"
                          data-testid="cons-partial-collect-split-more"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add another payment
                        </button>
                      </>
                    )}

                    {!partialCollectDraft.payment_lines && mode === "upi" && (
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

                    {!partialCollectDraft.payment_lines && BANK_DETAIL_MODES.includes(mode) && (
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

                    {!partialCollectDraft.payment_lines && mode === "cheque" && (
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
                        (partialCollectDraft.payment_lines
                          ? (partialCollectDraft.payment_lines.some((l) => !(parseFloat(l.amount) > 0)) ||
                             partialCollectDraft.payment_lines.some((l) => l.mode === "cash" && !notesSettled(l.notes, l.amount)) ||
                             Math.abs(partialCollectDraft.payment_lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0) - parseFloat(partialCollectDraft.amount)) > 0.01)
                          : ((mode === "cash" && !notesSettled(partialCollectDraft.cash_notes, partialCollectDraft.amount)) ||
                             (BANK_DETAIL_MODES.includes(mode) && (!partialCollectDraft.account_number.trim() || !partialCollectDraft.account_holder_name.trim() || !partialCollectDraft.bank_name.trim() || !partialCollectDraft.ifsc_code.trim())) ||
                             (mode === "account_transfer" && !partialCollectDraft.transfer_reference.trim()) ||
                             (mode === "cheque" && (!partialCollectDraft.bank_name.trim() || !partialCollectDraft.cheque_number.trim()))))
                      }
                      data-testid="cons-partial-collect-submit"
                    >
                      {collectingTreatmentFee ? "Saving..." : partialCollectDraft.payment_lines ? "Collect Split Payment" : `Collect ${modeLabel} Payment`}
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
                      <p className="text-sm font-semibold text-slate-800">Collect Rehab Fee</p>
                      <button onClick={() => setRehabFeeDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-rehab-fee-close"><X className="h-4 w-4" /></button>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      {selectedLead.rehab_package_name || "Rehab course"}
                      {selectedLead.rehab_package_sessions ? ` · ${selectedLead.rehab_package_sessions} sessions` : ""}
                      {selectedLead.rehab_package_mode ? <> · <span className="capitalize">{selectedLead.rehab_package_mode}</span></> : null}
                    </p>

                    <FeeAmountEntry
                      assignedPrice={selectedLead.rehab_package_price}
                      discount={rehabFeeDraft.discount}
                      amount={rehabFeeDraft.amount}
                      onChange={(patch) => setRehabFeeDraft({ ...rehabFeeDraft, ...patch })}
                      label="Rehab Fee (₹)"
                      testPrefix="cons-rehab-fee"
                    />

                    <BalanceDueBlock
                      balance={rehabBalanceDue}
                      dueDate={rehabFeeDraft.balance_due_date}
                      onDueDateChange={(v) => setRehabFeeDraft({ ...rehabFeeDraft, balance_due_date: v })}
                      amount={rehabAmountNow}
                      discount={rehabDiscountRs}
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
                        disabled={
                          collectingRehabFee ||
                          !(parseFloat(rehabFeeDraft.amount) > 0) ||
                          (rehabHasBalance && !rehabFeeDraft.balance_due_date) ||
                          rehabDiscountRs > rehabPrice
                        }
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
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid={`cons-${dietFeeCfg.testid}-modal`}>
                <div className="max-h-[85vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <Salad className="h-4 w-4 text-orange-500" />
                      {selectedLead[dietFeeCfg.paidField] != null ? `Update ${dietFeeCfg.label}` : `Collect ${dietFeeCfg.label}`}
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
                      <p className="text-sm font-semibold text-slate-800">Confirm {dietFeeCfg.label}</p>
                      <button onClick={() => setDietFeeConfirmDraft(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-diet-fee-confirm-close"><X className="h-4 w-4" /></button>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      {dietItemById(dietFeeDraft.item_id)?.name || "Diet Package"} · <span className="capitalize">{dietFeeDraft.mode}</span>
                    </p>

                    <FeeAmountEntry
                      assignedPrice={dietListPrice(dietFeeDraft)}
                      discount={dietFeeDraft.discount}
                      amount={dietFeeDraft.amount}
                      onChange={(patch) => setDietFeeDraft({ ...dietFeeDraft, ...patch })}
                      label={`${dietFeeCfg.label} (₹)`}
                      testPrefix="cons-diet-fee-confirm"
                    />

                    <BalanceDueBlock
                      balance={dietBalanceDue}
                      dueDate={dietFeeDraft.balance_due_date}
                      onDueDateChange={(v) => setDietFeeDraft({ ...dietFeeDraft, balance_due_date: v })}
                      amount={dietAmountNow}
                      discount={dietDiscountRs}
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
                        disabled={
                          collectingDietFee ||
                          !(parseFloat(dietFeeDraft.amount) > 0) ||
                          (dietHasBalance && !dietFeeDraft.balance_due_date) ||
                          dietDiscountRs > dietPrice
                        }
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
                                    ? "border border-orange-600 bg-orange-600 text-white shadow-sm hover:bg-orange-700 hover:text-white"
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
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      {/* Cyan and the Activity mark on rehab, the same pair the Rehab panel
                          carries. This opens straight over that card, so it has to read as
                          that card continued rather than as the treatment picker arriving. */}
                      {isRehabAssign ? <Activity className="h-4 w-4 text-cyan-600" /> : <Users className="h-4 w-4 text-emerald-600" />}
                      {assignTitle}
                    </p>
                    <button onClick={() => setShowPhysioModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-physio-close"><X className="h-4 w-4" /></button>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="cons-physio-package-context">
                    <p className="font-semibold text-slate-700">{courseName}{totalSessionsNeeded ? ` · ${totalSessionsNeeded} ${dayNoun}s` : ""}</p>
                    {resumingCourse && (
                      <p className="mt-0.5 font-medium text-violet-700" data-testid="cons-physio-resume-note">
                        {sessionsAlreadyDone} of {packageSessions} already delivered
                        {selectedLead.assigned_physio_name ? ` by ${selectedLead.assigned_physio_name}` : ""} — only the remaining {totalSessionsNeeded} need dates.
                      </p>
                    )}
                    <p className="mt-0.5">
                      {assignFeeLabel}: {assignFeePaid != null ? (
                        <span className="font-semibold text-emerald-700">Rs.{Number(assignFeePaid).toLocaleString("en-IN")} paid ({assignFeeMode || "—"})</span>
                      ) : (
                        <span className="text-amber-600">not paid</span>
                      )}
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-500">Available physios in this branch — pick one to choose their {isRehabAssign ? "rehab days" : "treatment dates"}</p>

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
                          <span className="min-w-0 truncate">{p.full_name}{p.specialization ? ` · ${p.specialization}` : ""}</span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {/* Which of them meet over video, before one is picked rather
                                than after. On an online arm the whole list carries it and
                                the badge says nothing new — it is the physio MISSING one
                                that it makes stand out. */}
                            {(p.meet_link || "").trim() && (
                              <span
                                className="flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"
                                data-testid={`cons-physio-option-meet-${p.id}`}
                              >
                                <Video className="h-3 w-3" /> Meet
                              </span>
                            )}
                            {physioPick === p.id && <CheckCircle2 className="h-3.5 w-3.5" />}
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* The room these days will be held in, and the plain statement that the
                      patient is the one being given it. The link reaches them through the
                      portal, which joins it onto every session still to come — so this is
                      not a copy to send by hand, and saying so is what stops it being sent
                      twice by two different routes. */}
                  {pickedMeetLink && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-physio-meet-link">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700">
                        <Video className="h-3.5 w-3.5" /> Held on Google Meet
                      </p>
                      <a
                        href={pickedMeetLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block truncate text-xs font-semibold text-violet-700 underline underline-offset-2 hover:text-violet-900"
                        data-testid="cons-physio-meet-link-open"
                      >
                        {pickedMeetLink.replace(/^https?:\/\//, "")}
                      </a>
                      <p className="mt-1 text-[10px] leading-snug text-violet-500">
                        {pickedPhysio?.full_name}&apos;s own room. {selectedLead.name} gets this link in their
                        patient portal against every day booked here — nothing to send by hand.
                      </p>
                    </div>
                  )}

                  {/* No room, on a board whose patients are only ever seen over video. Said
                      here rather than at the end because the fix is on another screen: six
                      days booked now would show the patient six days with no way to join. */}
                  {meetLinkMissing && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="cons-physio-meet-missing">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                        <AlertCircle className="h-3.5 w-3.5" /> No video room recorded
                      </p>
                      <p className="mt-1 text-[10px] leading-snug text-amber-600">
                        {pickedPhysio?.full_name} has no Google Meet link, so {selectedLead.name} will see these
                        days in their portal with no way to join. Add one on the Physiotherapist Calendar —
                        it applies to every day booked with them, including these.
                      </p>
                    </div>
                  )}

                  {physioPick && sortedPickedSlots.length > 0 && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-physio-sessions-preview">
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">{isRehabAssign ? "Rehab days fixed" : "Treatment days fixed"}</p>
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
                      : isRehabAssign ? "Choose Rehab Dates & Times" : "Choose Treatment Dates & Times"}
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
                          {" "}{isRehabAssign ? "one a day" : "one session a day"} · {sessionMinutes} min each · {openSlotCount} slots open
                        </p>
                        {/* Where these days will be held, on the screen that fixes them.
                            A link rather than plain text: whoever is booking can check the
                            room opens before six days are committed to it. The patient is
                            given the same address by the portal, so this is a check, not a
                            copy to send. */}
                        {pickedMeetLink && (
                          <a
                            href={pickedMeetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-white/25 sm:text-[11px]"
                            data-testid="cons-slot-picker-meet-link"
                          >
                            <Video className="h-3 w-3 shrink-0" />
                            <span className="truncate">{pickedMeetLink.replace(/^https?:\/\//, "")}</span>
                          </a>
                        )}
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
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{assignFeeLabel}</span>
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
                        {sessionPayment.paid} {dayNoun}{sessionPayment.paid === 1 ? "" : "s"} PAID
                        {sessionPayment.paidAmount > 0 && <span className="ml-2 font-semibold text-emerald-600">Rs.{sessionPayment.paidAmount}</span>}
                        {sessionPayment.paid > 0 && <span className="ml-2 font-medium text-emerald-500">Day 1–{sessionPayment.paid}</span>}
                      </span>
                      {sessionPayment.unpaid > 0 ? (
                        <span className="hidden w-full rounded-lg border-2 border-rose-400 bg-rose-50 sm:block px-3 py-1.5 text-center text-xs font-bold text-rose-700 shadow-sm sm:w-auto sm:px-4 sm:py-2 sm:text-left sm:text-sm" data-testid="cons-payment-unpaid">
                          {sessionPayment.unpaid} {dayNoun}{sessionPayment.unpaid === 1 ? "" : "s"} UNPAID
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
                            run. Picking another time on a day already fixed <b>moves</b> that day and stays put.
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
                              <p className="text-sm text-slate-400">Pick a {isRehabAssign ? "rehab" : "treatment"} date to see this physio's open times</p>
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
                                  <p className="text-sm font-bold uppercase tracking-wider text-violet-700">{isRehabAssign ? "Rehab plan" : "Treatment plan"}</p>
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
          counted down at a glance — which is what someone about to Move to Admin is
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
              load-bearing rather than tidy: Move to Admin refuses an empty Treatment
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

/**
 * Memoised, because of who mounts it and what it costs.
 *
 * Branch Leads embeds this board under a stage bar it draws itself, and is told the counts
 * to put on that bar from in here -- so every load reports up, the parent stores the
 * numbers, and the parent re-renders. That re-render used to walk this entire board again:
 * every row of the list, rebuilt to produce exactly what was already on screen. The same
 * went for the forty-odd other pieces of parent state -- a tick in its select-all box, its
 * own popup opening -- none of which this board is told about or affected by.
 *
 * Every prop it is given is a primitive, a literal, or memoised by the parent, so the
 * comparison is a cheap one and it holds: the board re-renders when the filters, the search
 * or the reload token actually move, and sits still the rest of the time. Parents passing
 * an inline arrow for onCountChange or onAutoOpened would defeat it, which is why the two
 * that mount it hold theirs in useCallback.
 */
export const ConsultationsBoard = memo(ConsultationsBoardInner);
ConsultationsBoard.displayName = "ConsultationsBoard";

export default ConsultationsBoard;
