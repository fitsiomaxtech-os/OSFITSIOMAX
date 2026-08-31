import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ArrowLeftRight,
  RefreshCw,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Search,
  Stethoscope,
  Trash2,
  UserPlus,
  X,
  Activity,
  LayoutDashboard,
  FileText,
  Printer,
  Share2,
  Download,
  ShoppingCart,
  ClipboardList,
  Bell,
  BadgeIndianRupee,
  Salad,
  UserCog,
  User,
  UserX,
  Clock,
  MoreHorizontal,
  Star,
  AlertCircle,
  PhoneOff,
  Music,
  Dumbbell,
  Video,
  HeartPulse,
  IdCard,
  Megaphone,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { QuickDateFilterBar, intersectDateFilters } from "@/components/QuickDateFilterBar";
import { StageTabBar, stageDisplayLabel } from "@/components/ui/stage-tab";
import { RescheduledTag } from "@/components/ui/lead-marks";
import { apptCardPng, REASSURANCE } from "@/lib/apptCard";
import {
  scheduleBranchAppointment,
  getBranches,
  getBranchBoard,
  getArmBoard,
  getAvailableExperts,
  getAvailableDates,
  getLeadActivity,
  getLeadRemarks,
  moveBranchStage,
  stagesList,
  scheduleBranchFollowUp,
  rescheduleBranchFollowUp,
  bulkDeleteLeads,
  setLeadFlags,
  rnrAttempt,
} from "@/lib/api";
import { to12h, endTime12h, callTimeStamp, callDateStamp, dateStampFull } from "@/lib/time";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { HeadPhysioCalendar } from "@/components/HeadPhysioCalendar";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import { FitsiomaxStorePanel } from "@/components/BranchStoreBoard";
import { PullFromSheetButton } from "@/components/PullFromSheetButton";
import { AccountantManageTab } from "@/components/branch/AccountantManageTab";
import { BranchCalendarPanel } from "@/components/branch/BranchCalendarPanel";
import { TimeManagementPanel } from "@/components/branch/TimeManagementPanel";
import { ZumbaMastersPanel } from "@/components/branch/ZumbaMastersPanel";
import { BranchDetailPage } from "@/components/branch/BranchDetailPage";
import MissedClassPanel from "@/components/branch/MissedClassPanel";
import { BranchReviewPanel } from "@/components/branch/BranchReviewPanel";
import { PatientsPortalPanel } from "@/components/branch/PatientsPortalPanel";
import { ZumbaPanel } from "@/components/branch/ZumbaPanel";
import { FitnessPanel } from "@/components/branch/FitnessPanel";
import { CreateLeadModal, DEPARTMENT_OPTIONS, LEAD_DATA_FIELDS } from "@/components/CreateLeadModal";
import { MilkCalendar, MilkDateInput, MilkTimeInput } from "@/components/ui/milk-calendar";
import { LOGO_URL, PRINTABLE_STYLES, escapeHtml, rowsHtml, openPrintable } from "@/lib/printable";
import { isCourseComplete } from "@/lib/leadStage";

// Branch (sales) stages this file has to name out loud, kept here rather than spelled at
// each site. They are the DB's own strings and the backend's constants.py holds the same
// three -- a rename in Pipeline Stage Management breaks the pair together, which is at
// least visible, where two spellings drifting apart is not.
//
// APPOINTMENT_STAGE reads "Appointment" on screen; the long form is the stored value.
// See STAGE_DISPLAY_LABELS in ui/stage-tab.
const APPOINTMENT_STAGE = "Appointment Date & Time";
const BRANCH_RNR_STAGE = "RNR";
const BRANCH_CANCELLED_STAGE = "Cancelled";
// Still a stage a lead can be moved to -- schedule-portfolio puts them there -- but no
// longer one of the pills on the Branch Leads strip. See leadPillStages.
const BRANCH_PORTFOLIO_STAGE = "Portfolio";

// ---- Appointment confirmation -------------------------------------------------------
// What the client walks away with. Built as its own document so it can be opened, printed
// to PDF, saved or shared — same branding, styles and mechanics the payment receipt uses,
// from lib/printable.js.

/**
 * One of the intake form's own questions, read back off a lead.
 *
 * These are sheet columns, so they arrive keyed by whatever the form called them --
 * "what_type_of_pain_are_you_experiencing?" on one branch's sheet, "What type of pain are
 * you experiencing" on the next. Compared on letters and digits alone so a form that
 * gains a capital, loses its question mark or swaps underscores for spaces keeps filling
 * its column instead of quietly going blank, which is a failure nobody can see.
 *
 * Falls back to the lead's own field where the question has one. A source whose mapping
 * sends this column to Condition or Months of Pain has no extra_fields entry left to read
 * -- the answer moved to the field it was mapped onto -- and the column would empty out
 * for exactly the sources that mapped themselves most carefully.
 */
const squashKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const formAnswer = (lead, questionKey, fallback, formatFallback) => {
  const wanted = squashKey(questionKey);
  const extras = lead?.extra_fields || {};
  for (const [key, value] of Object.entries(extras)) {
    if (squashKey(key) === wanted && value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  const own = fallback ? lead?.[fallback] : null;
  if (own === null || own === undefined || String(own).trim() === "") return "";
  // The field's own value needs its unit put back on. The sheet answer reads "3-6 months"
  // because that is what the patient ticked; months_of_pain is the bare number 6, and a
  // column headed Pain Duration showing "6" is not an answer to it.
  return formatFallback ? formatFallback(own) : String(own).trim();
};

/** "offline_physio" -> "Offline Physio", and whatever it already said where the dropdown
 *  has no label for it: department is not a controlled field on an imported lead. */
const departmentLabel = (value) =>
  DEPARTMENT_OPTIONS.find((d) => d.value === value)?.label || value || "";

/**
 * A sheet column's key, said the way a person would say it.
 *
 * extra_fields is keyed by whatever the intake form called the question, which arrives as
 * "what_type_of_pain_are_you_experiencing?". Printed verbatim that reads as a database row
 * rather than as the answer somebody actually gave, so the underscores come out and the
 * first letter goes up. Nothing else is touched — the question mark is part of the
 * question, and re-casing the words would turn a sentence into a headline.
 */
const humanKey = (key) => {
  const words = String(key || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
};

/**
 * One ad-record field, said the way the form that set it says it.
 *
 * "fb" is Facebook, and is_organic comes back as a real boolean rather than as the
 * "true"/"false" strings its select submitted — so the lookup is made on the stringified
 * value, which is the one form both of them share.
 */
const adFieldValue = (field, value) => {
  if (value === null || value === undefined || value === "") return "";
  if (field.options) {
    const match = field.options.find(([option]) => option === String(value));
    return match ? match[1] : String(value);
  }
  return String(value);
};

/** Whether a lead actually carries an answer. Explicit rather than falsiness, because 0 is
 *  one: "months_of_pain: 0" is somebody who started hurting this month. */
const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/** A label and its value hard against the other edge, for the read-only cards below.
 *  Aligned to the top rather than centred so the label stays level with the first line of
 *  an address that wraps, and break-words so an ad id with nowhere to break still does. */
const DetailRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 text-sm" data-testid={`branch-lead-row-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
    <span className="shrink-0 text-xs font-medium text-slate-500">{label}</span>
    <span className="break-words text-right font-medium text-slate-800">{value}</span>
  </div>
);

/** "2026-08-05" -> "05 - 08 - 2026" */
const dmyLabel = (d) => {
  const [y, m, day] = String(d || "").split("-");
  return y && m && day ? `${day} - ${m} - ${y}` : d || "—";
};
/** "2026-08-05" -> "Wednesday, 5 August" */
const weekdayLabel = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })
  : "—");
/** "2026-08-19" -> "Wednesday 19-08-2026". The popup hero only; the printed sheet and the
 *  card keep the spelled-out month, which reads better on paper and cannot be mistaken for
 *  month-first by a patient reading it. */
const weekdayDmy = (d) => {
  const [y, m, day] = String(d || "").split("-");
  if (!y || !m || !day) return d || "—";
  const weekday = new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday} ${day}-${m}-${y}`;
};

/** The slot on a lead, for the Branch Leads list — "06 Aug" + "10:30 AM".
 *  Pre-Sales writes appointment_date/time when it schedules, and assigning the Fitsiomax
 *  Expert later overwrites them with the branch's own confirmed slot. So while no physio
 *  is assigned this is still Pre-Sales' requested time, which is what New Appointment
 *  needs to show. Dates are plain "YYYY-MM-DD" calendar days, not instants, so they are
 *  parsed at local midnight and never shift a day. */
const apptSlotLabel = (lead) => {
  const date = lead?.appointment_date;
  const time = lead?.appointment_time;
  if (!date && !time) return null;
  return {
    date: date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "",
    time: time ? to12h(time) : "",
  };
};

// `compact` drops the three facts the confirmation's own hero already states in bigger
// type — the on-screen popup shows that hero, so repeating them underneath is noise. The
// printed sheet keeps them, where the row list has to stand on its own as the record.
const apptRows = (a, { compact = false } = {}) => [
  ["Reference No.", a.refNo],
  ["Patient", a.patient],
  ["Patient No.", a.patientNo],
  ["Phone", a.phone],
  compact ? null : ["Date", dmyLabel(a.date)],
  compact ? null : ["Time", `${to12h(a.time)} – ${endTime12h(a.time, a.duration)}`],
  // Popup drops it: the sheet is the record and still carries it, but on screen the
  // start time is what the patient is told and a length beside it invites the question.
  compact ? null : ["Duration", `${a.duration} minutes`],
  compact ? null : ["CONSULTANT", a.headPhysio],
  a.branch ? ["Branch", a.branch] : null,
  // Where an online appointment actually happens, so the sheet the patient keeps carries
  // it as plainly as a branch name. Kept in the compact popup too, unlike Date and Time
  // above: those are dropped because the card overhead already shouts them, and this one
  // appears nowhere else on that screen.
  a.meetLink ? ["Google Meet", a.meetLink] : null,
  ["Booked By", a.bookedBy],
];

/** lucide has no WhatsApp glyph and the brand mark can't be approximated with a generic
 *  chat bubble — staff scan for this exact shape. */
const WhatsAppIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.943c0 2.096.549 4.142 1.595 5.945L0 24l6.305-1.654a11.94 11.94 0 005.71 1.454h.005c6.585 0 11.946-5.359 11.949-11.945a11.87 11.87 0 00-3.44-8.406" />
  </svg>
);

/** 128 bits from the platform CSPRNG — the share link's only key, so it can't be a
 *  counter or anything derived from the patient's own details. */
const randomToken = () => {
  const bytes = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** A stored phone in E.164 for wa.me, which takes digits only — no +, spaces or the
 *  "p:" prefix some records carry. A bare 10-digit number is assumed Indian, matching
 *  every other number in the system; anything already carrying a country code is left
 *  alone. Returns "" when there's nothing dialable, so the button can hide itself. */
const waNumber = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};

/**
 * Puts the card PNG on the system clipboard.
 *
 * Safari only honours a ClipboardItem built around an unresolved promise — awaiting the
 * blob first spends the user gesture and the write is refused. Chrome accepts both, so
 * the promise form is tried first and the resolved form is the fallback for anything
 * that rejects it. A false return is not an error: the message still sends, it just
 * arrives without the picture.
 */
const copyCardToClipboard = async (a) => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": apptCardPng(a) })]);
    return true;
  } catch {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await apptCardPng(a) })]);
      return true;
    } catch {
      return false;
    }
  }
};

/** A phone rather than a desk: the two need opposite handoffs, below. */
const isHandheld = () => (typeof window !== "undefined"
  && (window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0));

// Above the two senders that call them. A const is not hoisted, so the pair only start
// existing at the line they are written on, and that line was below both callers.
const downloadApptCard = async (a, prebuilt) => {
  try {
    const blob = prebuilt || await apptCardPng(a);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `appointment-${a.refNo || "confirmation"}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    toast.error("Couldn't build the card image");
  }
};

/** The confirmation as a note to the patient — the day, the hours, the place, and a line
 *  telling them they're in hand. Short lines, because it is read on a phone in WhatsApp.
 *
 *  Where the appointment carries a meeting link, the place is that link and the message
 *  says so instead of naming a branch. The two endings are exclusive on purpose rather
 *  than the link being one more line on the old one: an address, a map pin and "arrive 10
 *  minutes early" tell a patient to travel, and a patient told to travel to a video call
 *  either goes to a branch that is not expecting them or reads the message as a mistake
 *  and asks. The room is where they are being asked to be, so it is the only place named. */
const apptMessage = (a) => {
  const meet = (a.meetLink || "").trim();
  const lines = [
    `Hi ${a.patient},`,
    "",
    "Your appointment is",
    weekdayLabel(a.date),
    `${to12h(a.time)} to ${endTime12h(a.time, a.duration)}`,
  ];
  // Online is a mode, not a branch, so the branch line goes with the rest of the room.
  if (a.branch && !meet) lines.push(`at ${a.branch}`);
  if (meet) lines.push("online, on Google Meet");
  lines.push("", REASSURANCE, "— Team Fitsiomax", "", `CONSULTANT: ${a.headPhysio}`);
  if (a.notes) lines.push(`Notes: ${a.notes}`);
  if (meet) {
    lines.push("", "Join here:", meet, "", "Please join 5 minutes early.");
    return lines.join("\n");
  }
  if (a.branchAddress) lines.push("", `Location: ${a.branchAddress}`);
  if (a.mapLocation) lines.push(a.mapLocation);
  lines.push("", "Please arrive 10 minutes early.");
  return lines.join("\n");
};

/**
 * Opens WhatsApp on the patient's own number with the confirmation already typed, and
 * leaves the card image on the clipboard so it can be pasted in on top.
 *
 * The split is forced by WhatsApp, not chosen: wa.me is the only route that addresses a
 * specific number and it carries text only, while the share sheet is the only route that
 * carries an attachment and it always asks who it is for. The clipboard bridges them —
 * pasting into the chat attaches the card and WhatsApp moves the typed text down into
 * its caption, which is the picture-above/words-below shape the branch is after.
 *
 * Resolves true when the card made it to the clipboard. Both outcomes are reported here,
 * so callers need not.
 */
const sendApptOnWhatsApp = async (a) => {
  const num = waNumber(a.phone);
  if (!num) { toast.error("This patient has no phone number on file"); return false; }

  // The tab has to be claimed here, synchronously, while the click is still the reason
  // anything is happening — after the await below the gesture is spent and the popup
  // blocker takes it. Opened blank and pointed at WhatsApp once the card is copied.
  // noopener isn't passed because it makes window.open return null; opener is cleared
  // by hand instead, which buys the same protection while keeping the handle.
  const tab = isHandheld() ? null : window.open("", "_blank");
  if (tab) tab.opener = null;

  const copied = await copyCardToClipboard(a);
  // Both outcomes are worth saying, since the popup itself no longer explains the paste.
  // On desktop WhatsApp takes its own tab, so this is still on screen when the branch
  // looks back at the board; on a phone the page navigates away and neither would have
  // survived anyway.
  if (copied) toast.success("Card copied — paste it into the chat to send the picture");
  else toast.message("This browser can't copy the card — use Send Card + Message for the image");
  const url = `https://wa.me/${num}?text=${encodeURIComponent(apptMessage(a))}`;

  if (tab && !tab.closed) {
    // Desk: WhatsApp Web gets its own tab and the board stays where it was, so the
    // "now paste it" prompt is still on screen when the branch looks back.
    tab.location.href = url;
  } else {
    // Phone: same-tab, not window.open(..., "_blank") — that hands mobile browsers an
    // ambiguous new-tab context and often leaves the app on a blank white screen once
    // WhatsApp gives control back (caf18a6, same fix on the Physio board).
    window.location.href = url;
  }
  return copied;
};

/** The card image plus the message, through the OS share sheet — the only path that can
 *  carry an attachment, at the cost of picking the recipient there. */
