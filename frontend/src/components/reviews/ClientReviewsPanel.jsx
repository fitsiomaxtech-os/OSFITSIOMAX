/**
 * Client Reviews — the stars and words clients give from the Client Portal, in two tabs:
 * Consultant Review (the default tab: from each completed 7-day Review, optional) and Physio
 * Review (from each completed session, required). Both also take anytime reviews.
 *
 * One panel, mounted in two places: HR Admin (Super Admin and BDE, every branch, with a
 * branch filter) and the Branch Admin board (one branch, passed in as branchId). The
 * server decides the scope — a Branch Admin only ever gets their own branch back — so this
 * file never has to.
 *
 * See backend/routers/v3_client_reviews.py.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Building2, UserRound, CalendarCheck, Check, ChevronDown, ChevronRight, Clock, MessageSquareQuote, RefreshCw, Search, Star, X } from "lucide-react";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { toast } from "@/components/ui/sonner";
import { getBranches, getClientReviews } from "@/lib/api";

const prettyDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/** Five stars, filled to `value`. Read-only. */
export const StarRow = ({ value, size = "h-4 w-4" }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={value ? `${value} out of 5 stars` : "Not rated"}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} className={`${size} ${value && n <= value ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
    ))}
  </span>
);

// The date pills in the bar. "All" is null, the same as a cleared Date Filter; anything
// else is the { key, label, from, to } the Date Filter itself hands back, so the pills and
// its dialog share one piece of state. The week runs Monday to Sunday, as on the Zumba board.
const startOfDay = (d) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const endOfDay = (d) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };
const shiftDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const DATE_PRESETS = [
  { key: "all", label: "All", range: () => null },
  { key: "today", label: "Today", range: (t) => ({ from: startOfDay(t), to: endOfDay(t) }) },
  { key: "yesterday", label: "Yesterday", range: (t) => ({ from: startOfDay(shiftDays(t, -1)), to: endOfDay(shiftDays(t, -1)) }) },
  { key: "this_week", label: "This Week", range: (t) => { const m = shiftDays(startOfDay(t), -((t.getDay() + 6) % 7)); return { from: m, to: endOfDay(shiftDays(m, 6)) }; } },
  { key: "this_month", label: "This Month", range: (t) => ({ from: new Date(t.getFullYear(), t.getMonth(), 1), to: endOfDay(new Date(t.getFullYear(), t.getMonth() + 1, 0)) }) },
  { key: "last_month", label: "Last Month", range: (t) => ({ from: new Date(t.getFullYear(), t.getMonth() - 1, 1), to: endOfDay(new Date(t.getFullYear(), t.getMonth(), 0)) }) },
];
const presetFilter = (p) => { const r = p.range(new Date()); return r ? { key: p.key, label: p.label, ...r } : null; };
// Keys the Date Filter dialog also uses (today, this_month...) count as pills only when the
// pill row has one, so a dialog pick lights its pill rather than the calendar button.
const presetKey = (f) => (!f ? "all" : DATE_PRESETS.some((p) => p.key === f.key) ? f.key : null);

const KINDS = [
  { key: "consultant", label: "Consultant Review", person: "Consultant" },
  { key: "physio", label: "Physio Review", person: "Physio" },
];

const ORDINAL = ["", "1st", "2nd", "3rd"];
// What prompted the review: a session day, a completed 7-day Review, or the Feedback tab.
const sessionLabel = (r) => {
  if (r.source === "anytime") return "Anytime";
  if (r.review_number != null) return `${ORDINAL[r.review_number] || `${r.review_number}th`} Review`;
  if (r.session_number != null) return `${r.track === "rehab" ? "Rehab Day" : "Session"} ${r.session_number}`;
  return "";
};

const SOURCE_LABEL = { session: "After a session day", review: "After a 7-day Review", anytime: "Anytime (Feedback tab)" };

const matchesSearch = (r, q) => !q || [
  r.patient_name, r.patient_number, r.person_name, r.branch_name, r.comment,
].some((v) => String(v || "").toLowerCase().includes(q));

const average = (rows) => {
  const rated = rows.filter((r) => r.rating);
  return rated.length ? Math.round((rated.reduce((n, r) => n + r.rating, 0) / rated.length) * 10) / 10 : null;
};

const DetailField = ({ label, children, wide = false }) => (
  <div className={wide ? "col-span-2" : ""}>
    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="font-medium text-slate-800">{children}</dd>
  </div>
);

/** Everything one review holds, opened from its row in the list. */
const ReviewDetail = ({ review: r, meta, onClose }) => (
  <Dialog open={!!r} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent className="max-w-lg" data-testid="client-review-detail">
      {r && (
        <>
          <DialogHeader>
            <DialogTitle className="text-lg">{r.patient_name || "Client"}</DialogTitle>
            <DialogDescription>
              {[r.patient_number, r.branch_name].filter(Boolean).join(" · ") || meta.label}
            </DialogDescription>
          </DialogHeader>

          <div className={`flex items-center justify-between rounded-xl border p-3 ${r.rating && r.rating <= 2 ? "border-rose-200 bg-rose-50/60" : "border-amber-100 bg-amber-50/50"}`}>
            <StarRow value={r.rating} size="h-6 w-6" />
            <span className="text-2xl font-extrabold text-slate-800">
              {r.rating || "—"}<span className="text-sm font-semibold text-slate-400"> / 5</span>
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <DetailField label={meta.person}>{r.person_name || "—"}</DetailField>
            <DetailField label="For">
              {sessionLabel(r) || "—"}
              {(r.session_date || r.review_date) && (
                <span className="block text-xs font-normal text-slate-500">{prettyDate(r.session_date || r.review_date)}</span>
              )}
            </DetailField>
            <DetailField label="Given">{SOURCE_LABEL[r.source] || "—"}</DetailField>
            <DetailField label="Submitted">
              {prettyDate(r.created_at) || "—"}
              {r.updated_at && <span className="block text-xs font-normal text-sky-600">Edited {prettyDate(r.updated_at)}</span>}
            </DetailField>
            {r.patient_phone && <DetailField label="Phone" wide>{r.patient_phone}</DetailField>}
          </dl>

          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Review</p>
            {r.comment ? (
              <div className="flex gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm text-slate-700">{r.comment}</p>
              </div>
            ) : <p className="text-sm text-slate-400">Stars only, no written review.</p>}
          </div>
        </>
      )}
    </DialogContent>
  </Dialog>
);

/**
 * The branch picker, drawn the way the Date Filter is: an outline trigger that turns sky
 * when a branch is chosen (with an × to clear it), and a white popover list with the chosen
 * row in sky and ticked. A native <select> opened the browser's own grey menu, which looked
 * like it belonged to another application.
 */
const BranchFilter = ({ branches, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sorted = useMemo(
    () => [...branches].sort((a, b) => String(a.branch_name || "").localeCompare(String(b.branch_name || ""))),
    [branches],
  );
  const q = query.trim().toLowerCase();
  const listed = q ? sorted.filter((b) => String(b.branch_name || "").toLowerCase().includes(q)) : sorted;
  const current = branches.find((b) => b.id === value);
  const active = Boolean(value);
  const pick = (id) => { onChange(id); setOpen(false); setQuery(""); };

  const row = (selected) => `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
    selected ? "bg-sky-100 font-semibold text-sky-700" : "text-slate-700 hover:bg-slate-100"
  }`;

  return (
    <div className="inline-flex items-center">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={`h-9 max-w-[240px] justify-between gap-2 ${active ? "rounded-r-none border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100" : "text-slate-600"}`}
            data-testid="client-reviews-branch"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{current?.branch_name || (active ? "Selected branch" : "All Branches")}</span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0" data-testid="client-reviews-branch-panel">
          <div className="border-b border-slate-200 bg-slate-50/40 p-2">
            <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Filter by Branch</p>
            {sorted.length > 6 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search branch..."
                  className="h-8 pl-8 text-sm"
                  data-testid="client-reviews-branch-search"
                />
              </div>
            )}
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
            {!q && (
              <button type="button" onClick={() => pick("")} className={row(!active)} data-testid="client-reviews-branch-all">
                <span className="truncate">All Branches</span>
                {!active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )}
            {listed.map((b) => (
              <button key={b.id} type="button" onClick={() => pick(b.id)} className={row(b.id === value)} data-testid={`client-reviews-branch-${b.id}`}>
                <span className="truncate">{b.branch_name}</span>
                {b.id === value && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
            {listed.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-400">
                {sorted.length ? "No branch matches." : "No branches found."}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {active && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear branch filter"
          className="flex h-9 items-center rounded-r-md border border-l-0 border-sky-300 bg-sky-50 px-2 text-sky-700 hover:bg-sky-100"
          data-testid="client-reviews-branch-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

/**
 * The consultant or physio picker: the Branch picker's look, listing every person reviewed
 * under the bar's other filters with their average and review count, best rated first.
 * Picking one narrows the tiles and the list to that person.
 */
const PersonFilter = ({ people, value, onChange, meta }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const listed = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  const active = Boolean(value);
  const plural = meta.key === "consultant" ? "Consultants" : "Physios";
  const pick = (name) => { onChange(name); setOpen(false); setQuery(""); };

  const row = (selected) => `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
    selected ? "bg-sky-100 font-semibold text-sky-700" : "text-slate-700 hover:bg-slate-100"
  }`;

  return (
    <div className="inline-flex items-center">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={`h-9 max-w-[240px] justify-between gap-2 ${active ? "rounded-r-none border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100" : "text-slate-600"}`}
            data-testid="client-reviews-person"
          >
            <span className="flex min-w-0 items-center gap-2">
              <UserRound className="h-4 w-4 shrink-0" />
              <span className="truncate">{value || `All ${plural}`}</span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0" data-testid="client-reviews-person-panel">
          <div className="border-b border-slate-200 bg-slate-50/40 p-2">
            <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Filter by {meta.person}</p>
            {people.length > 6 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${meta.person.toLowerCase()}...`}
                  className="h-8 pl-8 text-sm"
                  data-testid="client-reviews-person-search"
                />
              </div>
            )}
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
            {!q && (
              <button type="button" onClick={() => pick("")} className={row(!active)} data-testid="client-reviews-person-all">
                <span className="truncate">All {plural}</span>
                {!active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )}
            {listed.map((p) => (
              <button key={p.name} type="button" onClick={() => pick(p.name)} className={row(p.name === value)} data-testid={`client-reviews-person-${p.name}`}>
                <span className="truncate">{p.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  <span className="text-xs font-bold">{p.average ?? "—"}</span>
                  <span className="text-[10px] font-normal text-slate-400">({p.count})</span>
                  {p.name === value && <Check className="h-4 w-4" />}
                </span>
              </button>
            ))}
            {listed.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-400">
                {people.length ? `No ${meta.person.toLowerCase()} matches.` : "No ratings yet."}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {active && (
        <button
          type="button"
          onClick={() => onChange("")}
          title={`Clear ${meta.person.toLowerCase()} filter`}
          className="flex h-9 items-center rounded-r-md border border-l-0 border-sky-300 bg-sky-50 px-2 text-sky-700 hover:bg-sky-100"
          data-testid="client-reviews-person-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

// What a review was given for, as the pill in the Type column.
const TYPE_PILL = {
  review: { label: "7-day Review", color: "#059669" },
  session: { label: "Session", color: "#0284c7" },
  rehab: { label: "Rehab", color: "#7c3aed" },
  anytime: { label: "Anytime", color: "#64748b" },
};
const typeOf = (r) => (r.source === "session" && r.track === "rehab" ? "rehab" : r.source);

const TypePill = ({ review }) => {
  const t = TYPE_PILL[typeOf(review)];
  if (!t) return <span className="text-slate-400">—</span>;
  return (
    <span
      className="inline-flex shrink-0 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold"
      style={{ color: t.color, borderColor: `${t.color}55`, backgroundColor: `${t.color}14` }}
    >
      {t.label}
    </span>
  );
};

/**
 * The tiles over the list, per kind. Each one is also the list's filter by where the review
 * came from; `rated` is every review carrying stars, which is every review there is, and
 * reads as the average rather than a count.
 */
const TILES = {
  consultant: [
    { key: "", label: "All", figure: "total", sub: () => "Every consultant review", icon: MessageSquareQuote, color: "#4f46e5" },
    { key: "rated", label: "Consultation Review", figure: "average", sub: (f) => `${f.rated} ratings · 7-day + anytime`, icon: Star, color: "#f59e0b" },
    { key: "review", label: "7 Days Review", figure: "review", sub: (f) => `Avg ${f.reviewAvg ?? "—"} ★ · from a 7-day Review`, icon: CalendarCheck, color: "#059669" },
    { key: "anytime", label: "Anytime", figure: "anytime", sub: () => "From the Feedback tab", icon: Clock, color: "#0284c7" },
  ],
  physio: [
    { key: "", label: "All", figure: "total", sub: () => "Every physio review", icon: MessageSquareQuote, color: "#4f46e5" },
    { key: "session", label: "Session Review", figure: "session", sub: () => "Every treatment and rehab day", icon: Activity, color: "#059669" },
    { key: "rated", label: "Average Rating", figure: "average", sub: (f) => `${f.rated} ratings`, icon: Star, color: "#f59e0b" },
    { key: "anytime", label: "Anytime", figure: "anytime", sub: () => "From the Feedback tab", icon: Clock, color: "#0284c7" },
  ],
};

const inSource = (r, key) => !key || (key === "rated" ? !!r.rating : r.source === key);

const inDates = (r, range) => {
  if (!range?.from || !range?.to) return true;
  const d = new Date(r.created_at || r.updated_at || "");
  return !Number.isNaN(d.getTime()) && d >= range.from && d <= range.to;
};

/** Table from tablet up, the same rows as cards on a phone — the shape of the HR candidate list. */
const ReviewList = ({ rows, meta, loading, empty, onOpen }) => {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-14 text-center text-sm text-slate-400" data-testid="client-reviews-empty">
        {loading ? "Loading reviews..." : empty}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2 sm:hidden" data-testid="client-reviews-list-mobile">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r)}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left"
            data-testid={`client-review-card-${r.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-800">{r.patient_name || "Client"}</p>
                <p className="truncate text-xs text-slate-500">{r.person_name || `${meta.person} not set`}</p>
              </div>
              <TypePill review={r} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StarRow value={r.rating} size="h-3.5 w-3.5" />
              <span className="text-[11px] text-slate-400">{prettyDate(r.created_at || r.updated_at)}</span>
            </div>
            {r.comment && <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{r.comment}</p>}
          </button>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block" data-testid="client-reviews-list">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">{meta.person}</th>
                <th className="px-4 py-2.5 font-semibold">For</th>
                <th className="px-4 py-2.5 font-semibold">Rating</th>
                <th className="px-4 py-2.5 font-semibold">Review</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-slate-50" data-testid={`client-review-${r.id}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{r.patient_name || "Client"}</p>
                    <p className="text-[11px] text-slate-400">{r.patient_number || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.person_name || "—"}
                    {r.branch_name ? <span className="block text-[11px] text-slate-400">{r.branch_name}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {sessionLabel(r) || "—"}
                    {(r.session_date || r.review_date) ? <span className="block text-[11px] text-slate-400">{prettyDate(r.session_date || r.review_date)}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StarRow value={r.rating} size="h-3.5 w-3.5" />
                    <span className={`block text-[11px] font-bold ${(r.rating || 0) <= 2 ? "text-red-500" : r.rating === 3 ? "text-amber-500" : "text-slate-400"}`}>
                      {r.rating ? `${r.rating} / 5` : "Not rated"}
                    </span>
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-slate-600">
                    <p className="truncate">{r.comment || <span className="text-slate-400">—</span>}</p>
                  </td>
                  <td className="px-4 py-3"><TypePill review={r} /></td>
                  <td className="px-4 py-3 text-slate-500">
                    <span className="whitespace-nowrap">{prettyDate(r.created_at || r.updated_at) || "—"}</span>
                    {r.updated_at ? <span className="block text-[11px] font-semibold text-sky-600">Edited</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-slate-300" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export const ClientReviewsPanel = ({ branchId = null }) => {
  const [data, setData] = useState({ consultant: [], physio: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  // Only offered where no branch was handed in — the HR Admin view across branches.
  const [branch, setBranch] = useState("");
  // Consultant Review is the tab a review of a consultant lands in, and the one that opens.
  const [kind, setKind] = useState("consultant");
  // Set only by the tiles: where the review came from (see TILES).
  const [source, setSource] = useState("");
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(null);
  const [open, setOpen] = useState(null);

  const scope = branchId || branch || null;

  const load = useCallback(() => {
    setLoading(true);
    return getClientReviews(scope)
      .then(setData)
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not load client reviews"))
      .finally(() => setLoading(false));
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (branchId) return;
    getBranches().then((rows) => setBranches(rows || [])).catch(() => {});
  }, [branchId]);

  const meta = KINDS.find((k) => k.key === kind);
  const reviews = useMemo(() => data[kind] || [], [data, kind]);
  const q = search.trim().toLowerCase();

  // The tiles and the person picker count what the bar leaves (branch, search, date),
  // but not the tile filter itself: a tile that zeroes the other three when pressed leaves
  // nothing to press next.
  const base = useMemo(
    () => reviews.filter((r) => matchesSearch(r, q) && inDates(r, dateFilter)),
    [reviews, q, dateFilter],
  );
  const inPerson = useMemo(() => (person ? base.filter((r) => (r.person_name || "") === person) : base), [base, person]);
  const shown = useMemo(() => inPerson.filter((r) => inSource(r, source)), [inPerson, source]);

  const figures = useMemo(() => {
    const from = (key) => inPerson.filter((r) => inSource(r, key));
    return {
      total: inPerson.length,
      average: average(inPerson),
      rated: from("rated").length,
      review: from("review").length,
      reviewAvg: average(from("review")),
      session: from("session").length,
      anytime: from("anytime").length,
    };
  }, [inPerson]);

  const people = useMemo(() => {
    const by = {};
    base.forEach((r) => {
      if (!r.person_name) return;
      if (!by[r.person_name]) by[r.person_name] = [];
      by[r.person_name].push(r);
    });
    return Object.entries(by)
      .map(([name, rows]) => ({ name, count: rows.length, average: average(rows) }))
      .sort((a, b) => (b.average || 0) - (a.average || 0) || b.count - a.count || a.name.localeCompare(b.name));
  }, [base]);

  const filtered = Boolean(source || person || q || dateFilter);
  const clearFilters = () => { setSource(""); setPerson(""); setSearch(""); setDateFilter(null); };
  // Consultants and physios are different people with different tiles, so neither carries across.
  const switchKind = (key) => { setKind(key); setPerson(""); setSource(""); };

  return (
    <div className="space-y-4" data-testid="client-reviews-panel">
      {/* One bar, in the order it is read: which reviews, where, how many stars, who, when. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-2.5">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" data-testid="client-reviews-kind">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => switchKind(k.key)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition ${kind === k.key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                data-testid={`client-reviews-kind-${k.key}`}
              >
                {k.label}
                <span className="ml-1.5 text-xs font-normal text-slate-400">{(data[k.key] || []).length}</span>
              </button>
            ))}
          </div>
          {!branchId && (
            <BranchFilter branches={branches} value={branch} onChange={setBranch} />
          )}
          <PersonFilter people={people} value={person} onChange={setPerson} meta={meta} />
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search client, ${meta.person.toLowerCase()}...`} className="h-9 pl-9" data-testid="client-reviews-search" />
          </div>
          {/* Filters on the day the review was given. */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" data-testid="client-reviews-dates">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setDateFilter(presetFilter(p))}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${presetKey(dateFilter) === p.key ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                data-testid={`client-reviews-date-${p.key}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* The shared Date Filter, as the calendar icon for an exact day or a range. Handed
              null while a pill is lit so it does not echo the pill beside it, and pinned to
              the bar's height from out here rather than by a prop other boards share. */}
          <span className="[&>div>button]:h-9 [&>div>button:first-child]:min-w-9">
            <DateFilterPopover
              value={presetKey(dateFilter) ? null : dateFilter}
              onChange={setDateFilter}
              centered
              iconOnly
              testid="client-reviews-date"
            />
          </span>
          <Button
            onClick={load}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-9 w-9 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
            data-testid="client-reviews-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES[kind].map((t) => (
          <StatTile
            key={t.key || "all"}
            label={t.label}
            value={t.figure === "average" ? (figures.average != null ? `${figures.average} ★` : "—") : figures[t.figure]}
            sub={t.sub(figures)}
            icon={t.icon}
            color={t.color}
            active={source === t.key}
            onClick={() => setSource((cur) => (cur === t.key ? "" : t.key))}
            testid={`client-reviews-tile-${t.key || "all"}`}
          />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-sm font-semibold text-slate-700">
            Reviews <span className="ml-1 font-normal text-slate-400">{shown.length} of {reviews.length}</span>
          </p>
          {filtered && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800" data-testid="client-reviews-clear">
              <X className="h-3.5 w-3.5" />Clear filters
            </button>
          )}
        </div>
        <ReviewList
          rows={shown}
          meta={meta}
          loading={loading && !reviews.length}
          empty={reviews.length ? "No reviews match these filters." : `No ${meta.label.toLowerCase()}s yet.`}
          onOpen={setOpen}
        />
      </div>

      <p className="text-[11px] text-slate-400">
        {kind === "consultant"
          ? "Clients review their consultant from the Review button on each completed 7-day Review (optional), or any time from the Feedback tab."
          : "Clients must review every completed physio session, treatment or rehab, from its Review button in Sessions, or any time from the Feedback tab."}
        {" "}Only Super Admin, BDE and Branch Admin can read these.
      </p>

      <ReviewDetail review={open} meta={meta} onClose={() => setOpen(null)} />
    </div>
  );
};

export default ClientReviewsPanel;
