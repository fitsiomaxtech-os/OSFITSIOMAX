import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Music, Pencil, RefreshCw, Stethoscope, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { toast } from "@/components/ui/sonner";
import { listZumba, listZumbaMasters, addZumba, updateZumba, deleteZumba, moveZumbaStage } from "@/lib/api";

// How a registration arrived, as the branch would say it. A referral is recorded against
// the master who made it rather than against a single "Masters" bucket, so these six are
// the answers that stand on their own; the masters are offered alongside them by name.
//
// Board, Social Media and Personal all count towards Direct: nobody referred them, they
// came to us. The rest name whoever did the referring. The mapping lives on the server,
// which stamps each row with its card so this list and the counts cannot disagree.
const SOURCES = [
  { key: "board", label: "Board" },
  { key: "consultations", label: "Consultations" },
  { key: "branch", label: "Branch" },
  { key: "social_media", label: "Social Media" },
  { key: "personal", label: "Personal" },
  { key: "fitsiomax", label: "Fitsiomax" },
];
const MASTER = "master";
const sourceLabel = (r) => (
  r.source === MASTER
    ? (r.master_name || "Master")
    : (SOURCES.find((s) => s.key === r.source) || { label: "Personal" }).label
);

// The strip, in the order asked for. Styled like the Human Resource board's stage cards:
// a white card each, the name in its own colour above the count, and the selected one
// picked out by taking that colour into its border and a wash of it behind.
//
// The tinted boxes that used to group these are gone with the style. They were doing the
// work the colours now do, and a group box inside a row of cards that each carry their own
// colour reads as two systems arguing about the same thing.
//
// The colours run warm through the sources and cool through the three that follow, so the
// old grouping is still legible without drawing a box around it.
const CARDS = [
  { key: "all", label: "All", color: "#a855f7" },
  { key: "direct", label: "Direct", color: "#f59e0b" },
  { key: "consultant", label: "Consultant", color: "#f97316" },
  // Master is the leads a master brought in — a referral filed against a named master,
  // which is what the Zumba Master View's Refer Customer writes and what this card is
  // asked for. It held the branch-sourced count until that board existed and there was a
  // real master's referral to point it at.
  { key: "masters", label: "Refer Master", color: "#d97706" },
  // The last three are money, not counts: what the students paid, and how it splits. They
  // read as one figure and two halves of it, which is why they sit together at the end of
  // the row after the four that count people.
  //
  // Only Total Fees filters — it has rows behind it, the ones that have paid. The two
  // shares are the same money seen twice, so there is no subset of the list they could
  // narrow to and they are not clickable.
  { key: "total_fees", label: "Total Fees", color: "#059669", money: true },
  { key: "master_revenue", label: "Master's Revenue", color: "#10b981", money: true, derived: true },
  { key: "fitsiomax_revenue", label: "Fitsiomax Revenue", color: "#14b8a6", money: true, derived: true },
];

/** The colour Super Admin gave a stage in CI/CD ROOTS, or a neutral slate for one that
    no longer exists. Read off the pipeline rather than kept here, so a colour changed
    there changes here without a deploy. */
const stageColor = (stages, name) => (stages.find((st) => st.name === name) || {}).color || "#64748b";

// The two cards that are a share of the fee rather than a set of rows. Read by the filter
// so a stale `card` value can never narrow the list to nothing.
const DERIVED_CARDS = new Set(["master_revenue", "fitsiomax_revenue"]);

/** The Human Resource board's stage card, in the one other place that wants it.
 *
 * Copied rather than imported: that one is local to HumanResourceBoard.jsx and shaped for
 * a five-across phone row of nine stages, where this row holds seven. Lifting it into
 * components/ui to share would make both boards answer to one file for a look they only
 * happen to agree on today. */
