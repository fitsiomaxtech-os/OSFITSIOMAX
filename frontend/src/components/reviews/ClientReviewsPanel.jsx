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
import { Building2, Check, ChevronDown, ChevronRight, Clock, MessageSquareQuote, RefreshCw, Search, Star, ThumbsDown, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const SOURCE_LABEL = { session: "After a session", review: "After a 7-day Review", anytime: "Anytime (Feedback tab)" };

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

export const ClientReviewsPanel = ({ branchId = null }) => {
  const [data, setData] = useState({ consultant: [], physio: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  // Only offered where no branch was handed in — the HR Admin view across branches.
  const [branch, setBranch] = useState("");
  // Consultant Review is the tab a review of a consultant lands in, and the one that opens.
  const [kind, setKind] = useState("consultant");
  // The star bucket is set from the star pills and from the Average / Low tiles alike, so
  // the two always agree; Anytime and a person are narrower filters laid on top of it.
  const [bucket, setBucket] = useState("");
  const [anytimeOnly, setAnytimeOnly] = useState(false);
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
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

  // The tiles and the people card count what the branch and search leave, but not the tile
  // filters themselves: a tile that zeroes the other three when pressed leaves nothing to
  // press next. They used to show the server's summary, which ignored every filter here.
  const base = useMemo(() => reviews.filter((r) => matchesSearch(r, q)), [reviews, q]);
  const inPerson = useMemo(() => (person ? base.filter((r) => (r.person_name || "") === person) : base), [base, person]);
  const shown = useMemo(
    () => inPerson.filter((r) => inBucket(r, bucket) && (!anytimeOnly || r.source === "anytime")),
    [inPerson, bucket, anytimeOnly],
  );

  const figures = useMemo(() => ({
    total: inPerson.length,
    average: average(inPerson),
    high: inPerson.filter((r) => (r.rating || 0) >= 4).length,
    low: inPerson.filter((r) => r.rating && r.rating <= 2).length,
    anytime: inPerson.filter((r) => r.source === "anytime").length,
  }), [inPerson]);

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

  const filtered = Boolean(bucket || anytimeOnly || person || q);
  const clearFilters = () => { setBucket(""); setAnytimeOnly(false); setPerson(""); setSearch(""); };
  // Consultants and physios are different people, so a chosen name does not carry across.
  const switchKind = (key) => { setKind(key); setPerson(""); };
  const toggleBucket = (key) => setBucket((b) => (b === key ? "" : key));

  return (
    <div className="space-y-4" data-testid="client-reviews-panel">
      {/* One bar, in the order it is read: which reviews, where, how many stars, who. */}
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
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" data-testid="client-reviews-stars">
            {STAR_FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setBucket(f.key)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${bucket === f.key ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                data-testid={`client-reviews-stars-${f.key || "all"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search client, ${meta.person.toLowerCase()}...`} className="h-9 pl-9" data-testid="client-reviews-search" />
          </div>
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
        <StatTile
          label={`${meta.label}s`}
          value={figures.total}
          sub={bucket || anytimeOnly ? "Tap to show all" : "Every review"}
          icon={MessageSquareQuote}
          color="#4f46e5"
          active={!bucket && !anytimeOnly}
          onClick={() => { setBucket(""); setAnytimeOnly(false); }}
          testid="client-reviews-tile-total"
        />
        <StatTile
          label="Average Rating"
          value={figures.average != null ? `${figures.average} ★` : "—"}
          sub={`${figures.high} rated 4–5 stars`}
          icon={Star}
          color="#f59e0b"
          active={bucket === "high"}
          onClick={() => toggleBucket("high")}
          testid="client-reviews-tile-average"
        />
        <StatTile
          label="Low Reviews"
          value={figures.low}
          sub="2 stars or under"
          icon={ThumbsDown}
          color="#e11d48"
          active={bucket === "low"}
          onClick={() => toggleBucket("low")}
          testid="client-reviews-tile-low"
        />
        <StatTile
          label="Anytime"
          value={figures.anytime}
          sub="From the Feedback tab"
          icon={Clock}
          color="#0284c7"
          active={anytimeOnly}
          onClick={() => setAnytimeOnly((v) => !v)}
          testid="client-reviews-tile-anytime"
        />
      </div>

      <Card data-testid={`client-reviews-${kind}-people`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">{kind === "consultant" ? "Consultants" : "Physiotherapists"}</CardTitle>
          {person && (
            <button type="button" onClick={() => setPerson("")} className="text-xs font-semibold text-indigo-600 hover:underline">Show all</button>
          )}
        </CardHeader>
        <CardContent className="grid gap-1.5 sm:grid-cols-2">
          {people.length === 0 ? (
            <p className="text-xs text-slate-400">No ratings yet.</p>
          ) : people.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setPerson((cur) => (cur === p.name ? "" : p.name))}
              className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition ${person === p.name ? "border-indigo-300 bg-indigo-50" : "border-transparent bg-slate-50 hover:bg-slate-100"}`}
              data-testid={`client-reviews-person-${p.name}`}
            >
              <span className={`truncate text-sm font-medium ${person === p.name ? "text-indigo-700" : "text-slate-700"}`}>{p.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <StarRow value={Math.round(p.average || 0)} size="h-3.5 w-3.5" />
                <span className="text-xs font-bold text-slate-700">{p.average ?? "—"}</span>
                <span className="text-[10px] text-slate-400">({p.count})</span>
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card data-testid="client-reviews-list-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <p className="text-sm font-semibold text-slate-700">
            Reviews <span className="ml-1 font-normal text-slate-400">{shown.length} of {reviews.length}</span>
          </p>
          {filtered && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800" data-testid="client-reviews-clear">
              <X className="h-3.5 w-3.5" />Clear filters
            </button>
          )}
        </div>

        {loading && !reviews.length ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400" data-testid="client-reviews-empty">
            {reviews.length ? "No reviews match these filters." : `No ${meta.label.toLowerCase()}s yet.`}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="client-reviews-list">
            {shown.map((r) => {
              const w = r.rating || 0;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(r)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                    data-testid={`client-review-${r.id}`}
                  >
                    <span className={`h-9 w-1 shrink-0 rounded-full ${w >= 4 ? "bg-emerald-400" : w === 3 ? "bg-amber-300" : "bg-rose-400"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-semibold text-slate-800">{r.patient_name || "Client"}</span>
                        <span className="hidden truncate text-xs text-slate-400 sm:inline">{[r.patient_number, r.branch_name].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {[r.person_name, sessionLabel(r)].filter(Boolean).join(" · ")}
                        {r.comment && <span className="text-slate-400"> — {r.comment}</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <StarRow value={r.rating} size="h-3.5 w-3.5" />
                      <span className="text-[11px] text-slate-400">{prettyDate(r.updated_at || r.created_at)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-[11px] text-slate-400">
        {kind === "consultant"
          ? "Clients review their consultant from the Review button on each completed 7-day Review (optional), or any time from the Feedback tab."
          : "Clients must review every completed physio session from its Review button in Sessions, or any time from the Feedback tab."}
        {" "}Only Super Admin, BDE and Branch Admin can read these.
      </p>

      <ReviewDetail review={open} meta={meta} onClose={() => setOpen(null)} />
    </div>
  );
};

export default ClientReviewsPanel;
