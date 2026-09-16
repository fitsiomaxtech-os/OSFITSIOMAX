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
import { Building2, Check, ChevronDown, Download, MessageSquareQuote, RefreshCw, Search, Star, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { downloadCsv } from "@/lib/printable";
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

const STAR_FILTERS = [
  { key: "", label: "All ratings" },
  { key: "high", label: "4–5 stars" },
  { key: "mid", label: "3 stars" },
  { key: "low", label: "1–2 stars" },
];

const inBucket = (r, key) => {
  if (!key) return true;
  const w = r.rating || 0;
  return key === "high" ? w >= 4 : key === "mid" ? w === 3 : w <= 2;
};

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

const Figure = ({ label, value, sub, tone = "text-slate-800" }) => (
  <div className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5">
    <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
    <span className={`mt-0.5 block text-2xl font-extrabold ${tone}`}>{value}</span>
    {sub && <span className="block text-[10px] text-slate-400">{sub}</span>}
  </div>
);

const PeopleCard = ({ title, people, testid }) => (
  <Card data-testid={testid}>
    <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
    <CardContent className="space-y-1.5">
      {people.length === 0 ? (
        <p className="text-xs text-slate-400">No ratings yet.</p>
      ) : people.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5">
          <span className="truncate text-sm font-medium text-slate-700">{p.name}</span>
          <span className="flex shrink-0 items-center gap-2">
            <StarRow value={Math.round(p.average || 0)} size="h-3.5 w-3.5" />
            <span className="text-xs font-bold text-slate-700">{p.average}</span>
            <span className="text-[10px] text-slate-400">({p.count})</span>
          </span>
        </div>
      ))}
    </CardContent>
  </Card>
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

export const ClientReviewsPanel = ({ branchId = null }) => {
  const [data, setData] = useState({ consultant: [], physio: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  // Only offered where no branch was handed in — the HR Admin view across branches.
  const [branch, setBranch] = useState("");
  // Consultant Review is the tab a review of a consultant lands in, and the one that opens.
  const [kind, setKind] = useState("consultant");
  const [bucket, setBucket] = useState("");
  const [search, setSearch] = useState("");

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
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews.filter((r) => inBucket(r, bucket) && (!q || [
      r.patient_name, r.person_name, r.branch_name, r.comment,
    ].some((v) => String(v || "").toLowerCase().includes(q))));
  }, [reviews, bucket, search]);

  const s = (data.summary || {})[kind] || {};

  const exportCsv = () => downloadCsv([
    ["Date", "Client", "Branch", meta.person, "For", "Stars", "Review"],
    ...shown.map((r) => [
      prettyDate(r.updated_at || r.created_at), r.patient_name, r.branch_name, r.person_name,
      sessionLabel(r), r.rating || "", r.comment,
    ]),
  ], `${kind}-reviews.csv`);

  return (
    <div className="space-y-4" data-testid="client-reviews-panel">
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 sm:w-fit" data-testid="client-reviews-kind">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setKind(k.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition sm:flex-none ${kind === k.key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            data-testid={`client-reviews-kind-${k.key}`}
          >
            {k.label}
            <span className="ml-1.5 text-xs font-normal text-slate-400">{(data[k.key] || []).length}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          {!branchId && (
            <BranchFilter branches={branches} value={branch} onChange={setBranch} />
          )}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" data-testid="client-reviews-stars">
            {STAR_FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setBucket(f.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${bucket === f.key ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                data-testid={`client-reviews-stars-${f.key || "all"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search client, ${meta.person.toLowerCase()}...`} className="pl-9" data-testid="client-reviews-search" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="client-reviews-refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!shown.length} data-testid="client-reviews-csv">
              <Download className="h-4 w-4" />CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label={`${meta.label}s`} value={s.total ?? 0} tone="text-indigo-600" />
        <Figure label="Average Rating" value={s.average != null ? `${s.average} ★` : "—"} sub={`${s.total ?? 0} ratings`} tone="text-amber-500" />
        <Figure label="Low Reviews" value={s.low ?? 0} sub="2 stars or under" tone="text-rose-600" />
        <Figure label="Anytime" value={s.anytime ?? 0} sub="from the Feedback tab" tone="text-slate-600" />
      </div>

      <PeopleCard title={kind === "consultant" ? "Consultants" : "Physiotherapists"} people={s.people || []} testid={`client-reviews-${kind}-people`} />

      <p className="text-[11px] text-slate-400">
        {kind === "consultant"
          ? "Clients review their consultant from the Review button on each completed 7-day Review (optional), or any time from the Feedback tab."
          : "Clients must review every completed physio session from its Review button in Sessions, or any time from the Feedback tab."}
        {" "}Only Super Admin, BDE and Branch Admin can read these.
      </p>

      {loading && !reviews.length ? <p className="text-sm text-slate-500">Loading...</p> : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400" data-testid="client-reviews-empty">
          {reviews.length ? "No reviews match these filters." : `No ${meta.label.toLowerCase()}s yet.`}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="client-reviews-list">
          {shown.map((r) => (
            <Card key={r.id} className={(r.rating || 5) <= 2 ? "border-rose-200" : ""} data-testid={`client-review-${r.id}`}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">{r.patient_name || "Client"}</p>
                    <p className="truncate text-xs text-slate-400">
                      {[r.patient_number, r.branch_name].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-[11px] text-slate-400">
                    {prettyDate(r.updated_at || r.created_at)}
                    {r.updated_at && <span className="block text-[10px] font-semibold text-sky-600">Edited</span>}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <p className="text-xs text-slate-500">
                      <span className="font-semibold uppercase tracking-wide">{meta.person}</span>
                      {r.person_name ? <span className="text-slate-700"> · {r.person_name}</span> : null}
                      {sessionLabel(r) ? <span> · {sessionLabel(r)}{(r.session_date || r.review_date) ? ` (${prettyDate(r.session_date || r.review_date)})` : ""}</span> : null}
                    </p>
                    <StarRow value={r.rating} />
                  </div>
                  {r.comment && (
                    <div className="mt-1.5 flex gap-2">
                      <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                      <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{r.comment}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClientReviewsPanel;
