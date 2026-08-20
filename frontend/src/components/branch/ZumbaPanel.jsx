import { useCallback, useEffect, useMemo, useState } from "react";
import { Music, Pencil, RefreshCw, Stethoscope, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { toast } from "@/components/ui/sonner";
import { listZumba, listZumbaMasters, addZumba, updateZumba, deleteZumba, moveZumbaStage, listStoreItems } from "@/lib/api";

// How a registration arrived, as the branch would say it. A referral is recorded against
// the master who made it rather than against a single "Masters" bucket, so these six are
// the answers that stand on their own; the masters are offered alongside them by name.
//
// Board, Social Media and Personal all count towards Direct: nobody referred them, they
// came to us. The rest name whoever did the referring. The mapping lives on the server,
// which stamps each row with its card so this list and the counts cannot disagree.
const SOURCES = [
  { key: "branch", label: "Branch Admin" },
  { key: "board", label: "Board" },
  { key: "consultations", label: "Consultation" },
  { key: "social_media", label: "Social Media" },
  { key: "personal", label: "Personal Brand (Sumaiya Naaz)" },
  { key: "fitsiomax", label: "Fitsiomax" },
];
const MASTER = "master";

// The two slots the class is taught in. Kept in step with TIME_SLOTS in
// backend/routers/v3_zumba.py, which drops anything it does not recognise.
const TIME_SLOTS = ["10:00 am - 11:00 am", "11:00 am - 12:00 pm"];
const GENDERS = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
  { key: "other", label: "Other" },
];

// A membership is sold by the month — 12 classes in each. The shelf holds the per-class
// rate, so the price a student is quoted is that rate across the whole plan, rounded back
// to the figure that was typed when the package was priced.
const CLASSES_PER_MONTH = 12;
const planLabel = (item) => {
  const classes = item.sessions_offline || item.sessions_online || 0;
  const months = classes && classes % CLASSES_PER_MONTH === 0 ? classes / CLASSES_PER_MONTH : null;
  return months ? `${months} Month${months > 1 ? "s" : ""}` : item.name;
};
const planTotal = (item) => Math.round(
  (Number(item.price_offline ?? item.price_online) || 0) * (item.sessions_offline || item.sessions_online || 0),
);

/** The one dropdown shape this form uses, so six of them cannot drift into six looks. */
const FormSelect = ({ value, onChange, children, testid }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-10 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
    data-testid={testid}
  >
    {children}
  </select>
);

const FieldLabel = ({ children }) => (
  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</label>
);
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
// Kept in step with MASTER_SHARE in backend/routers/v3_zumba.py, which is what the card
// totals are already split by. Only the per-row line below is worked out here; the
// figures on the cards still come from the server, so the two cannot drift.
//
// A row's share is rounded for display like every other rupee figure here, so a column
// of them can land a rupee off the card above it on an odd total. The card is the
// figure of record.
const MASTER_SHARE = 0.5;

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
  // All three filter to the same rows — the students who have paid — because that is the
  // money all three describe. What changes is what the Fee column says: Total Fees shows
  // what came in, and each share shows the cut of it that card is counting, so opening one
  // answers "which registrations is this figure made of, and how much from each".
  { key: "total_fees", label: "Total Fees", color: "#059669", money: true },
  { key: "master_revenue", label: "Master's Revenue", color: "#10b981", money: true, share: MASTER_SHARE },
  { key: "fitsiomax_revenue", label: "Fitsiomax Revenue", color: "#14b8a6", money: true, share: 1 - MASTER_SHARE },
];

/** The colour Super Admin gave a stage in CI/CD ROOTS, or a neutral slate for one that
    no longer exists. Read off the pipeline rather than kept here, so a colour changed
    there changes here without a deploy. */
const stageColor = (stages, name) => (stages.find((st) => st.name === name) || {}).color || "#64748b";

// The cards that show a cut of the fee rather than the whole of it. Read by the filter,
// which sends them to the same rows Total Fees opens.
const REVENUE_CARDS = new Set(["master_revenue", "fitsiomax_revenue"]);

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