const shareApptCard = async (a) => {
  try {
    const blob = await apptCardPng(a);
    const file = new File([blob], `appointment-${a.refNo || "confirmation"}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: apptMessage(a) });
      return;
    }
    downloadApptCard(a, blob);
    toast.success("Card saved — attach it to your message");
  } catch (err) {
    if (err?.name === "AbortError") return;  // the user closed the share sheet
    toast.error("Couldn't build the card image");
  }
};

/** The card on its own, for attaching by hand where the share sheet isn't available. */
const apptHtml = (a) => `<!doctype html><html><head><meta charset="utf-8">
<title>Appointment ${escapeHtml(a.refNo)}</title><style>${PRINTABLE_STYLES}</style></head>
<body><div class="wrap">
  <div class="head">
    <img class="logo" src="${LOGO_URL}" alt="FITSIOMAX">
    <div>
      <div class="brand">FITSIOMAX</div>
      <div class="sub">${escapeHtml(a.branch || "Physiotherapy & Rehabilitation")}</div>
    </div>
  </div>
  <div class="tag tag-appt">APPOINTMENT CONFIRMED</div>
  <hr>
  <div class="amt-label">Your Appointment</div>
  <div class="amt amt-appt">${escapeHtml(weekdayLabel(a.date))}<br>${escapeHtml(to12h(a.time))}</div>
  <hr>
  ${rowsHtml(apptRows(a))}
  ${a.notes ? `<div class="note"><b>Notes</b><br>${escapeHtml(a.notes)}</div>` : ""}
  <div class="note">${a.meetLink ? "Please join the meeting 5 minutes early." : "Please arrive 10 minutes early."} To reschedule or cancel, contact the branch
  quoting reference ${escapeHtml(a.refNo)}.</div>
  <hr>
  <div class="foot">This is a computer-generated confirmation and needs no signature.<br>Thank you for choosing FITSIOMAX.</div>
</div></body></html>`;

// Which of the six get a direct slot on the phone bar. The other three go behind More.
const BOTTOM_NAV_KEYS = ["pipeline", "review", "consultations"];

// The two desks that only exist in a room. Zumba is a class taught in the branch's studio
// in two fixed morning slots, and Fitness is the gym's membership roll — who is training,
// who is paused, who owes on a package. Neither is something an arm with no floor sells.
const ROOM_ONLY_TABS = ["zumba", "fitness"];

/** Whether this role runs an arm that has no room in it.
 *
 * Both online branch admins do, and both lose both tabs above — including the Fitness one
 * from ONLINE FITNESS ADMIN, which looks like the wrong tab to take off that board until
 * you read what it holds. It is the gym's membership roll, sold against the Fitness shelf
 * and worked on the floor; online fitness is not run from it. Leaving it there offered a
 * desk whose every row would have to be somebody else's branch's.
 *
 * Matched exactly, like isBranchAdminRole in pages/CRMPage.jsx and for the same reason: a
 * loose match on the "online" token would also catch a plain branch_admin at a branch
 * whose name happens to carry the word, and take two working desks off their board.
 *
 * The three retired branch_admin_* slugs are deliberately absent. Every one of them named
 * a practice sold in a room, so none can be the online arm, and reading them as one would
 * strip the tabs from a physical branch whose account the migration has not reached.
 */
const ONLINE_BRANCH_ADMIN_ROLES = ["online_physio_admin", "online_fitness_admin"];
const runsWithoutARoom = (role) => ONLINE_BRANCH_ADMIN_ROLES.includes(String(role || "").trim().toLowerCase());

// Which Department a lead created on one of those boards is. Pinned rather than left to
// the dropdown, because the arm board finds its leads by their vertical and the vertical
// is derived from this field — so a lead entered here with the Department left blank would
// be saved as offline physiotherapy and vanish from the board that created it. That is the
// same disappearance this whole path is fixing, one step further along.
//
// Kept in step with DEPARTMENT_OPTIONS and VERTICAL_MAP in components/CreateLeadModal.jsx,
// and through them with ONLINE_ARM_PRACTICE in backend/deps.py, which is what reads the
// vertical back.
const ARM_DEPARTMENT = {
  online_physio_admin: "online_physio",
  online_fitness_admin: "online_fitness",
};

/**
 * Does this lead belong under that consultation stage chip?
 *
 * Every stage but one is the plain string on the lead. Diet Consultation is a stage
 * nothing ever writes: the backend sets consultation_stage to Follow Up, Consultation
 * Visit, Fee Collected, Physio Assign, Treatment Fee and Consultation Completed, and
 * never to this one — so the chip could only ever read 0 and its list could only ever be
 * empty, however many diet patients the branch had.
 *
 * It is matched on the lead's diet flag instead, which is set when the Head Physio
 * recommends diet, when a Diet Consultation is booked, and when the Diet Fee is
 * collected. That is the same flag the Diet Master View's own queue is built from, so the
 * two boards now agree on who is a diet patient.
 *
 * Deliberately NOT done by moving the lead's consultation_stage: diet runs alongside
 * treatment rather than instead of it, so a patient moved into this stage would vanish
 * from Fee Collected or Physio Assign, where their physio course still lives. The chip
 * reads a fact about the lead; it does not relocate them.
 *
 * Mirrors the "Treatments" virtual stage ConsultationsBoard already matches this way.
 */
export const matchesConsultationStage = (lead, stageName) => {
  // Recommending diet is not being on the diet programme. A consultation that ticks the box
  // starts the conversation; the patient is on it once the branch has taken the fee and a
  // Nutrition Coach has them. Reading the flag alone filled this stage with everybody who
  // had ever been offered it, which is a list nobody can work.
  if (stageName === "Diet Consultation") return lead.diet_fee_paid != null && !!lead.diet_coach_id;
  // Diet Chart, beside it: a separate product with its own fee (see DIET_FEE_KINDS.chart
  // in ConsultationsBoard), so a patient is on this pill because that fee is in, not
  // because a coach was assigned or a consultation was booked.
  if (stageName === "Diet Chart") return lead.diet_chart_fee_paid != null;
  // Rehab, on the same footing: a stage nothing writes. A patient is on the rehab list
  // because their Rehab Fee is in, and they keep whatever position they actually hold in
  // the physio pipeline — rehab runs beside it, not inside it.
  if (stageName === "Rehab") return lead.rehab_fee_paid != null;
  // Nothing left to attend — see isCourseComplete, which both boards showing this stage
  // now read it through.
  if (stageName === "Completed") return isCourseComplete(lead);
  // And nowhere else in the pipeline, which is the half that makes that line true. Nothing
  // writes "Completed" onto a lead, so consultation_stage still reads Fee Collected or
  // Physio Assign for a patient with nothing left to attend — counted under both, with the
  // two counts along one bar adding up to more patients than the branch has.
  //
  // Below the cross-cutting trio above it on purpose: Rehab, Diet Consultation and Diet
  // Chart are facts about a patient rather than positions, and are meant to hold whoever
  // they describe.
  //
  // Cancel keeps whatever it holds: abandoning a course is not finishing one, the same rule
  // matchesBranchStage follows.
  if (lead.consultation_stage !== "Cancel" && isCourseComplete(lead)) return false;
  return lead.consultation_stage === stageName;
};

/**
 * Does this lead belong under this Branch stage?
 *
 * Nearly always a branch_stage comparison. The exception is the "Leads" pill, which the
 * board sends down carrying `mirrors_stage`: it claims every lead still sitting at the
 * branch's own opening (`unmoved_branch_stage`, i.e. "Branch Assign"), and lets go of them
 * the moment the branch moves them anywhere.
 *
 * It used to require the second half as well — that the lead was ALSO an unworked Pre-Sales
 * New Lead, which is where the pill's name comes from. That half was dropped when the
 * branch's own entry stage lost its pill to this one (see leadPillStages): the strip has a
 * single opening now, so the pill has to hold everyone standing in it. A branch that was
 * switched off Pre-Sales control carries leads rehomed onto Branch Assign with their old
 * Pre-Sales stage still on them (realign_branch_stage_leads), and under the old two-part
 * match those leads would now belong to no pill at all.
 *
 * The third exception is a lead the consultation pipeline has taken over. This board shows
 * both pipelines as one strip, and nothing writes branch_stage again once the appointment is
 * booked — so a patient the consultant had already seen went on being counted under
 * Appointment as well as under Consultation Visit, with the row's own chip (rowStageName)
 * saying one thing and the pill it was listed under saying the other. Moving forward in the
 * consultation pipeline takes the lead out of the Branch pills, the same way moving forward
 * in the Branch pipeline already takes it out of the mirrored Leads pill.
 *
 * The other exception is Completed, which is now read off the lead rather than written —
 * the same rule and the same isCourseComplete the Consultations board already shows that
 * stage through, so the two pill sets sharing one row cannot say different things about
 * the same patient. A finished patient therefore leaves whichever stage they were parked
 * in, which is what this pipeline could never do on its own: every other stage in it is
 * set by a Branch Admin acting on the patient, and nobody acts on a branch board when a
 * course ends on a physio's or a Nutritionist's.
 */
export const matchesBranchStage = (lead, stage, isConsultationOnlyStage = () => false) => {
  const name = stage?.name;
  const here = lead.branch_stage;
  // Cancel is an abandonment rather than an ending, so it keeps whatever it holds and is
  // never read as finished. Both spellings: this pipeline stores "Cancelled" and the
  // consultation one is named "Cancel", and the two pill sets are shown in one row.
  const abandoned = here === "Cancelled" || here === "Cancel";
  const finished = !abandoned && isCourseComplete(lead);
  // Only the Consultation-ONLY stages hand a lead over. A name both pipelines share
  // ("Follow Up") gets a single pill backed by the sales-side field, and booking an
  // appointment seeds exactly that stage — releasing on it would drop every freshly booked
  // lead out of Appointment with no pill left to land in.
  const handedOver = !abandoned && isConsultationOnlyStage(lead.consultation_stage);
  // Completed is read off the lead here the way it already is on the Consultations board,
  // rather than waiting for somebody to move them. This pipeline is otherwise written
  // entirely by hand, and nothing in it was ever going to be written when a course ended
  // somewhere else — a patient whose treatment the physio closed, or whose diet report and
  // chart had both gone out, sat under whichever stage the branch last set, which for this
  // one was the Appointment they had already been to.
  //
  // Still claims anyone moved there by hand, so the leads already sitting in Completed
  // stay in it whether or not the lead reads as finished.
  if (name === "Completed") return finished || here === "Completed";
  // And a finished patient — or one the consultation pipeline has moved on — leaves every
  // other pill, which is the half that makes the first half true: a lead counted under both
  // Appointment and Consultation Visit is not a pipeline, and the counts across the row
  // would add up to more than the branch has.
  if (finished || handedOver) return false;
  if (!stage?.mirrors_stage) return here === name;
  return here === stage.unmoved_branch_stage;
};

/**
 * Confirm a bulk delete by typing the word.
 *
 * A count and an OK button is the shape of dialog people learn to dismiss, and this one
 * cannot be undone. Typing DELETE costs a second and cannot be done by muscle memory, so
 * the agreement is to this particular delete rather than to dialogs in general.
 *
 * The names are listed rather than only counted. "Delete 47 patients" is a number; the
 * list is what lets someone notice a real patient among the junk before it goes.
 */
function BulkDeleteLeadsModal({ leads, onClose, onDeleted }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = typed.trim().toUpperCase() === "DELETE";

  const run = async () => {
    if (!armed) return;
    setBusy(true);
    try {
      const res = await bulkDeleteLeads(leads.map((l) => l.id), typed.trim().toUpperCase());
      const blocked = res.blocked || [];
      if (res.deleted > 0) toast.success(`${res.deleted} patient${res.deleted > 1 ? "s" : ""} deleted`);
      // Kept apart from the success line: the ones that survived are the point of the
      // message, and folding both into one toast buries them.
      if (blocked.length) {
        const why = [...new Set(blocked.map((b) => b.reason))].join("; ");
        toast.error(`${blocked.length} kept — ${why}`, { duration: 8000 });
      }
      if (!res.deleted && !blocked.length) toast.error("Nothing was deleted");
      onDeleted(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl" data-testid="branch-bulk-delete-modal">
        <div className="border-b p-5">
          <h3 className="flex items-center gap-2 text-base font-semibold text-rose-700">
            <Trash2 className="h-4 w-4" /> Delete {leads.length} patient{leads.length > 1 ? "s" : ""}?
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            This removes them and their activity, follow-ups and appointments. It cannot be undone.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Being deleted</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="branch-bulk-delete-list">
            {leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="truncate font-medium text-slate-700">{l.name || "Unnamed"}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{l.patient_number || l.phone || "—"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">
            Anyone with treatment sessions or collected payments is kept — they are a patient with a
            record, not an import to clear. You will be told which.
          </p>
        </div>

        <div className="border-t p-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Type <b className="font-mono text-rose-700">DELETE</b> to confirm
          </label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && armed && !busy) run(); }}
            placeholder="DELETE"
            autoFocus
            className="font-mono"
            data-testid="branch-bulk-delete-input"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              size="sm"
              onClick={run}
              disabled={!armed || busy}
              className="bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
              data-testid="branch-bulk-delete-confirm"
            >
              {busy ? "Deleting..." : `Delete ${leads.length}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const BranchAdminBoard = ({ branchId, embedded = false, branchPicker = null, currentUser = null }) => {
  const [boardData, setBoardData] = useState({ leads: [], stage_counts: {}, stages: [] });
  const [consultationStages, setConsultationStages] = useState([]); // dynamic Consultation Stages, merged into the same stage bar
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Phone only: the toolbar's search is an icon until tapped. Desktop's field is always
  // open and ignores this.
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [activeView, setActiveView] = useState("pipeline");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [consultationsSubTab, setConsultationsSubTab] = useState("head_physio");
  const [stageFilter, setStageFilter] = useState(null); // null = show all stages
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null
  // The Consultation tab's own horizontal range row — All / Today / This Week / This
  // Month / Last 90 Days / Custom. Kept in its own state rather than sharing the one
  // above so the toolbar's date filter is left exactly as it was: pressing a range here
  // does not rewrite that control's label, and clearing that control does not undo the
  // range picked here. The two combine below.
  const [quickDate, setQuickDate] = useState(null); // same shape; null = All

  // Bumped by Refresh. loadBoard only reloads the branch leads; on a consultation stage
  // the rows on screen come from ConsultationsBoard, which needs telling separately.
  const [refreshTick, setRefreshTick] = useState(0);
  const [showCreateLead, setShowCreateLead] = useState(false);
  // Ticked rows in the leads table, and the confirm dialog they feed. A Set because this
  // is asked "is this row ticked" once per row on every render, and 2,000 rows against an
  // array is 2,000 scans of it.
  const [picked, setPicked] = useState(() => new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  // Set when a lead's own detail popup hands off to a Consultation-only stage — tells the
  // embedded ConsultationsBoard which lead to auto-open once it loads, so the handoff lands
  // straight on that lead's own rich modal instead of just the filtered list.
  const [autoOpenLeadId, setAutoOpenLeadId] = useState(null);

  // The bell's number, kept beside the board rather than inside it: the count is wanted
  // on every tab, and the board it belongs to is only mounted while somebody is looking
  // at it.

  // Whether this board is scoped to an arm rather than to a branch. An online admin has no
  // branch_id — an online arm is not a branch record and its leads carry a vertical instead
  // of a branch — so asking /branch-board for branch "" is asking for nothing, which is
  // what this board did and why both online admins saw an empty table with no explanation.
  const armScoped = runsWithoutARoom(currentUser?.role);

  const loadBoard = useCallback(async () => {
    // Only a branch board needs a branch. Returning here used to be silent, which is how an
    // admin with no branch got "No patients yet." — the table's empty state standing in for
    // an answer to a question the board had never asked.
    if (!branchId && !armScoped) {
      setBoardData({ noScope: true });
      return null;
    }
    setLoading(true);
    let data = null;
    try {
      data = armScoped ? await getArmBoard() : await getBranchBoard(branchId);
      setBoardData(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Failed to load branch board");
    }
    setLoading(false);
    return data;
  }, [branchId, armScoped]);

  // The two hand-made marks on a row: VIP, and needs attention. Patched into the list in
  // place rather than reloading the board — this is a click on one row of a list that can
  // run to thousands, and a full refetch would scroll-jump the person who pressed it.
  //
  // Only the flag that changed is sent, so pressing the star cannot also rewrite an
  // attention mark a colleague set a moment ago.
  const toggleLeadFlag = async (lead, field) => {
    const next = !lead[field];
    // Shown immediately and put back if the server refuses: a mark that lags a click reads
    // as a dead button and gets pressed again.
    setBoardData((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === lead.id ? { ...l, [field]: next } : l)) }));
    try {
      await setLeadFlags(lead.id, { [field]: next });
    } catch (err) {
      setBoardData((b) => ({ ...b, leads: (b.leads || []).map((l) => (l.id === lead.id ? { ...l, [field]: !next } : l)) }));
      toast.error(err?.response?.data?.detail || "Couldn't save that mark");
    }
  };

  useEffect(() => { loadBoard(); }, [loadBoard]);
  useEffect(() => { stagesList("consultation").then(setConsultationStages).catch(() => {}); }, []);

  // Branch Stages come with the board rather than from /stages, because which ones this
  // branch has depends on its Lead Control: a branch running its own leads opens at Branch
  // Assign and has an RNR stage, one fed by the Pre-Sales desk opens at New Appointment and
  // has neither. Arriving on the same response as lead_control keeps the strip and the tabs
  // describing the same mode — a separate fetch would briefly disagree after a flip.
  const stages = useMemo(() => boardData.stages || [], [boardData.stages]);

  const stageColor = useCallback(
    // Both pipelines: a row's chip can now name a consultation stage, and looking only in
    // the sales list would have found no colour and painted it the grey of a stage nobody
    // recognises.
    (name) => (stages.find((s) => s.name === name) || consultationStages.find((s) => s.name === name))?.color || "#64748b",
    [stages, consultationStages],
  );

  // The two ways a lead can open its journey on this board: the mirrored Pre-Sales "Leads"
  // pill, and the branch's own real entry stage ("Branch Assign", or "New Appointment" on
  // Pre-Sales control). Both are pre-physio, so both drop the Physio column; a lead's popup
  // shows whichever of the two it came in through, never both.
  const mirrorStage = useMemo(() => stages.find((s) => s.mirrors_stage) || null, [stages]);
  const realEntryStage = useMemo(() => stages.find((s) => !s.mirrors_stage) || null, [stages]);

  // What a row's Stage chip should say.
  //
  // The consultation stage when the lead has one. This read branch_stage alone, which
  // stops at Appointment Date & Time the moment the appointment is booked and never moves
  // again -- so a patient whose consultation was done, whose fee was collected and whose
  // physio was assigned still read "Appointment" on this board, for good. The stage bar
  // above already spans both pipelines and counts those leads under Consultation Visit,
  // Fee Collected and Physio Assign; only the chip was still reading the first half of the
  // journey.
  //
  // Except where the branch stage is a final one. Cancelling an appointment leaves
  // consultation_stage exactly where it was, and that the lead was cancelled is the more
  // important thing to say about them than wherever their consultation had reached.
  //
  // And except at the branch's own opening, which reads "Leads" wherever the row is
  // listed -- not only under the Leads pill, as this once did. That pill is the whole of
  // the opening on the strip now (see leadPillStages), so a chip saying "Branch Assign"
  // would name a stage the bar above has no pill for: nothing to click, and nothing to
  // tell the reader which pill their row is counted under.
  const showingMirror = !!mirrorStage && stageFilter === mirrorStage.name;
  // Is this lead standing at that opening? Only meaningful on a branch running its own
  // leads; a Pre-Sales-fed branch has no mirror pill and keeps naming its entry stage.
  const atBranchOpening = useCallback(
    (lead) => !!mirrorStage && !!lead?.branch_stage && lead.branch_stage === realEntryStage?.name,
    [mirrorStage, realEntryStage],
  );
  const finalBranchStages = useMemo(
    () => new Set(stages.filter((s) => s.is_final).map((s) => s.name)),
    [stages],
  );
  const rowStageName = useCallback(
    (lead) => {
      if ((showingMirror || atBranchOpening(lead)) && lead.branch_stage) return mirrorStage.name;
      if (lead.branch_stage && finalBranchStages.has(lead.branch_stage)) return lead.branch_stage;
      // Finished, and no stage field anywhere says so — nothing writes "Completed" onto a
      // lead, which is why both pill sets read it off the patient instead. The chip has to
      // read it the same way or a row listed under Completed sits there saying Fee
      // Collected. Cancelled leads are already answered by the final-stage line above.
      if (lead.consultation_stage !== "Cancel" && isCourseComplete(lead)) return "Completed";
      return lead.consultation_stage || lead.branch_stage;
    },
    [showingMirror, atBranchOpening, mirrorStage, finalBranchStages],
  );
  const entryStageNames = [mirrorStage?.name, realEntryStage?.name].filter(Boolean);

  // A stage the Consultation pipeline owns and the Branch one does not. Any name the two
  // share (e.g. "Follow Up") stays on the Branch side and is backed by the sales field, so
  // one name never gets a pill on both bars answering off different columns.
  const consultationOnlyStages = useMemo(
    () => consultationStages.filter((cs) => !stages.some((s) => s.name === cs.name)),
    [stages, consultationStages],
  );

  // Which of the Branch stages get a pill on the strip. Four of them: Leads, RNR, Follow
  // Up, Appointment — the shape the branch pipeline was built to mirror in the first place
  // (see BRANCH_ADMIN_ENTRY_STAGE in the backend's constants.py).
  //
  // Only the strip. The pipeline itself is untouched: every stage dropped here is still a
  // real position, still written to leads, still on the lead card's own Pipeline Stage row,
  // and still counted in All Stages. What changes is which of them the reader can filter by.
  //
  //   - The branch's own entry stage ("Branch Assign") hands its pill to Leads, which now
  //     claims everyone sitting there (see matchesBranchStage). They were two pills over
  //     one position — one named for the position, one for the lead standing in it.
  //   - Portfolio comes off. It is reached by its own scheduling dialog, not by the strip.
  //   - So does the final stage ("Cancelled"), for the same reason: cancelling happens in
  //     the appointment dialog and on the lead card, and the pill only ever showed the
  //     leftovers.
  //
  // Gated on there being a mirror pill at all, which is to say on the branch running its
  // own leads. A Pre-Sales-fed branch has no Leads pill to hand the opening to, so its
  // strip is left exactly as it was.
  const leadPillStages = useMemo(() => {
    if (!mirrorStage) return stages;
    return stages.filter((s) => s.mirrors_stage || (
      s.name !== realEntryStage?.name
      && s.name !== BRANCH_PORTFOLIO_STAGE
      && !s.is_final
    ));
  }, [stages, mirrorStage, realEntryStage]);

  // The two bars used to be one. Branch Leads carried both pipelines end to end, which put
  // thirteen pills on a strip where the first six answer "has this lead been picked up"
  // and the rest answer "how is their treatment going" — one bar reading as one question
  // when it was two, and a patient counted under Leads and again under Fee Collected.
  //
  // Each tab now shows the stages its own pipeline owns, and the board under it is decided
  // by the tab rather than by which pill happens to be lit.
  const onConsultationTab = activeView === "branch_consultation";
  // The same test asked of a lead's consultation_stage rather than of the lit pill: has this
  // lead reached the half of the strip the Branch pipeline does not own? Handed to
  // matchesBranchStage, which releases it from the Branch pills once it has.
  const isConsultationOnlyStage = useCallback(
    (name) => !!name && !stages.some((s) => s.name === name),
    [stages],
  );

  // Which mark the board is narrowed to, if any. Alongside the Date Filter and the search
  // rather than beside the stage pills: it narrows WHO is on the board, not where they are
  // in it, so a stage pill still means the same thing under it.
  const [markFilter, setMarkFilter] = useState(""); // "" | "vip" | "attention"

  // Switching tabs drops a stage the new tab has no pill for. Left alone it would narrow
  // the board to a stage with nothing on screen naming it and no second click to clear it.
  // A filter the new tab *does* own survives, which is what lets a lead popup send the
  // reader straight to its Consultation stage without this undoing the trip.
  useEffect(() => {
    const ownedHere = (activeView === "branch_consultation" ? consultationOnlyStages : leadPillStages)
      .some((st) => st.name === stageFilter);
    if (stageFilter && !ownedHere) setStageFilter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  // What the board is actually narrowed to. The toolbar's date filter and the range row's
  // quick pick are two independent controls over one list, so they combine by overlap
  // rather than one overwriting the other — each keeps showing its own state, and neither
  // can quietly cancel the other out.
  //
  // Both tabs draw the range row now, so this no longer needs to branch on which one is
  // active: quickDate simply stays null wherever the row isn't mounted, and
  // intersectDateFilters(dateFilter, null) is just dateFilter.
  const effectiveDateFilter = useMemo(
    () => intersectDateFilters(dateFilter, quickDate),
    [dateFilter, quickDate],
  );

  const filteredLeads = useMemo(() => {
    let list = boardData.leads;
    if (effectiveDateFilter) {
      const from = effectiveDateFilter.from?.getTime();
      const to = effectiveDateFilter.to?.getTime();
      list = list.filter((l) => {
        const ts = new Date(l.created_at || 0).getTime();
        if (!ts) return false;
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((l) =>
        l.name?.toLowerCase().includes(q) || l.phone?.includes(q) || l.email?.toLowerCase().includes(q)
      );
    }
    // Applied here, with the other two, rather than to the list alone. This used to narrow
    // only the rows and only on All Stages, on the reasoning that two narrowings at once --
    // each with its own count above it -- is a list nobody can account for. That reasoning
    // was right about the danger and wrong about the fix: drawn through the same memo the
    // counts are, every pill on the bar narrows with the list, so the row of counts still
    // describes exactly what is under it. Nothing is left saying otherwise, and a branch can
    // ask "which of my VIPs are in Fee Collected" on the stage where that is worked.
    if (markFilter === "vip") list = list.filter((l) => l.is_vip);
    else if (markFilter === "attention") list = list.filter((l) => l.needs_attention);
    return list;
  }, [boardData.leads, searchQuery, effectiveDateFilter, markFilter]);

  // The rows the table is actually showing. Hoisted out of the table body because the
  // select-all box and the delete bar have to agree with it exactly — "select all" that
  // picks up a row the stage filter is hiding deletes something nobody looked at.
  // The marks are already applied by filteredLeads above, so this is the stage pill and
  // nothing else.
  const visibleLeads = useMemo(() => {
    if (stageFilter) return filteredLeads.filter((l) => matchesBranchStage(l, stages.find((s) => s.name === stageFilter), isConsultationOnlyStage));
    return filteredLeads;
  }, [filteredLeads, stageFilter, stages, isConsultationOnlyStage]);

  // A tick survives scrolling and reopening a row, but not a change to what is on screen.
  // Searching, filtering by date or switching stage replaces the list under the selection,
  // and a delete confirmed against rows the person can no longer see is one they cannot
  // check before agreeing to it.
  useEffect(() => { setPicked(new Set()); }, [stageFilter, effectiveDateFilter, searchQuery, activeView, markFilter]);

  const pickedVisible = useMemo(
    () => visibleLeads.filter((l) => picked.has(l.id)),
    [visibleLeads, picked],
  );

  // No per-row tick any more, so nothing calls a toggle. The rest of the selection is
  // left standing: pickedVisible, the count bar and the bulk-delete dialog are whole and
  // correct, and want only a control to set the selection from. Deleting them would be
  // throwing away a working feature to tidy up after removing its only button.
  // Summary card counts follow the Date Filter (and search) too, instead of always
  // reflecting the branch's all-time totals — so the cards actually describe what's in
  // the table below them right now.
  const salesCounts = useMemo(() => {
    const counts = {};
    stages.forEach((s) => { counts[s.name] = filteredLeads.filter((l) => matchesBranchStage(l, s, isConsultationOnlyStage)).length; });
    return counts;
  }, [filteredLeads, stages, isConsultationOnlyStage]);
  const consultationCounts = useMemo(() => {
    const counts = {};
    consultationStages.forEach((s) => {
      counts[s.name] = filteredLeads.filter((l) => matchesConsultationStage(l, s.name)).length;
    });
    return counts;
  }, [filteredLeads, consultationStages]);

  // "All Stages" is the count of every lead matching the active Date Filter/search —
  // every lead in the branch when neither is set.
  const totalLeads = filteredLeads.length;

  const handleStageUpdate = async () => {
    const data = await loadBoard();
    if (selectedLead && data) {
      const updated = data.leads.find((l) => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
    }
  };

  // `short` is what the bottom nav shows — six full labels will not fit across a phone,
  // and a truncated "Accountant Ma…" reads worse than a word chosen to be short.
  const VIEW_TABS = [
    { key: "pipeline", label: "Branch Leads", short: "Leads", icon: LayoutDashboard },
    // Empty on purpose for now: the tab is the navigation going in ahead of what will sit
    // behind it, so the position is settled while the panel is still being decided.
    //
    // `branch_consultation`, not `consultation`, because `consultations` two rows down is
    // already taken — by the tab labelled Management, for historical reasons. Two keys a
    // single letter apart, both compared as strings against activeView, is a bug waiting
    // for whoever types the wrong one; there is nothing to make it announce itself.
    { key: "branch_consultation", label: "Consultation", short: "Consult", icon: HeartPulse },
    // Sits next to Branch Leads because it is the other list of people the branch is
    // signing up — but its own list, not a stage of theirs: nobody registering for a
    // Zumba class is consulted, treated or discharged.
    { key: "zumba", label: "Zumba", short: "Zumba", icon: Music },
    // Beside Zumba because both are class-based memberships the branch sells and
    // renews, rather than treatment a patient is referred for.
    { key: "fitness", label: "Fitness", short: "Fitness", icon: Dumbbell },
    { key: "review", label: "Review", short: "Review", icon: ClipboardCheck },
    { key: "consultations", label: "Management", short: "Manage", icon: Stethoscope },
    { key: "patients", label: "Patients", short: "Patients", icon: User },
    { key: "accountant_mgmt", label: "Accountant Manage", short: "Accounts", icon: BadgeIndianRupee },
    // Named as Super Admin names it. This tab is that page's catalogue read from a
    // branch, and calling the same shelves two different things left nobody able to say
    // whether the branch was looking at the same list.
    { key: "store", label: "Services and Products", short: "Services", icon: ShoppingCart },
    // Taken off an online arm's own board, where the studio and the gym floor those two
    // desks run do not exist — see runsWithoutARoom.
    //
    // Off `currentUser`, which is only passed where somebody is looking at THEIR OWN
    // branch (pages/CRMPage.jsx). Super Admin, Operations and Branch-wise all mount this
    // board without one, and keep every tab: they are reading a branch rather than running
    // it, and an org-level view that hid a desk depending on whose branch was picked would
    // be answering a question about the viewer.
  ].filter((t) => !(ROOM_ONLY_TABS.includes(t.key) && runsWithoutARoom(currentUser?.role)));

  // The phone bar carries three of the six plus More; the desktop strip above still shows
  // all six. Both halves come off VIEW_TABS, so a tab added there lands in one or the
  // other rather than being dropped.
  const bottomTabs = VIEW_TABS.filter((t) => BOTTOM_NAV_KEYS.includes(t.key));
  const moreTabs = VIEW_TABS.filter((t) => !BOTTOM_NAV_KEYS.includes(t.key));

  // Everything under MANAGEMENT — Experts and Calendar used to be their own
  // top-level tabs, and Manager used to sit one level deeper inside Calendar;
  // all three now live here alongside the two calendars.
  const MANAGEMENT_SUB_TABS = [
    { key: "head_physio", label: "Consultant Calendar", icon: Calendar },
    { key: "physio", label: "Physiotherapist Calendar", icon: Activity },
    // Zumba in the same place, because it answers the same question this row is asking —
    // who works here and when — in the shape Zumba actually has. A master does not publish
    // slots one booking at a time; there are two class times and somebody takes each.
    { key: "zumba", label: "Zumba", icon: Music },
    // Diet is the third vertical, so its calendar sits beside the other two rather than
    // anywhere new — the Branch Admin publishes a Nutrition Coach's days exactly the way
    // they publish a Physio's.
    { key: "diet", label: "Nutritionists Calendar", icon: Salad },
    // Sits next to PHYSIO CALENDAR because that is where its slots come from: a day an
    // absence left dateless is re-booked onto exactly the calendar published one tab over.
    { key: "missed", label: "Missed Classes", icon: UserX },
    { key: "manager", label: "Manager", icon: UserCog },
    { key: "calendar", label: "Calendar", icon: Calendar },
    // Sits after CALENDAR because it is the setting the three calendars above obey: the
    // shift an expert is on is the window their day gets opened across. Last in the strip
    // rather than first for the same reason — it is configured once and then left alone,
    // while the calendars are worked in daily.
    { key: "time", label: "Time Management", icon: Clock },
  ];

  return (
    // flex+gap rather than space-y: Tailwind's space-y keys off the `hidden` *attribute*,
    // so the desk-only tab strip below — hidden by class — still counted as a sibling and
    // pushed the stage bar down 16px for an element a phone never renders. A display:none
    // child isn't a flex item at all, so its gap goes with it.
    //
    // Bottom padding on a phone so the last row of a list clears the fixed nav below.
    //
    // min-w-0 on the children because a flex item defaults to min-width:auto, which would
    // let the scrolling tab strip and the leads table widen the board instead of
    // scrolling inside it.
    <div className={`flex flex-col gap-4 [&>*]:min-w-0 ${embedded ? "" : "pb-20 md:pb-0"}`} data-testid="branch-admin-board-root">
      {/* View Tabs — desk only; a phone gets the bottom nav at the end of this file. */}
      <div className="hidden items-center gap-1 overflow-x-auto border-b border-slate-200 pb-0 md:flex" data-testid="branch-view-tabs">
        {VIEW_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveView(tab.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                activeView === tab.key
                  ? "border-sky-500 text-sky-700"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
              data-testid={`branch-view-tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
        {/* The bell moved to the page header, where Super Admin's already was and where a
            person looks for it. One control, one place, rather than the same thing in two
            with only one of them findable. */}
      </div>

      {activeView === "consultations" ? (
        <div className="space-y-4" data-testid="branch-consultations-headphysio">
          {/* Three across on a phone, so they land as even rows in the order they are
              declared. Left to wrap on their own they came out ragged — four rows, one of
              them holding HEAD PHYSIO CALENDAR alone — because each label is a different
              width. A grid ignores the widths and the icon moves above the label so a
              third of the screen is enough to read it. From sm up nothing changes: one
              flex row of full-size pills. */}
          <div className="grid auto-rows-fr grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1 sm:flex sm:flex-wrap sm:gap-2" data-testid="branch-consultations-subtabs">
            {MANAGEMENT_SUB_TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setConsultationsSubTab(t.key)}
                  className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-center text-[10px] font-semibold leading-tight transition sm:inline-flex sm:shrink-0 sm:flex-row sm:gap-2 sm:whitespace-nowrap sm:px-3 sm:text-sm sm:font-medium ${consultationsSubTab === t.key ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
                  data-testid={`branch-consultations-subtab-${t.key}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />{t.label}
                </button>
              );
            })}
          </div>
          {/* onlineArm rides along to each of them: an arm with no room in it meets its
              patients over video whichever desk they are seeing, so the Google Meet field
              is offered on all of these. Rehab declines it on its own — a programme day is
              worked on the floor with the equipment in the room. See HeadPhysioCalendar. */}
          {consultationsSubTab === "physio" ? (
            <HeadPhysioCalendar branchId={branchId} profileType="physio" onlineArm={armScoped} />
          ) : consultationsSubTab === "zumba" ? (
            <ZumbaMastersPanel branchId={branchId} />
          ) : consultationsSubTab === "diet" ? (
            <HeadPhysioCalendar branchId={branchId} profileType="nutrition_coach" onlineArm={armScoped} />
          ) : consultationsSubTab === "missed" ? (
            <MissedClassPanel />
          ) : consultationsSubTab === "manager" ? (
            <BranchDetailPage branchId={branchId} readOnly />
          ) : consultationsSubTab === "calendar" ? (
            <BranchCalendarPanel branchId={branchId} />
          ) : consultationsSubTab === "time" ? (
            <TimeManagementPanel branchId={branchId} />
          ) : (
            // The Google Meet field rides on this: only an online arm's own admin is asked
            // for a video room, because only their consultations are held in one. The three
            // calendars above are room desks and never carry it — see HeadPhysioCalendar.
            <HeadPhysioCalendar branchId={branchId} onlineArm={armScoped} />
          )}
        </div>
      ) : activeView === "zumba" ? (
        <ZumbaPanel branchId={branchId} />
      ) : activeView === "fitness" ? (
        <FitnessPanel branchId={branchId} />
      ) : activeView === "review" ? (
        <BranchReviewPanel branchId={branchId} />
      ) : activeView === "patients" ? (
        <PatientsPortalPanel branchId={branchId} />
      ) : activeView === "store" ? (
        <FitsiomaxStorePanel branchId={branchId} />
      ) : activeView === "accountant_mgmt" ? (
        <AccountantManageTab branchId={branchId} />
      ) : (
        <>
          {/* Stage Head Bar — Pre-Sales style sticky segmented tabs, and the same block
              serves both tabs: the pills, the toolbar under them and the table are one
              screen answering to one filter, so the two tabs differ by which pipeline's
              stages the bar is given and which board sits underneath, and by nothing
              else. Two copies of this would be two toolbars to keep in step. */}
          <StageTabBar
            stages={onConsultationTab ? consultationOnlyStages : leadPillStages}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            counts={onConsultationTab ? consultationCounts : salesCounts}
            totalCount={totalLeads}
            // All Stages counts every lead on the branch, which is the Branch Leads
            // question. Over the Consultation pills it would head a row that only counts
            // patients who have reached treatment with a figure that includes those who
            // never will.
            hideAllStages={onConsultationTab}
            testid="branch-metric"
            plain
          />

          {/* One toolbar for every stage. It used to sit inside the non-consultation
              branch, so selecting a consultation stage swapped in ConsultationsBoard's
              own toolbar and Branch Leads lost Refresh, Create Lead and Pull from Sheet —
              the same screen offering four actions or two depending on which stage pill
              was lit. The consultations board is told to hide its toolbar (passing
              externalSearch does that) and is driven from here instead. */}
          {/* Six controls on a phone. Left as fields they need roughly 520px against the
              330 a phone gives, so the row either scrolled or squeezed the search to a
              stub — both were reported as broken.

              The search collapses to its icon instead, which is the Physio board's own
              answer to the same problem. That buys ~140px and the remaining five fit at
              full size; tapping it takes the whole row, since a search in use is the only
              thing you are doing. Desktop keeps the field open beside everything else. */}
          <div className="flex items-center gap-1.5 sm:gap-3" data-testid="branch-toolbar">
            {searchOpen ? (
              <div className="relative min-w-0 flex-1 sm:hidden">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  autoFocus
                  className="pl-9 pr-9"
                  placeholder={onConsultationTab ? "Search in Consultations..." : "Search patients..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="branch-search-mobile"
                />
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                  className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100"
                  aria-label="Close search"
                  data-testid="branch-search-close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 sm:hidden"
                aria-label="Search patients"
                title="Search patients"
                data-testid="branch-search-open"
              >
                <Search className="h-4 w-4" />
              </button>
            )}
            {/* The desk's own field. min-w-0 so it can shrink: a flex item defaults to its
                content's width, which would shove the buttons off the right edge.

                Capped rather than left to take the whole row. A search box stretched across
                1400px is mostly empty runway — nobody types a patient name that long — and
                the width is better spent leaving the toolbar's controls grouped where the
                eye already is. The buttons keep their right edge via ml-auto below, so the
                row still reads as one bar rather than a short field with the actions
                drifting in to meet it. */}
            <div className="relative hidden min-w-0 flex-1 sm:block sm:max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder={onConsultationTab ? "Search patients in Consultations..." : "Search patients..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="branch-search"
              />
            </div>
            {/* The one-tap ranges, in the toolbar beside the search rather than on a row
                of their own underneath: search, then ranges, then the actions, one
                horizontal line that never wraps.

                From xl only. The six ranges want ~570px and the five action buttons on the
                right ~240px; under about 1280px they cannot share a line with the search
                without squeezing it to a stub, so narrower screens keep the stacked row
                below instead. The same instance would have had to be two anyway — one
                row cannot be both in the toolbar and under it.

                shrink-0 so the search is what gives way when the row gets tighter. Shared
                by both tabs now — Branch Leads had no range row before, only the calendar
                icon further along, which is why the toolbar comment below still calls out
                that history. */}
            <div className="hidden shrink-0 xl:block">
              <QuickDateFilterBar
                value={quickDate}
                onChange={setQuickDate}
                testid="branch-quick-date-inline"
                inline
              />
            </div>
            {/* Branch Wise's own picker, handed down so it sits in this row rather than in
                a bar of its own above it. Nothing renders here on a real Branch Admin's
                board — they have one branch and never pick.

                It steps aside while the search is open: the expanded field takes the row,
                and leaving these beside it would overflow again, which is the whole thing
                being fixed. */}
            {!searchOpen && branchPicker}
            {/* Icons only. The labels live on title/aria-label rather than being dropped,
                so hovering still says what each one does and a screen reader still
                announces it — an unlabelled glyph that announces nothing is a button only
                the person who built it can use.

                One row with the search at every width — the four of them trail it rather
                than dropping to a line of their own. shrink-0 keeps them at full size and
                lets the search give up the width instead; on the narrowest phones that
                leaves the placeholder clipped, which costs less than a second row. */}
            <div className={`${searchOpen ? "hidden sm:flex" : "flex"} shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-3`}>
            {/* Narrow the board to one mark, on every stage rather than on All Stages
                alone. A branch that has just marked somebody on the stage they are being
                worked on could not then ask to see only those, which is the question the
                mark was put on for — and the marks became settable on every stage before
                the reading of them did.

                Safe on a stage now because the narrowing is applied where the Date Filter
                and the search are, so the counts along the bar move with the list instead
                of standing over it saying something else.

                Lit when active, and pressing the lit one clears it, so the same control
                both narrows and returns. */}
            <div className="flex shrink-0 items-center gap-1" data-testid="branch-mark-filters">
                <button
                  type="button"
                  onClick={() => setMarkFilter((m) => (m === "vip" ? "" : "vip"))}
                  title={markFilter === "vip" ? "Showing VIP clients only — click to show all" : "Show VIP clients only"}
                  aria-label="Show VIP clients only"
                  aria-pressed={markFilter === "vip"}
                  className={`flex h-10 w-10 items-center justify-center rounded-md border transition-colors ${
                    markFilter === "vip" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:bg-amber-50"
                  }`}
                  data-testid="branch-filter-vip"
                >
                  <Star className={`h-4 w-4 ${markFilter === "vip" ? "fill-amber-400 text-amber-500" : "text-slate-400"}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setMarkFilter((m) => (m === "attention" ? "" : "attention"))}
                  title={markFilter === "attention" ? "Showing flagged patients only — click to show all" : "Show patients needing attention only"}
                  aria-label="Show patients needing attention only"
                  aria-pressed={markFilter === "attention"}
                  className={`flex h-10 w-10 items-center justify-center rounded-md border transition-colors ${
                    markFilter === "attention" ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white hover:bg-rose-50"
                  }`}
                  data-testid="branch-filter-attention"
                >
                  <AlertCircle className={`h-4 w-4 ${markFilter === "attention" ? "fill-rose-500 text-white" : "text-slate-400"}`} />
                </button>
            </div>
            {/* This icon is its own control (Today/Yesterday/Last Month/This Month/exact
                day/custom range) and stays visible on Branch Leads exactly as before —
                the range row beside it is an addition, not a replacement, and its own
                Custom button already reaches a DateFilterPopover of its own for anything
                the five one-tap presets don't cover.

                On the Consultation tab, though, this icon is the SAME component the row's
                own Custom button already opens — showing both is two calendars on one
                line asking the same question, so it only surfaces there once it already
                holds a range, which in practice (nothing else ever sets dateFilter on that
                tab) means never: the row's own Custom is what that tab actually uses. */}
            {(!onConsultationTab || dateFilter) && (
              <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="branch-date-filter" centered iconOnly />
            )}
            <Button
              onClick={() => { loadBoard(); setRefreshTick((n) => n + 1); }}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
              data-testid="branch-refresh-btn"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {/* Branch Leads only. This toolbar is shared by both tabs (see the note
                above it), which is what put a Create Lead button over the Consultation
                pills -- and a consultation is a patient the branch already has, arrived
                through Pre-Sales. There is nothing to create from that tab, so the
                button offered an action whose result would not appear on the screen it
                was pressed from. Hidden the same way the date popover above it is. */}
            {!onConsultationTab && (
              <Button
                onClick={() => setShowCreateLead(true)}
                title="Create Lead"
                aria-label="Create Lead"
                className="h-10 w-10 shrink-0 bg-sky-600 p-0 hover:bg-sky-700"
                data-testid="branch-create-lead-btn"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            )}
            <PullFromSheetButton
              onPulled={() => { loadBoard(); setRefreshTick((n) => n + 1); }}
              notConnectedHint="Google Sheets isn't connected yet — ask your Super Admin to connect it."
              noSourcesHint="No Google Sheet is linked to this branch yet — ask your Super Admin to tag one to this branch in Marketing Board → Lead Sources."
              iconOnly
            />
            </div>
          </div>

          {/* The same range row as the one in the toolbar, for the widths where it will
              not fit up there — below xl this is the only copy on screen, and above it
              this one is the one that goes. Shared by both tabs now, same as the inline
              copy above.

              A second date control on Branch Leads, and deliberately not a replacement for
              the calendar button the toolbar keeps there — that one still opens the shared
              popover with Yesterday, Last Month and an exact day in it, unchanged.

              The fast path: the one-tap ranges a branch actually asks for, with the same
              popover on the end for anything else. Folded into effectiveDateFilter either
              way, which feeds the stage counts on the bar above and, on the Consultation
              tab, the ConsultationsBoard underneath too — so a pill's number always
              describes the list that pill opens. */}
          <div className="xl:hidden">
            <QuickDateFilterBar
              value={quickDate}
              onChange={setQuickDate}
              testid="branch-quick-date"
            />
          </div>

          {onConsultationTab ? (
            <ConsultationsBoard
              branchId={branchId}
              viewerRole="branch_admin"
              // Same fact the calendars above are given: an arm with no room in it meets
              // its patients over video, so Assign Physio says which room and says when
              // one is missing.
              onlineArm={armScoped}
              externalStageFilter={stageFilter}
              showOwnStageBar={false}
              autoOpenLeadId={autoOpenLeadId}
              onAutoOpened={() => setAutoOpenLeadId(null)}
              // Driven by the toolbar above: passing externalSearch hides this board's own
              // search row, which is also where its date filter and green refresh lived.
              externalSearch={searchQuery}
              externalDateFilter={effectiveDateFilter}
              // The mark filter above narrows this board's list the way the search and the
              // Date Filter beside it do. Without it the pills would count the VIPs and the
              // table under them would show everybody.
              externalMarkFilter={markFilter}
              reloadToken={refreshTick}
              // Eight columns can't be read on a phone — without this the consultation
              // stages fall back to the desk table and every field arrives truncated.
              mobileCards
            />
          ) : (
          <>

          {/* An answer where the table would otherwise show its own empty state.
              "No patients yet." is what a board says when it asked and nothing came back;
              a board with no branch and no arm never asked, and saying "yet" there sends
              somebody looking for leads that were never going to arrive. */}
          {boardData.noScope && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="branch-board-no-scope">
              This account is not posted to a branch, so there is no list to show. Ask your
              HR Admin to set the branch on it under HR → Credentials.
            </div>
          )}

          {/* Phone list — six columns can't be read at 430px whichever way they're sized,
              so below md the same rows are stacked as cards instead of being pushed off
              the side of a horizontally-scrolling table. */}
          <div className="space-y-2 md:hidden" data-testid="branch-list-mobile">
            {(() => {
              const visible = (stageFilter ? filteredLeads.filter((l) => matchesBranchStage(l, stages.find((s) => s.name === stageFilter), isConsultationOnlyStage)) : filteredLeads);
              if (visible.length === 0) {
                return (
                  <p className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400" data-testid="branch-list-mobile-empty">
                    No patients {stageFilter ? `in stage "${stageDisplayLabel(stageFilter)}"` : "yet"}.
                  </p>
                );
              }
              return visible.map((lead) => {
                const rowStage = rowStageName(lead);
                const hex = rowStage ? stageColor(rowStage) : null;
                const wa = waNumber(lead.phone);
                return (
                  // A div, not a button: the Call and WhatsApp actions below are
                  // themselves interactive, and a button inside a button is invalid
                  // markup that browsers resolve by dropping one of them.
                  <div
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedLead(lead)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedLead(lead); }
                    }}
                    className="w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-left transition active:bg-slate-50"
                    data-testid={`branch-card-${lead.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                        {lead.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate font-semibold text-slate-900">{lead.name}<RescheduledTag lead={lead} className="ml-1.5" compact /></span>
                          <span
                            className="shrink-0 rounded-[5px] border px-2 py-0.5 text-[10px] font-medium"
                            style={hex ? { background: `${hex}14`, color: hex, border: `1px solid ${hex}33` } : { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                          >
                            {rowStage ? stageDisplayLabel(rowStage) : "—"}
                          </span>
                        </div>
                        {lead.patient_number && <p className="truncate font-mono text-[10px] text-slate-400">{lead.patient_number}</p>}
                        <p className="mt-1 truncate text-xs text-slate-600">{lead.phone || "—"}</p>
                        {lead.email && <p className="truncate text-xs text-slate-500">{lead.email}</p>}
                        {(() => {
                          const slot = apptSlotLabel(lead);
                          if (!slot) return null;
                          return (
                            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px]" data-testid={`branch-card-appt-${lead.id}`}>
                              <Calendar className="h-3 w-3 text-slate-400" />
                              <span className="font-semibold text-slate-700">{[slot.date, slot.time].filter(Boolean).join(" · ")}</span>
                              {!lead.assigned_physio_name && <span className="font-medium text-amber-600">Pre-Sales request</span>}
                            </p>
                          );
                        })()}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-400">
                          {lead.assigned_physio_name && <span className="truncate">Physio: {lead.assigned_physio_name}</span>}
                          <span>Updated {(lead.updated_at || "").slice(0, 10)}</span>
                        </div>
                      </div>
                    </div>
                    {/* Reaching the patient is the commonest thing done from this list, and
                        on a phone it was three taps deep behind the lead popup. Anchors
                        rather than buttons so tel: and the WhatsApp handoff are the
                        browser's own — and stopPropagation so tapping one doesn't also
                        open the lead behind it. */}
                    {wa && (
                      <div className="mt-2.5 flex gap-2 border-t border-slate-100 pt-2.5">
                        <a
                          href={`tel:${wa}`}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-700 active:bg-slate-100"
                          data-testid={`branch-card-call-${lead.id}`}
                        >
                          <Phone className="h-3.5 w-3.5" /> Call
                        </a>
                        <a
                          href={`https://wa.me/${wa}`}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 py-2 text-xs font-semibold text-[#128C7E] active:bg-[#25D366]/20"
                          data-testid={`branch-card-whatsapp-${lead.id}`}
                        >
                          <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
                        </a>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Shown only while something is ticked, so the ordinary view of the list is the
              one without a delete button in it. Desk only, like the table it belongs to. */}
          {pickedVisible.length > 0 && (
            <div className="mb-2 hidden flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 md:flex" data-testid="branch-bulk-bar">
              <p className="text-xs font-semibold text-rose-800">
                {pickedVisible.length} selected
                <span className="ml-1 font-normal text-rose-700">of {visibleLeads.length} shown</span>
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPicked(new Set())} data-testid="branch-bulk-clear">
                  Clear
                </Button>
                <Button
                  size="sm"
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  onClick={() => setShowBulkDelete(true)}
                  data-testid="branch-bulk-delete-btn"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          )}

          {/* List View (table) — its own scroll region so the sticky header can use top-0
              instead of guessing the page header's pixel height, which was colliding with
              the stat cards row as it scrolled past. */}
          <div className="hidden w-full max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-white md:block" data-testid="branch-list">
            <table className="w-full min-w-[640px] table-fixed divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-500 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  {/* A lead at either entry stage hasn't had a physio assigned yet, so that
                      column is dropped there — every other view keeps it.

                      The three between Phone and the pipeline columns are the intake form's
                      own questions, which is what the branch is actually reading this list
                      to find out. Widths total 100 either way: table-fixed divides by the
                      stated widths, and a set that overshoots quietly squeezes the last
                      column instead. */}
                  {entryStageNames.includes(stageFilter) ? (
                    <>
                      <th className="w-[20%] px-4 py-3">Patient</th>
                      <th className="w-[12%] px-4 py-3">Phone</th>
                      <th className="w-[14%] px-4 py-3">Pain Type</th>
                      <th className="w-[14%] px-4 py-3">Pain Duration</th>
                      <th className="w-[14%] px-4 py-3">Consultation Type</th>
                      <th className="w-[13%] px-4 py-3">Appointment</th>
                      <th className="w-[13%] px-4 py-3">Stage</th>
                    </>
                  ) : (
                    <>
                      <th className="w-[18%] px-4 py-3">Patient</th>
                      <th className="w-[11%] px-4 py-3">Phone</th>
                      <th className="w-[13%] px-4 py-3">Pain Type</th>
                      <th className="w-[12%] px-4 py-3">Pain Duration</th>
                      <th className="w-[13%] px-4 py-3">Consultation Type</th>
                      <th className="w-[12%] px-4 py-3">Assigned Physio</th>
                      <th className="w-[11%] px-4 py-3">Appointment</th>
                      <th className="w-[10%] px-4 py-3">Stage</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  const visible = visibleLeads;
                  const showAssignedPhysio = !entryStageNames.includes(stageFilter);
                  if (visible.length === 0) {
                    return (
                      <tr>
                        <td colSpan={showAssignedPhysio ? 8 : 7} className="px-4 py-10 text-center text-sm text-slate-400" data-testid="branch-list-empty">
                          No patients {stageFilter ? `in stage "${stageDisplayLabel(stageFilter)}"` : "yet"}.
                        </td>
                      </tr>
                    );
                  }
                  return visible.map((lead) => {
                    const rowStage = rowStageName(lead);
                    const rowStageHex = rowStage ? stageColor(rowStage) : null;
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedLead(lead)}
                        className={`cursor-pointer transition-colors ${picked.has(lead.id) ? "bg-rose-50/70 hover:bg-rose-50" : "hover:bg-slate-50"}`}
                        data-testid={`branch-row-${lead.id}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                              {lead.name?.charAt(0)?.toUpperCase() || "?"}
                            </div>
                            <div className="min-w-0">
                              {/* The row's headline, so it carries the heaviest and darkest
                                  text in the row. As font-medium/slate-800 it sat half a step
                                  from the phone beside it and no heavier than the appointment
                                  two columns over, which left the one thing this list is
                                  scanned for competing with the columns either side of it.
                                  The mobile card above already gave the name its own weight. */}
                              <span className="block truncate font-semibold text-slate-900" title={lead.name}>{lead.name}</span>
                              {lead.patient_number && <span className="block truncate font-mono text-[10px] text-slate-400" title={lead.patient_number}>{lead.patient_number}</span>}
                              <RescheduledTag lead={lead} className="mt-0.5" />
                            </div>
                            {/* The two marks, after the name so they read as something said
                                about this patient rather than as part of their identity.
                                stopPropagation on both: the row opens the patient, and
                                marking one should not also open them.

                                Unset they are faint outlines rather than absent, so the
                                control is in the same place on every row — a mark that only
                                appears once set cannot be set by anyone who has not seen it
                                set before. */}
                            {/* Settable on every stage, not only on All Stages.
                                They were All-Stages-only on the reasoning that the whole
                                branch in one list is where such a judgement is made. But
                                the judgement is not made against the list — it is made
                                about the patient in front of you, and the moment it is made
                                is usually the moment their stage is being worked. Held to
                                All Stages, a Branch Admin looking at Fee Collected who
                                learns this one is a VIP has to clear the stage, find the
                                row again in two thousand, and mark it there. That is a long
                                way round to a click, and the mark that does not get made is
                                the one nobody makes.
                                Reading them back is offered on every stage too now — see
                                markFilter, which narrows the counts along with the list so
                                the bar cannot end up describing a different set. */}
                            <div className="ml-auto flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleLeadFlag(lead, "is_vip"); }}
                                title={lead.is_vip ? "VIP client — click to remove" : "Mark as VIP client"}
                                aria-label={lead.is_vip ? `Remove VIP mark from ${lead.name || "patient"}` : `Mark ${lead.name || "patient"} as VIP`}
                                aria-pressed={!!lead.is_vip}
                                className="rounded p-1 transition-colors hover:bg-amber-50"
                                data-testid={`branch-vip-${lead.id}`}
                              >
                                <Star className={`h-4 w-4 ${lead.is_vip ? "fill-amber-400 text-amber-500" : "text-slate-300 hover:text-amber-400"}`} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleLeadFlag(lead, "needs_attention"); }}
                                title={lead.needs_attention ? "Needs attention — click to clear" : "Flag as needing attention"}
                                aria-label={lead.needs_attention ? `Clear the attention flag on ${lead.name || "patient"}` : `Flag ${lead.name || "patient"} as needing attention`}
                                aria-pressed={!!lead.needs_attention}
                                className="rounded p-1 transition-colors hover:bg-rose-50"
                                data-testid={`branch-attention-${lead.id}`}
                              >
                                <AlertCircle className={`h-4 w-4 ${lead.needs_attention ? "fill-rose-500 text-white" : "text-slate-300 hover:text-rose-400"}`} />
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="truncate px-4 py-3 text-slate-600" title={lead.phone}>{lead.phone || "—"}</td>
                        {/* The intake form's three questions. Each falls back to the lead's
                            own field where it has one — see formAnswer. */}
                        {[
                          ["what_type_of_pain_are_you_experiencing?", "condition", null],
                          ["how_long_have_you_had_this_pain?", "months_of_pain", (n) => `${n} month${Number(n) === 1 ? "" : "s"}`],
                          ["preferred_consultation_type?", null, null],
                        ].map(([question, fallback, formatFallback]) => {
                          const answer = formAnswer(lead, question, fallback, formatFallback);
                          return (
                            <td key={question} className="truncate px-4 py-3 text-slate-600" title={answer || undefined}>
                              {answer || <span className="text-slate-400">—</span>}
                            </td>
                          );
                        })}
                        {showAssignedPhysio && (
                          <td className="truncate px-4 py-3 text-slate-600" title={lead.assigned_physio_name}>{lead.assigned_physio_name || <span className="text-slate-400">—</span>}</td>
                        )}
                        <td className="px-4 py-3">
                          {(() => {
                            const slot = apptSlotLabel(lead);
                            if (!slot) return <span className="text-slate-400">—</span>;
                            return (
                              <div className="flex flex-col gap-0.5" data-testid={`branch-row-appt-${lead.id}`}>
                                <span className="whitespace-nowrap text-xs font-semibold text-slate-700">
                                  {[slot.date, slot.time].filter(Boolean).join(" · ")}
                                </span>
                                {/* Until an expert is assigned, this is the slot Pre-Sales asked
                                    for rather than one the branch has committed to. */}
                                {!lead.assigned_physio_name && (
                                  <span className="text-[10px] font-medium text-amber-600">Pre-Sales request</span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center rounded-[5px] border px-2.5 py-0.5 text-xs font-medium"
                            style={rowStageHex ? { background: `${rowStageHex}14`, color: rowStageHex, border: `1px solid ${rowStageHex}33` } : { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                          >
                            {rowStage ? stageDisplayLabel(rowStage) : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <BranchLeadModal
          lead={selectedLead}
          branchId={branchId}
          stages={stages}
          consultationStages={consultationStages}
          // Which of the two entry stages this lead's pipeline should open on. The strip
          // above now shows only the mirrored one (see leadPillStages), so a lead standing
          // at the branch's opening opens on Leads however it was reached — from the Leads
          // pill or from All Stages — and the card names the position the same way the row
          // that opened it did.
          openedFromMirror={showingMirror || atBranchOpening(selectedLead)}
          onlineArm={armScoped}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleStageUpdate}
          onOpenConsultationStage={(stage) => {
            // Hand off to the embedded Consultations board: close this modal, switch the
            // stage bar to the requested Consultation stage, and tell that board which
            // lead to auto-open — same lead, same rich stage-specific popups it already
            // has (Collect Payment, Physio Assign, etc.), instead of duplicating them here.
            setAutoOpenLeadId(selectedLead.id);
            setSelectedLead(null);
            // The Consultation stages moved to their own tab, so the handoff has to go
            // there as well as set the pill — setting the pill alone would leave the
            // reader on Branch Leads with a filter that has no pill and no board.
            setActiveView("branch_consultation");
            setStageFilter(stage);
          }}
          onMoved={() => {
            // Close first, then refresh the list in the background via loadBoard directly
            // (not handleStageUpdate) — that closure's stale selectedLead would otherwise
            // re-open this same modal once the refresh resolves a couple seconds later.
            setSelectedLead(null);
            loadBoard();
          }}
        />
      )}
          </>
          )}

      {showCreateLead && (
        <CreateLeadModal
          isSuperAdmin={false}
          branchId={branchId}
          // Fixed to this arm's own department where the board is an arm's — see
          // ARM_DEPARTMENT. Null everywhere else, which leaves the field as it was.
          lockedDepartment={ARM_DEPARTMENT[String(currentUser?.role || "").trim().toLowerCase()] || null}
          onClose={() => setShowCreateLead(false)}
          onSaved={loadBoard}
        />
      )}

      {showBulkDelete && pickedVisible.length > 0 && (
        <BulkDeleteLeadsModal
          leads={pickedVisible}
          onClose={() => setShowBulkDelete(false)}
          // Whatever the server refused stays ticked, so a second attempt is against the
          // rows that actually survived rather than against a selection the list has
          // already moved on from.
          onDeleted={(res) => {
            setShowBulkDelete(false);
            setPicked(new Set((res.blocked || []).map((b) => b.lead_id)));
            loadBoard();
          }}
        />
      )}
        </>
      )}

      {loading && (
        <div className="fixed bottom-20 right-4 rounded-md bg-slate-900 px-3 py-2 text-sm text-white md:bottom-4">Loading...</div>
      )}

      {/* Bottom nav — phones only, and only when this board owns the page (not when
          Super Admin's Branch Wise embeds it, which already has its own bottom nav —
          two fixed bottom bars fighting for the same spot was the actual bug). The top
          strip scrolls sideways, which left Accountant Manage and Store behind a swipe.

          Three direct slots and a More sheet, rather than all six across the bar: six
          gave each tab about 60px, which is why every label had to be abbreviated to fit
          in the first place. Columns are counted rather than hardcoded, so a tab added to
          VIEW_TABS re-divides the bar instead of leaving a gap. */}
      {!embedded && (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-600 bg-slate-500/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-slate-500/85 md:hidden"
        data-testid="branch-bottom-nav"
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${bottomTabs.length + 1}, minmax(0, 1fr))` }}>
          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => { setActiveView(tab.key); setShowMoreMenu(false); }}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-2 transition-colors ${
                  active ? "text-white" : "text-slate-200 active:text-white"
                }`}
                data-testid={`branch-bottom-nav-${tab.key}`}
              >
                {/* The strip sits on the top edge, where the desk tabs carry their underline. */}
                {active && <span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-white" />}
                <Icon className="h-[18px] w-[18px] flex-none" />
                <span className="w-full truncate text-center text-[9px] font-semibold leading-tight">{tab.short}</span>
              </button>
            );
          })}
          {/* Lit while one of the tabs it holds is open, so the bar still says where you
              are once you have navigated into the sheet and it has closed behind you. */}
          <button
            type="button"
            onClick={() => setShowMoreMenu((v) => !v)}
            aria-expanded={showMoreMenu}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-2 transition-colors ${
              moreTabs.some((t) => t.key === activeView) || showMoreMenu ? "text-white" : "text-slate-200 active:text-white"
            }`}
            data-testid="branch-bottom-nav-more"
          >
            {moreTabs.some((t) => t.key === activeView) && <span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-white" />}
            <MoreHorizontal className="h-[18px] w-[18px] flex-none" />
            <span className="w-full truncate text-center text-[9px] font-semibold leading-tight">More</span>
          </button>
        </div>
      </nav>
      )}

      {/* Whatever came off the bar. Full labels here — a sheet has the width the bar
          did not, so this is the one place "Accountant Manage" reads in full. */}
      {!embedded && showMoreMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-900/40 md:hidden"
          onClick={() => setShowMoreMenu(false)}
          data-testid="branch-bottom-nav-sheet"
        >
          <div className="w-full rounded-t-2xl bg-white p-2 pb-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-sm font-semibold text-slate-700">More</p>
              <button
                type="button"
                onClick={() => setShowMoreMenu(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                data-testid="branch-bottom-nav-sheet-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {moreTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeView === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveView(tab.key); setShowMoreMenu(false); }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium ${active ? "bg-sky-50 text-sky-700" : "text-slate-700 hover:bg-slate-50"}`}
                  data-testid={`branch-bottom-nav-sheet-${tab.key}`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Branch Lead Detail Modal ─── */
// `onlineArm` reaches the booking popup for one thing: whether a CONSULTANT with no video
// room is worth warning about. On an online arm it is the whole address of the
// appointment about to be confirmed. At a branch it is nothing — the consultation is held
// in a room, the field that would set a link is not offered on that board at all, and an
// amber panel naming a gap nobody there can fill is noise on every booking they make.
function BranchLeadModal({ lead, branchId, stages, consultationStages, onClose, onUpdate, onMoved, onOpenConsultationStage, openedFromMirror = false, onlineArm = false }) {
  // The board offers two entry stages — the mirrored Pre-Sales "Leads" pill and the branch's
  // own first stage — but a single lead only ever came in through one of them, so its
  // pipeline shows that one and drops the other. Everything from RNR onwards is shared.
  const mirrorStageName = stages.find((s) => s.mirrors_stage)?.name;
  const realEntryStageName = stages.find((s) => !s.mirrors_stage)?.name;
  // Matches the chip on the row that opened this popup, rather than contradicting it.
  const headerStageName = (openedFromMirror && lead.branch_stage) ? mirrorStageName : lead.branch_stage;
  const entryStages = stages.filter((s) => (
    s.name === mirrorStageName ? openedFromMirror
      : s.name === realEntryStageName ? !openedFromMirror
        : true
  ));
  // Same merge as the main Branch Leads stage bar — one continuous pipeline covering both
  // branch_stage and consultation_stage, with shared names (e.g. "Follow Up") kept to a
  // single pill backed by the sales-side field.
  const pipelineStages = [...entryStages, ...consultationStages.filter((cs) => !stages.some((s) => s.name === cs.name))];
  // A lead whose appointment is booked and not yet consulted. From here the branch has
  // four things it can do, and none of them is moving the patient forward: forward is the
  // consultation happening, which the Consultant drives from their own board.
  //
  // So the rest of the pipeline is drawn but not pressable. Hidden would read as a
  // shorter pipeline rather than as a stage with few exits, and the card is the one place
  // the whole journey is laid out -- a Branch Admin looking at it is often checking where
  // a patient is going next, not moving them.
  const inAppointmentStage = lead.branch_stage === APPOINTMENT_STAGE;
  // The three real stages reachable from Appointment. Reschedule is the fourth exit and is
  // not in here, because it is not a stage at all -- see the pill itself.
  const APPOINTMENT_EXITS = [BRANCH_RNR_STAGE, "Follow Up", BRANCH_CANCELLED_STAGE];
  // `!!name` guards the matchesBranchStage call below: a lead with no consultation_stage
  // has not been handed over, and an undefined name is in neither pipelines' stage list.
  const isConsultationOnlyStage = (name) => !!name && !stages.some((s) => s.name === name);
  const [activeTab, setActiveTab] = useState("overview");
  const [remarks, setRemarks] = useState([]);
  const [activityLog, setActivityLog] = useState([]);

  const [apptDraft, setApptDraft] = useState(null); // { appointment_date, appointment_time, physio_id, notes, final_stage, duration } | null
  // Asked before the lead is cancelled off the Appointment stage. A boolean rather than a
  // draft: there is nothing to fill in, only something to be sure about.
  const [cancelDraft, setCancelDraft] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Handing a booked appointment to a different CONSULTANT without moving it.
  //
  // The appointment dialog can already do this, but only the long way round: picking an
  // expert clears the time, and the times it then offers are the ones that expert has
  // published. So a consultant ringing to say "I am free at 1:45, give me that one" cannot
  // be obliged unless they happen to have published 1:45 — even though the booking
  // endpoint has never required a published slot, only that nobody else holds it.
  //
  // null | { leadId, date, time, duration, currentId, currentName, options, loading, saving }
  const [handover, setHandover] = useState(null);
  const [apptExperts, setApptExperts] = useState({ experts: [], available_count: 0, busy_count: 0, loading: false });
  // Month shown by the popup's own calendar. Held apart from the picked date so paging
  // through months doesn't disturb the booking being built.
  const [apptMonth, setApptMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  // Shown once a booking is actually made. Kept outside the Appointment popup because
  // confirming closes that popup and the lead card with it.
  const [apptConfirm, setApptConfirm] = useState(null);
  // The branch's own address and map link, for the confirmation the patient is sent —
  // they need to know where to come, which the lead record doesn't carry.
  const [branchInfo, setBranchInfo] = useState(null);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    getBranches()
      .then((rows) => { if (!cancelled) setBranchInfo((rows || []).find((b) => b.id === branchId) || null); })
      .catch(() => { /* the confirmation just omits the location */ });
    return () => { cancelled = true; };
  }, [branchId]);
  // { "YYYY-MM-DD": free slot count } for the shown month — drives the purple marking so
  // the days worth clicking are visible without opening each one.
  const [apptOpenDates, setApptOpenDates] = useState({});

  // Follow-up scheduling
  const tomorrowIso = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [followUpForm, setFollowUpForm] = useState({ date: tomorrowIso(), time: "10:00", remarks: "" });
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [followUpBusy, setFollowUpBusy] = useState(false);

  // "Move to Stage" popup for Follow Up (mirrors Appointment Date & Time's popup pattern)
  const [followUpMoveDraft, setFollowUpMoveDraft] = useState(null); // { date, time, remarks } | null
  const [followUpMoveBusy, setFollowUpMoveBusy] = useState(false);

  /** Who could take this exact slot, and hand it to one of them.
   *
   * available-experts is asked with the time, which is the form that returns everyone not
   * already booked then rather than everyone who has published it — the distinction the
   * booking endpoint itself has always drawn. lead_id is passed so this lead's own booking
   * does not read as a clash against the consultant currently holding it.
   */
  const openHandover = async (l) => {
    setHandover({
      leadId: l.id,
      date: l.appointment_date,
      time: l.appointment_time,
      duration: l.appointment_duration || null,
      currentId: l.assigned_physio_id || "",
      currentName: l.assigned_physio_name || "",
      options: [],
      loading: true,
      saving: false,
    });
    try {
      const res = await getAvailableExperts(branchId, l.appointment_date, l.appointment_time, l.id);
      setHandover((p) => (p ? { ...p, options: res.experts || [], loading: false } : p));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load consultants");
      setHandover((p) => (p ? { ...p, loading: false } : p));
    }
  };

  const confirmHandover = async (doc) => {
    if (!handover || doc.id === handover.currentId) { setHandover(null); return; }
    setHandover((p) => ({ ...p, saving: true }));
    try {
      // The same call that books one, re-posted with the date and time untouched. Its own
      // clash check is what makes this safe: it refuses if somebody else already holds the
      // slot with the consultant being handed to.
      await scheduleBranchAppointment(handover.leadId, {
        appointment_date: handover.date,
        appointment_time: handover.time,
        physio_id: doc.id,
        final_stage: APPOINTMENT_STAGE,
        ...(handover.duration ? { duration: handover.duration } : {}),
      });
      toast.success(`${handover.time} moved to ${doc.full_name}`);
      setHandover(null);
      // The modal's own refresh prop, not the board's handler — that one is not in scope
      // here and would be a stale closure over a different selectedLead if it were.
      await onUpdate?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change the consultant");
      setHandover((p) => (p ? { ...p, saving: false } : p));
    }
  };

  const fetchAvailableExperts = useCallback(async (branch, dateStr, leadId) => {
    if (!branch || !dateStr) return;
    setApptExperts((p) => ({ ...p, loading: true }));
    try {
      const res = await getAvailableExperts(branch, dateStr, undefined, leadId);
      setApptExperts({
        experts: res.experts || [],
        available_count: res.available_count || 0,
        busy_count: res.busy_count || 0,
        loading: false,
      });
      setApptDraft((curr) => {
        if (!curr || !curr.physio_id) return curr;
        const stillAvail = (res.experts || []).some((dd) => dd.id === curr.physio_id);
        return stillAvail ? curr : { ...curr, physio_id: "" };
      });
    } catch {
      setApptExperts({ experts: [], available_count: 0, busy_count: 0, loading: false });
    }
  }, []);

  // The picked expert's own open times on the picked date. They arrive with the expert
  // list, so choosing an expert reveals their slots without a second round trip.
  // Free and booked in one time-ordered grid. Showing only the gaps said nothing about
  // whether the day was quiet or nearly full, which is the question being asked when a
  // patient on the phone wants to know what else is around their preferred time.
  const apptSlotsForExpert = useMemo(() => {
    if (!apptDraft?.physio_id) return [];
    const doc = (apptExperts.experts || []).find((d) => d.id === apptDraft.physio_id);
    if (!doc) return [];
    const rows = [
      ...(doc.free_slots || []).map((s) => ({ ...s, booked: false })),
      ...(doc.booked_slots || []).map((s) => ({ ...s, booked: true })),
    ];
    return rows.sort((a, b) => (a.slot_time || "").localeCompare(b.slot_time || ""));
  }, [apptExperts.experts, apptDraft?.physio_id]);

  const apptFreeCount = useMemo(
    () => apptSlotsForExpert.filter((s) => !s.booked).length,
    [apptSlotsForExpert],
  );

  // The chosen CONSULTANT's own record, and the room on it. available-experts answers with
  // the whole expert row, so the link arrives with the list and choosing somebody reveals
  // it without a second request.
  const apptSelectedExpert = useMemo(
    () => (apptDraft?.physio_id ? (apptExperts.experts || []).find((d) => d.id === apptDraft.physio_id) : null) || null,
    [apptExperts.experts, apptDraft?.physio_id],
  );
  const apptMeetLink = (apptSelectedExpert?.meet_link || "").trim();

  useEffect(() => {
    if (!apptDraft || !apptDraft.appointment_date || !branchId) return;
    fetchAvailableExperts(branchId, apptDraft.appointment_date, lead.id);
  }, [apptDraft?.appointment_date, branchId, lead.id, fetchAvailableExperts]);

  // Which days of the shown month have a free slot, refreshed whenever the popup pages to
  // another month.
  useEffect(() => {
    if (!apptDraft || !branchId) { return; }
    const month = `${apptMonth.y}-${String(apptMonth.m + 1).padStart(2, "0")}`;
    let cancelled = false;
    getAvailableDates(branchId, month, lead.id)
      .then((res) => { if (!cancelled) setApptOpenDates(res?.dates || {}); })
      .catch(() => { if (!cancelled) setApptOpenDates({}); });
    return () => { cancelled = true; };
  }, [apptDraft ? true : false, apptMonth.y, apptMonth.m, branchId, lead.id]);

  // Open the popup's calendar on the month the booking already sits in — reopening an
  // appointment made for next month shouldn't land on today's page with nothing selected.
  useEffect(() => {
    const d = apptDraft?.appointment_date;
    if (!d) return;
    const [y, m] = d.split("-").map(Number);
    setApptMonth((prev) => (prev.y === y && prev.m === m - 1 ? prev : { y, m: m - 1 }));
  }, [apptDraft?.appointment_date]);

  const loadRemarks = async () => {
    try { setRemarks(await getLeadRemarks(lead.id)); } catch { /* silent */ }
  };
  const loadActivity = async () => {
    try { setActivityLog(await getLeadActivity(lead.id)); } catch { /* silent */ }
  };

  useEffect(() => {
    if (activeTab === "timeline") { loadRemarks(); loadActivity(); }
    if (activeTab === "rnr") { loadActivity(); }
  }, [activeTab, lead.id]);

  // Reports whether it actually moved. The toast is still raised here -- every caller
  // wants it -- but a caller holding a confirmation dialog open needs to know not to
  // dismiss it over a move the server refused.
  const moveStage = async (stage) => {
    try {
      await moveBranchStage(lead.id, { branch_stage: stage });
      toast.success(`Moved to ${stage}`);
      onMoved && onMoved(stage); // closes immediately; parent refreshes the list itself
      return true;
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
      return false;
    }
  };

  // Same endpoint and counter Pre-Sales' own RNR tracker uses — logging an attempt here
  // doesn't move the lead off RNR, so the modal stays open and just refreshes in place,
  // same as scheduling or rescheduling a follow-up does.
  const logRnrAttempt = async () => {
    try {
      const updated = await rnrAttempt(lead.id);
      toast.success(`Attempt logged (#${updated.rnr_attempts})`);
      await onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to log attempt");
    }
  };

  const submitFollowUp = async () => {
    if (!followUpForm.date || !followUpForm.time) { toast.error("Date and time are required"); return; }
    try {
      setFollowUpBusy(true);
      await scheduleBranchFollowUp(lead.id, followUpForm);
      toast.success("Follow-up scheduled");
      setFollowUpForm({ date: tomorrowIso(), time: "10:00", remarks: "" });
      await onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to schedule follow-up");
    } finally {
      setFollowUpBusy(false);
    }
  };

  const submitReschedule = async () => {
    if (!rescheduleDraft?.date || !rescheduleDraft?.time) { toast.error("Date and time are required"); return; }
    try {
      setFollowUpBusy(true);
      await rescheduleBranchFollowUp(lead.id, rescheduleDraft.followupId, {
        date: rescheduleDraft.date,
        time: rescheduleDraft.time,
        reason: rescheduleDraft.reason,
      });
      toast.success("Follow-up rescheduled");
      setRescheduleDraft(null);
      await onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to reschedule");
    } finally {
      setFollowUpBusy(false);
    }
  };

  const submitFollowUpMove = async () => {
    if (!followUpMoveDraft?.date || !followUpMoveDraft?.time) { toast.error("Date and time are required"); return; }
    try {
      setFollowUpMoveBusy(true);
      await scheduleBranchFollowUp(lead.id, followUpMoveDraft);
      toast.success("Moved to Follow Up");
      setFollowUpMoveDraft(null);
      onMoved && onMoved("Follow Up"); // closes immediately; parent refreshes the list itself
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to schedule");
    } finally {
      setFollowUpMoveBusy(false);
    }
  };

  const TABS = [
    { key: "overview", label: "Overview", color: "bg-sky-500" },
    { key: "follow-up", label: "Follow-Up", color: "bg-amber-500" },
    { key: "timeline", label: "Timeline", color: "bg-emerald-500" },
    { key: "rnr", label: "RNR Record", color: "bg-rose-500" },
  ];

  const avatarFirstChar = (lead.name?.trim()?.charAt(0) || "?").toUpperCase();

  // The follow-up the lead is actually on, for the Overview preview below. Newest first
  // and skipping the rescheduled ones, which is the same rule the Follow-Up tab draws
  // with — a booking that was moved is history, not the appointment somebody is waiting
  // on, and previewing it would name a date nobody is going to call on.
  const followUps = lead.follow_ups || [];
  const activeFollowUp = followUps.slice().reverse().find((f) => f.status !== "rescheduled") || null;
  // Matched loosely rather than against a literal "Follow Up": these names are editable in
  // Pipeline Stage Management, and a rename there should not silently empty this card.
  const atFollowUpStage = /follow\s*-?\s*up/i.test(headerStageName || "");
  // The attempts, newest last, exactly as the endpoint wrote them — one lead_activity row
  // per press of +1 No Answer, carrying who pressed it and when.
  const rnrLog = activityLog.filter((a) => a.action === "rnr_attempt");
  const rnrCount = lead.rnr_attempts || 0;
  // The literal is inherited from the tracker this replaces, and from the stage seed that
  // writes it (ensure_rnr_stage). Unlike Follow Up it is not matched loosely: RNR is an
  // initialism, and a loose test for three letters catches stage names that merely contain
  // them.
  const atRnrStage = lead.branch_stage === BRANCH_RNR_STAGE;
  // Drawn for a lead that has been called and not answered even after it has moved on:
  // the attempts are the reason it sits where it does, and they do not stop being true.
  const showRnrCard = atRnrStage || rnrCount > 0;
  // What the lead itself says about the patient, as against what the pipeline says about
  // them. This popup could show neither: it opened on a phone number, a stage strip and
  // nothing else, so a lead somebody had filled a whole intake form for read as blank as a
  // name typed in at the desk.
  //
  // Empty fields are dropped rather than drawn as em-dashes. A walk-in carries three of
  // these and a sheet import carries fifteen, and a fixed list would show the first as a
  // page of dashes — which is close to how the popup already read.
  const leadDetailRows = [
    ["Source", lead.source_tab || lead.source_type],
    ["Department", departmentLabel(lead.department)],
    ["Alternative Phone", lead.alternative_phone],
    ["Age", lead.age],
    ["Gender", lead.gender],
    ["Occupation", lead.occupation],
    ["Condition", lead.condition],
    ["Months of Pain", hasValue(lead.months_of_pain) ? `${lead.months_of_pain} ${Number(lead.months_of_pain) === 1 ? "month" : "months"}` : ""],
    ["Expected Consultation", hasValue(lead.expected_consultation_date) ? weekdayLabel(lead.expected_consultation_date) : ""],
    ["Location", lead.location],
    ["Address", lead.address],
    ["City", lead.city],
    ["State", lead.state],
    ["Assigned To", lead.assigned_user_name],
    // Last, and the one row every lead has: created_at is required on the record, so the
    // card can never come out empty however little else was filled in.
    ["Added", dateStampFull(lead.created_at)],
  ].filter(([, value]) => hasValue(value));

  // Every answer the intake form collected, keyed by the question as that sheet asked it.
  // However long the form was: a branch that asks nine questions has nine rows here, and no
  // board can know their names in advance.
  //
  // A column mapped onto one of the lead's own fields leaves no extra_fields entry behind,
  // so the two lists do not repeat each other — and where both hold an answer to the same
  // question they are genuinely two stored answers, both worth reading.
  //
  // Held to the three types a form field can honestly be. extra_fields is Dict[str, Any] on
  // the wire and nothing validates what a sheet puts in it, so a nested value is possible —
  // and String() would draw that as the literal "[object Object]", which is worse than not
  // drawing the row at all.
  const formAnswers = Object.entries(lead.extra_fields || {}).filter(
    ([, value]) => ["string", "number", "boolean"].includes(typeof value) && hasValue(value),
  );

  // The advert behind the lead, and only the fields that were filled: V3LeadData is twelve
  // optionals and a walk-in has none of them.
  //
  // Nothing here gates on the reader. The block is withheld from everyone but Super Admin on
  // the way out of the API (lead_as_read_by in backend/deps.py), so a Branch Admin is handed
  // null and the card simply never draws — the same lock the create form leans on, rather
  // than a second one that could come to disagree with it.
  const adRows = LEAD_DATA_FIELDS
    .map((field) => [field.label, adFieldValue(field, lead.lead_data?.[field.key])])
    .filter(([, value]) => hasValue(value));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="branch-lead-modal-overlay">
      {/* A floating card on every size, not a full-bleed sheet on a phone. Edge to edge
          reads as a page you navigated to — there's no backdrop left to show it sits on
          top of the list, and nothing to tap beside it to dismiss. Height is capped so
          the darkened list stays visible above and below; the body below scrolls. */}
      <div className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[90vh] sm:max-w-2xl" data-testid="branch-lead-modal">
        {/* Plain header. The gradient made this the loudest thing on a screen whose
            subject is the cards underneath — the patient's name and their stage are the
            information here, and they read better on white than reversed out of three
            colours. Every chip in it had been picked to survive that background: white on
            20% white, a name with no colour of its own inheriting the band's. Those are
            set against the page now instead. */}
        <div className="relative border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-base font-bold text-slate-600 ring-1 ring-slate-200">{avatarFirstChar}</span>
              <div>
                <p className="text-base font-semibold leading-tight text-slate-900" data-testid="branch-lead-name">{lead.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {lead.patient_number && (
                    <span className="rounded-[5px] bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600" data-testid="branch-lead-patient-number">{lead.patient_number}</span>
                  )}
                  <span className="rounded-[5px] border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700" data-testid="branch-lead-stage">
                    {/* Named the same way the row that opened this popup was: opened from
                        Leads it reads Leads, and the pipeline below highlights Leads too. */}
                    {headerStageName ? stageDisplayLabel(headerStageName) : "No Stage"}
                  </span>
                  {lead.consultation_fee && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 ring-1 ring-teal-100">Fee Rs.{lead.consultation_fee}</span>}
                  {lead.package_amount && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">Pkg Rs.{lead.package_amount}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" data-testid="branch-lead-close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Pill tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5" data-testid="branch-lead-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-[5px] px-3.5 py-1 text-xs font-semibold capitalize transition-all ${activeTab === t.key ? `${t.color} text-white shadow-sm` : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
              data-testid={`branch-lead-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50/30 p-5" data-testid="branch-lead-content">
          {activeTab === "overview" && (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-sky-100 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-600"><Phone className="h-4 w-4" /></span>
                  <p className="text-xs font-bold uppercase tracking-wider text-sky-700">Contact</p>
                </div>
                <div className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Phone</span><span className="font-medium text-slate-800">{lead.phone || "—"}</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Email</span><span className="font-medium text-slate-800">{lead.email || "—"}</span></div>
                </div>
              </div>

              {/* Above the pipeline for the same reason the Follow-Up card is: on a lead
                  parked at RNR, how many times somebody has rung is what the popup is
                  being opened to find out. It used to sit *under* the stage picker, below
                  a row of eleven buttons, which is a long way past the point the reader
                  had already made up their mind.

                  RNR first and Follow Up second, matching the order the two stages come
                  in on the pipeline itself. */}
              {showRnrCard && (
                <div className="overflow-hidden rounded-xl border border-rose-100 bg-white shadow-sm" data-testid="branch-lead-rnr-status">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-700">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-600"><PhoneOff className="h-4 w-4" /></span>
                      RNR Status
                    </p>
                    {/* Only where there is a record to open. With no attempt logged the
                        tab is an empty page, and offering it reads as a promise of one. */}
                    {rnrCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab("rnr")}
                        className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50"
                        data-testid="branch-lead-rnr-status-open"
                      >
                        Record
                      </button>
                    )}
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">Client Not Answered</p>
                        <p className="text-[11px] text-slate-500" data-testid="branch-lead-rnr-attempts">
                          Attempts so far: <span className="font-bold text-rose-600">{rnrCount}</span>
                        </p>
                        {lead.rnr_last_attempt_at && (
                          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500" data-testid="branch-lead-rnr-lastcall">
                            <Clock className="h-3 w-3" />
                            Last call
                            <span className="font-bold text-slate-700">{callTimeStamp(lead.rnr_last_attempt_at)}</span>
                            <span className="text-slate-400">· {callDateStamp(lead.rnr_last_attempt_at)}</span>
                          </p>
                        )}
                      </div>
                      {/* Logging an attempt is only offered while the lead is actually
                          parked at RNR. On one that has moved on, this card is a record of
                          what happened rather than a desk to work from. */}
                      {atRnrStage && (
                        <Button
                          size="sm"
                          onClick={logRnrAttempt}
                          className="h-8 shrink-0 bg-rose-600 text-white hover:bg-rose-700"
                          data-testid="branch-lead-rnr-attempt"
                        >
                          <PhoneOff className="mr-1 h-3.5 w-3.5" /> +1 No Answer
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Between Contact and the pipeline, because on a lead sitting at Follow Up
                  the next call is the thing the popup is being opened to check. The
                  Follow-Up tab still owns scheduling and the full history; this is the one
                  line of it worth reading without changing tabs, and it says so with a link
                  rather than repeating the form. */}
              {(followUps.length > 0 || atFollowUpStage) && (
                <div className="overflow-hidden rounded-xl border border-amber-100 bg-white shadow-sm" data-testid="branch-lead-followup-preview">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Bell className="h-4 w-4" /></span>
                      Follow-Up
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab("follow-up")}
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50"
                      data-testid="branch-lead-followup-preview-open"
                    >
                      {activeFollowUp ? "Manage" : "Schedule"}
                    </button>
                  </div>
                  {activeFollowUp ? (() => {
                    const dt = new Date(`${activeFollowUp.date}T${activeFollowUp.time}:00`);
                    const isUpcoming = dt.getTime() > Date.now();
                    // Everything before the one that stands. Counted rather than listed:
                    // the tab is where a history belongs, and a preview that grows with it
                    // stops being a preview.
                    const earlier = followUps.length - 1;
                    return (
                      <div className="space-y-2 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-800" data-testid="branch-lead-followup-preview-when">
                            {dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {activeFollowUp.time}
                          </p>
                          {/* Overdue is the state worth colouring: an upcoming call needs
                              no action today, a missed one does. */}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${isUpcoming ? "bg-emerald-500" : "bg-rose-500"}`}>
                            {isUpcoming ? "UPCOMING" : "OVERDUE"}
                          </span>
                        </div>
                        {activeFollowUp.remarks && (
                          <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 ring-1 ring-slate-100">{activeFollowUp.remarks}</div>
                        )}
                        <p className="text-[11px] text-slate-400">
                          Set by {activeFollowUp.created_by || "—"}
                          {earlier > 0 && ` · ${earlier} earlier ${earlier === 1 ? "follow-up" : "follow-ups"}`}
                        </p>
                      </div>
                    );
                  })() : (
                    <p className="px-4 py-3 text-sm text-slate-400" data-testid="branch-lead-followup-preview-empty">
                      No follow-up scheduled yet.
                    </p>
                  )}
                </div>
              )}

              {/* The booked slot leads, because on a lead sitting at Appointment that is
                  the thing somebody opened this popup to read. It used to be missing
                  entirely: the card was drawn only when a department, a mode or a
                  diagnosis had been filled in, none of which booking an appointment
                  writes — so a patient with a day and a time on file had a popup that
                  never mentioned either, and the only sign of the appointment was the
                  word in the header. */}
              {(lead.appointment_date || lead.appointment_time || lead.appointment_department || lead.appointment_mode || lead.diagnosis) && (
                <div className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm" data-testid="branch-lead-appointment-details">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><ClipboardList className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Appointment Details</p>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    {lead.appointment_date && (
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="shrink-0 text-xs font-medium text-slate-500">Date</span>
                        <span className="text-right font-medium text-slate-800" data-testid="branch-lead-appt-date">{weekdayLabel(lead.appointment_date)}</span>
                      </div>
                    )}
                    {lead.appointment_time && (
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="shrink-0 text-xs font-medium text-slate-500">Time</span>
                        <span className="text-right font-semibold text-slate-900" data-testid="branch-lead-appt-time">{to12h(lead.appointment_time)}</span>
                      </div>
                    )}
                    {lead.appointment_department && (
                      <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Service</span><span className="font-medium capitalize text-slate-800">{lead.appointment_department === "physio" ? "Physiotherapy" : "Fitness"}</span></div>
                    )}
                    {lead.appointment_mode && (
                      <div className="flex items-center justify-between text-sm"><span className="text-xs font-medium text-slate-500">Type</span><span className="font-medium capitalize text-slate-800">{lead.appointment_mode}</span></div>
                    )}
                    {lead.diagnosis && (
                      <div className="text-sm"><span className="text-xs font-medium text-slate-500">Diagnosis</span><p className="mt-0.5 font-medium text-slate-800">{lead.diagnosis}</p></div>
                    )}
                  </div>
                </div>
              )}

              {lead.assigned_physio_name && (
                <div className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><UserPlus className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Assigned Jr. Physio</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <p className="min-w-0 truncate text-sm font-medium text-slate-800">{lead.assigned_physio_name}</p>
                    {/* Only where there is a booked slot to hand over. Without a date and a
                        time this is a reassignment with nothing to reassign, and the
                        appointment dialog is the right place to make one. */}
                    {lead.appointment_date && lead.appointment_time && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 text-[11px]"
                        onClick={() => openHandover(lead)}
                        data-testid={`appt-handover-open-${lead.id}`}
                      >
                        <ArrowLeftRight className="mr-1 h-3 w-3" /> Change
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Who the patient is and what they came in saying, read back off the record.

                  Under the working cards on purpose: a lead parked at RNR is opened to find
                  out how many times somebody has rung, and this is the reference sitting
                  beneath that. It costs nothing on the lead this was missing from most — one
                  still at the opening, where none of RNR, Follow-Up, Appointment or the
                  physio card draws at all, so this lands directly under Contact, which is
                  exactly where it belongs for a lead nobody has worked yet. */}
              {(leadDetailRows.length > 0 || formAnswers.length > 0) && (
                <div className="overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-sm" data-testid="branch-lead-details">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700"><IdCard className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Lead Details</p>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    {leadDetailRows.map(([label, value]) => (
                      <DetailRow key={label} label={label} value={String(value)} />
                    ))}
                    {formAnswers.length > 0 && (
                      <div className="space-y-2 border-t border-slate-100 pt-2.5" data-testid="branch-lead-form-answers">
                        {/* Named for where they came from rather than "Custom Fields": on
                            this board they are the questions the patient answered, not
                            columns somebody added to a form. */}
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Enquiry Form</p>
                        {/* Stacked, unlike the rows above. These labels are whole questions
                            — "What type of pain are you experiencing?" — and a label beside
                            its value would leave each of them a couple of words wide. */}
                        {formAnswers.map(([key, value]) => (
                          <div key={key}>
                            <p className="text-[11px] font-medium text-slate-500">{humanKey(key)}</p>
                            <p className="break-words text-sm font-medium text-slate-800">{String(value)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Which advert bought this lead. Super Admin alone sees it — see adRows. */}
              {adRows.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-fuchsia-100 bg-white shadow-sm" data-testid="branch-lead-data">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-fuchsia-100 text-fuchsia-700"><Megaphone className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-700">Lead Data</p>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    {adRows.map(([label, value]) => (
                      <DetailRow key={label} label={label} value={value} />
                    ))}
                  </div>
                </div>
              )}

              {lead.notes && (
                <div className="overflow-hidden rounded-xl border border-amber-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><FileText className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Notes</p>
                  </div>
                  <p className="px-4 py-3 text-sm leading-relaxed text-slate-700">{lead.notes}</p>
                </div>
              )}

              {/* Stage Pipeline */}
              <div className="overflow-hidden rounded-xl border border-violet-100 bg-white shadow-sm" data-testid="branch-lead-pipeline">
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><ChevronRight className="h-4 w-4" /></span>
                  <p className="text-xs font-bold uppercase tracking-wider text-violet-700">Pipeline Stage</p>
                </div>
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  {(pipelineStages || []).map((s) => {
                    const stage = s.name;
                    // The mirrored "Leads" pill reads the lead's Pre-Sales stage instead of
                    // its branch stage, and is never a move target: it exists to show where
                    // the lead already is, and writing to it would move the lead inside the
                    // Pre-Sales pipeline, which this board does not own.
                    const isMirror = !!s.mirrors_stage;
                    // Highlighted on the same terms the board filters by, so the pipeline
                    // here agrees with the pill the lead was listed under.
                    const isActive = isMirror
                      ? matchesBranchStage(lead, s, isConsultationOnlyStage)
                      : (lead.branch_stage === stage || lead.consultation_stage === stage);
                    const consultationOnly = isConsultationOnlyStage(stage);
                    // A Consultation-only stage isn't reachable until the lead has actually
                    // entered that pipeline (schedule-branch-appointment seeds
                    // consultation_stage the first time) — shown, but not yet clickable.
                    const notYetReached = consultationOnly && !lead.consultation_stage;
                    // Everything that is not one of Appointment's four exits, while the
                    // lead is sitting on Appointment. Drawn, and deliberately dead.
                    const blockedFromAppointment = inAppointmentStage && !isActive && !APPOINTMENT_EXITS.includes(stage);
                    const tint = s.color || "#64748b";
                    const handleClick = () => {
                      if (isMirror || blockedFromAppointment) return;
                      // Cancelling is not a move like the others: it puts the expert's slot
                      // back on the calendar, and the lead stops here. Asked before, not
                      // reported after — the pill sits one press from Follow Up and there
                      // is nothing on this card that undoes it.
                      if (stage === BRANCH_CANCELLED_STAGE) {
                        setCancelDraft(true);
                        return;
                      }
                      if (stage === APPOINTMENT_STAGE) {
                        setApptDraft({
                          appointment_date: lead.appointment_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
                          // Left blank on purpose — the time has to be picked from the
                          // expert's published slots, so pre-filling a guess like 10:00
                          // would show a time that may not actually be bookable.
                          appointment_time: lead.appointment_time || "",
                          physio_id: lead.assigned_physio_id || "",
                          notes: "",
                          duration: null,
                          final_stage: APPOINTMENT_STAGE,
                        });
                        return;
                      }
                      if (stage === "Follow Up") {
                        setFollowUpMoveDraft({ date: tomorrowIso(), time: "10:00", remarks: "" });
                        return;
                      }
                      if (consultationOnly) {
                        if (notYetReached) {
                          toast.error("This lead needs an appointment scheduled before it can enter the Consultations pipeline");
                          return;
                        }
                        onOpenConsultationStage && onOpenConsultationStage(stage);
                        return;
                      }
                      moveStage(stage);
                    };
                    return (
                      <Fragment key={s.id}>
                      <button
                        type="button"
                        disabled={isActive || notYetReached || isMirror || blockedFromAppointment}
                        onClick={handleClick}
                        title={blockedFromAppointment ? `${stageDisplayLabel(stage)} is not reachable from Appointment — the consultation moves the patient on from here` : undefined}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:shadow-md disabled:cursor-not-allowed ${blockedFromAppointment ? "disabled:opacity-40" : "disabled:opacity-90"}`}
                        style={isActive ? { background: tint, color: "#ffffff" } : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }}
                        data-testid={`branch-stage-btn-${stage}`}
                      >
                        {stageDisplayLabel(stage)}
                      </button>
                      {/* Reschedule rides beside Appointment rather than being a stage of
                          its own. Nothing about the patient changes when a booking moves —
                          they are still in Appointment, still waiting for the same
                          consultation — so a stage would have been a place the lead sat
                          until somebody remembered to move it back.

                          It opens the same booking popup Appointment does, prefilled with
                          the slot currently held. The backend treats a rebooking onto a
                          different slot as the reschedule and stamps the tag itself; there
                          is no separate endpoint and nothing here says which it was. */}
                      {stage === APPOINTMENT_STAGE && inAppointmentStage && (
                        <button
                          type="button"
                          onClick={() => setApptDraft({
                            appointment_date: lead.appointment_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
                            // Blank, like the first booking: the new time has to come off
                            // the expert's published slots, and carrying the old one over
                            // would offer back the very slot being moved away from.
                            appointment_time: "",
                            physio_id: lead.assigned_physio_id || "",
                            notes: "",
                            duration: null,
                            final_stage: APPOINTMENT_STAGE,
                          })}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-all hover:bg-amber-100 hover:shadow-md"
                          data-testid="branch-stage-btn-Reschedule"
                        >
                          Reschedule
                        </button>
                      )}
                      </Fragment>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {activeTab === "follow-up" && (
            <div className="space-y-4" data-testid="branch-lead-followup">
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4" data-testid="branch-followup-form">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700"><Bell className="h-3.5 w-3.5" /> Schedule Follow-Up</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Date</label>
                    <MilkDateInput  value={followUpForm.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUpForm({ ...followUpForm, date: e.target.value })} className="w-40" data-testid="branch-followup-date" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Time</label>
                    <MilkTimeInput value={followUpForm.time} onChange={(e) => setFollowUpForm({ ...followUpForm, time: e.target.value })} className="w-32" data-testid="branch-followup-time" />
                  </div>
                  <Input value={followUpForm.remarks} onChange={(e) => setFollowUpForm({ ...followUpForm, remarks: e.target.value })} placeholder="Remarks (optional)" className="min-w-[10rem] flex-1" data-testid="branch-followup-remarks" />
                  <Button size="sm" onClick={submitFollowUp} disabled={followUpBusy} className="bg-amber-600 text-white hover:bg-amber-700" data-testid="branch-followup-submit">Schedule</Button>
                </div>
              </div>

              {(lead.follow_ups || []).length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">No follow-ups scheduled yet</p>
              ) : (
                <div className="space-y-2">
                  {(lead.follow_ups || []).slice().reverse().map((f, idx) => {
                    const dt = new Date(`${f.date}T${f.time}:00`);
                    const isUpcoming = dt.getTime() > Date.now();
                    const isRescheduled = f.status === "rescheduled";
                    const isActive = idx === 0 && !isRescheduled;
                    return (
                      <div key={f.id} className={`flex items-start gap-3 rounded-lg border p-3 ${isRescheduled ? "border-slate-200 bg-slate-50/70 opacity-70" : isUpcoming ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`} data-testid={`branch-followup-row-${f.id}`}>
                        <span className={`mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${isRescheduled ? "bg-slate-100 text-slate-400" : isUpcoming ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          <Bell className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-sm font-semibold ${isRescheduled ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"}`}>
                              {dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {f.time}
                            </p>
                            {isRescheduled && <span className="rounded-full bg-slate-300 px-2 py-0.5 text-[10px] font-bold text-white">RESCHEDULED</span>}
                            {!isRescheduled && isUpcoming && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">UPCOMING</span>}
                          </div>
                          {f.remarks && <div className="mt-1.5 rounded-md bg-white px-2.5 py-1.5 text-sm text-slate-700 ring-1 ring-slate-100">{f.remarks}</div>}
                          {isRescheduled && f.reschedule_reason && (
                            <div className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 ring-1 ring-amber-100"><span className="font-semibold">Reschedule reason:</span> {f.reschedule_reason}</div>
                          )}
                          <p className="mt-1.5 text-[11px] text-slate-400">Set by {f.created_by || "—"}</p>
                        </div>
                        {isActive && (
                          <Button size="sm" variant="outline" className="h-8 flex-shrink-0 border-amber-200 text-amber-700 hover:bg-amber-50" onClick={() => setRescheduleDraft({ followupId: f.id, date: f.date, time: f.time, reason: "" })} data-testid={`branch-followup-reschedule-${f.id}`}>
                            Reschedule
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {rescheduleDraft && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="branch-followup-reschedule-form">
                  <p className="mb-2 text-xs font-semibold text-amber-700">Reschedule Follow-Up</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">New Date</label>
                      <MilkDateInput  value={rescheduleDraft.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, date: e.target.value })} className="w-40" data-testid="branch-followup-reschedule-date" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">New Time</label>
                      <MilkTimeInput value={rescheduleDraft.time} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })} className="w-32" data-testid="branch-followup-reschedule-time" />
                    </div>
                    <Input value={rescheduleDraft.reason} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, reason: e.target.value })} placeholder="Reason (optional)" className="min-w-[10rem] flex-1" data-testid="branch-followup-reschedule-reason" />
                    <Button size="sm" variant="outline" onClick={() => setRescheduleDraft(null)} data-testid="branch-followup-reschedule-cancel">Cancel</Button>
                    <Button size="sm" onClick={submitReschedule} disabled={followUpBusy} className="bg-amber-600 text-white hover:bg-amber-700" data-testid="branch-followup-reschedule-save">Save</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Every attempt, rather than the counter and the latest one the Overview card
              carries. The two answer different questions: whether this lead is worth
              ringing again, and what was actually done — which needs the dates and the
              names beside them, because "8 attempts" says nothing about whether they were
              eight days apart or eight in one afternoon.

              Read off the same lead_activity log Timeline draws, filtered to the rows the
              RNR endpoint writes. Nothing new is stored for this: every press of +1 No
              Answer has always left a row, it simply had nowhere to be read except mixed
              in with the rest of the history. */}
          {activeTab === "rnr" && (
            <div className="space-y-3" data-testid="branch-lead-rnr-record">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-100 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600"><PhoneOff className="h-4 w-4" /></span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Call Attempts</p>
                    <p className="text-[11px] text-slate-500">
                      {rnrCount === 0 ? "None logged yet" : `${rnrCount} logged`}
                      {lead.rnr_last_attempt_at && ` · last ${callDateStamp(lead.rnr_last_attempt_at)}`}
                    </p>
                  </div>
                </div>
                {atRnrStage && (
                  <Button
                    size="sm"
                    onClick={logRnrAttempt}
                    className="h-8 bg-rose-600 text-white hover:bg-rose-700"
                    data-testid="branch-lead-rnr-record-attempt"
                  >
                    <PhoneOff className="mr-1 h-3.5 w-3.5" /> +1 No Answer
                  </Button>
                )}
              </div>

              {rnrLog.length === 0 ? (
                /* The counter can be ahead of the log on a lead whose attempts predate the
                   activity row being written, so this says what it can see rather than
                   claiming nobody ever rang. */
                <p className="py-8 text-center text-sm text-slate-400" data-testid="branch-lead-rnr-record-empty">
                  {rnrCount > 0 ? "No individual attempts on record for this lead." : "No call attempts logged yet."}
                </p>
              ) : (
                <ol className="ml-3 space-y-4 border-l-2 border-rose-100 py-1 pl-6">
                  {rnrLog.map((a) => (
                    <li key={a.id} className="relative" data-testid={`branch-lead-rnr-entry-${a.id}`}>
                      <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-rose-500" />
                      <div className="rounded-lg border border-rose-100 bg-rose-50/50 p-3">
                        <p className="text-sm text-slate-700">{a.details}</p>
                        <p className="mt-1 text-[10px] text-slate-400">{a.created_by} · {a.created_at?.slice(0, 16).replace("T", " ")}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {activeTab === "timeline" && (
            <div className="space-y-3" data-testid="branch-lead-timeline">
              {(() => {
                const events = [
                  ...remarks.map((r) => ({ ...r, _kind: "remark" })),
                  ...activityLog.map((a) => ({ ...a, _kind: "activity" })),
                ].sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
                if (events.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No timeline events yet</p>;
                return (
                  <ol className="ml-3 space-y-4 border-l-2 border-slate-200 py-1 pl-6">
                    {events.map((h) => (
                      <li key={`${h._kind}-${h.id}`} className="relative" data-testid={`branch-timeline-${h._kind}-${h.id}`}>
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
        </div>
      </div>

      {/* Appointment Date & Time Popup */}
      {handover && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !handover.saving) setHandover(null); }}
          data-testid="appt-handover-modal"
        >
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="shrink-0 border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Change consultant</h3>
              {/* The slot is stated and not offered for editing: this hands the same
                  appointment to somebody else, and moving it is what the appointment
                  dialog is for. */}
              <p className="mt-0.5 text-xs text-slate-500">
                {weekdayLabel(handover.date)} · {to12h(handover.time)}
                {handover.currentName ? <> — currently <b className="text-slate-700">{handover.currentName}</b></> : null}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {handover.loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
              {!handover.loading && handover.options.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-slate-400">
                  Every consultant is already booked at this time.
                </p>
              )}
              {!handover.loading && handover.options.map((doc) => {
                const mine = doc.id === handover.currentId;
                // Published means they had already opened this time; the rest can still
                // take it, which is the whole point of asking here rather than in the
                // slot picker.
                const published = (doc.free_slots || []).some((sl) => sl.time === handover.time);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    disabled={handover.saving || mine}
                    onClick={() => confirmHandover(doc)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition disabled:opacity-60 ${mine ? "bg-slate-50" : "hover:bg-sky-50"}`}
                    data-testid={`appt-handover-pick-${doc.id}`}
                  >
                    {/* Same faces the booking popup's CONSULTANT column shows — this is
                        the same list of experts off the same call, and a photo in one of
                        them and an initial in the other reads as two different people. */}
                    <EmployeeAvatar employee={doc} size={32} className="text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{doc.full_name}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {mine ? "Currently holds this appointment" : published ? "Free — this time is on their calendar" : "Free — not on their calendar, but nothing is booked"}
                      </span>
                    </span>
                    {mine && <span className="shrink-0 rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">NOW</span>}
                  </button>
                );
              })}
            </div>

            <div className="shrink-0 border-t border-slate-200 px-4 py-2.5 text-right">
              <Button variant="outline" size="sm" disabled={handover.saving} onClick={() => setHandover(null)} data-testid="appt-handover-cancel">
                {handover.saving ? "Saving…" : "Cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {apptDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-2 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setApptDraft(null); }} data-testid="branch-appt-modal">
          {/* A card, like every other popup here, but a tall one — three booking steps
              need the height, so it takes what's left after the backdrop rather than a
              fixed fraction. Heights in dvh: 100vh on mobile measures the viewport as if
              the browser's URL bar were hidden, which pushed Confirm below the fold. The
              vh values stay as the fallback for anything without dvh. */}
          <div className="flex h-[calc(100vh-1rem)] max-h-[calc(100dvh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <Calendar className="h-5 w-5 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-800 sm:text-lg">Appointment</p>
                  <p className="truncate text-xs text-slate-500">{lead.name} · pick a date, then the CONSULTANT, then their time</p>
                </div>
              </div>
              <button onClick={() => setApptDraft(null)} className="shrink-0 rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 transition hover:border-orange-300 hover:bg-orange-200 hover:text-orange-700" data-testid="branch-appt-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Three steps left to right: the date narrows who's available, the chosen
                Head Physio narrows which times exist. Each column only fills in once the
                one before it has an answer. */}
            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              {/* STEP 1 — Date */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-4 sm:p-6 lg:w-[28rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-appt-date-panel">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">1 · Date</p>
                {(() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                  const firstDow = new Date(apptMonth.y, apptMonth.m, 1).getDay();
                  const daysInMonth = new Date(apptMonth.y, apptMonth.m + 1, 0).getDate();
                  const pad = (n) => String(n).padStart(2, "0");
                  const stepMonth = (delta) => setApptMonth(({ y, m }) => {
                    const d = new Date(y, m + delta, 1);
                    return { y: d.getFullYear(), m: d.getMonth() };
                  });
                  return (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <button type="button" onClick={() => stepMonth(-1)} className="rounded p-1 hover:bg-slate-100" data-testid="branch-appt-prev-month">
                          <ChevronLeft className="h-5 w-5 text-slate-500" />
                        </button>
                        <h4 className="text-base font-bold text-slate-700">{monthNames[apptMonth.m]} {apptMonth.y}</h4>
                        <button type="button" onClick={() => stepMonth(1)} className="rounded p-1 hover:bg-slate-100" data-testid="branch-appt-next-month">
                          <ChevronRight className="h-5 w-5 text-slate-500" />
                        </button>
                      </div>
                      <div className="mb-1 grid grid-cols-7 gap-1">
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                          <div key={d} className="py-1 text-center text-xs font-semibold text-slate-400">{d}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: firstDow }, (_, i) => <div key={`pad-${i}`} className="h-14" />)}
                        {Array.from({ length: daysInMonth }, (_, i) => {
                          const day = i + 1;
                          const dateStr = `${apptMonth.y}-${pad(apptMonth.m + 1)}-${pad(day)}`;
                          const isPast = dateStr < todayStr;
                          const isPicked = apptDraft.appointment_date === dateStr;
                          const isToday = dateStr === todayStr;
                          const openSlots = apptOpenDates[dateStr] || 0;
                          const hasSlots = !isPast && openSlots > 0;
                          return (
                            <button
                              key={day}
                              type="button"
                              disabled={isPast}
                              // A new date invalidates the expert and slot chosen under the
                              // old one — availability is per-day, so both are cleared.
                              onClick={() => setApptDraft({ ...apptDraft, appointment_date: dateStr, physio_id: "", appointment_time: "", duration: null })}
                              className={`h-14 rounded-lg text-lg font-semibold transition ${
                                isPicked
                                  // Brand blue -- colors.palette.primary, #0EA5E9. The halo
                                  // is sky-300 rather than sky-200 on purpose: sky-200 is
                                  // what the legend teaches as "slots open", and a picked
                                  // day ringed in it would read as saying both.
                                  ? "bg-sky-500 text-white shadow-sm ring-2 ring-sky-300"
                                  : isPast
                                  ? "cursor-not-allowed text-slate-300"
                                  : hasSlots
                                  // Light blue marks a day that actually has a slot free, so
                                  // the days worth clicking are visible without opening each
                                  // one. The number goes dark with the fill -- this carried
                                  // white text while it was violet-300, which a light blue
                                  // cannot hold.
                                  ? "bg-sky-200 text-sky-900 shadow-sm hover:bg-sky-300"
                                  : isToday
                                  ? "border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100"
                                  : "text-slate-600 hover:bg-slate-100"
                              }`}
                              title={hasSlots ? `${openSlots} slot${openSlots === 1 ? "" : "s"} open` : undefined}
                              data-testid={`branch-appt-day-${day}`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-400">
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-sky-200" /> Slots open</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-sky-500" /> Picked</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* STEP 2 — Head Physio */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-4 sm:p-5 lg:w-[22rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-appt-expert-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">2 · CONSULTANT</p>
                <p className="mb-3 text-xs text-slate-400">Only those with availability on the picked date.</p>
                {!apptDraft.appointment_date ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Pick a date first.</p>
                ) : apptExperts.loading ? (
                  <p className="text-sm text-slate-400">Checking availability...</p>
                ) : apptExperts.experts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">No CONSULTANT is available on this date.</p>
                ) : (
                  <div className="space-y-2">
                    {apptExperts.experts.map((doc) => {
                      const active = apptDraft.physio_id === doc.id;
                      const open = (doc.free_slots || []).length;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setApptDraft({ ...apptDraft, physio_id: doc.id, appointment_time: "", duration: null })}
                          className={`flex w-full items-center gap-3 rounded-lg border-2 p-3.5 text-left transition ${active ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-slate-50"}`}
                          data-testid={`branch-appt-expert-${doc.id}`}
                        >
                          {/* The consultant's own face where HR has one on file, their
                              initial in the column's teal where they do not — the same
                              component the directory and the signed-in header use, so a
                              photo cannot appear on some boards and not others. The ring
                              carries the picked state a solid fill used to, which a
                              photograph has no room for. */}
                          <EmployeeAvatar
                            employee={doc}
                            size={44}
                            fallbackClassName={active ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-700"}
                            className={active ? "ring-2 ring-teal-500" : ""}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-800">{doc.full_name}</p>
                            {/* How much of this consultant's day is actually free is the
                                one number this column is picked on, so it is a badge with
                                the count carrying the weight rather than a grey line of
                                text under the name. Sky, matching the calendar beside it,
                                where sky-200 already means "slots open" — one colour for
                                availability across both steps. Amber where there are none,
                                as before: that is a different message, not a smaller count. */}
                            <span
                              className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                                open > 0
                                  ? "bg-sky-100 text-sky-800 ring-sky-200"
                                  : "bg-amber-50 text-amber-700 ring-amber-200"
                              }`}
                              data-testid={`branch-appt-expert-open-${doc.id}`}
                            >
                              {open > 0 ? (
                                <>
                                  <span className="text-sm font-extrabold tabular-nums">{open}</span>
                                  slot{open === 1 ? "" : "s"} open
                                </>
                              ) : (
                                "Nothing published"
                              )}
                            </span>
                          </div>
                          {active && <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-teal-600" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* The room the picked CONSULTANT meets in, under the choice that decides
                    it. Read off their record — set in MANAGEMENT → CONSULTANT CALENDAR —
                    rather than typed here: it is a fact about the expert, the same one
                    every patient booked with them is sent, and a booking screen able to
                    name the room would be a booking screen able to send a patient
                    anywhere.

                    Said before Confirm rather than only after it, because it is the half
                    of an online appointment the branch cannot check afterwards. A
                    consultant with no room recorded is the one case worth interrupting
                    for: the confirmation is about to go out with nowhere in it. */}
                {/* The link itself wherever there is one — a room recorded against this
                    consultant is where this appointment is happening, whichever board is
                    booking it. The warning for a missing one only on an online arm, where
                    a missing room is a confirmation about to go out with nowhere in it. */}
                {apptSelectedExpert && (apptMeetLink || onlineArm) && (
                  apptMeetLink ? (
                    <div className="mt-3 rounded-lg border-2 border-violet-200 bg-violet-50 p-3" data-testid="branch-appt-meet-link">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-500">
                        <Video className="h-3.5 w-3.5" /> Google Meet
                      </p>
                      <a
                        href={apptMeetLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block break-all text-xs font-semibold text-violet-700 hover:underline"
                        data-testid="branch-appt-meet-link-open"
                      >
                        {apptMeetLink.replace(/^https?:\/\//, "")}
                      </a>
                      <p className="mt-1.5 text-[10px] text-violet-500">Goes to the patient with the confirmation.</p>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border-2 border-amber-200 bg-amber-50 p-3" data-testid="branch-appt-no-meet-link">
                      <p className="text-xs font-semibold text-amber-800">No Google Meet link for this CONSULTANT.</p>
                      <p className="mt-0.5 text-[10px] text-amber-700">
                        The confirmation will go out without one. Add it in MANAGEMENT → CONSULTANT CALENDAR.
                      </p>
                    </div>
                  )
                )}
              </div>

              {/* STEP 3 — Time slot. Times come only from what the expert has actually
                  confirmed on HEAD PHYSIO CALENDAR — no free typing, so nothing gets booked
                  into a slot the Head Physio never agreed to. */}
              {/* overflow and flex-1 are gated to lg on purpose. Below that the three
                  steps are one stacked column that scrolls as a whole, and an inner
                  scroller here would trap Time Slot in a short box of its own inside
                  that scroll — two scrollbars, and the slots unreachable. */}
              <div className="w-full flex-shrink-0 p-4 sm:p-5 lg:flex-1 lg:overflow-y-auto" data-testid="branch-appt-slot-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">3 · Time Slot</p>
                <p className="mb-3 text-xs text-slate-400">
                  Published availability. Booked times are shown in amber.
                </p>
                {!apptDraft.physio_id ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Select a CONSULTANT to see their available times.</p>
                ) : apptSlotsForExpert.length === 0 ? (
                  <div className="rounded-lg border-2 border-amber-200 bg-amber-50 px-4 py-3" data-testid="branch-appt-no-slots">
                    <p className="text-sm font-semibold text-amber-800">No availability published for this date.</p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Confirm with the expert, then open MANAGEMENT → CONSULTANT CALENDAR and mark them available.
                    </p>
                  </div>
                ) : (
                  <>
                  {/* Every slot greyed out would otherwise be a grid with no explanation
                      of why nothing responds to a click. */}
                  {apptFreeCount === 0 && (
                    <div className="mb-2 rounded-lg border-2 border-amber-200 bg-amber-50 px-3 py-2" data-testid="branch-appt-fully-booked">
                      <p className="text-xs font-semibold text-amber-800">Every published slot on this date is already booked.</p>
                      <p className="mt-0.5 text-[11px] text-amber-700">Pick another date, or publish more availability in MANAGEMENT → CONSULTANT CALENDAR.</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="branch-appt-slots">
                    {apptSlotsForExpert.map((s) => {
                      const active = apptDraft.appointment_time === s.time;
                      // Disabled, not merely styled: a booked slot that still responds to a
                      // click would put a second patient on one time and the clash would
                      // only surface on Confirm.
                      return (
                        // Amber, matching the booked slot on HEAD PHYSIO CALENDAR — the same
                        // fact in two places should look the same. Not struck through: the
                        // time hasn't been withdrawn, it belongs to someone, and the name
                        // below says who so a clash can be discussed on the call.
                        <button
                          key={s.slot_time}
                          type="button"
                          disabled={s.booked}
                          onClick={() => setApptDraft({ ...apptDraft, appointment_time: s.time, duration: s.duration })}
                          className={`rounded-lg border-2 px-2 py-2.5 text-center transition ${
                            s.booked
                              ? "cursor-not-allowed border-amber-300 bg-amber-50"
                              : active
                                ? "border-teal-500 bg-teal-50 text-teal-700 shadow-sm ring-2 ring-teal-100"
                                : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-slate-50"
                          }`}
                          title={s.booked ? (s.lead_name ? `Booked — ${s.lead_name}` : "Already booked") : undefined}
                          data-testid={`branch-appt-slot-${s.time}`}
                        >
                          <span className={`block text-base font-bold ${s.booked ? "text-amber-800" : ""}`}>{to12h(s.time)}</span>
                          {s.booked ? (
                            <>
                              <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">Booked</span>
                              {s.lead_name && <span className="mt-0.5 block truncate text-[10px] text-amber-600">{s.lead_name}</span>}
                            </>
                          ) : (
                            <span className="block text-[11px] text-slate-400">{s.duration} min</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  </>
                )}
                {/* Start time only. A consultation runs as long as it needs to, so printing
                    an end time and a duration here stated something the branch cannot
                    promise. The slot's duration is still recorded and still drives the
                    expert's calendar and clash checks -- it is just not shown as a
                    commitment to the patient. */}
                {apptDraft.appointment_time && (
                  <p className="mt-4 rounded-lg border-2 border-teal-300 bg-teal-50 px-4 py-2.5 text-sm font-bold text-teal-700" data-testid="branch-appt-slot-summary">
                    Consultation starts {to12h(apptDraft.appointment_time)}
                  </p>
                )}

                <div className="mt-5">
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Notes</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    placeholder="Optional notes about the appointment..."
                    value={apptDraft.notes}
                    onChange={(e) => setApptDraft({ ...apptDraft, notes: e.target.value })}
                    data-testid="branch-appt-notes"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-100 px-3 py-3 sm:gap-3 sm:px-6 sm:py-3.5">
              {/* Marking the lead Cancelled is a destructive move — it frees the slot and
                  drops the lead out of the consultation pipeline — so it reads red the
                  moment it's ticked, and carries the primary button's colour with it. */}
              {(() => {
                const cancelled = apptDraft.final_stage === "Cancelled";
                return (
                  <button
                    type="button"
                    onClick={() => setApptDraft({ ...apptDraft, final_stage: cancelled ? "Appointment Date & Time" : "Cancelled" })}
                    className={`shrink rounded-lg border-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition sm:px-6 sm:text-sm ${
                      cancelled
                        ? "border-rose-700 bg-rose-600 text-white shadow-sm"
                        : "border-rose-200 bg-white text-rose-600 hover:border-rose-400 hover:bg-rose-50"
                    }`}
                    data-testid="branch-appt-cancel-toggle"
                    aria-pressed={cancelled}
                  >
                    Cancelled
                  </button>
                );
              })()}
              <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" onClick={() => setApptDraft(null)} data-testid="branch-appt-cancel">Cancel</Button>
              <Button
                className={apptDraft.final_stage === "Cancelled"
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-teal-600 text-white hover:bg-teal-700"}
                onClick={async () => {
                  if (!apptDraft.appointment_date) { toast.error("Pick a date"); return; }
                  if (!apptDraft.physio_id) { toast.error("Please select an expert"); return; }
                  if (!apptDraft.appointment_time) { toast.error("Pick a time slot"); return; }
                  try {
                    // Minted here so the confirmation, its share link and the stored
                    // booking all carry the same pair — no second round trip to learn
                    // what the server called it.
                    const refNo = `APT-${(lead.patient_number || lead.id || "").toString().slice(-8).toUpperCase()}-${Date.now().toString().slice(-6)}`;
                    const shareToken = randomToken();
                    await scheduleBranchAppointment(lead.id, { ...apptDraft, ref_no: refNo, share_token: shareToken });
                    toast.success(`Appointment ${apptDraft.appointment_date} ${to12h(apptDraft.appointment_time)} → ${apptDraft.final_stage}`);
                    const stage = apptDraft.final_stage;
                    setApptDraft(null);
                    // A cancellation has nothing to hand over, so it closes straight away.
                    // A booking shows its confirmation first and only tells the parent to
                    // close once that's dismissed — onMoved unmounts this whole card, and
                    // the confirmation has to survive long enough to be shared or printed.
                    if (stage === "Cancelled") {
                      onMoved && onMoved(stage);
                      return;
                    }
                    const hp = apptExperts.experts.find((d) => d.id === apptDraft.physio_id);
                    setApptConfirm({
                      finalStage: stage,
                      refNo,
                      shareToken,
                      patient: lead.name || "—",
                      patientNo: lead.patient_number || "—",
                      phone: lead.phone || "—",
                      branch: branchInfo?.branch_name || lead.branch_name || "",
                      branchAddress: branchInfo?.address || "",
                      mapLocation: branchInfo?.map_location || "",
                      date: apptDraft.appointment_date,
                      time: apptDraft.appointment_time,
                      duration: apptDraft.duration || 30,
                      headPhysio: hp?.full_name || lead.assigned_physio_name || "—",
                      // The room this was booked into. The server writes the same value
                      // onto the appointment off the expert's own record, so what is
                      // shared here is what the booking holds.
                      meetLink: (hp?.meet_link || "").trim(),
                      notes: (apptDraft.notes || "").trim(),
                      bookedBy: "Branch Admin",
                    });
                  } catch (e) {
                    // Names the failure rather than reporting every one as a scheduling
                    // failure: the booking above is only the first of several statements
                    // here, and a fault in any of the rest used to surface as "Failed to
                    // schedule" over a confirmation dialog that had already opened.
                    toast.error(e?.response?.data?.detail || e?.message || "Failed to schedule");
                  }
                }}
                data-testid="branch-appt-save"
              >
                {apptDraft.final_stage === "Cancelled" ? "Confirm Cancellation" : "Confirm"}
              </Button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Cancelling off Appointment. Says what will happen rather than "Are you sure?",
          which asks a question whose answer depends on knowing what the button does: the
          slot goes back on the expert's calendar, and Cancelled is the end of this
          pipeline — nothing on this card moves a lead out of it again. */}
      {cancelDraft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setCancelDraft(false); }}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" data-testid="branch-cancel-confirm">
            <div className="border-b p-5">
              <h3 className="text-base font-semibold text-slate-800">Cancel this appointment?</h3>
              <p className="text-[10px] text-slate-400">{lead.name}{lead.phone ? ` · ${lead.phone}` : ""}</p>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] text-rose-800">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {apptSlotLabel(lead)
                    ? <>The {apptSlotLabel(lead)} slot{lead.assigned_physio_name ? ` with ${lead.assigned_physio_name}` : ""} goes back on the calendar for someone else to take. </>
                    : <>Any slot this lead is holding goes back on the calendar. </>}
                  {lead.name} moves to Cancelled, which is the end of the Branch pipeline.
                </span>
              </div>
              {/* Rebooking is the other door, and it is one press away on the same card.
                  Said here because a Branch Admin reaching for Cancel because the patient
                  cannot make Tuesday wants Reschedule, and finding that out afterwards
                  costs them the slot. */}
              <p className="text-[11px] text-slate-500">
                If the patient only needs a different time, close this and press <span className="font-semibold text-amber-700">Reschedule</span> instead — that keeps the lead where it is.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t p-4">
              <Button variant="outline" size="sm" onClick={() => setCancelDraft(false)} data-testid="branch-cancel-confirm-back">Keep it</Button>
              <Button
                size="sm"
                disabled={cancelling}
                className="bg-rose-600 text-white hover:bg-rose-700"
                onClick={async () => {
                  setCancelling(true);
                  // Stays open if the move was refused, so the reason is read beside the
                  // button that caused it rather than over a card that has just closed.
                  const moved = await moveStage(BRANCH_CANCELLED_STAGE);
                  setCancelling(false);
                  if (moved) setCancelDraft(false);
                }}
                data-testid="branch-cancel-confirm-submit"
              >
                {cancelling ? "Cancelling..." : "Cancel appointment"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Appointment confirmation — the sheet the client is given. Opening it as a PDF,
          sharing it or saving it all render the exact same document. */}
      {apptConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid="branch-appt-confirm-modal">
          {/* 90%, this dialog only. zoom rather than transform: scale — zoom shrinks the
              layout box itself, so the flex centring above and the max-h below still work
              on the size actually drawn. scale would leave the box at full size, centring
              the card off its own bounds and reserving space nothing occupies. */}
          <div
            className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            style={{ zoom: 0.9 }}
          >
            {/* The receipt popup's header. items-center so the two-line title does not
                leave a band of empty teal beneath it, a status mark rather than the logo
                (which already opens the body), and a plain close — the orange-bordered X
                read as a warning on a dialog that only confirms. */}
            <div className="flex shrink-0 items-center justify-between gap-3 bg-teal-600 px-4 py-3 text-white">
              <div className="flex min-w-0 items-center gap-2.5">
                <CheckCircle2 className="h-7 w-7 shrink-0" />
                <div className="min-w-0">
                  <p className="text-base font-bold leading-tight">Appointment Confirmed</p>
                  <p className="truncate text-xs text-white/80">Ref {apptConfirm.refNo}</p>
                </div>
              </div>
              <button
                onClick={() => { const s = apptConfirm.finalStage; setApptConfirm(null); onMoved && onMoved(s); }}
                className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20"
                aria-label="Close"
                data-testid="branch-appt-confirm-close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="rounded-xl border-2 border-teal-200 bg-teal-50 px-4 py-5 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-teal-600">Your Appointment</p>
                {/* Day and time on one line — they are read as one fact. Start only: a
                    consultation runs as long as it needs to, so printing an end time
                    promised something the branch cannot hold to. Wrapping is left on so a
                    narrow phone drops the time to its own line rather than shrinking it. */}
                <p className="mt-1 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-0.5 text-xl font-extrabold text-teal-700 sm:text-2xl">
                  <span>{weekdayDmy(apptConfirm.date)}</span>
                  <span className="text-lg sm:text-xl">{to12h(apptConfirm.time)}</span>
                </p>
                <p className="mt-1 text-sm font-semibold text-teal-600">with {apptConfirm.headPhysio}</p>
              </div>

              <dl className="mt-5 space-y-2 text-sm">
                {apptRows(apptConfirm, { compact: true }).filter(Boolean).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt className="shrink-0 text-slate-500">{k}</dt>
                    {/* break-words and min-w-0 for the meeting link, which is one
                        unbroken token long enough to push the row off its own card. */}
                    <dd className="min-w-0 break-words text-right font-semibold text-slate-700">{v}</dd>
                  </div>
                ))}
              </dl>

              {/* The two standing instructions, same wording the printed sheet carries.
                  The first of them is about travelling to a branch, so an appointment held
                  in a video room is told to join early instead — the same swap apptMessage
                  makes, and for the same reason: nobody arrives anywhere for this one. */}
              <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-xs leading-relaxed text-teal-800" data-testid="branch-appt-confirm-note">
                <p>{apptConfirm.meetLink ? "Please join the meeting 5 minutes early." : "Please arrive 10 minutes early."}</p>
                <p>To reschedule or cancel, contact the branch quoting reference {apptConfirm.refNo}.</p>
              </div>

              {apptConfirm.notes && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{apptConfirm.notes}</p>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3">
              {/* Icons on one row, as the receipt popup does. Every label moves to title
                  and aria-label rather than being dropped. Done goes with them: the header
                  X runs the same close-and-move, so it was a second button for one action. */}
              <div className="flex items-center justify-center gap-2 pt-1 sm:gap-3">
                {/* A printer, matching the receipt popup's own first button. It opens the
                    sheet with the print dialog already up, which is what a printer icon
                    promises — the document glyph promised a file and delivered a print.
                    Save-as-PDF still lives behind that dialog, so nothing is lost. */}
                <Button
                  variant="outline"
                  className="h-10 w-10 shrink-0 p-0"
                  onClick={() => openPrintable(apptHtml(apptConfirm), { print: true })}
                  title="Print"
                  aria-label="Print"
                  data-testid="branch-appt-confirm-pdf"
                >
                  <Printer className="h-4 w-4" />
                </Button>
                {/* The one the branch actually reaches for: straight to the patient's own
                    number with the confirmation typed, card image on the clipboard. */}
                <Button
                  className="h-10 w-10 shrink-0 bg-[#25D366] p-0 text-white hover:bg-[#1da851]"
                  onClick={() => sendApptOnWhatsApp(apptConfirm)}
                  title="Send on WhatsApp"
                  aria-label="Send on WhatsApp"
                  data-testid="branch-appt-confirm-whatsapp"
                >
                  <WhatsAppIcon className="h-4 w-4" />
                </Button>
                {/* The attachment route proper: the share sheet is the only thing that can
                    carry a file, at the cost of asking who it is going to. */}
                <Button
                  variant="outline"
                  className="h-10 w-10 shrink-0 p-0"
                  onClick={() => shareApptCard(apptConfirm)}
                  title="Send Card + Message"
                  aria-label="Send Card + Message"
                  data-testid="branch-appt-confirm-share-card"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-10 w-10 shrink-0 p-0"
                  onClick={() => downloadApptCard(apptConfirm)}
                  title="Download Card"
                  aria-label="Download Card"
                  data-testid="branch-appt-confirm-download"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Follow Up Date & Time Popup (triggered from Move to Stage) */}
      {followUpMoveDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) setFollowUpMoveDraft(null); }} data-testid="branch-followup-move-modal">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <p className="text-base font-semibold">Follow Up — Date & Time</p>
              </div>
              <button onClick={() => setFollowUpMoveDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="branch-followup-move-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Date *</label>
                {/* Always open, in the OS's own palette — the native picker dropped a
                    browser dialog with its own chrome and blue over the popup. */}
                <MilkCalendar
                  value={followUpMoveDraft.date}
                  min={new Date().toISOString().slice(0, 10)}
                  accent="amber"
                  onChange={(d) => setFollowUpMoveDraft({ ...followUpMoveDraft, date: d })}
                  testid="branch-followup-move-date"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                <MilkTimeInput value={followUpMoveDraft.time} onChange={(e) => setFollowUpMoveDraft({ ...followUpMoveDraft, time: e.target.value })} data-testid="branch-followup-move-time" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="Optional remarks..."
                  value={followUpMoveDraft.remarks}
                  onChange={(e) => setFollowUpMoveDraft({ ...followUpMoveDraft, remarks: e.target.value })}
                  data-testid="branch-followup-move-remarks"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setFollowUpMoveDraft(null)} data-testid="branch-followup-move-cancel">Cancel</Button>
              <Button className="bg-amber-600 text-white hover:bg-amber-700" onClick={submitFollowUpMove} disabled={followUpMoveBusy} data-testid="branch-followup-move-save">Save & Move</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
