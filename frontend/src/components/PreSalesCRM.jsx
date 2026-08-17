import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Plus, Search, Settings as Cog, Calendar as CalendarIcon, Phone, FileText, StickyNote, ArrowRight, CheckCircle2, X, Pencil, PhoneOff, Clock, Bell, Building2, Trash2, Lock, Users, CalendarCheck, UserRound, LogOut, Mail, Youtube, ChevronDown, ChevronUp, RefreshCw, BarChart3, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getLeads, createManualLead, stagesList, updateLead, rnrAttempt, scheduleFollowUp, rescheduleFollowUp, scheduleAppointment, getBranches, leadActivity, deleteLead,
  listTestimonials, addTestimonial, deleteTestimonial, getDashboardOverview,
} from "@/lib/api";
import { LeadEditModal } from "@/components/LeadEditModal";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { SourcePill } from "@/components/marketing/SourcePill";
import { PullFromSheetButton } from "@/components/PullFromSheetButton";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { StageTabBar } from "@/components/ui/stage-tab";
import { MilkDateInput, MilkTimeInput } from "@/components/ui/milk-calendar";
import { callTimeStamp, callDateStamp } from "@/lib/time";

const initials = (name) => (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// Deterministic avatar color per first letter so A→one hue, B→another, etc.
// Tailwind 26-letter palette (bg + text pair) chosen for legibility on white rows.
const AVATAR_PALETTE = [
  { bg: "bg-red-100",     fg: "text-red-700" },     // A
  { bg: "bg-orange-100",  fg: "text-orange-700" },  // B
  { bg: "bg-amber-100",   fg: "text-amber-700" },   // C
  { bg: "bg-yellow-100",  fg: "text-yellow-800" },  // D
  { bg: "bg-lime-100",    fg: "text-lime-700" },    // E
  { bg: "bg-green-100",   fg: "text-green-700" },   // F
  { bg: "bg-emerald-100", fg: "text-emerald-700" }, // G
  { bg: "bg-teal-100",    fg: "text-teal-700" },    // H
  { bg: "bg-cyan-100",    fg: "text-cyan-700" },    // I
  { bg: "bg-sky-100",     fg: "text-sky-700" },     // J
  { bg: "bg-blue-100",    fg: "text-blue-700" },    // K
  { bg: "bg-indigo-100",  fg: "text-indigo-700" },  // L
  { bg: "bg-violet-100",  fg: "text-violet-700" },  // M
  { bg: "bg-purple-100",  fg: "text-purple-700" },  // N
  { bg: "bg-fuchsia-100", fg: "text-fuchsia-700" }, // O
  { bg: "bg-pink-100",    fg: "text-pink-700" },    // P
  { bg: "bg-rose-100",    fg: "text-rose-700" },    // Q
  { bg: "bg-red-200",     fg: "text-red-800" },     // R
  { bg: "bg-orange-200",  fg: "text-orange-800" },  // S
  { bg: "bg-amber-200",   fg: "text-amber-800" },   // T
  { bg: "bg-lime-200",    fg: "text-lime-800" },    // U
  { bg: "bg-emerald-200", fg: "text-emerald-800" }, // V
  { bg: "bg-cyan-200",    fg: "text-cyan-800" },    // W
  { bg: "bg-blue-200",    fg: "text-blue-800" },    // X
  { bg: "bg-violet-200",  fg: "text-violet-800" },  // Y
  { bg: "bg-pink-200",    fg: "text-pink-800" },    // Z
];

const avatarColor = (name) => {
  const c = (name || "?").trim().charAt(0).toUpperCase();
  const idx = c.charCodeAt(0) - 65;
  if (idx < 0 || idx > 25) return { bg: "bg-slate-100", fg: "text-slate-700" };
  return AVATAR_PALETTE[idx];
};

// 10-digit → prepend 91; 11-digit leading 0 → drop the 0 and prepend 91 — same
// sanitizer used for WhatsApp links elsewhere in this app (PhysioBoard, Client Portal).
const waNumber = (raw) => {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};

// lucide-react has no WhatsApp glyph, so this is hand-drawn (duplicated per-file,
// matching the convention already used in PhysioBoard.jsx / PatientsPortalPanel.jsx).
const WhatsAppIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2m0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.14.82.84-3.06-.2-.31a8.22 8.22 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.55-3.7 8.24-8.24 8.24m4.52-6.17c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.81-.78.97-.15.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.24-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.12-.56-1.36-.77-1.86-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31s-.87.85-.87 2.08.89 2.41 1.02 2.58c.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.16-.48-.28"/>
  </svg>
);

// Each branch or source keeps one colour wherever it appears, picked from its name
// rather than its position in the list — so one added or reordered later doesn't
// recolour every row that already reads as "the green branch".
const BRANCH_TONES = [
  { chip: "border-emerald-300 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", hover: "hover:bg-emerald-100" },
  { chip: "border-sky-300 bg-sky-50 text-sky-700", dot: "bg-sky-500", hover: "hover:bg-sky-100" },
  { chip: "border-violet-300 bg-violet-50 text-violet-700", dot: "bg-violet-500", hover: "hover:bg-violet-100" },
  { chip: "border-amber-300 bg-amber-50 text-amber-700", dot: "bg-amber-500", hover: "hover:bg-amber-100" },
  { chip: "border-rose-300 bg-rose-50 text-rose-700", dot: "bg-rose-500", hover: "hover:bg-rose-100" },
  { chip: "border-teal-300 bg-teal-50 text-teal-700", dot: "bg-teal-500", hover: "hover:bg-teal-100" },
  { chip: "border-indigo-300 bg-indigo-50 text-indigo-700", dot: "bg-indigo-500", hover: "hover:bg-indigo-100" },
  { chip: "border-orange-300 bg-orange-50 text-orange-700", dot: "bg-orange-500", hover: "hover:bg-orange-100" },
];

const branchTone = (name) => {
  const s = (name || "").trim().toUpperCase();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 1000003;
  return BRANCH_TONES[h % BRANCH_TONES.length];
};

const branchLabel = (b) => b?.branch_name || b?.name || "";

/**
 * The board's coloured dropdown, shared by the Assigned To column and the Sources
 * filter.
 *
 * A native <select> can only be coloured on its closed box — the option list is drawn
 * by the OS and ignores CSS, which is why both of these looked like plain system
 * dropdowns next to the rest of the board. This draws its own list instead, giving
 * every entry its own colour in the trigger and the list alike.
 *
 * The panel is position:fixed and measured off the trigger, because the leads table
 * sits in an overflow-auto wrapper that would otherwise clip an absolutely-positioned
 * one. A fixed panel can't follow what it is anchored to, so any scroll or resize
 * closes it rather than leaving it stranded beside a different row.
 *
 * `options` is [{ value, label }]. `resetLabel`, when given, adds a neutral first row
 * that clears the selection — that's the filter's "All Sources"; the assign column has
 * no such row because unassigning a lead isn't a thing you can do here.
 */
