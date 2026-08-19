import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Music, Pencil, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StageTab } from "@/components/ui/stage-tab";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { toast } from "@/components/ui/sonner";
import { listZumba, addZumba, updateZumba, deleteZumba } from "@/lib/api";

// How a registration arrived, as the branch would say it. A referral is recorded against
// the master who made it rather than against a single "Masters" bucket, so these five are
// the answers that stand on their own; the masters are offered alongside them by name.
const SOURCES = [
  { key: "board", label: "Board" },
  { key: "consultations", label: "Consultations" },
  { key: "branch", label: "Branch" },
  { key: "social_media", label: "Social Media" },
  { key: "personal", label: "Personal" },
];
const MASTER = "master";
const sourceLabel = (r) => (
  r.source === MASTER
    ? (r.master_name || "Master")
    : (SOURCES.find((s) => s.key === r.source) || { label: "Personal" }).label
);

// The strip, in the order asked for, split into the three things it is actually saying:
// the total on its own, then where a registration came from, then the three that answer
// something else. A wider gap between the groups is the whole point; without it seven
// identical cards read as one undifferentiated row.
//
// `grow` keeps every card the same width despite the groups holding different numbers of
// them: a group grows in proportion to how many cards it holds, so 1 : 3 : 3 divides the
// row into sevenths rather than into thirds. Written out as literal class names because
// Tailwind's JIT only compiles what it can read in the source.
//
// `border` gives each card its own outline and `wrap` puts the group itself in a tinted
// box: the gap says where a group ends, the box says the cards inside it belong together,
// and the colour says which group it is. The colour is the whole point of the outline, so
// it stays put when a card is selected; the selected card is picked out by its fill.
//
// The tints are a step up from the palest ones. These boxes sit straight on the page with
// no frame around them, so the tint is the only thing marking where a group starts.
const CARD_GROUPS = [
  { key: "total", grid: "grid-cols-1", grow: "sm:flex-1", border: "border border-purple-300", wrap: "border border-purple-200 bg-purple-100", cards: [
    { key: "all", label: "All" },
  ] },
  { key: "sources", grid: "grid-cols-3", grow: "sm:flex-[3]", border: "border border-orange-300", wrap: "border border-orange-200 bg-orange-100", cards: [
    { key: "direct", label: "Direct" },
    { key: "consultant", label: "Consultant" },
    { key: "branch", label: "Branch" },
  ] },
  { key: "reach", grid: "grid-cols-3", grow: "sm:flex-[3]", border: "border border-emerald-500", wrap: "border border-emerald-200 bg-emerald-100", cards: [
    { key: "fee_collected", label: "Fee's Collected" },
    { key: "masters", label: "Masters" },
    { key: "fitsiomax", label: "Fitsiomax" },
  ] },
];

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

  const visible = useMemo(() => {
    let list = rows;
    // Fee's Collected is the one card that is not a source, so it filters on the money
    // rather than on where the person came from. Every other card matches the `card` the
    // server worked out, so the list and the counts above cannot drift apart.
    if (card === "fee_collected") list = list.filter((r) => Number(r.fee_paid || 0) > 0);
    else if (card !== "all") list = list.filter((r) => r.card === card);
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
      {/* Three tinted boxes, separated by a gap three times the one between cards, so the
          split is read as a split rather than as a stray margin. No outer frame: the boxes
          are the grouping, and a grey border round all three only argued with them.
          On a phone the boxes stack instead, one line each: All, then the three desks,
          then the three that follow. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:gap-6" data-testid="zumba-summary">
        {CARD_GROUPS.map((g) => (
          <div key={g.key} className={"grid gap-2 rounded-lg p-1.5 sm:flex sm:flex-nowrap " + g.grid + " " + g.grow + " " + g.wrap} data-testid={"zumba-group-" + g.key}>
            {g.cards.map((c) => (
              <StageTab
                key={c.key}
                label={c.label}
                count={summary?.[c.key] || 0}
                active={card === c.key}
                onClick={() => setCard(c.key === "all" ? "all" : (card === c.key ? "all" : c.key))}
                testid={`zumba-card-${c.key}`}
                gridded
                plain
                borderClass={g.border}
              />
            ))}
          </div>
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
            {/* The money the Fee's Collected card counts. Printed here rather than inside
                the card, which has room for a number only and would read as a count. */}
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700" data-testid="zumba-fee-total">
              {rupees(summary?.fee_total)} collected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or phone"
                className="h-8 w-44 text-xs"
                data-testid="zumba-search"
              />
              {/* Grey, because it changes nothing — it re-reads what is already on screen.
                  The blue is spent on the one button that creates something. */}
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-700"
                onClick={load}
                data-testid="zumba-refresh"
              >
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
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
                        </td>
                        <td className="px-3 py-3 text-xs">
                          <span className={paid > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}>{rupees(paid)}</span>
                          {/* Shown only when something is actually outstanding — a fully
                              paid row saying "0 due" is noise on every line. */}
                          {due > 0 ? <span className="ml-1 text-[10px] text-amber-600">{rupees(due)} due</span> : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500">{shortDate(r.created_at)}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => openForm(r)} title="Edit" aria-label="Edit" data-testid={`zumba-edit-${r.id}`}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 w-7 border-rose-200 p-0 text-rose-700 hover:bg-rose-50" onClick={() => setRemoving(r)} title="Delete" aria-label="Delete" data-testid={`zumba-delete-${r.id}`}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
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
