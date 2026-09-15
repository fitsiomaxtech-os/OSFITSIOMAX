/**
 * Client Reviews — the stars and words clients give their Consultant and Physio from the
 * Client Portal's Feedback tab.
 *
 * One panel, mounted in two places: HR Admin (Super Admin and BDE, every branch, with a
 * branch filter) and the Branch Admin board (one branch, passed in as branchId). The
 * server decides the scope — a Branch Admin only ever gets their own branch back — so this
 * file never has to.
 *
 * See backend/routers/v3_client_reviews.py.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, MessageSquareQuote, RefreshCw, Search, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// The lower of the two ratings decides the bucket: a review that loves the consultant and
// gives the physio one star is a low review, because that is the half somebody must act on.
const worstOf = (r) => Math.min(r.consultant_rating || 5, r.physio_rating || 5);
const inBucket = (r, key) => {
  if (!key) return true;
  const w = worstOf(r);
  return key === "high" ? w >= 4 : key === "mid" ? w === 3 : w <= 2;
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

const RatedPerson = ({ role, name, rating, comment }) => (
  <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
    <div className="flex flex-wrap items-center justify-between gap-1">
      <p className="text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wide">{role}</span>
        {name ? <span className="text-slate-700"> · {name}</span> : null}
      </p>
      {rating ? <StarRow value={rating} /> : <span className="text-[11px] text-slate-400">Not rated</span>}
    </div>
    {comment && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{comment}</p>}
  </div>
);

export const ClientReviewsPanel = ({ branchId = null }) => {
  const [data, setData] = useState({ reviews: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  // Only offered where no branch was handed in — the HR Admin view across branches.
  const [branch, setBranch] = useState("");
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

  const reviews = useMemo(() => data.reviews || [], [data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews.filter((r) => inBucket(r, bucket) && (!q || [
      r.patient_name, r.consultant_name, r.physio_name, r.branch_name,
      r.summary, r.consultant_comment, r.physio_comment,
    ].some((v) => String(v || "").toLowerCase().includes(q))));
  }, [reviews, bucket, search]);

  const s = data.summary || {};

  const exportCsv = () => downloadCsv([
    ["Date", "Client", "Branch", "Consultant", "Consultant stars", "Consultant feedback", "Physio", "Physio stars", "Physio feedback", "Summary"],
    ...shown.map((r) => [
      prettyDate(r.updated_at || r.created_at), r.patient_name, r.branch_name,
      r.consultant_name, r.consultant_rating || "", r.consultant_comment,
      r.physio_name, r.physio_rating || "", r.physio_comment, r.summary,
    ]),
  ], "client-reviews.csv");

  return (
    <div className="space-y-4" data-testid="client-reviews-panel">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          {!branchId && (
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className={`h-9 max-w-[220px] rounded-md border px-2 text-sm font-medium ${branch ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}
              data-testid="client-reviews-branch"
            >
              <option value="">All Branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
            </select>
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
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, consultant, physio..." className="pl-9" data-testid="client-reviews-search" />
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
        <Figure label="Total Reviews" value={s.total ?? 0} tone="text-indigo-600" />
        <Figure label="Consultant Rating" value={s.consultant_average != null ? `${s.consultant_average} ★` : "—"} sub={`${s.consultant_count ?? 0} ratings`} tone="text-amber-500" />
        <Figure label="Physio Rating" value={s.physio_average != null ? `${s.physio_average} ★` : "—"} sub={`${s.physio_count ?? 0} ratings`} tone="text-amber-500" />
        <Figure label="Low Reviews" value={s.low ?? 0} sub="2 stars or under" tone="text-rose-600" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <PeopleCard title="Consultants" people={s.consultants || []} testid="client-reviews-consultants" />
        <PeopleCard title="Physiotherapists" people={s.physios || []} testid="client-reviews-physios" />
      </div>

      <p className="text-[11px] text-slate-400">
        Clients rate from the Client Portal&apos;s Feedback tab. Each client has one review and can change it; the date shows its latest version.
        Only Super Admin, BDE and Branch Admin can read these.
      </p>

      {loading && !reviews.length ? <p className="text-sm text-slate-500">Loading...</p> : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400" data-testid="client-reviews-empty">
          {reviews.length ? "No reviews match these filters." : "No client reviews yet."}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="client-reviews-list">
          {shown.map((r) => (
            <Card key={r.id} className={worstOf(r) <= 2 ? "border-rose-200" : ""} data-testid={`client-review-${r.id}`}>
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
                <RatedPerson role="Consultant" name={r.consultant_name} rating={r.consultant_rating} comment={r.consultant_comment} />
                <RatedPerson role="Physio work" name={r.physio_name} rating={r.physio_rating} comment={r.physio_comment} />
                {r.summary && (
                  <div className="flex gap-2 rounded-lg bg-indigo-50/60 p-2.5">
                    <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                    <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{r.summary}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClientReviewsPanel;
