import { useCallback, useEffect, useMemo, useState } from "react";
import { Music, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StageTab } from "@/components/ui/stage-tab";
import { toast } from "@/components/ui/sonner";
import { listZumba, addZumba, updateZumba, deleteZumba } from "@/lib/api";

// Where a registration came from. The slugs are what the server stores; the labels are
// what the summary cards print.
const SOURCES = [
  { key: "direct", label: "Direct" },
  { key: "consultant", label: "Consultant" },
  { key: "branch", label: "Branch" },
  { key: "masters", label: "Masters" },
  { key: "fitsiomax", label: "Fitsiomax" },
];
const sourceLabel = (slug) => (SOURCES.find((s) => s.key === slug) || SOURCES[0]).label;

// The strip, in the order asked for, split into the three things it is actually saying:
// the total on its own, then the three desks a registration can come in through, then the
// three that answer a different question — how many have paid, and how many arrived from
// outside the branch. A wider gap between the groups is the whole point; without it seven
// identical cards read as one undifferentiated row.
//
// `grow` keeps every card the same width despite the groups holding different numbers of
// them: a group grows in proportion to how many cards it holds, so 1 : 3 : 3 divides the
// row into sevenths rather than into thirds. Written out as literal class names because
// Tailwind's JIT only compiles what it can read in the source.
//
// `border` gives each card its own outline and `wrap` puts the group itself in a tinted
// box, so the split survives being looked at quickly: the gap says where a group ends,
// the box says the cards inside it belong together, and the colour says which group it
// is. The colour is the whole point of the outline here, so it stays put when a card is
// selected; the selected card is picked out by its fill, as on every other bar in the OS.
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

const EMPTY = { name: "", phone: "", source: "direct", fee_amount: "", fee_paid: "", notes: "" };

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
  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null); // null | { ...fields, id? }
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listZumba(branchId);
      setRows(data.registrations || []);
      setSummary(data.summary || {});
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
    // rather than on where the person came from.
    if (card === "fee_collected") list = list.filter((r) => Number(r.fee_paid || 0) > 0);
    else if (card !== "all") list = list.filter((r) => (r.source || "direct") === card);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q));
    return list;
  }, [rows, card, search]);

  const save = async () => {
    if (!form?.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: (form.phone || "").trim(),
        source: form.source || "direct",
        fee_amount: Number(form.fee_amount || 0),
        fee_paid: Number(form.fee_paid || 0),
        notes: (form.notes || "").trim(),
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
              <Button size="sm" variant="outline" className="h-8 text-slate-600" onClick={load} data-testid="zumba-refresh">
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button size="sm" className="h-8 bg-sky-600 text-white hover:bg-sky-700" onClick={() => setForm({ ...EMPTY })} data-testid="zumba-add">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Registration
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-400">
              {rows.length === 0 ? "No Zumba registrations yet." : "Nothing under this card."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="w-[5%] px-3 py-2.5">S.No</th>
                    <th className="w-[24%] px-3 py-2.5">Name</th>
                    <th className="w-[15%] px-3 py-2.5">Phone</th>
                    <th className="w-[14%] px-3 py-2.5">Source</th>
                    <th className="w-[16%] px-3 py-2.5">Fee</th>
                    <th className="w-[14%] px-3 py-2.5">Registered</th>
                    <th className="w-[12%] px-3 py-2.5 text-right">Actions</th>
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
                          {r.notes ? <p className="truncate text-[11px] text-slate-500" title={r.notes}>{r.notes}</p> : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">{r.phone || "—"}</td>
                        <td className="px-3 py-3">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{sourceLabel(r.source)}</span>
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
                            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setForm({ ...EMPTY, ...r })} data-testid={`zumba-edit-${r.id}`}>
                              <Pencil className="mr-1 h-3 w-3" /> Edit
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 border-rose-200 text-[11px] text-rose-700 hover:bg-rose-50" onClick={() => setRemoving(r)} data-testid={`zumba-delete-${r.id}`}>
                              <Trash2 className="mr-1 h-3 w-3" /> Delete
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
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">{form.id ? "Edit Registration" : "Add Registration"}</h3>
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Name *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" data-testid="zumba-field-name" />
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit number" data-testid="zumba-field-phone" />
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source</label>
              {/* Pills rather than a dropdown: five options, and they are the same five the
                  cards above split by, so choosing one shows where the row will land. */}
              <div className="flex flex-wrap gap-1.5">
                {SOURCES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setForm({ ...form, source: s.key })}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${form.source === s.key ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    data-testid={`zumba-field-source-${s.key}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fee Amount</label>
                <Input type="number" value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value })} placeholder="0" data-testid="zumba-field-amount" />
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fee Collected</label>
                <Input type="number" value={form.fee_paid} onChange={(e) => setForm({ ...form, fee_paid: e.target.value })} placeholder="0" data-testid="zumba-field-paid" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" data-testid="zumba-field-notes" />
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