const SummaryCard = ({ label, count, color, active, onClick, testid, readOnly = false }) => (
  <button
    type="button"
    onClick={readOnly ? undefined : onClick}
    // A card with nothing to filter to is still a card, but it must not offer the click:
    // no hover lift, no pointer, and the keyboard skips it rather than landing on a
    // control that does nothing.
    disabled={readOnly}
    tabIndex={readOnly ? -1 : undefined}
    className={`min-w-0 flex-1 rounded-lg border-2 px-1 py-1.5 text-center transition sm:rounded-xl sm:px-2.5 sm:py-2.5 sm:text-left ${
      readOnly ? "cursor-default" : "hover:shadow-sm"
    } ${
      active ? "shadow-sm" : "border-slate-200 bg-white"
    }`}
    style={active ? { borderColor: color, backgroundColor: `${color}14` } : undefined}
    data-testid={testid}
  >
    {/* Wraps rather than truncates on a phone: "Fee's Collected" and "Fee's Collect…" are
        the same width and only one of them can be read. */}
    <span
      className="block break-words text-[9px] font-bold uppercase leading-[1.15] [hyphens:auto] sm:truncate sm:text-xs sm:tracking-wider"
      style={{ color }}
      title={label}
    >
      {label}
    </span>
    {/* Sized for nine across, not the five this card was borrowed from: a rupee figure
        at 3xl set the width of every card in the row and pushed the labels to an
        ellipsis two words early. */}
    <span className="mt-0.5 block text-base font-extrabold leading-tight sm:mt-0.5 sm:text-xl" style={{ color }}>
      {count}
    </span>
  </button>
);

const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** "06 Aug 2026" off the stored ISO timestamp; a dash rather than "Invalid Date". */
const shortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** The stored timestamp as a plain YYYY-MM-DD, which is what the date inputs compare. */
const dayOf = (iso) => String(iso || "").slice(0, 10);