const ColorSelect = ({
  value, options, onChange, placeholder, resetLabel, testid,
  triggerClass = "h-8 min-w-[7.5rem] text-xs", emptyText = "Nothing to choose from.",
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const tone = current ? branchTone(current.label) : null;

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = wrapRef.current.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    const height = Math.min(48 + options.length * 34, 288);
    // Wide enough to read a long source name, but never wider than the window on a
    // phone. Then pinned inside the viewport: a control sitting near the right edge
    // would otherwise open a panel that runs straight off the screen, which is what
    // made this one unreadable and half of it unclickable.
    const width = Math.min(Math.max(r.width, 232), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({
      left,
      width,
      ...(room > height ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    });
    setOpen(true);
  };

  const pick = (v) => { setOpen(false); if (v !== value) onChange(v); };

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={toggle}
        className={`flex w-full items-center justify-between gap-1.5 rounded-md border px-2 font-semibold transition ${triggerClass} ${tone ? tone.chip : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
        data-testid={testid}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {tone && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />}
          <span className="truncate">{current ? current.label : placeholder}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>

      {open && pos && (
        <div
          className="fixed z-50 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
          style={pos}
          data-testid={`${testid}-list`}
        >
          {resetLabel && (
            <button
              type="button"
              onClick={() => pick("")}
              className={`flex w-full items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1.5 text-left text-xs font-semibold transition hover:bg-slate-100 ${!value ? "border-slate-400 bg-slate-100 text-slate-700" : "border-slate-200 bg-white text-slate-600"}`}
            >
              <span className="truncate">{resetLabel}</span>
              {!value && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />}
            </button>
          )}
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-slate-400">{emptyText}</p>
          ) : options.map((o) => {
            const t = branchTone(o.label);
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                title={o.label}
                className={`flex w-full items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1.5 text-left text-xs font-semibold transition ${t.chip} ${t.hover} ${active ? "ring-1 ring-slate-400" : ""}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
                <span className="truncate">{o.label}</span>
                {active && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const testimonialsUrl = () => `${window.location.origin}/testimonials`;

// Call → native dialer (tel:); WhatsApp → a template message pointing the lead at the
// patient testimonial videos before the rep even gets them on the phone. Same-tab
// navigation (window.location.href, not window.open), matching the fix applied
// elsewhere for the mobile "blank screen on return from WhatsApp" bug.
const LeadContactIcons = ({ lead }) => {
  if (!lead.phone) return null;
  const num = waNumber(lead.phone);
  const handleCall = (e) => { e.stopPropagation(); window.location.href = `tel:${lead.phone}`; };
  const handleWhatsApp = (e) => {
    e.stopPropagation();
    const text = [
      `Hi ${lead.name || "there"}, this is Fitsiomax!`,
      "",
      "Take a look at real patient success stories before we connect:",
      testimonialsUrl(),
    ].join("\n");
    window.location.href = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  };
  // 40px targets with a tinted disc behind each. These now render only on the phone
  // cards, and at 3.5 icons inside 1.5 padding they were 26px of tappable area with
  // nothing marking them as buttons — under the 44px a thumb is generally reckoned to
  // need, and sitting next to a card that opens the lead on tap, so a near miss opened
  // the wrong thing entirely.
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={handleCall}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 transition active:bg-sky-100"
        title="Call"
        aria-label={`Call ${lead.name || "lead"}`}
        data-testid={`presales-call-${lead.id}`}
      >
        <Phone className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={handleWhatsApp}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition active:bg-emerald-100"
        title="WhatsApp"
        aria-label={`WhatsApp ${lead.name || "lead"}`}
        data-testid={`presales-whatsapp-${lead.id}`}
      >
        <WhatsAppIcon className="h-5 w-5" />
      </button>
    </div>
  );
};

// Shared between the desktop Appointment column and the mobile Consultations tab —
// same branch_stage vocabulary the Branch Admin's own pipeline already uses.
const branchStatusInfo = (lead, branches) => {
  const branchName = lead.branch_id
    ? (branches.find((b) => b.id === lead.branch_id)?.branch_name || branches.find((b) => b.id === lead.branch_id)?.name)
    : (lead.appointment_mode === "online" ? "Online Consultation" : "Unassigned");
  const status = lead.branch_stage || "Pending";
  const statusColor = {
    "New Appointment": "bg-blue-50 text-blue-700 border-blue-200",
    "Portfolio": "bg-violet-50 text-violet-700 border-violet-200",
    "Follow Up": "bg-orange-50 text-orange-700 border-orange-200",
    "Appointment Date & Time": "bg-teal-50 text-teal-700 border-teal-200",
    "Cancelled": "bg-rose-50 text-rose-700 border-rose-200",
  }[status] || "bg-slate-50 text-slate-600 border-slate-200";
  return { branchName, status, statusColor };
};

// Same helper BranchManagementBoard.jsx and BranchFormDialogV2.jsx already carry —
// every default vertical is named "online_.../offline_...", so reading the prefix off
// the branch record itself can never disagree with how those two screens group branches.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

// Marketing Head's KPI row — a fixed funnel rather than the live Pre-Sales stage list,
// since two of these span more than one field. "Appointment Booked by Branch Admin" counts
// a branch board's own appointment stage regardless of how the lead got there: "New
// Appointment" is where a Pre-Sales-controlled branch's board opens (the lead arrives
// already booked), "Appointment Date & Time" is the stage a Branch-Admin-controlled
// branch's own leads reach once *it* books one directly — both mean "there's a booked
// appointment sitting on a branch's board" (see backend/stage_utils.py). "Lost" folds in
// each sub-pipeline's own didn't-convert stage, since a lead can end up not converting from
// any of the three.
const MARKETING_HEAD_FUNNEL = [
  { key: "new_leads", label: "New Leads", color: "#3b82f6", match: (l) => l.stage === "New Leads" },
  { key: "rnr", label: "RNR", color: "#f59e0b", match: (l) => l.stage === "RNR" },
  { key: "follow_up", label: "Follow Up", color: "#8b5cf6", match: (l) => l.stage === "Follow Up" },
  { key: "appointment_pre_sales", label: "Appointment Booked by Pre-Sales", color: "#6366f1", match: (l) => l.stage === "Appointment" },
  {
    key: "appointment_branch_admin",
    label: "Appointment Booked by Branch Admin",
    color: "#14b8a6",
    match: (l) => l.branch_stage === "New Appointment" || l.branch_stage === "Appointment Date & Time",
  },
  { key: "consultation_done", label: "Consultation Done", color: "#10b981", match: (l) => l.consultation_stage === "Consultation Completed" },
  {
    key: "lost",
    label: "Lost",
    color: "#ef4444",
    match: (l) => l.stage === "Lost" || l.branch_stage === "Cancelled" || l.consultation_stage === "Cancel",
  },
];

// Super Admin only: All | Offline | Online, then one pill per branch in that group —
// the same split Branches & Verticals uses, so a branch's grouping reads the same way
// everywhere. Picking a pill sets sourceFilter, the board's existing branch scope.
const PreSalesGroupPill = ({ active, onClick, children, testid }) => (
  <button
    type="button"
    onClick={onClick}
    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
      active ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
    }`}
    data-testid={testid}
  >
    {children}
  </button>
);

const PreSalesBranchPill = ({ active, onClick, children, testid }) => (
  <button
    type="button"
    onClick={onClick}
    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
      active ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-sky-300 hover:text-sky-600"
    }`}
    data-testid={testid}
  >
    {children}
  </button>
);

// Which desk is holding a lead right now — the one fact the merged Super Admin view adds
// that neither of the two split boards needed, since each of them only ever shows one.
const HandledByBadge = ({ lead }) => {
  const isBranchAdmin = lead.lead_control === "branch_admin";
  return (
    <span
      className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
        isBranchAdmin ? "border-violet-200 bg-violet-50 text-violet-700" : "border-sky-200 bg-sky-50 text-sky-700"
      }`}
    >
      {isBranchAdmin ? "Branch Admin" : "Pre-Sales"}
    </span>
  );
};

const PRESALES_ANALYTICS_DATE_PRESETS = [
  // First, because it is the widest: every other option here narrows it.
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "custom", label: "Custom" },
];

// The funnel this board feeds, off one /dashboard/overview call: leads and appointments
// through to what a branch makes of them — consultations, sessions, and the treatment
// packages patients end up buying.
//
// The last two are a pair, both counted off the Treatment Fee: how many patients bought a
// package, and what those came to. "Treatment Purchase Revenue" is the figure that used to
// be labelled "Session Amount Collected" — the same money, named for the thing being sold
// rather than for the visits it pays for, so it reads with the count beside it.
//
// Pending Session Amount is gone from here. It is an outstanding balance rather than
// anything this board's date range describes — every other card counts what happened in
// the window, that one reported what was owed right now regardless of it.
const PRESALES_ANALYTICS_METRICS = [
  { key: "leads", label: "All Leads" },
  { key: "appointments", label: "Appointment Booked" },
  { key: "consultations", label: "Consultations" },
  { key: "consultation_revenue", label: "Consultations Revenue", currency: true },
  { key: "sessions_booked", label: "Sessions Total Booked" },
  { key: "treatment_purchases", label: "Treatment Purchase Number" },
  { key: "session_revenue", label: "Treatment Purchase Revenue", currency: true },
];

const presalesStartOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const presalesStartOfWeek = (d) => { const x = presalesStartOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const presalesStartOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const presalesToIso = (d) => d.toISOString().slice(0, 10);

/** A specific branch wins outright; otherwise the group's own branches summed (Offline/
 *  Online), or the bucket's grand total for All. Same shape as Overview's own helper. */
const presalesAnalyticsValueFor = (bucket, branchId, group) => {
  if (!bucket) return 0;
  const branches = bucket.branches || [];
  if (branchId) {
    const hit = branches.find((b) => b.branch_id === branchId);
    return hit ? hit.value : 0;
  }
  if (!group || group === "all") return bucket.total;
  return branches.filter((b) => isOnlineVertical(b.vertical) === (group === "online")).reduce((s, b) => s + b.value, 0);
};

/**
 * Pre-Sales' own analytics board — same data, same math as Branches & Verticals >
 * Overview, just reached from inside the Sales Master View instead. A second call to
 * the same endpoint rather than lifted state: the two boards' date/branch filters are
 * independent, and sharing one would mean picking a date range on one silently changed
 * what the other was showing.
 */
const PreSalesAnalyticsPanel = ({ branches, branchGroup, sourceFilter }) => {
  // Opens on everything rather than the current month. The month is a narrowing to reach
  // for, not the question the board is first asked — and a card that silently showed one
  // month's worth read as the total until you noticed the range control above it.
  const [preset, setPreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Held apart from `data` so a failed load can say so. Swallowing the error left every
  // card reading 0, which is indistinguishable from a branch that genuinely has none —
  // and that is exactly how a 403 on this endpoint passed for real figures.
  const [failed, setFailed] = useState(false);

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    // "All" carries no dates at all — see load(), which then asks for no window rather
    // than for a very wide one, and lets the endpoint answer over everything it holds.
    if (preset === "all") return { startDate: "", endDate: "" };
    if (preset === "today") return { startDate: presalesToIso(today), endDate: presalesToIso(today) };
    if (preset === "this_week") return { startDate: presalesToIso(presalesStartOfWeek(today)), endDate: presalesToIso(today) };
    if (preset === "this_month") return { startDate: presalesToIso(presalesStartOfMonth(today)), endDate: presalesToIso(today) };
    return { startDate: customFrom, endDate: customTo };
  }, [preset, customFrom, customTo]);

  const load = useCallback(() => {
    if (preset === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);
    const params = preset === "all" ? {} : { start_date: startDate, end_date: endDate };
    getDashboardOverview(params)
      .then((rows) => { setData(rows); setFailed(false); })
      .catch(() => { setData(null); setFailed(true); })
      .finally(() => setLoading(false));
  }, [startDate, endDate, preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

  return (
    <div className="space-y-4" data-testid="presales-analytics-panel">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="presales-analytics-date-filter">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {PRESALES_ANALYTICS_DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${preset === p.key ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
              data-testid={`presales-analytics-preset-${p.key}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" />
            <MilkDateInput value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs" data-testid="presales-analytics-custom-from" />
            <span>to</span>
            <MilkDateInput value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs" data-testid="presales-analytics-custom-to" />
          </div>
        )}
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
      ) : failed ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800" data-testid="presales-analytics-failed">
          These figures could not be loaded. Refresh to try again — if it keeps happening, this account may not have access to the org-wide numbers.
        </p>
      ) : (
        // All seven across one row on a wide screen — they are one funnel read
        // left to right, and wrapping the last three onto a second line broke that
        // into two groups it does not actually have. Narrower widths still wrap:
        // seven cards on a laptop would leave no room for the figures themselves.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7" data-testid="presales-analytics-metrics">
          {PRESALES_ANALYTICS_METRICS.map((m) => {
            const value = presalesAnalyticsValueFor(data?.[m.key], sourceFilter, branchGroup);
            return (
              <div key={m.key} className="rounded-xl border-2 border-slate-200 bg-white px-4 py-3.5" data-testid={`presales-analytics-metric-${m.key}`}>
                {/* Wraps rather than truncating. Seven-up leaves a card too narrow for
                    the longer names, and "TREATMENT PURCHASE …" on two of them gave no
                    way to tell the count from the revenue. The two-line floor keeps the
                    figures on one baseline across the row whether a label takes one line
                    or two. */}
                <span className="block min-h-[2.5em] text-[11px] font-bold uppercase leading-tight tracking-wider text-slate-500">{m.label}</span>
                {/* Steps down at the width the row goes seven-up: a card is ~170px
                    there, and "₹5,54,752" at the larger size runs straight out of it. */}
                <span className="mt-1 block truncate text-3xl font-extrabold text-slate-800 xl:text-2xl">{m.currency ? fmt(value) : value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const PRESALES_TABS = [
  { key: "leads", label: "Leads", icon: Users },
  { key: "consultations", label: "Consultations", icon: CalendarCheck },
  { key: "profile", label: "Profile", icon: UserRound },
];

const PRESALES_CRM_LOCKED = false;

/**
 * The Pre-Sales pipeline.
 *
 * Mounted in three places: the Pre Sales role's own view, Super Admin > PRE SALES, and —
 * when a branch runs on Branch Admin Lead Control — as the first tab of that branch's
 * Branch Admin Master View. The third is why `branchControlled` exists: the same board,
 * pointed at the other half of the leads.
 *
 * @param branchControlled  false shows leads whose branch leaves them to Pre-Sales (the
 *                          Pre-Sales desk's own book). true shows the leads a branch has
 *                          taken over, which is exactly what its Branch Admin works.
 *                          The two are complements, so no lead is on both boards and
 *                          none is on neither.
 * @param branchId          the branch this board is pinned to, when it is pinned to one.
 *                          Stands in for currentUser.branch_id so a Super Admin drilled
 *                          into a branch schedules against that branch, not none.
 * @param embedded          drop the phone bottom-padding; the host board already pads for
 *                          its own fixed nav and two lots of it leave a dead band.
 */
export const PreSalesCRM = ({
  onManageStages,
  role,
  currentUser,
  onLogout,
  branchControlled = false,
  branchId = null,
  embedded = false,
}) => {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState("");
  // Opens on New Leads, not All — that's the stage that needs action; a rep shouldn't
  // have to dig through everything already worked on just to see what's new. Marketing
  // Head has no leads to action, so its funnel opens on the whole picture instead.
  const [stageFilter, setStageFilter] = useState(role === "marketing_head" ? "all" : "New Leads");
  const [sourceFilter, setSourceFilter] = useState("");
  const [dateFilter, setDateFilter] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [activeTab, setActiveTab] = useState("leads"); // mobile bottom-nav only; desktop always shows Leads
  // Super Admin, Sales Head and Marketing Head only, from here down: which branches count
  // as one group (All/Offline/Online, same split Branches & Verticals uses), and which
  // top-level pane is showing. Sales Head is Pre-Sales' own manager, and Marketing Head
  // reads the same funnel from the marketing side — both get the same org-wide picture
  // Super Admin's Pre Sales tab has, rather than one rep's own filtered book.
  const [branchGroup, setBranchGroup] = useState("all");
  const [masterView, setMasterView] = useState("leads"); // "leads" | "analytics"
  const isSuperAdminMasterView = role === "super_admin" || role === "sales_head" || role === "marketing_head";
  // Marketing Head's KPI row is a fixed funnel rather than the live, admin-configurable
  // Pre-Sales stage list everyone else's cards come from (see MARKETING_HEAD_FUNNEL) —
  // two of its buckets aren't a single stage-field equality.
  const isMarketingHeadFunnel = role === "marketing_head";

  const selectBranchGroup = (g) => { setBranchGroup(g); setSourceFilter(""); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Scoped to the branch when this board is pinned to one. The API already scopes a
      // Branch Admin to their own branch, but a Super Admin drilled into a branch is not
      // scoped by anything — without this they would see every branch's taken-over leads
      // on one branch's tab.
      const [stgs, ldList] = await Promise.all([
        stagesList("pre_sales"),
        getLeads(branchId ? { branch_id: branchId } : {}),
      ]);
      setStages(stgs);
      // Lead Control splits the leads between two copies of this board: the Pre-Sales
      // desk's own, and the one a branch gets when it takes its leads over. Filtered here
      // at the source rather than in each memo below — the KPI cards, the stage tabs, the
      // table and the pipeline view all read from this one list, and a lead hidden from
      // three of the four would be worse than showing it everywhere. The backend resolves
      // the flag from each lead's branch on every fetch, so flipping the switch moves
      // leads between the two boards on the next refresh.
      //
      // Super Admin's Master View is the one exception: it is meant to be the whole
      // picture across every branch, so it shows both halves at once (each row tagged
      // Branch Admin or Pre-Sales) instead of picking one side the way the Pre-Sales
      // role's own board and a branch's embedded board still do.
      setLeads(isSuperAdminMasterView ? ldList : ldList.filter((l) => (l.lead_control === "branch_admin") === branchControlled));
      // If a lead is currently open in the detail dialog, refresh its reference
      // so saved edits show up immediately.
      setEditing((prev) => prev ? (ldList.find((l) => l.id === prev.id) || prev) : prev);
    } catch (e) { toast.error("Failed to load"); }
    setLoading(false);
  }, [branchControlled, branchId, isSuperAdminMasterView]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  // Leads narrowed by Date Filter + Branch filter only — feeds both the KPI
  // summary cards and the table, so the cards stay dynamic with those two filters
  // without also collapsing to whatever single stage tab is currently selected.
  const dateSourceFiltered = useMemo(() => {
    let rows = leads;
    // Empty is every branch, which is why the control opens on "All Branches" and its
    // reset returns here. Leads with no branch yet are the unassigned ones and belong in
    // the all-branches view, so they only drop out once a specific branch is picked.
    if (sourceFilter) {
      rows = rows.filter((l) => (l.branch_id || "") === sourceFilter);
    } else if (isSuperAdminMasterView && branchGroup !== "all") {
      // No specific branch picked, but a group is — every branch in that group summed,
      // same as leaving Offline/Online selected with no branch pill drilled into does on
      // Overview.
      const groupBranchIds = new Set(
        branches.filter((b) => isOnlineVertical(b.vertical) === (branchGroup === "online")).map((b) => b.id)
      );
      rows = rows.filter((l) => groupBranchIds.has(l.branch_id || ""));
    }
    if (dateFilter) {
      const from = dateFilter.from?.getTime();
      const to = dateFilter.to?.getTime();
      rows = rows.filter((l) => {
        const ts = new Date(l.created_at || 0).getTime();
        if (!ts) return false;
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      });
    }
    return rows;
  }, [leads, sourceFilter, dateFilter, isSuperAdminMasterView, branchGroup, branches]);

  const stageCounts = useMemo(() => {
    const map = { All: dateSourceFiltered.length };
    stages.forEach((s) => { map[s.name] = 0; });
    dateSourceFiltered.forEach((l) => { if (map[l.stage] != null) map[l.stage] += 1; });
    return map;
  }, [dateSourceFiltered, stages]);

  // Marketing Head's own bucket counts — same idea as stageCounts, against
  // MARKETING_HEAD_FUNNEL's match functions instead of a live stage-name equality.
  const funnelCounts = useMemo(() => {
    const map = { all: dateSourceFiltered.length };
    MARKETING_HEAD_FUNNEL.forEach((b) => { map[b.key] = dateSourceFiltered.filter(b.match).length; });
    return map;
  }, [dateSourceFiltered]);

  // The toolbar filter and the per-row assign dropdown take the same {value,label} shape,
  // so they share one list. The source list that used to sit here went with the filter it
  // fed — the SOURCE column still shows where each lead came from, it is just no longer
  // something you can narrow the board by.
  const branchOptions = useMemo(() => branches.map((b) => ({ value: b.id, label: branchLabel(b) })), [branches]);

  const filtered = useMemo(() => {
    let rows = dateSourceFiltered;
    if (isMarketingHeadFunnel) {
      if (stageFilter !== "all") {
        const bucket = MARKETING_HEAD_FUNNEL.find((b) => b.key === stageFilter);
        if (bucket) rows = rows.filter(bucket.match);
      }
    } else if (stageFilter !== "All") {
      rows = rows.filter((l) => l.stage === stageFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((l) => (l.name || "").toLowerCase().includes(q) || (l.phone || "").includes(q) || (l.email || "").toLowerCase().includes(q));
    }
    return rows.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [dateSourceFiltered, stageFilter, search, isMarketingHeadFunnel]);

  // Rendering thousands of rows at once is fine on desktop but chokes mobile
  // devices, so re-page back to 50 whenever the filtered set changes.
  useEffect(() => { setVisibleCount(50); }, [stageFilter, sourceFilter, search, dateFilter]);
  const visibleLeads = filtered.slice(0, visibleCount);

  // Mobile Consultations tab — this rep's leads currently booked for a consultation.
  // Not narrowed by the Leads tab's own date filter — ConsultationsTab applies its own.
  const appointmentLeads = useMemo(
    () => leads.filter((l) => l.stage === "Appointment").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [leads],
  );

  const moveToStage = async (leadId, stageName) => {
    try { await updateLead(leadId, { stage: stageName }); toast.success(`Moved to ${stageName}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Move failed"); }
  };

  // Pick KPI cards: total + up to 8 stage cards
  const kpiStages = stages.slice(0, 8);

  // Branches under the selected group — every one under All, just the offline ones under
  // Offline, just the online ones under Online. Super Admin only.
  const visibleGroupBranches = branchGroup === "all" ? branches : branches.filter((b) => isOnlineVertical(b.vertical) === (branchGroup === "online"));

  if (PRESALES_CRM_LOCKED) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-24 text-center" data-testid="presales-crm-locked">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-xl font-bold text-slate-700">Pre Sales is locked</h2>
        <p className="max-w-sm text-sm text-slate-500">This dashboard has been locked by a Super Admin. Contact your administrator to restore access.</p>
      </div>
    );
  }

  // flex+gap, not space-y — space-y's sibling selector keys off the `hidden` HTML
  // attribute, not the `hidden` class, so the desktop leads block (hidden by class
  // on mobile, not attribute) would still count as a sibling and hand the next
  // block phantom top margin for content a phone never draws.
  // Bottom padding for every role now, not just Pre Sales: Super Admin gets the card list
  // on a phone too, and its own fixed bottom nav would otherwise sit on the last card.
  // Desktop has no bar and no padding.
  return (
    <div className={`flex flex-col gap-5 ${embedded ? "" : "pb-20 md:pb-0"}`} data-testid="presales-crm-page">
    {/* Desk only, whoever is looking. Super Admin used to get this table on a phone while
        the Pre Sales role got the card list below — the same screen, one of them unusable,
        decided by who was logged in. Both now get the cards. */}
    <div className="hidden space-y-5 md:block" data-testid="presales-leads-tab">
      {/* Master View controls — Super Admin only: which pane (Leads / Analytics), and
          which branches (All/Offline/Online, then the individual branches in that
          group) both panes are scoped to.

          Above the KPI cards, because the cards are counted for whatever these select.
          With the cards on top they read as the page's headline totals, which is not what
          they are the moment a branch pill is on. */}
      {isSuperAdminMasterView && (
        <div className="space-y-2" data-testid="presales-master-controls">
          <div className="flex items-center gap-2">
            <PreSalesGroupPill active={masterView === "leads"} onClick={() => setMasterView("leads")} testid="presales-view-leads">
              <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Leads</span>
            </PreSalesGroupPill>
            <PreSalesGroupPill active={masterView === "analytics"} onClick={() => setMasterView("analytics")} testid="presales-view-analytics">
              <span className="inline-flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Analytics</span>
            </PreSalesGroupPill>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-testid="presales-branch-groups">
            <PreSalesGroupPill active={branchGroup === "all"} onClick={() => selectBranchGroup("all")} testid="presales-branch-group-all">All</PreSalesGroupPill>
            <PreSalesGroupPill active={branchGroup === "offline"} onClick={() => selectBranchGroup("offline")} testid="presales-branch-group-offline">Offline</PreSalesGroupPill>
            <PreSalesGroupPill active={branchGroup === "online"} onClick={() => selectBranchGroup("online")} testid="presales-branch-group-online">Online</PreSalesGroupPill>
          </div>

          {visibleGroupBranches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="presales-branch-pills">
              {visibleGroupBranches.map((b) => (
                <PreSalesBranchPill
                  key={b.id}
                  active={sourceFilter === b.id}
                  onClick={() => setSourceFilter((id) => (id === b.id ? "" : b.id))}
                  testid={`presales-branch-pill-${b.id}`}
                >
                  {branchLabel(b)}
                </PreSalesBranchPill>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI Cards — the Leads pane only. They are that table's stage filter, not a
          summary: each one selects a stage and the list below narrows to it. Analytics
          has no such table to narrow, and its own cards already open with All Leads, so
          on that pane these were a second row of counts answering nothing. */}
      {/* Three across on a phone rather than all of them jammed into one nowrap row. Six
          cards sharing 330px gave each about 50px, which truncated every label to
          "Tota…", "Follo…" — a row of counts with no way to tell which count is which.
          Desktop still lays them out on the single line it has room for. */}
      {!(masterView === "analytics" && isSuperAdminMasterView) && (
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-nowrap sm:gap-3" data-testid="presales-kpi-row">
          {isMarketingHeadFunnel ? (
            <>
              <KpiCard label="All" value={funnelCounts.all} active={stageFilter === "all"} color="#22c55e" onClick={() => setStageFilter("all")} testid="presales-kpi-all" />
              {MARKETING_HEAD_FUNNEL.map((b) => (
                <KpiCard key={b.key} label={b.label} value={funnelCounts[b.key] || 0} active={stageFilter === b.key} color={b.color} onClick={() => setStageFilter(b.key)} testid={`presales-kpi-${b.key}`} />
              ))}
            </>
          ) : (
            <>
              <KpiCard label="Total Leads" value={stageCounts.All} active={stageFilter === "All"} color="#22c55e" onClick={() => setStageFilter("All")} testid="presales-kpi-all" />
              {kpiStages.map((s) => (
                <KpiCard key={s.id} label={s.name} value={stageCounts[s.name] || 0} active={stageFilter === s.name} color={s.color} onClick={() => setStageFilter(s.name)} testid={`presales-kpi-${s.name}`} />
              ))}
            </>
          )}
        </div>
      )}

      {masterView === "analytics" && isSuperAdminMasterView ? (
        <PreSalesAnalyticsPanel branches={branches} branchGroup={branchGroup} sourceFilter={sourceFilter} />
      ) : (
      <>
      {/* Toolbar */}
      {/* Seven controls, which a phone cannot hold on one line — so it takes two, split
          where the meaning splits: what you are looking at on top, what you can do to it
          below. It used to be one flex-wrap row whose min-w-[260px] search forced a break
          wherever it landed, leaving Manage Stages orphaned on a third line.

          sm:contents dissolves both wrappers from sm up, so the desk still lays all seven
          out in the single row it always had. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" data-testid="presales-toolbar">
        <div className="flex items-center gap-2 sm:contents">
        <div className="relative min-w-0 flex-1 sm:min-w-[260px]">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads by name, email, phone..." className="h-10 pl-8" data-testid="presales-search" />
        </div>
        {/* Icons only, matching Branch Leads. The labels move to title/aria-label rather
            than being dropped, so a hover still says what each does and a screen reader
            still announces it.

            All Sources keeps its text: it is not a button but the current selection, and
            an icon cannot say WHICH source is filtered. Same reason the date filter puts
            its label back once a range is picked — a filtered screen has to admit it. */}
        <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="presales-date-filter" centered iconOnly />
        </div>

        <div className="flex items-center gap-2 sm:contents">
        {/* Master View only (Super Admin / Sales Head). A Pre Sales rep works one branch's
            book, so a control that narrows the board to a branch either does nothing or
            hides their own leads. */}
        {isSuperAdminMasterView && (
          <ColorSelect
            value={sourceFilter}
            options={branchOptions}
            placeholder="All Branches"
            resetLabel="All Branches"
            emptyText="No branches yet."
            triggerClass="h-10 min-w-0 flex-1 text-sm sm:w-[200px] sm:flex-none"
            onChange={setSourceFilter}
            testid="presales-source-filter"
          />
        )}
        <PullFromSheetButton onPulled={load} iconOnly />
        <Button
          variant="outline"
          onClick={() => setShowCreate(true)}
          title="Create Lead"
          aria-label="Create Lead"
          className="h-10 w-10 shrink-0 p-0"
          data-testid="presales-create-lead-btn"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="presales-refresh-btn"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {role === "super_admin" && (
          // Icon-only on a phone, like the four beside it — the words would take a third
          // of the row for a control used once a month. The label stays on title and
          // aria-label, and returns in full from sm up.
          <Button
            variant="outline"
            className="h-10 w-10 shrink-0 p-0 sm:w-auto sm:px-4"
            onClick={onManageStages}
            title="Manage Stages"
            aria-label="Manage Stages"
            data-testid="presales-manage-stages-btn"
          >
            <Cog className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Manage Stages</span>
          </Button>
        )}
        </div>
      </div>

      {/* The stage strip that used to sit here is gone. It set the same `stageFilter`
          the KPI cards above already set, so every stage was on screen twice, four
          rows apart, with the pair drifting out of step as you clicked either one.
          The cards win: they carry the counts. The mobile block below keeps its own
          StageTabBar — it has no KPI row, so that one isn't a duplicate. */}

      {/* Leads table */}
      <Card data-testid="presales-leads-card">
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead className="text-center text-xs text-slate-500">
                <tr><th className="px-3 py-2 text-left">LEAD</th><th className="px-3 py-2">PHONE</th><th className="px-3 py-2">EMAIL</th><th className="px-3 py-2">SOURCE</th><th className="px-3 py-2">STAGE</th>{isSuperAdminMasterView && <th className="px-3 py-2">HANDLED BY</th>}{stageFilter === "Appointment" && <th className="px-3 py-2">BRANCH ADMIN STATUS</th>}{stageFilter === "RNR" && <th className="px-3 py-2">LAST CALL</th>}<th className="px-3 py-2">CREATED</th><th className="px-3 py-2">ASSIGNED TO</th><th className="px-3 py-2">ACTIONS</th></tr>
              </thead>
              <tbody>
                {visibleLeads.map((l) => {
                  const stg = stages.find((s) => s.name === l.stage);
                  return (
                    <tr key={l.id} onClick={() => setEditing(l)} className="group cursor-pointer" data-testid={`presales-lead-row-${l.id}`}>
                      <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-3 text-left font-medium text-slate-800 transition-colors group-hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(l.name).bg} ${avatarColor(l.name).fg}`}>{initials(l.name)}</span>
                          <span className="truncate">{l.name}</span>
                        </div>
                      </td>
                      {/* Number only. Call and WhatsApp both hand off to an app the desk
                          does not have — tel: and wa.me open a dialer and a phone client,
                          so on a desktop they were two icons per row that either did
                          nothing or launched the wrong thing. They stay on the phone
                          cards, where they work. */}
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50">
                        <span className="font-mono text-xs text-slate-700">{l.phone || "—"}</span>
                      </td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center text-xs text-slate-600 transition-colors group-hover:bg-slate-50">{l.email || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50"><SourcePill source={l.source_tab || l.source_type} /></td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 transition-colors group-hover:bg-slate-50">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex h-6 items-center rounded border px-2 text-[10px] font-semibold" style={{ borderColor: stg?.color || "#cbd5e1", color: stg?.color || "#64748b" }}>{l.stage}</span>
                            {l.stage === "RNR" && (l.rnr_attempts || 0) > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700" title={`${l.rnr_attempts} unanswered call attempts`} data-testid={`presales-rnr-badge-${l.id}`}>
                                <PhoneOff className="h-2.5 w-2.5" />×{l.rnr_attempts}
                              </span>
                            )}
                          </div>
                          {l.stage === "Follow Up" && l.next_follow_up_at && (() => {
                            const dt = new Date(l.next_follow_up_at);
                            const today = new Date(); today.setHours(0, 0, 0, 0);
                            const diff = Math.floor((dt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
                            const isToday = diff === 0;
                            const isTomorrow = diff === 1;
                            const isPast = dt.getTime() < Date.now();
                            const tone = isPast ? "bg-rose-50 text-rose-700 border-rose-200" : isToday ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-emerald-50 text-emerald-700 border-emerald-200";
                            return (
                              <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${tone}`} data-testid={`presales-followup-badge-${l.id}`}>
                                <Clock className="h-2.5 w-2.5" />
                                {isToday ? "Today" : isTomorrow ? "Tomorrow" : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                                {" · "}
                                {dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      {isSuperAdminMasterView && (
                        <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50" data-testid={`presales-handled-by-${l.id}`}>
                          <div className="flex justify-center"><HandledByBadge lead={l} /></div>
                          {l.lead_control === "branch_admin" && l.branch_stage && (
                            <span className="mt-1 block text-[10px] text-slate-400">{l.branch_stage}</span>
                          )}
                        </td>
                      )}
                      {stageFilter === "Appointment" && (() => {
                        const { branchName, status, statusColor } = branchStatusInfo(l, branches);
                        return (
                          <td className="border-y border-slate-200 bg-white px-3 py-3 text-center text-xs transition-colors group-hover:bg-slate-50">
                            <div className="flex flex-col items-center gap-1" data-testid={`presales-branch-status-${l.id}`}>
                              <span className="font-semibold text-slate-700">{branchName || "—"}</span>
                              <span className={`inline-flex w-fit items-center rounded border px-1.5 text-[10px] font-semibold ${statusColor}`}>{status}</span>
                              {l.assigned_physio_name ? (
                                <span className="text-[10px] text-emerald-600">Expert: {l.assigned_physio_name}</span>
                              ) : (
                                <span className="text-[10px] text-amber-600">Pending Expert</span>
                              )}
                            </div>
                          </td>
                        );
                      })()}
                      {stageFilter === "RNR" && (
                        <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50">
                          {l.rnr_last_attempt_at ? (
                            <div className="flex flex-col items-center gap-0.5" data-testid={`presales-rnr-lastcall-${l.id}`}>
                              <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                <Clock className="h-2.5 w-2.5" />{callTimeStamp(l.rnr_last_attempt_at)}
                              </span>
                              <span className="text-[10px] text-slate-400">{callDateStamp(l.rnr_last_attempt_at)}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center text-xs text-slate-400 transition-colors group-hover:bg-slate-50">{(l.created_at || "").slice(0, 10)}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50" onClick={(e) => e.stopPropagation()}>
                        <ColorSelect
                          value={l.branch_id || ""}
                          options={branchOptions}
                          placeholder="— Assign —"
                          emptyText="No branches available."
                          // pickedBranchId, not branchId — the component now takes a
                          // branchId prop, and a parameter shadowing it here would read
                          // like the board's own branch rather than the row's choice.
                          onChange={async (pickedBranchId) => {
                            if (!pickedBranchId) return;
                            try {
                              await scheduleAppointment(l.id, { department: "physio", mode: "offline", branch_id: pickedBranchId });
                              toast.success(`Assigned to ${branchLabel(branches.find((b) => b.id === pickedBranchId)) || "branch"}`);
                              load();
                            } catch (err) { toast.error(err?.response?.data?.detail || "Failed to assign branch"); }
                          }}
                          testid={`presales-assign-branch-${l.id}`}
                        />
                      </td>
                      <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-3 text-center transition-colors group-hover:bg-slate-50">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditing(l); }} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-sky-600" data-testid={`presales-lead-view-${l.id}`} title="View / Edit">
                            <Eye className="h-4 w-4" />
                          </button>
                          {role === "super_admin" && (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(l); }} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" data-testid={`presales-lead-delete-${l.id}`} title="Delete lead">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={(stageFilter === "Appointment" ? 9 : 8) + (isSuperAdminMasterView ? 1 : 0)} className="px-3 py-8 text-center text-slate-400">{loading ? "Loading..." : "No leads match."}</td></tr>}
              </tbody>
            </table>
          </div>
          {filtered.length > visibleCount && (
            <div className="flex items-center justify-center border-t border-slate-100 p-3">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + 50)} data-testid="presales-load-more">
                Load More ({filtered.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>

      {activeTab === "leads" && (
        <div className="space-y-3 md:hidden" data-testid="presales-leads-mobile">
          {/* Two rows, split by what they do: the first narrows what you are looking at,
              the second acts on it. Seven controls will not share one line on a phone at
              a usable size, and this is the seam that reads. */}
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="h-8 border-0 p-0 focus-visible:ring-0"
              data-testid="presales-mobile-search"
            />
            <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="presales-mobile-date-filter" centered iconOnly />
            <Button
              onClick={load}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="h-8 w-8 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
              data-testid="presales-mobile-refresh-btn"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* Same controls as the desk toolbar, stacked instead of inline — a phone has no
              room for a row of pills beside search and refresh, so this gets its own
              block rather than squeezing into the row above. The dropdown that used to
              sit here for branch selection is gone; the pills below replace it. */}
          {isSuperAdminMasterView && (
            <div className="space-y-2" data-testid="presales-mobile-master-controls">
              <div className="flex items-center gap-2">
                <PreSalesGroupPill active={masterView === "leads"} onClick={() => setMasterView("leads")} testid="presales-mobile-view-leads">
                  <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Leads</span>
                </PreSalesGroupPill>
                <PreSalesGroupPill active={masterView === "analytics"} onClick={() => setMasterView("analytics")} testid="presales-mobile-view-analytics">
                  <span className="inline-flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Analytics</span>
                </PreSalesGroupPill>
              </div>
              <div className="flex flex-wrap items-center gap-2" data-testid="presales-mobile-branch-groups">
                <PreSalesGroupPill active={branchGroup === "all"} onClick={() => selectBranchGroup("all")} testid="presales-mobile-branch-group-all">All</PreSalesGroupPill>
                <PreSalesGroupPill active={branchGroup === "offline"} onClick={() => selectBranchGroup("offline")} testid="presales-mobile-branch-group-offline">Offline</PreSalesGroupPill>
                <PreSalesGroupPill active={branchGroup === "online"} onClick={() => selectBranchGroup("online")} testid="presales-mobile-branch-group-online">Online</PreSalesGroupPill>
              </div>
              {visibleGroupBranches.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" data-testid="presales-mobile-branch-pills">
                  {visibleGroupBranches.map((b) => (
                    <PreSalesBranchPill
                      key={b.id}
                      active={sourceFilter === b.id}
                      onClick={() => setSourceFilter((id) => (id === b.id ? "" : b.id))}
                      testid={`presales-mobile-branch-pill-${b.id}`}
                    >
                      {branchLabel(b)}
                    </PreSalesBranchPill>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Right-aligned for Pre Sales. Manage Stages being Super Admin's alone makes
              this row one icon for them — and one control at the left edge with the rest
              of the line empty reads as something that failed to load rather than as a
              toolbar. */}
          <div className={`flex items-center gap-2 ${role === "super_admin" ? "" : "justify-end"}`}>
            {/* Super Admin's alone — the Pre Sales role can work the pipeline but not
                reshape it, and the button 403s for them anyway. */}
            {role === "super_admin" && (
              <Button
                variant="outline"
                className="h-10 w-10 shrink-0 p-0"
                onClick={onManageStages}
                title="Manage Stages"
                aria-label="Manage Stages"
                data-testid="presales-mobile-manage-stages-btn"
              >
                <Cog className="h-4 w-4" />
              </Button>
            )}
            <Button
              onClick={() => setShowCreate(true)}
              title="Create Lead"
              aria-label="Create Lead"
              variant="outline"
              className="h-10 w-10 shrink-0 p-0"
              data-testid="presales-mobile-create-lead-btn"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <PullFromSheetButton onPulled={() => { load(); setStageFilter("New Leads"); }} iconOnly />
          </div>

          {masterView === "analytics" && isSuperAdminMasterView ? (
            <PreSalesAnalyticsPanel branches={branches} branchGroup={branchGroup} sourceFilter={sourceFilter} />
          ) : (
          <>
          <StageTabBar
            stages={stages}
            stageFilter={stageFilter === "All" ? null : stageFilter}
            setStageFilter={(v) => setStageFilter(v === null ? "All" : v)}
            counts={stageCounts}
            totalCount={stageCounts.All}
            testid="presales-mobile-stagebar"
          />

          <div className="space-y-2">
            {visibleLeads.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">
                {loading ? "Loading..." : "No leads match."}
              </p>
            ) : visibleLeads.map((l) => {
              const stg = stages.find((s) => s.name === l.stage);
              const hex = stg?.color || "#64748b";
              return (
                <div
                  key={l.id}
                  onClick={() => setEditing(l)}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                  data-testid={`presales-mobile-card-${l.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(l.name).bg} ${avatarColor(l.name).fg}`}>{initials(l.name)}</span>
                      <p className="min-w-0 truncate text-sm font-bold text-slate-800">{l.name || "—"}</p>
                    </div>
                    <span className="shrink-0 rounded-[5px] px-2 py-0.5 text-[10px] font-bold" style={{ background: `${hex}14`, color: hex, border: `1px solid ${hex}33` }}>
                      {l.stage}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                      {l.stage === "RNR" && (l.rnr_attempts || 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-rose-600">
                          <PhoneOff className="h-2.5 w-2.5" />×{l.rnr_attempts}
                        </span>
                      )}
                      {l.stage === "RNR" && l.rnr_last_attempt_at && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-rose-600">
                          <Clock className="h-2.5 w-2.5" />{callTimeStamp(l.rnr_last_attempt_at)}
                        </span>
                      )}
                      {l.stage === "Follow Up" && l.next_follow_up_at && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-amber-600">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(l.next_follow_up_at).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                        </span>
                      )}
                      {(l.source_tab || l.source_type) && <span className="truncate">{l.source_tab || l.source_type}</span>}
                    </div>
                    <LeadContactIcons lead={l} />
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length > visibleCount && (
            <div className="flex items-center justify-center pt-1">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + 50)} data-testid="presales-mobile-load-more">
                Load More ({filtered.length - visibleCount} remaining)
              </Button>
            </div>
          )}
          </>
          )}

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700"
            data-testid="presales-mobile-create-fab"
            aria-label="Create Lead"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
      )}

      {role === "pre_sales" && activeTab === "consultations" && (
        <ConsultationsTab leads={appointmentLeads} branches={branches} loading={loading} onOpen={setEditing} />
      )}

      {role === "pre_sales" && activeTab === "profile" && (
        <ProfileTab currentUser={currentUser} branches={branches} onLogout={onLogout} />
      )}

      {editing && (
        <LeadDetailDialog lead={editing} stages={stages} currentUser={currentUser} pinnedBranchId={branchId} onClose={() => setEditing(null)} onSaved={load} onMoveStage={moveToStage} />
      )}

      {showCreate && (
        // Pinned to this board's branch when it has one. A lead created on a Branch
        // Admin's Pre Sales tab with no branch would be an unbranched lead, which always
        // belongs to Pre-Sales — it would vanish from the board that created it.
        <CreateLeadModal onClose={() => setShowCreate(false)} onSaved={load} branchId={branchId} isSuperAdmin={isSuperAdminMasterView} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="presales-delete-dialog">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900" data-testid="presales-delete-title">Delete lead?</h3>
                <p className="mt-1 text-xs text-slate-500">This will permanently delete <b className="text-slate-700">{confirmDelete.name || "this lead"}</b> along with its activity history and follow-ups. This cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDelete(null)} data-testid="presales-delete-cancel">Cancel</Button>
              <Button
                onClick={async () => {
                  try {
                    await deleteLead(confirmDelete.id);
                    toast.success(`Deleted ${confirmDelete.name || "lead"}`);
                    setConfirmDelete(null);
                    load();
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || "Delete failed");
                  }
                }}
                className="bg-rose-600 hover:bg-rose-700"
                data-testid="presales-delete-confirm"
              >
                Yes, Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {role === "pre_sales" && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-600 bg-slate-500 md:hidden" data-testid="presales-bottom-nav">
          <div className="mx-auto flex max-w-lg items-stretch justify-around">
            {PRESALES_TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${active ? "text-white" : "text-slate-200"}`}
                  data-testid={`presales-nav-${t.key}`}
                >
                  <Icon className="h-5 w-5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ============ Mobile: Consultations tab (leads booked for a consultation) ============

// Read-only milestone tracker for what happens to a lead after it's handed to a
// branch: branch_stage carries the first two ("New Appointment" is set the instant a
// branch is assigned; "Appointment Date & Time" is set once a specific date/time is
// booked, and branch_stage never advances past it). The doctor finishing the visit
// and suggesting a treatment plan is a *different* field — consultation_stage (or
// head_consultation_stage) hits "Consultation Visit" — so it's tracked separately and
// can be true at the same time branch_stage is still "Appointment Date & Time".
const CONSULT_MILESTONES = [
  { key: "new", label: "New Branch Assign", color: "#0ea5e9" },
  { key: "booked", label: "Consultation Booked", color: "#f59e0b" },
  { key: "completed", label: "Consultation Completed", color: "#22c55e" },
];

const consultMilestoneMatch = (l, key) => {
  if (key === "new") return l.branch_stage === "New Appointment";
  if (key === "booked") return l.branch_stage === "Appointment Date & Time";
  if (key === "completed") return l.consultation_stage === "Consultation Visit" || l.head_consultation_stage === "Consultation Visit";
  return false;
};

const ConsultationsTab = ({ leads, branches, loading, onOpen }) => {
  const [dateFilter, setDateFilter] = useState(null);
  const [milestoneFilter, setMilestoneFilter] = useState(null);

  const milestoneCounts = useMemo(() => ({
    new: leads.filter((l) => consultMilestoneMatch(l, "new")).length,
    booked: leads.filter((l) => consultMilestoneMatch(l, "booked")).length,
    completed: leads.filter((l) => consultMilestoneMatch(l, "completed")).length,
  }), [leads]);

  // Filters by appointment_date (when the consultation is booked), not created_at —
  // same field ConsultationsBoard's own date filter uses for this stage of leads.
  const filtered = useMemo(() => {
    let rows = leads;
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
    if (milestoneFilter) rows = rows.filter((l) => consultMilestoneMatch(l, milestoneFilter));
    return rows;
  }, [leads, dateFilter, milestoneFilter]);

  return (
    <div className="space-y-3 md:hidden" data-testid="presales-consultations-tab">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Consultations ({filtered.length})</h2>
        <DateFilterPopover value={dateFilter} onChange={setDateFilter} testid="presales-consult-date-filter" centered iconOnly />
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="presales-consult-milestones">
        {CONSULT_MILESTONES.map((m) => {
          const active = milestoneFilter === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMilestoneFilter(active ? null : m.key)}
              className="rounded-xl p-2.5 text-center transition-all"
              style={
                active
                  ? { background: m.color, color: "#fff", boxShadow: `0 2px 8px ${m.color}40` }
                  : { background: `${m.color}14`, color: m.color, border: `1px solid ${m.color}33` }
              }
              data-testid={`presales-consult-milestone-${m.key}`}
            >
              <p className="text-lg font-bold leading-none">{milestoneCounts[m.key]}</p>
              <p className="mt-1 text-[9px] font-semibold uppercase leading-tight tracking-tight">{m.label}</p>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400">
          {loading ? "Loading..." : "No consultations booked yet."}
        </p>
      ) : (
        filtered.map((l) => {
          const { branchName, status, statusColor } = branchStatusInfo(l, branches);
          const completed = consultMilestoneMatch(l, "completed");
          return (
            <div
              key={l.id}
              onClick={() => onOpen(l)}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              data-testid={`presales-consultation-card-${l.id}`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(l.name).bg} ${avatarColor(l.name).fg}`}>{initials(l.name)}</span>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{l.name}</p>
                <LeadContactIcons lead={l} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-slate-600">{branchName || "—"}</span>
                <span className={`inline-flex items-center rounded border px-1.5 text-[10px] font-semibold ${statusColor}`}>{status}</span>
                {l.assigned_physio_name ? (
                  <span className="text-[10px] text-emerald-600">Expert: {l.assigned_physio_name}</span>
                ) : (
                  <span className="text-[10px] text-amber-600">Pending Expert</span>
                )}
                {completed && (
                  <span className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-2.5 w-2.5" />Treatment Suggested
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

// ============ Mobile: Profile tab (rep's own info + testimonial video management) ============

const ProfileTab = ({ currentUser, branches, onLogout }) => {
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const loadVideos = useCallback(async () => {
    setLoadingVideos(true);
    try { setVideos(await listTestimonials()); }
    catch { /* keep whatever was already shown */ }
    setLoadingVideos(false);
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  const branchName = currentUser?.branch_id
    ? (branches.find((b) => b.id === currentUser.branch_id)?.branch_name || branches.find((b) => b.id === currentUser.branch_id)?.name)
    : null;
  const joinedOn = currentUser?.created_at
    ? new Date(currentUser.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "—";

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    try {
      await addTestimonial({ youtube_url: url.trim(), title: title.trim() || undefined });
      setUrl(""); setTitle("");
      toast.success("Testimonial added");
      loadVideos();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not add — check the YouTube link");
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try { await deleteTestimonial(id); setVideos((v) => v.filter((x) => x.id !== id)); }
    catch { toast.error("Delete failed"); }
  };

  return (
    <div className="space-y-4 md:hidden" data-testid="presales-profile-tab">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-xl font-bold text-sky-700">
              {currentUser?.full_name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-800">{currentUser?.full_name}</p>
              <p className="flex items-center gap-1 text-xs text-slate-400"><Mail className="h-3 w-3" />{currentUser?.email}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs text-slate-400">Role</span>
              <span className="text-sm font-medium text-slate-700">Pre-Sales</span>
            </div>
            {branchName && (
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs text-slate-400">Branch</span>
                <span className="text-sm font-medium text-slate-700">{branchName}</span>
              </div>
            )}
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs text-slate-400">Joined On</span>
              <span className="text-sm font-medium text-slate-700">{joinedOn}</span>
            </div>
          </div>
          <Button variant="outline" onClick={onLogout} className="mt-4 w-full text-rose-600 hover:bg-rose-50" data-testid="presales-profile-logout">
            <LogOut className="mr-1.5 h-4 w-4" />Logout
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Youtube className="h-4 w-4 text-rose-500" />Testimonial Videos
          </CardTitle>
          <p className="text-xs text-slate-400">Shown live on the link shared with leads over WhatsApp.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleAdd} className="space-y-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste YouTube video link" data-testid="presales-testimonial-url" />
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" data-testid="presales-testimonial-title" />
            <Button type="submit" disabled={saving || !url.trim()} className="w-full bg-sky-600 hover:bg-sky-700" data-testid="presales-testimonial-add">
              {saving ? "Adding..." : "Add Video"}
            </Button>
          </form>

          <div className="space-y-2 pt-1">
            {loadingVideos ? (
              <p className="text-center text-xs text-slate-400">Loading...</p>
            ) : videos.length === 0 ? (
              <p className="text-center text-xs text-slate-400">No videos added yet.</p>
            ) : (
              videos.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2" data-testid={`presales-testimonial-row-${v.id}`}>
                  <span className="truncate text-xs font-medium text-slate-700">{v.title || v.video_id}</span>
                  <button type="button" onClick={() => handleDelete(v.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" data-testid={`presales-testimonial-delete-${v.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const KpiCard = ({ label, value, color, active, onClick, testid }) => (
  <button onClick={onClick} data-testid={testid} className={`min-w-0 rounded-2xl p-3 text-left transition sm:flex-1 sm:p-4 ${active ? "ring-2 ring-inset" : ""}`} style={{ background: `${color}14`, border: `1px solid ${color}33`, ...(active ? { "--tw-ring-color": color } : {}) }}>
    {/* Wraps on a phone instead of truncating — a stage name is only useful whole, and
        these differ at the end ("Consultation Visit" against "Consultation Fee"). Two
        lines' height whether or not it needs them, so the figures stay on one baseline
        across the row. Desktop has the width to truncate rarely and stay on one line. */}
    <p className="min-h-[2.4em] break-words text-[11px] font-medium leading-snug sm:min-h-0 sm:truncate sm:text-xs" style={{ color }}>{label}</p>
    <p className="mt-0.5 text-2xl font-bold sm:mt-1 sm:text-3xl" style={{ color }}>{value}</p>
  </button>
);

// Legacy compact chip kept for callers that haven't migrated yet (unused after redesign).
const ChipTab = ({ label, active, onClick, color, testid }) => (
  <button onClick={onClick} data-testid={testid} className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${active ? "text-white" : "text-slate-600 bg-slate-100 hover:bg-slate-200"}`} style={active ? { background: color } : undefined}>
    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}
  </button>
);

// ============ Lead Detail Dialog (Overview + Move-to-Stage + Edit) ============

/**
 * The activity line without its "Call attempt #4 — " prefix.
 *
 * The backend writes that prefix so the entry reads on its own in the History tab and in
 * Transaction History, where nothing else says which call it was. In RNR History the badge
 * beside it already says ATTEMPT 4, so the prefix printed the number twice on one row.
 *
 * Stripped here rather than dropped at the source, because those other screens still need
 * it. Anything that doesn't match the pattern is passed through untouched — an activity
 * line written some other way should still be readable, not silently blanked.
 */
const rnrDetail = (details) => {
  const text = (details || "").trim();
  const stripped = text.replace(/^call attempt\s*#?\d+\s*[—–-]\s*/i, "");
  if (!stripped) return text;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
};

// pinnedBranchId: set when the board is a single branch's, which is how a Super Admin
// drilled into a branch gets a branch for the appointment flow — they have none of their
// own, and without it every appointment asks them to pick one they already chose.
const LeadDetailDialog = ({ lead, stages, currentUser, pinnedBranchId = null, onClose, onSaved, onMoveStage }) => {
  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [currentLead, setCurrentLead] = useState(lead);
  const [followUpDraft, setFollowUpDraft] = useState(null); // { date, time, remarks } | null
  const [rescheduleDraft, setRescheduleDraft] = useState(null); // { followupId, date, time, reason } | null
  const [appointmentDraft, setAppointmentDraft] = useState(null); // { department, appointment_date, appointment_time, remarks } | null
  const [appointmentResult, setAppointmentResult] = useState(null); // summary shown after a successful schedule
  const [branches, setBranches] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    getBranches().then(setBranches).catch(() => {});
  }, []);

  // Both History and RNR History read the same activity trail — RNR History is that trail
  // filtered to the call attempts, not a second source. One fetch serves both, so the two
  // tabs can never show a different number of calls for the same lead.
  useEffect(() => {
    if ((tab === "history" || tab === "rnr") && currentLead?.id) {
      setActivityLoading(true);
      leadActivity(currentLead.id).then(setActivity).catch(() => setActivity([])).finally(() => setActivityLoading(false));
    }
  }, [tab, currentLead?.id]);

  // "rnr_attempt" is the action v3_leads writes on every +1 No Answer. Nothing else in
  // the trail records a call, so this is the whole of what the OS knows about ringing
  // this person.
  const rnrRows = activity.filter((a) => a.action === "rnr_attempt");

  useEffect(() => { setCurrentLead(lead); }, [lead]);

  const refreshAndKeep = () => { onSaved && onSaved(); };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" data-testid="presales-detail-dialog">
      {!showEdit && (
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* Plain header. The gradient was the loudest thing on the dialog and it carried
            no meaning — the two chips beneath it are what actually say where this lead
            came from and what stage it is at, and they read better against white. */}
        <div className="relative border-b border-slate-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-base font-bold ${avatarColor(currentLead.name).bg} ${avatarColor(currentLead.name).fg}`}>{initials(currentLead.name)}</span>
              <div>
                <p className="text-lg font-semibold leading-tight text-slate-900" data-testid="presales-detail-name">{currentLead.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    {currentLead.source_tab || currentLead.source_type || "—"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                    {currentLead.stage}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentLead.source_type === "manual" && (
                <Button size="sm" variant="outline" onClick={() => setShowEdit(true)} className="h-8" data-testid="presales-detail-edit-btn">
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              )}
              <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" data-testid="presales-detail-close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Pill tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
          {[
            { key: "overview", label: "Overview", color: "bg-sky-500" },
            { key: "rnr", label: "RNR History", color: "bg-rose-500" },
            { key: "history", label: "History", color: "bg-violet-500" },
            { key: "follow-up", label: "Follow-up", color: "bg-emerald-500" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-all ${tab === t.key ? `${t.color} text-white shadow-sm` : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
              data-testid={`presales-detail-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto bg-slate-50/30 p-5">
          {tab === "overview" && (
            <div className="space-y-3">
              <ColorSection title="Contact Information" tone="sky" icon={<Phone className="h-4 w-4" />} collapsible defaultOpen={false}>
                <ColorRow k="Phone" v={currentLead.phone} />
                <ColorRow k="Email" v={currentLead.email || "—"} />
                <ColorRow k="Location" v={currentLead.location || "—"} />
              </ColorSection>
              <ColorSection title="Additional Details" tone="violet" icon={<FileText className="h-4 w-4" />} collapsible defaultOpen={false}>
                <ColorRow k="Expected Consultation" v={currentLead.expected_consultation_date || "—"} />
                <ColorRow k="Months of Pain" v={currentLead.months_of_pain ?? "—"} />
                <ColorRow k="Age" v={currentLead.age ?? "—"} />
                <ColorRow k="Gender" v={currentLead.gender || "—"} />
                <ColorRow k="Occupation" v={currentLead.occupation || "—"} />
                <ColorRow k="Department" v={currentLead.department || "—"} />
                <ColorRow k="Vertical" v={currentLead.vertical} />
              </ColorSection>
              {currentLead.notes && (
                <ColorSection title="Notes" tone="amber" icon={<StickyNote className="h-4 w-4" />}>
                  <p className="text-sm leading-relaxed text-slate-700">{currentLead.notes}</p>
                </ColorSection>
              )}
              {(currentLead.follow_ups || []).filter((f) => f.status !== "rescheduled").length > 0 && (
                <ColorSection title="Follow-up Reminders" tone="emerald" icon={<Bell className="h-4 w-4" />}>
                  {(currentLead.follow_ups || []).filter((f) => f.status !== "rescheduled").slice().reverse().map((f) => {
                    const dt = new Date(`${f.date}T${f.time}:00`);
                    const isUpcoming = dt.getTime() > Date.now();
                    return (
                      <div key={f.id} className={`flex items-start justify-between gap-3 rounded-lg border p-2.5 ${isUpcoming ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`} data-testid={`presales-followup-row-${f.id}`}>
                        <div className="flex items-start gap-2">
                          <Clock className={`mt-0.5 h-4 w-4 ${isUpcoming ? "text-emerald-600" : "text-slate-400"}`} />
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              {dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {f.time}
                            </p>
                            {f.remarks && <p className="mt-0.5 text-xs text-slate-600">{f.remarks}</p>}
                            <p className="mt-0.5 text-[10px] text-slate-400">Set by {f.created_by || "—"}</p>
                          </div>
                        </div>
                        {isUpcoming && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">UPCOMING</span>}
                      </div>
                    );
                  })}
                </ColorSection>
              )}
            </div>
          )}
          {tab === "rnr" && (
            <div className="space-y-3" data-testid="presales-detail-rnr">
              {/* The standing count first — it is what decides whether this lead is still
                  worth ringing, and it comes off the lead itself rather than the length of
                  the list below, so a trail that predates the counter still reports right. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">Client Not Answered</p>
                  <p className="mt-1 text-2xl font-bold text-rose-700" data-testid="presales-rnr-count">
                    {currentLead.rnr_attempts || 0}
                    <span className="ml-1.5 text-sm font-medium text-rose-500">
                      {(currentLead.rnr_attempts || 0) === 1 ? "attempt" : "attempts"}
                    </span>
                  </p>
                </div>
                {currentLead.rnr_last_attempt_at && (
                  <div className="text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">Last call</p>
                    <p className="text-sm font-semibold text-rose-700">
                      {callTimeStamp(currentLead.rnr_last_attempt_at)}
                    </p>
                    <p className="text-[11px] text-rose-400">{callDateStamp(currentLead.rnr_last_attempt_at)}</p>
                  </div>
                )}
              </div>

              {activityLoading && <p className="text-sm text-slate-400">Loading call history...</p>}

              {!activityLoading && rnrRows.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400" data-testid="presales-rnr-empty">
                  {(currentLead.rnr_attempts || 0) > 0
                    // The counter can be ahead of the trail for leads that were rung before
                    // the activity log recorded it. Saying so beats showing an empty list
                    // under a figure that insists calls were made.
                    ? "No individual calls are logged for this lead — only the running total above."
                    : "No calls attempted yet. Use +1 No Answer on the Overview tab when a client doesn't pick up."}
                </div>
              )}

              {!activityLoading && rnrRows.map((a, i) => (
                <div key={a.id} className="flex items-start gap-3 rounded-lg border border-rose-100 bg-white p-3 shadow-sm" data-testid={`presales-rnr-row-${a.id}`}>
                  <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                    <PhoneOff className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Newest first, so attempt numbering counts down the page. */}
                      <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700">
                        Attempt {rnrRows.length - i}
                      </span>
                      {/* callTimeStamp, not toLocaleString: it reads the clock in IST and
                          names the band — "01:02 pm Afternoon" — the same way the panel on
                          Overview already reports the last call. Two formatters would
                          eventually disagree about where Afternoon ends. */}
                      <span className="text-[11px] font-medium text-slate-600">{callTimeStamp(a.created_at)}</span>
                      <span className="text-[11px] text-slate-400">· {callDateStamp(a.created_at)}</span>
                    </div>
                    {a.details && <p className="mt-1 text-sm text-slate-700">{rnrDetail(a.details)}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      by {a.created_by || "system"}{a.created_by_role ? ` · ${a.created_by_role}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab !== "overview" && tab === "history" && (
            <div className="space-y-2" data-testid="presales-detail-history">
              {activityLoading && <p className="text-sm text-slate-400">Loading history...</p>}
              {!activityLoading && activity.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400" data-testid="presales-history-empty">
                  No activity recorded yet.
                </div>
              )}
              {!activityLoading && activity.map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-lg border border-violet-100 bg-white p-3 shadow-sm" data-testid={`presales-history-row-${a.id}`}>
                  <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <Clock className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">{a.action || "event"}</span>
                      <span className="text-[11px] text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
                    </div>
                    {a.details && <p className="mt-1 text-sm text-slate-700">{a.details}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      by {a.created_by || "system"}{a.created_by_role ? ` · ${a.created_by_role}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "follow-up" && (
            <div className="space-y-2" data-testid="presales-detail-followups">
              {(currentLead.follow_ups || []).length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400" data-testid="presales-followups-empty">
                  No follow-ups scheduled yet. Use <span className="font-semibold">Move to Stage → Follow Up</span> to schedule one.
                </div>
              )}
              {(currentLead.follow_ups || []).slice().reverse().map((f, idx) => {
                const dt = new Date(`${f.date}T${f.time}:00`);
                const isUpcoming = dt.getTime() > Date.now();
                const isRescheduled = f.status === "rescheduled";
                const isActive = idx === 0 && !isRescheduled;
                return (
                  <div
                    key={f.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 shadow-sm ${
                      isRescheduled ? "border-slate-200 bg-slate-50/70 opacity-70" : isUpcoming ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"
                    }`}
                    data-testid={`presales-followup-tab-row-${f.id}`}
                  >
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
                      {f.remarks && (
                        <div className="mt-1.5 rounded-md bg-white px-2.5 py-1.5 text-sm text-slate-700 ring-1 ring-slate-100">
                          {f.remarks}
                        </div>
                      )}
                      {isRescheduled && f.reschedule_reason && (
                        <div className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 ring-1 ring-amber-100">
                          <span className="font-semibold">Reschedule reason:</span> {f.reschedule_reason}
                        </div>
                      )}
                      <p className="mt-1.5 text-[11px] text-slate-400">Set by {f.created_by || "—"} · {new Date(f.created_at).toLocaleString()}</p>
                    </div>
                    {isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-shrink-0 border-amber-200 text-amber-700 hover:bg-amber-50"
                        onClick={() => setRescheduleDraft({ followupId: f.id, date: f.date, time: f.time, reason: "" })}
                        data-testid={`presales-followup-reschedule-${f.id}`}
                      >
                        Reschedule
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-5 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
            Move to Stage
          </p>
          <div className="flex flex-wrap gap-2" data-testid="presales-detail-move-stages">
            {stages.filter((s) => s.name === "New Leads" ? currentLead.stage === "New Leads" : true).map((s) => {
              const active = currentLead.stage === s.name;
              const handleClick = async () => {
                if (s.name === "Follow Up") {
                  // Open the follow-up scheduling form instead of moving immediately
                  const today = new Date();
                  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
                  setFollowUpDraft({
                    date: tomorrow.toISOString().slice(0, 10),
                    time: "10:00",
                    remarks: "",
                  });
                  return;
                }
                if (s.name === "Appointment") {
                  const tmrw = new Date(Date.now() + 24 * 60 * 60 * 1000);
                  setAppointmentDraft({ department: "physio", appointment_date: tmrw.toISOString().slice(0, 10), appointment_time: "10:00", remarks: "" });
                  return;
                }
                await onMoveStage(currentLead.id, s.name);
                setCurrentLead({ ...currentLead, stage: s.name });
              };
              return (
                <button
                  key={s.id}
                  onClick={handleClick}
                  disabled={active}
                  className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                  style={
                    active
                      ? { background: s.color, color: "#fff", boxShadow: `0 2px 8px ${s.color}40` }
                      : { background: `${s.color}14`, color: s.color, border: `1px solid ${s.color}33` }
                  }
                  data-testid={`presales-detail-move-${s.name}`}
                >
                  {active && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                  {s.name}
                </button>
              );
            })}
          </div>

          {currentLead.stage === "RNR" && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2" data-testid="presales-detail-rnr-tracker">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                  <PhoneOff className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-rose-700">Client Not Answered</p>
                  <p className="text-[11px] text-rose-500">
                    Attempts so far: <span className="font-bold">{currentLead.rnr_attempts || 0}</span>
                  </p>
                  {currentLead.rnr_last_attempt_at && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-rose-600" data-testid="presales-detail-rnr-lastcall">
                      <Clock className="h-3 w-3" />
                      Last call
                      <span className="font-bold">{callTimeStamp(currentLead.rnr_last_attempt_at)}</span>
                      <span className="text-rose-400">· {callDateStamp(currentLead.rnr_last_attempt_at)}</span>
                    </p>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const updated = await rnrAttempt(currentLead.id);
                    setCurrentLead(updated);
                    toast.success(`Attempt logged (#${updated.rnr_attempts})`);
                    onSaved && onSaved();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
                }}
                className="h-8 bg-rose-600 text-white hover:bg-rose-700"
                data-testid="presales-detail-rnr-attempt"
              >
                <PhoneOff className="mr-1 h-3.5 w-3.5" /> +1 No Answer
              </Button>
            </div>
          )}
        </div>
      </div>
      )}

      {showEdit && (
        <LeadEditModal lead={currentLead} onClose={() => setShowEdit(false)} onSaved={() => { refreshAndKeep(); setShowEdit(false); }} />
      )}

      {followUpDraft && !showEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" data-testid="presales-followup-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <p className="text-base font-semibold">Schedule Follow-Up</p>
              </div>
              <button onClick={() => setFollowUpDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="presales-followup-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
                <MilkDateInput
                  centered
                  title="Follow-Up Date"
                  value={followUpDraft.date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFollowUpDraft({ ...followUpDraft, date: e.target.value })}
                  data-testid="presales-followup-date"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Time *</label>
                <MilkTimeInput
                  centered
                  title="Follow-Up Time"
                  value={followUpDraft.time}
                  onChange={(e) => setFollowUpDraft({ ...followUpDraft, time: e.target.value })}
                  data-testid="presales-followup-time"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="What to discuss in the next call..."
                  value={followUpDraft.remarks}
                  onChange={(e) => setFollowUpDraft({ ...followUpDraft, remarks: e.target.value })}
                  data-testid="presales-followup-remarks"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setFollowUpDraft(null)} data-testid="presales-followup-cancel">Cancel</Button>
              <Button
                className="bg-amber-500 text-white hover:bg-amber-600"
                onClick={async () => {
                  if (!followUpDraft.date || !followUpDraft.time) {
                    toast.error("Date and time are required");
                    return;
                  }
                  try {
                    const updated = await scheduleFollowUp(currentLead.id, followUpDraft);
                    setCurrentLead(updated);
                    setFollowUpDraft(null);
                    toast.success(`Follow-up scheduled for ${followUpDraft.date} at ${followUpDraft.time}`);
                    onSaved && onSaved();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule"); }
                }}
                data-testid="presales-followup-save"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Save & Move to Follow Up
              </Button>
            </div>
          </div>
        </div>
      )}

      {rescheduleDraft && !showEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" data-testid="presales-reschedule-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <p className="text-base font-semibold">Reschedule Follow-Up</p>
              </div>
              <button onClick={() => setRescheduleDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="presales-reschedule-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">New Date *</label>
                <MilkDateInput
                  centered
                  title="New Follow-Up Date"
                  value={rescheduleDraft.date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, date: e.target.value })}
                  data-testid="presales-reschedule-date"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">New Time *</label>
                <MilkTimeInput
                  centered
                  title="New Follow-Up Time"
                  value={rescheduleDraft.time}
                  onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })}
                  data-testid="presales-reschedule-time"
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
                  data-testid="presales-reschedule-reason"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={() => setRescheduleDraft(null)} data-testid="presales-reschedule-cancel">Cancel</Button>
              <Button
                className="bg-amber-500 text-white hover:bg-amber-600"
                onClick={async () => {
                  if (!rescheduleDraft.date || !rescheduleDraft.time || !rescheduleDraft.reason.trim()) {
                    toast.error("Date, time and reason are required");
                    return;
                  }
                  try {
                    const updated = await rescheduleFollowUp(currentLead.id, rescheduleDraft.followupId, {
                      date: rescheduleDraft.date, time: rescheduleDraft.time, reason: rescheduleDraft.reason,
                    });
                    setCurrentLead(updated);
                    setRescheduleDraft(null);
                    toast.success(`Follow-up rescheduled to ${rescheduleDraft.date} at ${rescheduleDraft.time}`);
                    onSaved && onSaved();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to reschedule"); }
                }}
                data-testid="presales-reschedule-save"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Reschedule
              </Button>
            </div>
          </div>
        </div>
      )}

      {appointmentDraft && !showEdit && (() => {
        const myBranch = pinnedBranchId || currentUser?.branch_id;
        const myBranchName = branches.find((b) => b.id === myBranch)?.branch_name || branches.find((b) => b.id === myBranch)?.name || "";
        const resolvedBranchName = () => myBranchName || branches.find((b) => b.id === appointmentDraft.branch_id)?.branch_name || branches.find((b) => b.id === appointmentDraft.branch_id)?.name || "your branch";
        const closeAll = () => { setAppointmentDraft(null); setAppointmentResult(null); };
        return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" data-testid="presales-appointment-modal">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                <p className="text-base font-semibold">{appointmentResult ? "Moved to Branch Admin" : "Schedule Appointment"}</p>
              </div>
              <button onClick={closeAll} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="presales-appointment-close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {appointmentResult ? (
              <>
                <div className="space-y-3 p-5">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">Sent To Branch Admin</p>
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><dt className="text-slate-500">Service</dt><dd className="font-semibold text-slate-800">{appointmentResult.department === "physio" ? "Physiotherapy" : "Fitness"}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Branch</dt><dd className="font-semibold text-slate-800">{appointmentResult.branchName}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Date</dt><dd className="font-semibold text-slate-800">{appointmentResult.appointment_date}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Time</dt><dd className="font-semibold text-slate-800">{appointmentResult.appointment_time}</dd></div>
                    </dl>
                    <p className="mt-2 border-t border-emerald-200 pt-2 text-[11px] text-emerald-700">
                      The branch admin will see this in New Appointment and assign a Fitsiomax Expert for this date &amp; time.
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Lead Summary</p>
                    <p className="text-sm font-semibold text-slate-800">{currentLead.name || "Unknown"}</p>
                    <p className="text-xs text-slate-500">{currentLead.phone}</p>
                  </div>
                  {appointmentResult.remarks && (
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Remarks</p>
                      <p className="text-sm text-slate-700">{appointmentResult.remarks}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                  <Button className="bg-emerald-500 text-white hover:bg-emerald-600" onClick={closeAll} data-testid="presales-appointment-done">
                    <CheckCircle2 className="mr-1 h-4 w-4" /> Done
                  </Button>
                </div>
              </>
            ) : (
            <>
            <div className="space-y-4 p-5">
              <div className="space-y-3">
                {myBranchName ? (
                  <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    <Building2 className="h-3.5 w-3.5" /> {myBranchName}
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Select Branch *</label>
                    <select
                      value={appointmentDraft.branch_id || ""}
                      onChange={(e) => setAppointmentDraft({ ...appointmentDraft, branch_id: e.target.value })}
                      className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      data-testid="presales-appointment-branch"
                    >
                      <option value="">-- choose a branch --</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.branch_name || b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Date *</label>
                    <MilkDateInput
                      centered
                      title="Appointment Date"
                      accent="teal"
                      value={appointmentDraft.appointment_date}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setAppointmentDraft({ ...appointmentDraft, appointment_date: e.target.value })}
                      data-testid="presales-appointment-date"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Time *</label>
                    <MilkTimeInput
                      centered
                      title="Appointment Time"
                      accent="teal"
                      value={appointmentDraft.appointment_time}
                      onChange={(e) => setAppointmentDraft({ ...appointmentDraft, appointment_time: e.target.value })}
                      data-testid="presales-appointment-time"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">Remarks</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    placeholder="e.g. Lower back pain, 3 months"
                    value={appointmentDraft.remarks}
                    onChange={(e) => setAppointmentDraft({ ...appointmentDraft, remarks: e.target.value })}
                    data-testid="presales-appointment-remarks"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <Button variant="outline" onClick={closeAll} data-testid="presales-appointment-cancel">Cancel</Button>
              <Button
                className="bg-emerald-500 text-white hover:bg-emerald-600"
                onClick={async () => {
                  if (!myBranchName && !appointmentDraft.branch_id) {
                    toast.error("Please select a branch");
                    return;
                  }
                  if (!appointmentDraft.appointment_date || !appointmentDraft.appointment_time) {
                    toast.error("Pick a date and time");
                    return;
                  }
                  try {
                    const payload = {
                      department: appointmentDraft.department,
                      mode: "offline",
                      appointment_date: appointmentDraft.appointment_date,
                      appointment_time: appointmentDraft.appointment_time,
                      remarks: appointmentDraft.remarks,
                    };
                    // Sent explicitly when the board is pinned to a branch. Leaving it out
                    // lets the API infer the branch from whoever is logged in, which is
                    // right for a Branch Admin and wrong for a Super Admin drilled into a
                    // branch — they have none, and the appointment would land nowhere.
                    if (pinnedBranchId) payload.branch_id = pinnedBranchId;
                    else if (!myBranchName) payload.branch_id = appointmentDraft.branch_id;
                    const updated = await scheduleAppointment(currentLead.id, payload);
                    setCurrentLead(updated);
                    setAppointmentResult({
                      department: appointmentDraft.department,
                      branchName: resolvedBranchName(),
                      appointment_date: appointmentDraft.appointment_date,
                      appointment_time: appointmentDraft.appointment_time,
                      remarks: appointmentDraft.remarks,
                    });
                    onSaved && onSaved();
                  } catch (e) { toast.error(e?.response?.data?.detail || "Failed to schedule appointment"); }
                }}
                data-testid="presales-appointment-save"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Move to Branch Admin
              </Button>
            </div>
            </>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
};

const Section = ({ title, children }) => (
  <div className="rounded-lg border border-slate-200 p-3">
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <div className="space-y-1">{children}</div>
  </div>
);

const Row = ({ k, v }) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-slate-500">{k}</span>
    <span className="text-slate-800">{String(v)}</span>
  </div>
);

const TONE_MAP = {
  sky: { bar: "bg-sky-500", iconBg: "bg-sky-100 text-sky-600", title: "text-sky-700", border: "border-sky-100" },
  violet: { bar: "bg-violet-500", iconBg: "bg-violet-100 text-violet-600", title: "text-violet-700", border: "border-violet-100" },
  amber: { bar: "bg-amber-500", iconBg: "bg-amber-100 text-amber-700", title: "text-amber-700", border: "border-amber-100" },
  emerald: { bar: "bg-emerald-500", iconBg: "bg-emerald-100 text-emerald-700", title: "text-emerald-700", border: "border-emerald-100" },
};

// `collapsible` opts a section into an FAQ-style accordion (starts at `defaultOpen`,
// toggled by tapping the header) — plain ColorSection callers keep the original
// always-expanded card unchanged.
const ColorSection = ({ title, tone = "sky", icon, children, collapsible = false, defaultOpen = true }) => {
  const t = TONE_MAP[tone] || TONE_MAP.sky;
  const [open, setOpen] = useState(defaultOpen);
  const showContent = collapsible ? open : true;
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm ${t.border}`}>
      <div
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        className={`flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 ${collapsible ? "cursor-pointer select-none" : ""}`}
      >
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.iconBg}`}>{icon}</span>
        <p className={`flex-1 text-xs font-bold uppercase tracking-wider ${t.title}`}>{title}</p>
        {collapsible && (open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />)}
      </div>
      {showContent && <div className="space-y-2 px-4 py-3">{children}</div>}
    </div>
  );
};

const ColorRow = ({ k, v }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-xs font-medium text-slate-500">{k}</span>
    <span className="font-medium text-slate-800">{String(v)}</span>
  </div>
);

export default PreSalesCRM;
