import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Search,
  Stethoscope,
  UserPlus,
  X,
  Activity,
  LayoutDashboard,
  FileText,
  Share2,
  Copy,
  Link as LinkIcon,
  Download,
  ShoppingCart,
  ClipboardList,
  Bell,
  BadgeIndianRupee,
  UserCog,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { StageTabBar, stageDisplayLabel } from "@/components/ui/stage-tab";
import { apptCardPng, REASSURANCE } from "@/lib/apptCard";
import {
  scheduleBranchAppointment,
  publicAppointmentUrl,
  getBranches,
  getBranchBoard,
  getAvailableExperts,
  getAvailableDates,
  getLeadActivity,
  getLeadRemarks,
  moveBranchStage,
  stagesList,
  scheduleBranchFollowUp,
  rescheduleBranchFollowUp,
} from "@/lib/api";
import { to12h, endTime12h } from "@/lib/time";
import { HeadPhysioCalendar } from "@/components/HeadPhysioCalendar";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";
import { FitsiomaxStorePanel } from "@/components/BranchStoreBoard";
import { PullFromSheetButton } from "@/components/PullFromSheetButton";
import { AccountantManageTab } from "@/components/branch/AccountantManageTab";
import { BranchCalendarPanel } from "@/components/branch/BranchCalendarPanel";
import { BranchDetailPage } from "@/components/branch/BranchDetailPage";
import { BranchReviewPanel } from "@/components/branch/BranchReviewPanel";
import { PatientsPortalPanel } from "@/components/branch/PatientsPortalPanel";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { LOGO_URL, PRINTABLE_STYLES, escapeHtml, rowsHtml, openPrintable } from "@/lib/printable";

// ---- Appointment confirmation -------------------------------------------------------
// What the client walks away with. Built as its own document so it can be opened, printed
// to PDF, saved or shared — same branding, styles and mechanics the payment receipt uses,
// from lib/printable.js.

/** "2026-08-05" -> "05 - 08 - 2026" */
const dmyLabel = (d) => {
  const [y, m, day] = String(d || "").split("-");
  return y && m && day ? `${day} - ${m} - ${y}` : d || "—";
};
/** "2026-08-05" -> "Wednesday, 5 August" */
const weekdayLabel = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })
  : "—");

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
  ["Duration", `${a.duration} minutes`],
  compact ? null : ["Head Physio", a.headPhysio],
  a.branch ? ["Branch", a.branch] : null,
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

/** Where the patient opens their own copy of this confirmation. Keyed by an unguessable
 *  token rather than the reference number, which is printed on the sheet and derived
 *  from the patient number — guessable, and not something to hang access on. */
const apptLink = (a) => (a.shareToken ? publicAppointmentUrl(a.shareToken) : "");

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
 * Resolves true when the card made it to the clipboard, so the caller can leave the
 * paste instruction on screen instead of in a toast that the handoff wipes out.
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
  // Only the failure is worth a toast — success is said by the panel that stays up.
  if (!copied) toast.message("This browser can't copy the card — use Send Card + Message for the image");
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
 *  telling them they're in hand. Short lines, because it is read on a phone in WhatsApp. */
const apptMessage = (a) => {
  const lines = [
    `Hi ${a.patient},`,
    "",
    "Your appointment is",
    weekdayLabel(a.date),
    `${to12h(a.time)} to ${endTime12h(a.time, a.duration)}`,
  ];
  if (a.branch) lines.push(`at ${a.branch}`);
  lines.push("", REASSURANCE, "— Team Fitsiomax", "", `Head Physio: ${a.headPhysio}`);
  if (a.notes) lines.push(`Notes: ${a.notes}`);
  if (a.branchAddress) lines.push("", `Location: ${a.branchAddress}`);
  if (a.mapLocation) lines.push(a.mapLocation);
  lines.push("", "Please arrive 10 minutes early.");
  return lines.join("\n");
};

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
  <div class="note">Please arrive 10 minutes early. To reschedule or cancel, contact the branch
  quoting reference ${escapeHtml(a.refNo)}.</div>
  <hr>
  <div class="foot">This is a computer-generated confirmation and needs no signature.<br>Thank you for choosing FITSIOMAX.</div>