const EMPTY = { name: "", phone: "", age: "", address: "", source: "personal", master_name: "", assigned_master_id: "", fee_amount: "", fee_paid: "" };

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
  const [showDates, setShowDates] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [form, setForm] = useState(null); // null | { ...fields, id? }
  const [newMaster, setNewMaster] = useState(""); // a master not yet on the list
  // The Zumba accounts at this branch, which is what a student is assigned *to*. Not
  // the same list as `masters` above: that one is names typed onto referrals, and a
  // referral name with no account behind it cannot be given a class.
  const [zumbaMasters, setZumbaMasters] = useState([]);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  // The Zumba pipeline exactly as Super Admin has it in CI/CD ROOTS. Nothing is hardcoded
  // here: a clinic that has not set the pipeline up has no stages and gets no stage bar.
  const [stages, setStages] = useState([]);
  const [stageFilter, setStageFilter] = useState(null);
  const [movingId, setMovingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listZumba(branchId);
      setRows(data.registrations || []);
      setSummary(data.summary || {});
      setMasters(data.masters || []);
      setStages(data.stages || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load Zumba registrations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  // Loaded apart from the registrations: the roster does not change when a row does, and a
  // branch with no Zumba accounts should still get its board rather than an error.
  useEffect(() => {
    let live = true;
    listZumbaMasters(branchId)
      .then((data) => { if (live) setZumbaMasters(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setZumbaMasters([]); });
    return () => { live = false; };
  }, [branchId]);

  // The three money figures, all read from the server rather than split here: the Zumba
  // master's own Payment card reads the same fields, and two halves worked out in two
  // places is exactly how they end up disagreeing by a rupee.
  const money = useMemo(() => ({
    total_fees: Number(summary?.fee_total) || 0,
    master_revenue: Number(summary?.master_revenue) || 0,
    fitsiomax_revenue: Number(summary?.fitsiomax_revenue) || 0,
  }), [summary]);

  const visible = useMemo(() => {
    let list = rows;
    // Total Fees is the one card that is not a source, so it filters on the money rather
    // than on where the person came from: the rows behind the figure are the ones that
    // have paid. The two revenue shares filter nothing — they are that same money split,
    // not a different set of people — and the card row does not offer them as a click.
    if (card === "total_fees") list = list.filter((r) => Number(r.fee_paid || 0) > 0);
    else if (card !== "all" && !DERIVED_CARDS.has(card)) list = list.filter((r) => r.card === card);
    if (stageFilter) list = list.filter((r) => r.stage === stageFilter);
    if (from) list = list.filter((r) => dayOf(r.created_at) >= from);
    if (to) list = list.filter((r) => dayOf(r.created_at) <= to);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q));
    }
    return list;
  }, [rows, card, search, from, to, stageFilter]);

  // Counted off the rows on screen rather than off the server's figure, so the bar agrees
  // with the list underneath it once a card or a date range has narrowed things.
  const stageCounts = useMemo(() => {
    const out = {};
    stages.forEach((st) => { out[st.name] = 0; });
    rows.forEach((r) => { if (r.stage in out) out[r.stage] += 1; });
    return out;
  }, [rows, stages]);

  const moveStage = async (row, stage) => {
    if (!stage || stage === row.stage) return;
    setMovingId(row.id);
    try {
      await moveZumbaStage(row.id, stage);
      toast.success(`Moved to ${stage}`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not move");
    } finally {
      setMovingId(null);
    }
  };

  // Every master offered in the picker: the ones already referred from, plus one being
  // typed in now, so a new name is selectable the moment it exists.
  const masterOptions = useMemo(() => {
    const set = new Set(masters);
    if (form?.source === MASTER && form.master_name) set.add(form.master_name);
    return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [masters, form]);

  const openForm = (row) => {
    setNewMaster("");
    setForm(row ? { ...EMPTY, ...row, age: row.age ?? "" } : { ...EMPTY });
  };

  const save = async () => {
    if (!form?.name?.trim()) { toast.error("Name is required"); return; }
    if (form.source === MASTER && !(form.master_name || "").trim()) { toast.error("Which master referred them?"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: (form.phone || "").trim(),
        age: form.age === "" || form.age == null ? null : Number(form.age),
        address: (form.address || "").trim(),
        source: form.source || "personal",
        master_name: (form.master_name || "").trim(),
        assigned_master_id: form.assigned_master_id || "",
        fee_amount: Number(form.fee_amount || 0),
        fee_paid: Number(form.fee_paid || 0),
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
      toast.success("Registration removed");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove");
    }
  };

  const dated = !!(from || to);

  return (
    <div className="flex flex-col gap-4" data-testid="branch-zumba-panel">
      {/* One row, always. The cards share the width evenly and never wrap: nine of them
          breaking as 7 + 2 read as two unrelated strips, and the second one looked like a
          separate thing rather than the tail of the first.

          No minimum width and no scroller: nine cards divide whatever width there is, so
          the row ends exactly where the page does. What gives instead is the label, which
          truncates and carries the full text on `title`. */}
      <div
        className="flex flex-nowrap gap-1.5 sm:gap-2"
        data-testid="zumba-summary"
      >
        {CARDS.map((c) => (
          <SummaryCard
            key={c.key}
            label={c.label}
            count={c.money ? rupees(money[c.key]) : (summary?.[c.key] || 0)}
            color={c.color}
            active={card === c.key}
            readOnly={Boolean(c.derived)}
            onClick={() => setCard(c.key === "all" ? "all" : (card === c.key ? "all" : c.key))}
            testid={`zumba-card-${c.key}`}
          />
        ))}
      </div>

      {/* The Zumba pipeline, straight from Super Admin's CI/CD ROOTS. Absent entirely when
          that pipeline has no stages yet — an empty bar would only claim a pipeline exists
          and then not draw one. */}
      {stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5" data-testid="zumba-stage-bar">
          <button
            type="button"
            onClick={() => setStageFilter(null)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${stageFilter === null ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            data-testid="zumba-stage-all"
          >
            All Stages
            <span className={`ml-1.5 rounded px-1.5 py-px text-[10px] font-bold ${stageFilter === null ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>{rows.length}</span>
          </button>
          {stages.map((st) => {
            const on = stageFilter === st.name;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setStageFilter(on ? null : st.name)}
                className="rounded-md border px-3 py-1.5 text-xs font-semibold transition"
                // Inline, because the colour is whatever Super Admin picked for the stage
                // and Tailwind can only compile class names it can read in the source.
                style={on
                  ? { background: st.color || "#64748b", borderColor: st.color || "#64748b", color: "#fff" }
                  : { background: `${st.color || "#64748b"}12`, borderColor: `${st.color || "#64748b"}44`, color: st.color || "#475569" }}
                data-testid={`zumba-stage-${st.name}`}
              >
                {st.name}
                <span className={`ml-1.5 rounded px-1.5 py-px text-[10px] font-bold ${on ? "bg-white/25" : "bg-white/70"}`}>
                  {stageCounts[st.name] || 0}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Music className="h-4 w-4 text-sky-600" />
              Zumba Registrations
              <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500">{visible.length}</span>
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
              {/* Icon only, and lit while a range is set — the dates themselves are in the
                  panel it opens, and a toolbar has no room to print them twice. */}
              <Button
                size="sm"
                variant="outline"
                className={`h-8 w-8 p-0 ${dated ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100" : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                onClick={() => setShowDates((v) => !v)}
                title="Filter by date"
                aria-label="Filter by date"
                data-testid="zumba-date-toggle"
              >
                <CalendarDays className="h-3.5 w-3.5" />
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

          {showDates && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5" data-testid="zumba-date-filter">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Registered between</span>
              <div className="w-40">
                {/* Centred, not anchored: this bar sits above a table, and a panel hanging
                    off the field opens over the rows and gets clipped. */}
                <MilkDateInput value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From" centered title="From" accent="sky" data-testid="zumba-date-from" />
              </div>
              <div className="w-40">
                <MilkDateInput value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" centered title="To" accent="sky" data-testid="zumba-date-to" />
              </div>
              {dated && (
                <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-500" onClick={() => { setFrom(""); setTo(""); }} data-testid="zumba-date-clear">
                  <X className="mr-1 h-3 w-3" /> Clear
                </Button>
              )}
            </div>
          )}

          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">
              {rows.length === 0 ? "No Zumba registrations yet." : "Nothing under this filter."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="w-[5%] px-3 py-2.5">S.No</th>
                    <th className="w-[24%] px-3 py-2.5">Name</th>
                    <th className="w-[13%] px-3 py-2.5">Phone</th>
                    <th className="w-[6%] px-3 py-2.5">Age</th>
                    <th className="w-[16%] px-3 py-2.5">Source</th>
                    {stages.length > 0 && <th className="w-[14%] px-3 py-2.5">Stage</th>}
                    <th className="w-[12%] px-3 py-2.5">Fee</th>
                    <th className="w-[10%] px-3 py-2.5">Registered</th>
                    <th className="w-[10%] px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r, i) => {
                    const paid = Number(r.fee_paid || 0);
                    const due = Number(r.fee_amount || 0) - paid;
                    return (
                      <tr key={r.id} className="align-middle hover:bg-slate-50/60" data-testid={`zumba-row-${r.id}`}>
                        <td className="px-3 py-3 text-xs text-slate-400">{i + 1}</td>
                        <td className="px-3 py-3">
                          <p className="truncate font-semibold text-slate-800" title={r.name}>{r.name || "—"}</p>
                          {r.address ? <p className="truncate text-[11px] text-slate-500" title={r.address}>{r.address}</p> : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">{r.phone || "—"}</td>
                        <td className="px-3 py-3 text-xs text-slate-600">{r.age || "—"}</td>
                        <td className="px-3 py-3">
                          {/* A referral prints the master's name, because "Master" on its
                              own is the half of the answer nobody asks for. */}
                          <span className={`inline-block max-w-full truncate rounded px-2 py-0.5 text-[10px] font-semibold ${r.source === MASTER ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`} title={sourceLabel(r)}>
                            {sourceLabel(r)}
                          </span>
                          {r.package_name ? (
                            <p className="mt-0.5 truncate text-[10px] text-slate-500" title={r.package_name}>
                              {r.package_name}{r.package_sessions ? ` · ${r.package_sessions} classes` : ""}
                            </p>
                          ) : null}
                          {/* Drawn under the source and in a different colour because the
                              two answer different questions: the pill above is who brought
                              them in, this is whose class they turn up to and whose board
                              they appear on. */}
                          {r.assigned_master_name ? (
                            <span className="mt-1 inline-block max-w-full truncate rounded bg-pink-50 px-2 py-0.5 text-[10px] font-semibold text-pink-700" title={`Class: ${r.assigned_master_name}`}>
                              Class: {r.assigned_master_name}
                            </span>
                          ) : null}
                        </td>
                        {stages.length > 0 && (
                          <td className="px-3 py-3">
                            {/* A referral is read off the lead, so there is nowhere to
                                write a move onto — it shows where it sits and no more. */}
                            {r.origin === "consultation" ? (
                              <span className="inline-block max-w-full truncate rounded px-2 py-0.5 text-[10px] font-semibold text-slate-600" style={{ background: `${stageColor(stages, r.stage)}18`, color: stageColor(stages, r.stage) }} title={r.stage || "—"}>
                                {r.stage || "—"}
                              </span>
                            ) : (
                              <select
                                value={r.stage || ""}
                                disabled={movingId === r.id}
                                onChange={(e) => moveStage(r, e.target.value)}
                                className="w-full max-w-[10rem] truncate rounded-md border px-1.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                                style={{ borderColor: `${stageColor(stages, r.stage)}55`, color: stageColor(stages, r.stage) }}
                                data-testid={`zumba-stage-select-${r.id}`}
                              >
                                {stages.map((st) => (
                                  <option key={st.id} value={st.name}>{st.name}</option>
                                ))}
                              </select>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-3 text-xs">
                          <span className={paid > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}>{rupees(paid)}</span>
                          {/* Shown only when something is actually outstanding — a fully
                              paid row saying "0 due" is noise on every line. */}
                          {due > 0 ? <span className="ml-1 text-[10px] text-amber-600">{rupees(due)} due</span> : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500">{shortDate(r.created_at)}</td>
                        <td className="px-3 py-3 text-right">
                          {/* A referral is a decision recorded on the consultation, read
                              live from the lead rather than copied here. Editing or
                              deleting it would only put this tab out of step with the
                              consultation that owns it — un-ticking Zumba there takes the
                              row out on its own. */}
                          {r.origin === "consultation" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700" title="Referred on the consultation — edit it there" data-testid={`zumba-referred-${r.id}`}>
                              <Stethoscope className="h-3 w-3" /> Referred
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => openForm(r)} title="Edit" aria-label="Edit" data-testid={`zumba-edit-${r.id}`}>
                                <Pencil className="h-3 w-3" />
                              </Button>
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
          <div className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">{form.id ? "Edit Zumba Lead" : "Zumba Lead Create"}</h3>
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Name *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" data-testid="zumba-field-name" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Phone</label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit number" data-testid="zumba-field-phone" />
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Age</label>
                <Input type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="—" data-testid="zumba-field-age" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Address</label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Area, city" data-testid="zumba-field-address" />
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source</label>
              {/* One list, masters and channels together, because that is the one question
                  being answered: how did this person get here. A master is picked by name
                  — "Master" on its own would only prompt a second question. */}
              <div className="flex flex-wrap gap-1.5">
                {masterOptions.map((m) => {
                  const on = form.source === MASTER && form.master_name === m;
                  return (
                    <button
                      key={`master-${m}`}
                      type="button"
                      onClick={() => setForm({ ...form, source: MASTER, master_name: m })}
                      className={`max-w-full truncate rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${on ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                      title={m}
                      data-testid={`zumba-field-master-${m}`}
                    >
                      {m}
                    </button>
                  );
                })}
                {SOURCES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setForm({ ...form, source: s.key, master_name: "" })}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${form.source === s.key ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    data-testid={`zumba-field-source-${s.key}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {/* The roster is the names already referred from, so the first referral by a
                  master has to introduce them. Typed once, then offered from then on. */}
              <div className="flex items-center gap-2 pt-1">
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
            {/* Deliberately its own field rather than a second use of Source: Source is
                how this student arrived, this is whose class they are in. Only what is set
                here reaches a master's board — a master referring somebody does not put
                them on their own roll, which is the point of keeping the two apart. */}
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Assigned Master</label>
              {zumbaMasters.length === 0 ? (
                <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500" data-testid="zumba-field-assign-empty">
                  No Zumba accounts at this branch yet. Add one in HR Admin to assign students to a class.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {zumbaMasters.map((m) => {
                    const on = form.assigned_master_id === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setForm({ ...form, assigned_master_id: on ? "" : m.id })}
                        className={`max-w-full truncate rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${on ? "bg-pink-600 text-white" : "bg-pink-50 text-pink-700 hover:bg-pink-100"}`}
                        title={m.name}
                        data-testid={`zumba-field-assign-${m.id}`}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-slate-400">Unassigned until you pick one. Tap the same master again to take the student off their board.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fee Collected</label>
                <Input type="number" value={form.fee_paid} onChange={(e) => setForm({ ...form, fee_paid: e.target.value })} placeholder="0" data-testid="zumba-field-paid" />
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fee Amount</label>
                <Input type="number" value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value })} placeholder="0" data-testid="zumba-field-amount" />
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
      )}

      {removing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="zumba-delete-dialog">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Remove this registration?</h3>
                <p className="mt-1 text-xs text-slate-500">
                  <b className="text-slate-700">{removing.name}</b> comes off the Zumba list and out of the counts above. This cannot be undone.
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