const EMPTY = {
  name: "", email: "", phone: "", age: "", gender: "", address: "",
  source: "personal", master_name: "", assigned_master_id: "", time_slot: "",
  package_id: "", package_name: "", fee_amount: "", fee_paid: "",
};

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
  // The same shape Branch Leads keeps: { key, label, from, to } with Dates on the ends,
  // or null for no filter. The presets and the typed range both come from the one
  // control, so there is no From/To bar of this tab's own to keep in step with it.
  const [dateFilter, setDateFilter] = useState(null);
  const [form, setForm] = useState(null); // null | { ...fields, id? }
  const [newMaster, setNewMaster] = useState(""); // a master not yet on the list
  // The Zumba accounts at this branch, which is what a student is assigned *to*. Not
  // the same list as `masters` above: that one is names typed onto referrals, and a
  // referral name with no account behind it cannot be given a class.
  const [zumbaMasters, setZumbaMasters] = useState([]);
  // The Zumba shelf as Super Admin priced it — 1, 3 and 6 month memberships. Read rather
  // than hardcoded, so a change of price on the shelf is the change of price here.
  const [packages, setPackages] = useState([]);
  // Which branch these rows belong to, as the server resolved it. Printed rather than
  // assumed: an empty list is either "nobody has registered" or "you are looking at the
  // wrong branch", and those two read identically until the branch is named.
  const [branch, setBranch] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  // The Zumba pipeline exactly as Super Admin has it in CI/CD ROOTS. Nothing is hardcoded
  // here: a clinic that has not set the pipeline up has no stages, and the Stage column
  // and its move control drop out of the table rather than drawing an empty pipeline.
  const [stages, setStages] = useState([]);
  const [movingId, setMovingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listZumba(branchId);
      setRows(data.registrations || []);
      setSummary(data.summary || {});
      setMasters(data.masters || []);
      setStages(data.stages || []);
      setBranch(data.branch || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load Zumba registrations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  // Once, not per open: the shelf does not change while a form is on screen, and fetching
  // it on every Create would put a spinner in front of a list that is nearly always the
  // same three rows.
  useEffect(() => {
    listStoreItems("zumba", "session")
      .then(setPackages)
      .catch(() => setPackages([]));
  }, []);

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

  // The share card currently open, if it is one — read once here rather than per row.
  const openShare = useMemo(() => CARDS.find((c) => c.key === card && c.share), [card]);

  const visible = useMemo(() => {
    let list = rows;
    // The three money cards filter on the money rather than on where the person came from:
    // the rows behind all of them are the ones that have paid. The two shares open that
    // same list, and say their own cut of each row in the Fee column.
    if (card === "total_fees" || REVENUE_CARDS.has(card)) list = list.filter((r) => Number(r.fee_paid || 0) > 0);
    else if (card !== "all") list = list.filter((r) => r.card === card);
    if (dateFilter) {
      // Compared as timestamps rather than as day strings: the picker hands back Dates
      // whose ends are the start and the end of a day, so a single day is a range like
      // any other and needs no special case.
      const fromTs = dateFilter.from?.getTime();
      const toTs = dateFilter.to?.getTime();
      list = list.filter((r) => {
        const ts = new Date(`${dayOf(r.created_at)}T00:00:00`).getTime();
        if (!ts) return false;
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
        return true;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q));
    }
    return list;
  }, [rows, card, search, from, to]);

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
  /**
   * Who can be named as the master who referred somebody.
   *
   * Three sources, in the order they matter. The Zumba accounts at this branch come first
   * and are the answer nearly every time — a master with a login is a master the branch
   * employs, and having to type their name while their account sits in the Assign To box
   * below was the gap here. Then the names already typed onto earlier referrals, so a
   * master with no account keeps working once introduced. Then whatever this row already
   * says, so editing an old referral never silently blanks its master.
   *
   * Deduped on the name case-folded, since the same person reached from two of those
   * sources is one option, not two that save the same string.
   */
  const masterOptions = useMemo(() => {
    const seen = new Map();
    const add = (name) => {
      const label = (name || "").trim();
      const key = label.toLowerCase();
      if (label && !seen.has(key)) seen.set(key, label);
    };
    zumbaMasters.forEach((m) => add(m.name));
    masters.forEach(add);
    if (form?.source === MASTER) add(form.master_name);
    return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [zumbaMasters, masters, form]);

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
        email: (form.email || "").trim(),
        gender: form.gender || "",
        address: (form.address || "").trim(),
        time_slot: form.time_slot || "",
        package_id: form.package_id || "",
        package_name: form.package_name || "",
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
              {branch?.name && (
                <span className="rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700" data-testid="zumba-branch-name">
                  {branch.name}
                </span>
              )}
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
              {/* The same control Branch Leads carries: presets and a typed range in one
                  dialog, rather than a bar of this tab's own. iconOnly keeps it to the
                  glyph until a range is set, when it prints the range instead. */}
              <DateFilterPopover
                value={dateFilter}
                onChange={setDateFilter}
                centered
                iconOnly
                testid="zumba-date-filter"
              />
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

          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">
              {rows.length > 0
                ? "Nothing under this filter."
                : branch?.name
                  ? `No Zumba registrations at ${branch.name} yet. A registration is filed against the branch it was taken at — a master's referral lands on the branch their own account belongs to.`
                  : branch
                    ? "This account has no branch assigned, so there is no Zumba list to read. Assign one in HR Admin → Roles & Credentials."
                    : "No Zumba registrations yet."}
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
                          {/* With a share card open, what that share takes from this row —
                              under the fee rather than replacing it, so the row still says
                              what the student actually paid. */}
                          {openShare ? (
                            <span className="block text-[10px] text-slate-500" data-testid={`zumba-share-${r.id}`}>
                              {openShare.label}: <b className="text-slate-700">{rupees(paid * openShare.share)}</b>
                            </span>
                          ) : null}
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
          <div className="max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">{form.id ? "Edit Zumba Lead" : "Zumba Lead Create"}</h3>

            {/* Two columns, and the split is the question each answers: who the person is
                on the left, what the branch is doing with them on the right. On a phone
                they stack in that same order, which is the order they are asked in. */}
            <div className="grid gap-5 md:grid-cols-2">

              {/* ---------------------------------------------------- who they are */}
              <div className="space-y-3">
                <p className="border-b border-slate-100 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Basic Details</p>
                <div className="space-y-2">
                  <FieldLabel>Name *</FieldLabel>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" data-testid="zumba-field-name" />
                </div>
                <div className="space-y-2">
                  <FieldLabel>Email</FieldLabel>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" data-testid="zumba-field-email" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-2">
                    <FieldLabel>Phone Number</FieldLabel>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit number" data-testid="zumba-field-phone" />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Age</FieldLabel>
                    <Input type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="—" data-testid="zumba-field-age" />
                  </div>
                </div>
                <div className="space-y-2">
                  <FieldLabel>Gender</FieldLabel>
                  <FormSelect value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} testid="zumba-field-gender">
                    <option value="">Not stated</option>
                    {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </FormSelect>
                </div>
                <div className="space-y-2">
                  <FieldLabel>Address</FieldLabel>
                  <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Where they are coming from" data-testid="zumba-field-address" />
                </div>
              </div>

              {/* -------------------------------------------- what the branch does */}
              <div className="space-y-3">
                <p className="border-b border-slate-100 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Lead &amp; Class</p>

                <div className="space-y-2">
                  <FieldLabel>Source of the Lead</FieldLabel>
                  <FormSelect
                    value={form.source}
                    onChange={(v) => setForm({ ...form, source: v, master_name: v === MASTER ? form.master_name : "" })}
                    testid="zumba-field-source"
                  >
                    {SOURCES.map((src) => <option key={src.key} value={src.key}>{src.label}</option>)}
                    <option value={MASTER}>Zumba Master</option>
                  </FormSelect>
                  {/* Which master, asked only once the source says a master referred them.
                      The roster is the names already referred from, so the first referral
                      by a master has to introduce them. */}
                  {form.source === MASTER && (
                    <div className="space-y-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-2.5">
                      <FieldLabel>Which master referred them?</FieldLabel>
                      <FormSelect
                        value={form.master_name}
                        onChange={(v) => setForm({ ...form, master_name: v })}
                        testid="zumba-field-master-name"
                      >
                        <option value="">Select a master…</option>
                        {masterOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                      </FormSelect>
                      <div className="flex items-center gap-2">
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
                  )}
                </div>

                {/* Its own field rather than a second use of Source: Source is how this
                    student arrived, this is whose class they are in. Only what is set here
                    reaches a master's board — referring somebody does not put them on your
                    own roll, which is the point of keeping the two apart. */}
                <div className="space-y-2">
                  <FieldLabel>Assign To</FieldLabel>
                  {zumbaMasters.length === 0 ? (
                    <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500" data-testid="zumba-field-assign-empty">
                      No Zumba accounts at this branch yet. Add one in HR Admin to assign students to a class.
                    </p>
                  ) : (
                    <FormSelect
                      value={form.assigned_master_id}
                      onChange={(v) => setForm({ ...form, assigned_master_id: v })}
                      testid="zumba-field-assign"
                    >
                      <option value="">Unassigned</option>
                      {zumbaMasters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </FormSelect>
                  )}
                </div>

                <div className="space-y-2">
                  <FieldLabel>Time</FieldLabel>
                  <FormSelect value={form.time_slot} onChange={(v) => setForm({ ...form, time_slot: v })} testid="zumba-field-time">
                    <option value="">Not set</option>
                    {TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </FormSelect>
                </div>

                {/* The shelf, priced. Picking a membership fills the amount owed, which is
                    what the plan costs; what has actually been handed over stays a separate
                    number, because the two are only equal once the student has paid. */}
                <div className="space-y-2">
                  <FieldLabel>Fee</FieldLabel>
                  {packages.length === 0 ? (
                    <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500" data-testid="zumba-field-package-empty">
                      No Zumba memberships on the shelf yet. Add them in Services and Products → Zumba Class.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5" data-testid="zumba-field-packages">
                      {packages.map((item) => {
                        const on = form.package_id === item.id;
                        const total = planTotal(item);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setForm(on
                              ? { ...form, package_id: "", package_name: "", fee_amount: "" }
                              : { ...form, package_id: item.id, package_name: item.name, fee_amount: total })}
                            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${on ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                            title={item.name}
                            data-testid={`zumba-field-package-${item.id}`}
                          >
                            {planLabel(item)} · {rupees(total)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-2">
                      <FieldLabel>Fee Collected</FieldLabel>
                      <Input type="number" value={form.fee_paid} onChange={(e) => setForm({ ...form, fee_paid: e.target.value })} placeholder="0" data-testid="zumba-field-paid" />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Fee Amount</FieldLabel>
                      <Input type="number" value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value, package_id: "", package_name: "" })} placeholder="0" data-testid="zumba-field-amount" />
                    </div>
                  </div>
                </div>
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