</div></body></html>`;

/** Clipboard write, with the execCommand fallback for the non-HTTPS/older-browser case
 *  where navigator.clipboard simply isn't there. */
const copyApptText = async (text, successMsg) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    toast.success(successMsg);
  } catch {
    toast.error("Couldn't copy on this device");
  }
};

const copyApptMessage = (a) => copyApptText(apptMessage(a), "Confirmation copied — paste it into WhatsApp or SMS");

export const BranchAdminBoard = ({ branchId }) => {
  const [boardData, setBoardData] = useState({ leads: [], stage_counts: {} });
  const [stages, setStages] = useState([]); // dynamic Branch Stages, from Super Admin > Pipeline Stage Management
  const [consultationStages, setConsultationStages] = useState([]); // dynamic Consultation Stages, merged into the same stage bar
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [activeView, setActiveView] = useState("pipeline");
  const [consultationsSubTab, setConsultationsSubTab] = useState("head_physio");
  const [stageFilter, setStageFilter] = useState(null); // null = show all stages
  const [dateFilter, setDateFilter] = useState(null); // { from, to, label, key } | null
  const [showCreateLead, setShowCreateLead] = useState(false);
  // Set when a lead's own detail popup hands off to a Consultation-only stage — tells the
  // embedded ConsultationsBoard which lead to auto-open once it loads, so the handoff lands
  // straight on that lead's own rich modal instead of just the filtered list.
  const [autoOpenLeadId, setAutoOpenLeadId] = useState(null);

  const loadBoard = useCallback(async () => {
    if (!branchId) return null;
    setLoading(true);
    let data = null;
    try {
      data = await getBranchBoard(branchId);
      setBoardData(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Failed to load branch board");
    }
    setLoading(false);
    return data;
  }, [branchId]);

  useEffect(() => { loadBoard(); }, [loadBoard]);
  useEffect(() => { stagesList("sales").then(setStages).catch(() => {}); }, []);
  useEffect(() => { stagesList("consultation").then(setConsultationStages).catch(() => {}); }, []);

  const stageColor = useCallback(
    (name) => stages.find((s) => s.name === name)?.color || "#64748b",
    [stages],
  );

  // The entry stage of Branch's own pipeline ("New Leads" by default, but Super Admin can
  // rename it) — read structurally off position 0 rather than hardcoding the label, since
  // Pipeline Stage Management lets it be renamed at any time.
  const firstStageName = stages[0]?.name;

  // Branch Leads' stage bar shows both pipelines' stages in one continuous strip, so a
  // branch admin never needs to leave this tab to track a patient's whole journey. Any
  // stage name shared by both pipelines (e.g. "Follow Up") only gets one pill, backed by
  // the sales-side field — the Consultations tab itself is still the place to see a lead
  // sitting in the post-appointment Follow Up.
  const combinedStages = useMemo(
    () => [...stages, ...consultationStages.filter((cs) => !stages.some((s) => s.name === cs.name))],
    [stages, consultationStages],
  );
  // True only when the active pill is one of the Consultation-only stages just merged in —
  // those render the real Consultations board (same table, same popups) instead of the
  // Branch Leads table below.
  const isConsultationStage = !!stageFilter && !stages.some((s) => s.name === stageFilter);

  const filteredLeads = useMemo(() => {
    let list = boardData.leads;
    if (dateFilter) {
      const from = dateFilter.from?.getTime();
      const to = dateFilter.to?.getTime();
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
    return list;
  }, [boardData.leads, searchQuery, dateFilter]);

  // Summary card counts follow the Date Filter (and search) too, instead of always
  // reflecting the branch's all-time totals — so the cards actually describe what's in
  // the table below them right now.
  const salesCounts = useMemo(() => {
    const counts = {};
    stages.forEach((s) => { counts[s.name] = filteredLeads.filter((l) => l.branch_stage === s.name).length; });
    return counts;
  }, [filteredLeads, stages]);
  const consultationCounts = useMemo(() => {
    const counts = {};
    consultationStages.forEach((s) => { counts[s.name] = filteredLeads.filter((l) => l.consultation_stage === s.name).length; });
    return counts;
  }, [filteredLeads, consultationStages]);
  const combinedCounts = { ...consultationCounts, ...salesCounts };

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
    { key: "review", label: "Review", short: "Review", icon: ClipboardCheck },
    { key: "consultations", label: "MANAGEMENT", short: "Manage", icon: Stethoscope },
    { key: "patients", label: "Patients", short: "Patients", icon: User },
    { key: "accountant_mgmt", label: "Accountant Manage", short: "Accounts", icon: BadgeIndianRupee },
    { key: "store", label: "Fitsiomax Store", short: "Store", icon: ShoppingCart },
  ];

  // Everything under MANAGEMENT — Experts and Calendar used to be their own
  // top-level tabs, and Manager used to sit one level deeper inside Calendar;
  // all three now live here alongside the two calendars.
  const MANAGEMENT_SUB_TABS = [
    { key: "head_physio", label: "HEAD PHYSIO CALENDAR", icon: Calendar },
    { key: "physio", label: "PHYSIO CALENDAR", icon: Activity },
    { key: "manager", label: "MANAGER", icon: UserCog },
    { key: "calendar", label: "CALENDAR", icon: Calendar },
  ];

  return (
    // Bottom padding on a phone so the last row of a list clears the fixed nav below.
    <div className="space-y-4 pb-20 md:pb-0" data-testid="branch-admin-board-root">
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
      </div>

      {activeView === "consultations" ? (
        <div className="space-y-4" data-testid="branch-consultations-headphysio">
          <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="branch-consultations-subtabs">
            {MANAGEMENT_SUB_TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setConsultationsSubTab(t.key)}
                  className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${consultationsSubTab === t.key ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
                  data-testid={`branch-consultations-subtab-${t.key}`}
                >
                  <Icon className="h-4 w-4" />{t.label}
                </button>
              );
            })}
          </div>
          {consultationsSubTab === "physio" ? (
            <HeadPhysioCalendar branchId={branchId} profileType="physio" />
          ) : consultationsSubTab === "manager" ? (
            <BranchDetailPage branchId={branchId} readOnly />
          ) : consultationsSubTab === "calendar" ? (
            <BranchCalendarPanel branchId={branchId} />
          ) : (
            <HeadPhysioCalendar branchId={branchId} />
          )}
        </div>
      ) : activeView === "review" ? (
        <BranchReviewPanel branchId={branchId} />
      ) : activeView === "patients" ? (
        <PatientsPortalPanel branchId={branchId} />
      ) : activeView === "store" ? (
        <FitsiomaxStorePanel />
      ) : activeView === "accountant_mgmt" ? (
        <AccountantManageTab branchId={branchId} />
      ) : (
        <>
          {/* Stage Head Bar — Pre-Sales style sticky segmented tabs. Merges in the
              Consultation pipeline's stages too, so this one bar covers a patient's whole
              journey; selecting one of those switches the view below to the real
              Consultations board (see isConsultationStage). */}
          <StageTabBar
            stages={combinedStages}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            counts={combinedCounts}
            totalCount={totalLeads}
            testid="branch-metric"
          />

          {isConsultationStage ? (
            <ConsultationsBoard
              branchId={branchId}
              viewerRole="branch_admin"
              externalStageFilter={stageFilter}
              showOwnStageBar={false}
              autoOpenLeadId={autoOpenLeadId}
              onAutoOpened={() => setAutoOpenLeadId(null)}
            />
          ) : (
          <>
          {/* Toolbar — search takes the whole first row on a phone, the actions sit
              together underneath rather than all four squeezing onto one line. */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3" data-testid="branch-toolbar">
            <div className="relative w-full sm:flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search patients..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="branch-search" />
            </div>
            <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="branch-date-filter" />
            <Button onClick={() => setShowCreateLead(true)} className="flex-1 bg-sky-600 hover:bg-sky-700 sm:flex-none" data-testid="branch-create-lead-btn">
              <UserPlus className="h-4 w-4 mr-1.5" />Create Lead
            </Button>
            <PullFromSheetButton
              onPulled={loadBoard}
              notConnectedHint="Google Sheets isn't connected yet — ask your Super Admin to connect it."
              noSourcesHint="No Google Sheet is linked to this branch yet — ask your Super Admin to tag one to this branch in Marketing Board → Lead Sources."
              iconOnly
            />
          </div>

          {/* Phone list — six columns can't be read at 430px whichever way they're sized,
              so below md the same rows are stacked as cards instead of being pushed off
              the side of a horizontally-scrolling table. */}
          <div className="space-y-2 md:hidden" data-testid="branch-list-mobile">
            {(() => {
              const visible = (stageFilter ? filteredLeads.filter((l) => l.branch_stage === stageFilter) : filteredLeads);
              if (visible.length === 0) {
                return (
                  <p className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400" data-testid="branch-list-mobile-empty">
                    No patients {stageFilter ? `in stage "${stageDisplayLabel(stageFilter)}"` : "yet"}.
                  </p>
                );
              }
              return visible.map((lead) => {
                const hex = lead.branch_stage ? stageColor(lead.branch_stage) : null;
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
                          <span className="truncate font-semibold text-slate-800">{lead.name}</span>
                          <span
                            className="shrink-0 rounded-[5px] border px-2 py-0.5 text-[10px] font-medium"
                            style={hex ? { background: `${hex}14`, color: hex, border: `1px solid ${hex}33` } : { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                          >
                            {lead.branch_stage ? stageDisplayLabel(lead.branch_stage) : "—"}
                          </span>
                        </div>
                        {lead.patient_number && <p className="truncate font-mono text-[10px] text-slate-400">{lead.patient_number}</p>}
                        <p className="mt-1 truncate text-xs text-slate-600">{lead.phone || "—"}</p>
                        {lead.email && <p className="truncate text-xs text-slate-500">{lead.email}</p>}
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

          {/* List View (table) — its own scroll region so the sticky header can use top-0
              instead of guessing the page header's pixel height, which was colliding with
              the stat cards row as it scrolled past. */}
          <div className="hidden w-full max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-white md:block" data-testid="branch-list">
            <table className="w-full min-w-[640px] table-fixed divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {/* New Leads haven't had a physio assigned yet, so that column is dropped
                      only for this stage filter — every other view keeps it. */}
                  {stageFilter === firstStageName ? (
                    <>
                      <th className="w-[26%] px-4 py-3">Patient</th>
                      <th className="w-[16%] px-4 py-3">Phone</th>
                      <th className="w-[26%] px-4 py-3">Email</th>
                      <th className="w-[20%] px-4 py-3">Stage</th>
                      <th className="w-[12%] px-4 py-3 text-right">Updated</th>
                    </>
                  ) : (
                    <>
                      <th className="w-[22%] px-4 py-3">Patient</th>
                      <th className="w-[14%] px-4 py-3">Phone</th>
                      <th className="w-[22%] px-4 py-3">Email</th>
                      <th className="w-[16%] px-4 py-3">Stage</th>
                      <th className="w-[16%] px-4 py-3">Assigned Physio</th>
                      <th className="w-[10%] px-4 py-3 text-right">Updated</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  const visible = (stageFilter ? filteredLeads.filter((l) => l.branch_stage === stageFilter) : filteredLeads);
                  const showAssignedPhysio = stageFilter !== firstStageName;
                  if (visible.length === 0) {
                    return (
                      <tr>
                        <td colSpan={showAssignedPhysio ? 6 : 5} className="px-4 py-10 text-center text-sm text-slate-400" data-testid="branch-list-empty">
                          No patients {stageFilter ? `in stage "${stageDisplayLabel(stageFilter)}"` : "yet"}.
                        </td>
                      </tr>
                    );
                  }
                  return visible.map((lead) => {
                    const rowStageHex = lead.branch_stage ? stageColor(lead.branch_stage) : null;
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedLead(lead)}
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                        data-testid={`branch-row-${lead.id}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                              {lead.name?.charAt(0)?.toUpperCase() || "?"}
                            </div>
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-slate-800" title={lead.name}>{lead.name}</span>
                              {lead.patient_number && <span className="block truncate font-mono text-[10px] text-slate-400" title={lead.patient_number}>{lead.patient_number}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="truncate px-4 py-3 text-slate-600" title={lead.phone}>{lead.phone || "—"}</td>
                        <td className="truncate px-4 py-3 text-slate-600" title={lead.email}>{lead.email || "—"}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center rounded-[5px] border px-2.5 py-0.5 text-xs font-medium"
                            style={rowStageHex ? { background: `${rowStageHex}14`, color: rowStageHex, border: `1px solid ${rowStageHex}33` } : { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                          >
                            {lead.branch_stage ? stageDisplayLabel(lead.branch_stage) : "—"}
                          </span>
                        </td>
                        {showAssignedPhysio && (
                          <td className="truncate px-4 py-3 text-slate-600" title={lead.assigned_physio_name}>{lead.assigned_physio_name || <span className="text-slate-400">—</span>}</td>
                        )}
                        <td className="px-4 py-3 text-right text-xs text-slate-400">{(lead.updated_at || "").slice(0, 10)}</td>
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
          onClose={() => setSelectedLead(null)}
          onUpdate={handleStageUpdate}
          onOpenConsultationStage={(stage) => {
            // Hand off to the embedded Consultations board: close this modal, switch the
            // stage bar to the requested Consultation stage, and tell that board which
            // lead to auto-open — same lead, same rich stage-specific popups it already
            // has (Collect Payment, Physio Assign, etc.), instead of duplicating them here.
            setAutoOpenLeadId(selectedLead.id);
            setSelectedLead(null);
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
          onClose={() => setShowCreateLead(false)}
          onSaved={loadBoard}
        />
      )}
        </>
      )}

      {loading && (
        <div className="fixed bottom-20 right-4 rounded-md bg-slate-900 px-3 py-2 text-sm text-white md:bottom-4">Loading...</div>
      )}

      {/* Bottom nav — phones only. The top strip scrolls sideways, which left Accountant
          Manage and Store behind a swipe; down here all six are reachable by thumb.
          Columns are counted off VIEW_TABS rather than hardcoded, so adding or dropping
          a tab (as Rehab was) re-divides the bar instead of leaving a gap. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-white/85 md:hidden"
        data-testid="branch-bottom-nav"
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${VIEW_TABS.length}, minmax(0, 1fr))` }}>
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveView(tab.key)}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-2 transition-colors ${
                  active ? "text-sky-600" : "text-slate-400 active:text-slate-600"
                }`}
                data-testid={`branch-bottom-nav-${tab.key}`}
              >
                {/* The strip sits on the top edge, where the desk tabs carry their underline. */}
                {active && <span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-sky-500" />}
                <Icon className="h-[18px] w-[18px] flex-none" />
                <span className="w-full truncate text-center text-[9px] font-semibold leading-tight">{tab.short}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

/* ─── Branch Lead Detail Modal ─── */
function BranchLeadModal({ lead, branchId, stages, consultationStages, onClose, onUpdate, onMoved, onOpenConsultationStage }) {
  // Same merge as the main Branch Leads stage bar — one continuous pipeline covering both
  // branch_stage and consultation_stage, with shared names (e.g. "Follow Up") kept to a
  // single pill backed by the sales-side field.
  const pipelineStages = [...stages, ...consultationStages.filter((cs) => !stages.some((s) => s.name === cs.name))];
  const isConsultationOnlyStage = (name) => !stages.some((s) => s.name === name);
  const [activeTab, setActiveTab] = useState("overview");
  const [remarks, setRemarks] = useState([]);
  const [activityLog, setActivityLog] = useState([]);

  const [apptDraft, setApptDraft] = useState(null); // { appointment_date, appointment_time, physio_id, notes, final_stage, duration } | null
  const [apptExperts, setApptExperts] = useState({ experts: [], available_count: 0, busy_count: 0, loading: false });
  // Month shown by the popup's own calendar. Held apart from the picked date so paging
  // through months doesn't disturb the booking being built.
  const [apptMonth, setApptMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  // Shown once a booking is actually made. Kept outside the Appointment popup because
  // confirming closes that popup and the lead card with it.
  const [apptConfirm, setApptConfirm] = useState(null);
  // Whether the card is sitting on the clipboard waiting to be pasted. A toast can't
  // carry this — sending navigates to WhatsApp and takes the toast with it, and the
  // instruction is needed after that trip, not during it.
  const [cardCopied, setCardCopied] = useState(false);
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
  const apptSlotsForExpert = useMemo(() => {
    if (!apptDraft?.physio_id) return [];
    const doc = (apptExperts.experts || []).find((d) => d.id === apptDraft.physio_id);
    return doc?.free_slots || [];
  }, [apptExperts.experts, apptDraft?.physio_id]);

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

  useEffect(() => {
    if (activeTab === "timeline") { loadRemarks(); loadActivity(); }
  }, [activeTab, lead.id]);

  const loadRemarks = async () => {
    try { setRemarks(await getLeadRemarks(lead.id)); } catch { /* silent */ }
  };
  const loadActivity = async () => {
    try { setActivityLog(await getLeadActivity(lead.id)); } catch { /* silent */ }
  };

  const moveStage = async (stage) => {
    try {
      await moveBranchStage(lead.id, { branch_stage: stage });
      toast.success(`Moved to ${stage}`);
      onMoved && onMoved(stage); // closes immediately; parent refreshes the list itself
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
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
  ];

  const avatarFirstChar = (lead.name?.trim()?.charAt(0) || "?").toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="branch-lead-modal-overlay">
      {/* Full-bleed on a phone — a centred card with margins wastes the little width
          there is, and the stage stepper inside needs every pixel of it. */}
      <div className="flex h-full max-h-full w-full flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl" data-testid="branch-lead-modal">
        {/* Gradient header */}
        <div className="relative bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-base font-bold text-indigo-600 shadow-md">{avatarFirstChar}</span>
              <div>
                <p className="text-base font-semibold leading-tight" data-testid="branch-lead-name">{lead.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {lead.patient_number && (
                    <span className="rounded-[5px] bg-white/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-white" data-testid="branch-lead-patient-number">{lead.patient_number}</span>
                  )}
                  <span className="rounded-[5px] bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700" data-testid="branch-lead-stage">
                    {lead.branch_stage ? stageDisplayLabel(lead.branch_stage) : "No Stage"}
                  </span>
                  {lead.consultation_fee && <span className="rounded-full bg-teal-100/95 px-2 py-0.5 text-[10px] font-semibold text-teal-800">Fee Rs.{lead.consultation_fee}</span>}
                  {lead.package_amount && <span className="rounded-full bg-emerald-100/95 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Pkg Rs.{lead.package_amount}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="branch-lead-close">
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

              {(lead.appointment_department || lead.appointment_mode || lead.diagnosis) && (
                <div className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm" data-testid="branch-lead-appointment-details">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><ClipboardList className="h-4 w-4" /></span>
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Appointment Details</p>
                  </div>
                  <div className="space-y-2 px-4 py-3">
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
                  <p className="px-4 py-3 text-sm font-medium text-slate-800">{lead.assigned_physio_name}</p>
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
                    const isActive = lead.branch_stage === stage || lead.consultation_stage === stage;
                    const consultationOnly = isConsultationOnlyStage(stage);
                    // A Consultation-only stage isn't reachable until the lead has actually
                    // entered that pipeline (schedule-branch-appointment seeds
                    // consultation_stage the first time) — shown, but not yet clickable.
                    const notYetReached = consultationOnly && !lead.consultation_stage;
                    const tint = s.color || "#64748b";
                    const handleClick = () => {
                      if (stage === "Appointment Date & Time") {
                        setApptDraft({
                          appointment_date: lead.appointment_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
                          // Left blank on purpose — the time has to be picked from the
                          // expert's published slots, so pre-filling a guess like 10:00
                          // would show a time that may not actually be bookable.
                          appointment_time: lead.appointment_time || "",
                          physio_id: lead.assigned_physio_id || "",
                          notes: "",
                          duration: null,
                          final_stage: "Appointment Date & Time",
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
                      <button
                        key={s.id}
                        type="button"
                        disabled={isActive || notYetReached}
                        onClick={handleClick}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-90"
                        style={isActive ? { background: tint, color: "#ffffff" } : { background: `${tint}14`, color: tint, border: `1px solid ${tint}33` }}
                        data-testid={`branch-stage-btn-${stage}`}
                      >
                        {stageDisplayLabel(stage)}
                      </button>
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
                    <Input type="date" value={followUpForm.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUpForm({ ...followUpForm, date: e.target.value })} className="w-40" data-testid="branch-followup-date" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Time</label>
                    <Input type="time" value={followUpForm.time} onChange={(e) => setFollowUpForm({ ...followUpForm, time: e.target.value })} className="w-32" data-testid="branch-followup-time" />
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
                      <Input type="date" value={rescheduleDraft.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, date: e.target.value })} className="w-40" data-testid="branch-followup-reschedule-date" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">New Time</label>
                      <Input type="time" value={rescheduleDraft.time} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })} className="w-32" data-testid="branch-followup-reschedule-time" />
                    </div>
                    <Input value={rescheduleDraft.reason} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, reason: e.target.value })} placeholder="Reason (optional)" className="min-w-[10rem] flex-1" data-testid="branch-followup-reschedule-reason" />
                    <Button size="sm" variant="outline" onClick={() => setRescheduleDraft(null)} data-testid="branch-followup-reschedule-cancel">Cancel</Button>
                    <Button size="sm" onClick={submitReschedule} disabled={followUpBusy} className="bg-amber-600 text-white hover:bg-amber-700" data-testid="branch-followup-reschedule-save">Save</Button>
                  </div>
                </div>
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
      {apptDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-2 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setApptDraft(null); }} data-testid="branch-appt-modal">
          <div className="flex h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <Calendar className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="text-lg font-bold text-slate-800">Appointment</p>
                  <p className="text-xs text-slate-500">{lead.name} · pick a date, then the Head Physio, then their time</p>
                </div>
              </div>
              <button onClick={() => setApptDraft(null)} className="rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 transition hover:border-orange-300 hover:bg-orange-200 hover:text-orange-700" data-testid="branch-appt-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Three steps left to right: the date narrows who's available, the chosen
                Head Physio narrows which times exist. Each column only fills in once the
                one before it has an answer. */}
            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              {/* STEP 1 — Date */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-6 lg:w-[28rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-appt-date-panel">
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
                                  ? "bg-teal-600 text-white shadow-sm ring-2 ring-teal-200"
                                  : isPast
                                  ? "cursor-not-allowed text-slate-300"
                                  : hasSlots
                                  // Purple marks a day that actually has a slot free, so the
                                  // days worth clicking are visible without opening each one.
                                  ? "bg-violet-300 text-white shadow-sm hover:bg-violet-400"
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
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-violet-300" /> Slots open</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded bg-teal-600" /> Picked</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* STEP 2 — Head Physio */}
              <div className="w-full flex-shrink-0 border-b border-slate-200 p-5 lg:w-[22rem] lg:border-b-0 lg:border-r lg:overflow-y-auto" data-testid="branch-appt-expert-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">2 · Head Physio</p>
                <p className="mb-3 text-xs text-slate-400">Only those with availability on the picked date.</p>
                {!apptDraft.appointment_date ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Pick a date first.</p>
                ) : apptExperts.loading ? (
                  <p className="text-sm text-slate-400">Checking availability...</p>
                ) : apptExperts.experts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">No Head Physio is available on this date.</p>
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
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold ${active ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-700"}`}>
                            {doc.full_name?.charAt(0) || "E"}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-800">{doc.full_name}</p>
                            <p className={`truncate text-xs ${open > 0 ? "text-slate-400" : "text-amber-600"}`}>
                              {open > 0 ? `${open} slot${open === 1 ? "" : "s"} open` : "Nothing published"}
                            </p>
                          </div>
                          {active && <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-teal-600" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* STEP 3 — Time slot. Times come only from what the expert has actually
                  confirmed on HEAD PHYSIO CALENDAR — no free typing, so nothing gets booked
                  into a slot the Head Physio never agreed to. */}
              <div className="flex-1 overflow-y-auto p-5" data-testid="branch-appt-slot-panel">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">3 · Time Slot</p>
                <p className="mb-3 text-xs text-slate-400">Published availability only.</p>
                {!apptDraft.physio_id ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">Select a Head Physio to see their available times.</p>
                ) : apptSlotsForExpert.length === 0 ? (
                  <div className="rounded-lg border-2 border-amber-200 bg-amber-50 px-4 py-3" data-testid="branch-appt-no-slots">
                    <p className="text-sm font-semibold text-amber-800">No availability published for this date.</p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Confirm with the expert, then open MANAGEMENT → HEAD PHYSIO CALENDAR and mark them available.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="branch-appt-slots">
                    {apptSlotsForExpert.map((s) => {
                      const active = apptDraft.appointment_time === s.time;
                      return (
                        <button
                          key={s.slot_time}
                          type="button"
                          onClick={() => setApptDraft({ ...apptDraft, appointment_time: s.time, duration: s.duration })}
                          className={`rounded-lg border-2 px-2 py-2.5 text-center transition ${active ? "border-teal-500 bg-teal-50 text-teal-700 shadow-sm ring-2 ring-teal-100" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-slate-50"}`}
                          data-testid={`branch-appt-slot-${s.time}`}
                        >
                          <span className="block text-base font-bold">{to12h(s.time)}</span>
                          <span className="block text-[11px] text-slate-400">{s.duration} min</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {apptDraft.appointment_time && apptDraft.duration && (
                  <p className="mt-4 rounded-lg border-2 border-teal-300 bg-teal-50 px-4 py-2.5 text-sm font-bold text-teal-700" data-testid="branch-appt-slot-summary">
                    {to12h(apptDraft.appointment_time)} – {endTime12h(apptDraft.appointment_time, apptDraft.duration)} · {apptDraft.duration} minute consultation
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

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-6 py-3.5">
              {/* Marking the lead Cancelled is a destructive move — it frees the slot and
                  drops the lead out of the consultation pipeline — so it reads red the
                  moment it's ticked, and carries the primary button's colour with it. */}
              {(() => {
                const cancelled = apptDraft.final_stage === "Cancelled";
                return (
                  <button
                    type="button"
                    onClick={() => setApptDraft({ ...apptDraft, final_stage: cancelled ? "Appointment Date & Time" : "Cancelled" })}
                    className={`rounded-lg border-2 px-6 py-2.5 text-sm font-bold uppercase tracking-wide transition ${
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
              <div className="flex items-center gap-2">
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
                      notes: (apptDraft.notes || "").trim(),
                      bookedBy: "Branch Admin",
                    });
                    // A fresh booking hasn't been copied yet — the previous one's card
                    // is on the clipboard, and saying otherwise would send the wrong image.
                    setCardCopied(false);
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
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


      {/* Appointment confirmation — the sheet the client is given. Opening it as a PDF,
          sharing it or saving it all render the exact same document. */}
      {apptConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid="branch-appt-confirm-modal">
          <div className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 bg-teal-600 px-6 py-4 text-white">
              <div className="flex min-w-0 items-center gap-3">
                <img src={LOGO_URL} alt="FITSIOMAX" className="h-11 w-11 shrink-0 rounded-lg bg-white/90 object-contain p-1" />
                <div className="min-w-0">
                  <p className="text-lg font-bold">Appointment Confirmed</p>
                  <p className="truncate text-xs text-white/80">Ref {apptConfirm.refNo}</p>
                </div>
              </div>
              <button
                onClick={() => { const s = apptConfirm.finalStage; setApptConfirm(null); onMoved && onMoved(s); }}
                className="shrink-0 rounded-lg border-2 border-orange-200 bg-orange-100 p-2 text-orange-600 hover:bg-orange-200"
                data-testid="branch-appt-confirm-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="rounded-xl border-2 border-teal-200 bg-teal-50 px-4 py-5 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-teal-600">Your Appointment</p>
                <p className="mt-1 text-2xl font-extrabold text-teal-700">{weekdayLabel(apptConfirm.date)}</p>
                <p className="text-lg font-bold text-teal-700">
                  {to12h(apptConfirm.time)} – {endTime12h(apptConfirm.time, apptConfirm.duration)}
                </p>
                <p className="mt-1 text-sm font-semibold text-teal-600">with {apptConfirm.headPhysio}</p>
              </div>

              <dl className="mt-5 space-y-2 text-sm">
                {apptRows(apptConfirm, { compact: true }).filter(Boolean).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-right font-semibold text-slate-700">{v}</dd>
                  </div>
                ))}
              </dl>

              {/* The two standing instructions, same wording the printed sheet carries. */}
              <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-xs leading-relaxed text-teal-800" data-testid="branch-appt-confirm-note">
                <p>Please arrive 10 minutes early.</p>
                <p>To reschedule or cancel, contact the branch quoting reference {apptConfirm.refNo}.</p>
              </div>

              {apptConfirm.notes && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{apptConfirm.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              {/* Open leads: the client wants to see the sheet before it's sent anywhere,
                  and the browser's own Save-as-PDF lives behind that window's print. */}
              <Button className="w-full bg-teal-600 text-white hover:bg-teal-700" onClick={() => openPrintable(apptHtml(apptConfirm), { print: true })} data-testid="branch-appt-confirm-pdf">
                <FileText className="mr-1.5 h-4 w-4" /> Open PDF
              </Button>
              {/* The one the branch actually reaches for: straight to the patient's own
                  number with the confirmation typed, card image waiting on the clipboard. */}
              <Button
                className="w-full bg-[#25D366] text-white hover:bg-[#1da851]"
                onClick={async () => setCardCopied(await sendApptOnWhatsApp(apptConfirm))}
                data-testid="branch-appt-confirm-whatsapp"
              >
                <WhatsAppIcon className="mr-1.5 h-4 w-4" /> Send on WhatsApp
              </Button>
              {/* The paste is the only manual step in the flow and nothing on screen would
                  otherwise suggest it, so it is spelled out beforehand and then left up
                  afterwards — the trip to WhatsApp is exactly when it's needed, and a
                  toast would already be gone by then. */}
              {cardCopied ? (
                <p className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-center text-[11px] font-semibold leading-snug text-emerald-800" data-testid="branch-appt-confirm-hint">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-none" />
                  Card copied — paste it into {apptConfirm.patient}'s chat to attach it
                </p>
              ) : (
                <p className="px-1 text-center text-[11px] leading-snug text-slate-500" data-testid="branch-appt-confirm-hint">
                  Opens {apptConfirm.patient}'s chat with the message ready. The card image is
                  copied too — paste it in to send the picture with it.
                </p>
              )}
              {/* The attachment route proper: the share sheet is the only thing that can
                  carry a file, at the cost of asking who it is going to. */}
              <Button variant="outline" className="w-full" onClick={() => shareApptCard(apptConfirm)} data-testid="branch-appt-confirm-share-card">
                <Share2 className="mr-1.5 h-4 w-4" /> Send Card + Message
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => copyApptMessage(apptConfirm)} data-testid="branch-appt-confirm-copy">
                  <Copy className="mr-1.5 h-4 w-4" /> Copy
                </Button>
                <Button variant="outline" onClick={() => downloadApptCard(apptConfirm)} data-testid="branch-appt-confirm-download">
                  <Download className="mr-1.5 h-4 w-4" /> Card
                </Button>
              </div>
              {apptLink(apptConfirm) && (
                <Button variant="outline" className="w-full" onClick={() => copyApptText(apptLink(apptConfirm), "Link copied")} data-testid="branch-appt-confirm-copy-link">
                  <LinkIcon className="mr-1.5 h-4 w-4" /> Copy Link
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full text-slate-500"
                onClick={() => { const s = apptConfirm.finalStage; setApptConfirm(null); onMoved && onMoved(s); }}
                data-testid="branch-appt-confirm-done"
              >
                Done
              </Button>
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
                <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
                <Input type="date" value={followUpMoveDraft.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUpMoveDraft({ ...followUpMoveDraft, date: e.target.value })} data-testid="branch-followup-move-date" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                <Input type="time" value={followUpMoveDraft.time} onChange={(e) => setFollowUpMoveDraft({ ...followUpMoveDraft, time: e.target.value })} data-testid="branch-followup-move-time" />
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
