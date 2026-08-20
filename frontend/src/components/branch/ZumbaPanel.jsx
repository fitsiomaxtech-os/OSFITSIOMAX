import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Music, Pencil, RefreshCw, Stethoscope, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { toast } from "@/components/ui/sonner";
import { listZumba, addZumba, updateZumba, deleteZumba } from "@/lib/api";

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
const PINK = "#be185d";

const CARDS = [
  { key: "all", label: "All", color: "#a855f7" },
  { key: "direct", label: "Direct", color: "#f59e0b" },
  { key: "consultant", label: "Consultant", color: "#f97316" },
  // Master is the leads a master brought in — a referral filed against a named master,
  // which is what the Zumba Master View's Refer Customer writes and what this card is
  // asked for. It held the branch-sourced count until that board existed and there was a
  // real master's referral to point it at.
  { key: "masters", label: "Refer Master", color: "#d97706" },
  // Whether a master's name is against the row, asked from both ends: Master has one,
  // Assign does not, and the two always sum to All. Dark pink because they are one
  // question rather than two, and they sit on the seam — after the cards that count
  // where people came from, before the ones that count money.
  { key: "assign", label: "Assign", color: PINK },
  { key: "master", label: "Master", color: PINK },
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

/** Whether a registration has a master's name against it. */
const hasMaster = (r) => !!(r.master_name || "").trim();

// The two cards that are a share of the fee rather than a set of rows. Read by the filter
// so a stale `card` value can never narrow the list to nothing.
const DERIVED_CARDS = new Set(["master_revenue", "fitsiomax_revenue"]);

// The class fee is split down the middle between the master who runs it and Fitsiomax.
const MASTER_SHARE = 0.5;

/** The two halves of the collected fee.
 *
 * Fitsiomax takes the remainder rather than its own percentage, so the two always add back
 * to exactly what was collected. Splitting an odd number both ways independently loses or
 * invents a rupee, and this figure is somebody's pay.
 */
const revenueSplit = (feeTotal) => {
  const total = Number(feeTotal) || 0;
  const master = Math.round(total * MASTER_SHARE);
  return { total, master, fitsiomax: total - master };
};

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
    className={`w-[calc(33.333%-0.34rem)] min-w-0 rounded-lg border-2 px-1 py-1.5 text-center transition sm:w-full sm:rounded-xl sm:px-4 sm:py-4 sm:text-left ${
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
    <span className="mt-0.5 block text-lg font-extrabold leading-tight sm:mt-1 sm:text-3xl" style={{ color }}>
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

const EMPTY = { name: "", phone: "", age: "", address: "", source: "personal", master_name: "", fee_amount: "", fee_paid: "" };

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
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listZumba(branchId);
      setRows(data.registrations || []);
      setSummary(data.summary || {});
      setMasters(data.masters || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load Zumba registrations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  // The three money figures, off the one collected total the server already reports.
  const money = useMemo(() => {
    const { total, master, fitsiomax } = revenueSplit(summary?.fee_total);
    return { total_fees: total, master_revenue: master, fitsiomax_revenue: fitsiomax };
  }, [summary]);

  // Assign and Master are worked out here rather than on the server: they are a cut of
  // the rows this panel already holds, not a new fact about them. Every other count is
  // still the server's own, so nothing that agreed before can start disagreeing.
  const counts = useMemo(() => ({
    ...(summary || {}),
    master: rows.filter(hasMaster).length,
    assign: rows.filter((r) => !hasMaster(r)).length,
  }), [summary, rows]);

  const visible = useMemo(() => {
    let list = rows;
    // Total Fees is the one card that is not a source, so it filters on the money rather
    // than on where the person came from: the rows behind the figure are the ones that
    // have paid. The two revenue shares filter nothing — they are that same money split,
    // not a different set of people — and the card row does not offer them as a click.
    if (card === "total_fees") list = list.filter((r) => Number(r.fee_paid || 0) > 0);
    // The pink pair splits on whether a master is named, not on where the person came
    // from, so they cannot match against the server's `card` the way the rest do.
    else if (card === "master") list = list.filter(hasMaster);
    else if (card === "assign") list = list.filter((r) => !hasMaster(r));
    else if (card !== "all" && !DERIVED_CARDS.has(card)) list = list.filter((r) => r.card === card);
    if (from) list = list.filter((r) => dayOf(r.created_at) >= from);
    if (to) list = list.filter((r) => dayOf(r.created_at) <= to);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q));
    }
    return list;
  }, [rows, card, search, from, to]);

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
      {/* One row, the way Human Resource lays its stages out. Three across on a phone so
          seven cards land as 3 + 3 + 1 and the whole strip is visible without a swipe;
          flex-wrap rather than a grid there, because a grid pins the last card to the first
          column and leaves a hole, and a partial row cannot be centred. */}
      <div
        className="flex flex-wrap justify-center gap-1.5 sm:grid sm:grid-cols-4 sm:gap-3 lg:grid-cols-7"
        data-testid="zumba-summary"
      >
        {CARDS.map((c) => (
          <SummaryCard
            key={c.key}
            label={c.label}
            count={c.money ? rupees(money[c.key]) : (counts[c.key] || 0)}
            color={c.color}
            active={card === c.key}
            readOnly={Boolean(c.derived)}
            onClick={() => setCard(c.key === "all" ? "all" : (card === c.key ? "all" : c.key))}
            testid={`zumba-card-${c.key}`}
          />
        ))}
      </div>

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
                    <th className="w-[14%] px-3 py-2.5">Fee</th>
                    <th className="w-[11%] px-3 py-2.5">Registered</th>
                    <th className="w-[11%] px-3 py-2.5 text-right">Actions</th>
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
                        </td>
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
