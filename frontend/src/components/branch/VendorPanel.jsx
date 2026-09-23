import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Truck, Plus, Search, Pencil, Trash2, History, IndianRupee, PackageCheck, Power,
  Building2, Phone, Mail, Boxes, Link2, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { StatTile } from "@/components/ui/stat-tile";
import {
  listVendors, vendorSummary, vendorDeliveries, createVendor, updateVendor, deleteVendor,
  vendorCatalogue,
} from "@/lib/api";
// The dialog shell, the labelled field and the input class the stock panel already uses.
// Imported rather than copied: the two boards sit on the same tab row and a vendor form
// with its own geometry would read as a different product.
import { Modal, Field, inputCls, fmt, when, errText } from "@/components/branch/StoreInventoryPanel";
import {
  VENDOR_SERVICE_CATEGORIES, VENDOR_SERVICE_MAX_COUNT, VENDOR_SERVICE_MAX_LEN,
} from "@/lib/vendorServices";

/**
 * The three stock shelves a vendor can supply — the same keys the inventory catalogue and
 * the backend's VALID_CATEGORIES use, so a shelf added there is added here and nowhere
 * else. A vendor may supply any number of them, including none while nothing has been
 * bought yet.
 */
const SHELVES = [
  { key: "tablet", label: "Tablet" },
  { key: "supplementary", label: "Supplementary" },
  { key: "equipment", label: "Equipment" },
];

const SHELF_LABEL = Object.fromEntries(SHELVES.map((s) => [s.key, s.label]));

/**
 * What a vendor is, as the chips on its row.
 *
 * Its own categories when it has them. When it hasn't — every vendor added before the
 * Category field existed — the shelves it supplies, which is the only thing that was ever
 * recorded about those rows and is still true of them. That fallback is what stops the
 * column reading as a column of dashes on an existing list, and it costs nothing: the
 * moment somebody opens one of those vendors and picks a category, its own wins.
 */
const vendorTags = (v) => {
  const own = v.services || [];
  if (own.length) return own;
  return (v.categories || []).map((c) => SHELF_LABEL[c] || c);
};

const emptyDraft = {
  id: null, name: "", contact_person: "", phone: "", email: "", gst_number: "",
  city: "", address: "", payment_terms: "", notes: "", services: [], categories: [],
  item_ids: [], active: true,
};

const toDraft = (v) => ({
  id: v.id,
  name: v.name || "",
  contact_person: v.contact_person || "",
  phone: v.phone || "",
  email: v.email || "",
  gst_number: v.gst_number || "",
  city: v.city || "",
  address: v.address || "",
  payment_terms: v.payment_terms || "",
  notes: v.notes || "",
  services: v.services || [],
  categories: v.categories || [],
  item_ids: v.item_ids || [],
  active: v.active !== false,
});

/** A shelf chip, on a vendor row and again as the picker in the form. */
const ShelfChip = ({ label, on = true, onClick, testid }) => {
  const cls = on
    ? "border-violet-200 bg-violet-50 text-violet-700"
    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50";
  return onClick ? (
    <button type="button" onClick={onClick} className={`rounded-[5px] border px-2 py-0.5 text-[11px] font-semibold ${cls}`} data-testid={testid}>
      {label}
    </button>
  ) : (
    <span className={`rounded-[5px] border px-2 py-0.5 text-[11px] font-semibold ${cls}`} data-testid={testid}>{label}</span>
  );
};

/** A category the branch typed itself — the only chip that can be taken off again. */
const CustomChip = ({ label, onRemove, testid }) => (
  <span
    className="inline-flex items-center gap-1 rounded-[5px] border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700"
    data-testid={testid}
  >
    {label}
    <button type="button" onClick={onRemove} className="text-violet-400 hover:text-violet-700" title={`Remove ${label}`}>
      <X className="h-3 w-3" />
    </button>
  </span>
);

/**
 * FITSIOMAX STORE > Vendor — who supplies the stock, and which of it they supply.
 *
 * The list is org-wide, exactly as the item catalogue is: one vendor across the whole
 * organisation is what makes a spend figure add up and what lets two branches recognise
 * the same supplier. `branchId` only narrows the delivery totals on each row — a Branch
 * Admin is pinned to their own branch by the server whatever this sends, and a Super
 * Admin with none sees every branch's, which is the org-wide view that desk wants.
 *
 * The supply link is the point of the tab. A vendor carries the catalogue rows they
 * supply, and booking a delivery against them in Add Stock adds the item to that list on
 * its own — so the list describes what has actually been bought rather than what somebody
 * remembered to tick.
 */
export const VendorPanel = ({ branchId, canEdit = true, reloadToken }) => {
  const scope = branchId ? { branch_id: branchId } : {};

  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  // The typed-in category, held until it is added — a half-typed word is not a category.
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState(null);            // create / edit
  const [ledger, setLedger] = useState(null);          // { vendor, rows }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = branchId ? { branch_id: branchId } : {};
      const [rows, totals] = await Promise.all([listVendors(s), vendorSummary(s)]);
      setVendors(rows);
      setSummary(totals);
    } catch (e) {
      toast.error(errText(e, "Couldn't load the vendors"));
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load, reloadToken]);
  // The catalogue only changes when stock items are added, so it is fetched once rather
  // than with every vendor reload. It is org-wide and carries no counts, which is why it
  // has an endpoint of its own — /inventory/items would need a branch to answer.
  useEffect(() => { vendorCatalogue().then(setCatalogue).catch(() => {}); }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (catFilter && !vendorTags(v).includes(catFilter)) return false;
      if (!q) return true;
      return `${v.name} ${v.contact_person || ""} ${v.phone || ""} ${v.city || ""}`.toLowerCase().includes(q);
    });
  }, [vendors, search, catFilter]);

  /**
   * The categories to offer as filters: the ones the list actually carries, in the order
   * the form offers them and with anything typed in after.
   *
   * Deliberately not the whole suggestion list — a chip for Travel on a list where nobody
   * supplies travel filters to an empty table, and eleven of those is a row of dead
   * buttons above the thing you were trying to read.
   */
  const filterCats = useMemo(() => {
    const used = new Set(vendors.flatMap(vendorTags));
    const known = VENDOR_SERVICE_CATEGORIES.filter((c) => used.has(c));
    const own = [...used].filter((c) => !VENDOR_SERVICE_CATEGORIES.includes(c)).sort();
    return [...known, ...own];
  }, [vendors]);

  // A filter on a category that was the last vendor's, or was just renamed away, would
  // otherwise leave the table empty with no chip lit to explain why.
  useEffect(() => {
    if (catFilter && !filterCats.includes(catFilter)) setCatFilter("");
  }, [filterCats, catFilter]);

  // What the form offers to link. Narrowed to the shelves the vendor is marked as
  // supplying, because a list of every tablet, supplement and piece of equipment is not a
  // picker; with no shelf picked yet it shows everything rather than nothing.
  const pickableItems = useMemo(() => {
    const cats = draft?.categories || [];
    if (cats.length === 0) return catalogue;
    return catalogue.filter((i) => cats.includes(i.category));
  }, [catalogue, draft]);

  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res?.message || successMsg);
      await load();
      return true;
    } catch (e) {
      toast.error(errText(e, "That didn't go through"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The form is opened and closed through these rather than setDraft, so the typed-in
  // category box never survives from one vendor to the next.
  const openDraft = (d) => { setTyped(""); setDraft(d); };
  const closeDraft = () => { setTyped(""); setDraft(null); };

  const payloadOf = (d) => ({
    name: d.name.trim(),
    contact_person: d.contact_person.trim(),
    phone: d.phone.trim(),
    email: d.email.trim(),
    gst_number: d.gst_number.trim(),
    city: d.city.trim(),
    address: d.address.trim(),
    payment_terms: d.payment_terms.trim(),
    notes: d.notes.trim(),
    services: d.services,
    categories: d.categories,
    item_ids: d.item_ids,
    active: d.active,
  });

  const saveVendor = async () => {
    if (!draft.name.trim()) { toast.error("Vendor name is required"); return; }
    const ok = await run(
      () => (draft.id ? updateVendor(draft.id, payloadOf(draft), scope) : createVendor(payloadOf(draft))),
      draft.id ? "Vendor updated" : "Vendor added",
    );
    if (ok) closeDraft();
  };

  // Switching a vendor off is the ordinary end of one — they stop appearing in Add Stock
  // and their deliveries stay readable. Deleting is only for a row that never bought
  // anything, and the server is the one that enforces that.
  const toggleActive = (v) => run(
    () => updateVendor(v.id, { ...payloadOf(toDraft(v)), active: !(v.active !== false) }, scope),
    v.active !== false ? `${v.name} switched off` : `${v.name} switched on`,
  );

  const removeVendor = async (v) => {
    if (!window.confirm(`Remove ${v.name} from the vendor list?`)) return;
    await run(() => deleteVendor(v.id), "Vendor removed");
  };

  const openLedger = async (v) => {
    try {
      const res = await vendorDeliveries(v.id, scope);
      setLedger({ vendor: v, rows: res.deliveries || [] });
    } catch (e) {
      toast.error(errText(e, "Couldn't load the deliveries"));
    }
  };

  const toggleIn = (list, key) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const toggleShelf = (key) => setDraft((d) => {
    const categories = toggleIn(d.categories, key);
    // Items belonging to a shelf that has just been un-picked are dropped with it —
    // otherwise the vendor keeps a link the form no longer shows, and the next save would
    // look like it lost it.
    const allowed = new Set(catalogue.filter((i) => categories.length === 0 || categories.includes(i.category)).map((i) => i.id));
    return { ...d, categories, item_ids: d.item_ids.filter((id) => allowed.has(id)) };
  });

  /** A suggestion chip. Off puts it on the vendor, on takes it back off. */
  const toggleService = (name) => setDraft((d) => ({ ...d, services: toggleIn(d.services, name) }));

  /**
   * A category the branch typed. Matched against the suggestions case-insensitively
   * first, so typing "water" lights the Water chip rather than sitting beside it as a
   * second category that filters and totals on its own.
   */
  const addTyped = () => {
    const name = typed.trim().replace(/\s+/g, " ");
    if (!name) return;
    const known = VENDOR_SERVICE_CATEGORIES.find((c) => c.toLowerCase() === name.toLowerCase());
    const final = known || name;
    if (final.length > VENDOR_SERVICE_MAX_LEN) {
      toast.error(`Keep a category under ${VENDOR_SERVICE_MAX_LEN} characters`);
      return;
    }
    if (draft.services.some((c) => c.toLowerCase() === final.toLowerCase())) {
      setTyped("");
      return;
    }
    if (draft.services.length >= VENDOR_SERVICE_MAX_COUNT) {
      toast.error(`A vendor can carry ${VENDOR_SERVICE_MAX_COUNT} categories at most`);
      return;
    }
    setDraft({ ...draft, services: [...draft.services, final] });
    setTyped("");
  };

  const empty = loading || visible.length === 0;

  const RowActions = ({ vendor }) => (
    <>
      <Button
        size="sm" variant="outline" className="h-8 border-sky-200 text-sky-700 hover:bg-sky-50"
        onClick={() => openLedger(vendor)}
        data-testid={`vendor-deliveries-${vendor.id}`}
      >
        <History className="mr-1 h-3.5 w-3.5" /> Deliveries
      </Button>
      {canEdit && (
        <>
          <button
            onClick={() => toggleActive(vendor)}
            className={`rounded p-1.5 ${vendor.active !== false ? "text-emerald-500 hover:bg-emerald-50" : "text-slate-300 hover:bg-slate-100"}`}
            title={vendor.active !== false ? "Switch off" : "Switch on"}
            data-testid={`vendor-toggle-${vendor.id}`}
          >
            <Power className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => openDraft(toDraft(vendor))}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-600"
            title="Edit" data-testid={`vendor-edit-${vendor.id}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => removeVendor(vendor)}
            className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            title="Delete" data-testid={`vendor-delete-${vendor.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </>
  );

  const Supplies = ({ vendor }) => (
    <div className="flex flex-wrap items-center gap-1">
      {(vendor.items || []).length === 0 ? (
        <span className="text-[11px] text-slate-400">Nothing linked yet</span>
      ) : (
        <>
          {vendor.items.slice(0, 3).map((i) => (
            <span key={i.id} className="rounded-[5px] border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{i.name}</span>
          ))}
          {vendor.items.length > 3 && (
            <span className="text-[11px] font-semibold text-slate-400">+{vendor.items.length - 3} more</span>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="vendor-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Vendors" value={summary?.vendors ?? "—"} sub={`${summary?.active ?? 0} switched on`} icon={Truck} color="#7c3aed" />
        <StatTile label="Linked Stock" value={summary?.linked_items ?? "—"} sub="items with a vendor" icon={Boxes} color="#0284c7" />
        <StatTile label="Deliveries" value={summary?.deliveries ?? "—"} sub="stock booked in" icon={PackageCheck} color="#d97706" />
        <StatTile label="Purchase Spend" value={fmt(summary?.spend)} sub="at cost price" icon={IndianRupee} color="#059669" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor, contact or city..."
              className={`${inputCls} pl-9`}
              data-testid="vendor-search"
            />
          </div>
          {filterCats.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="vendor-cat-filter">
              <ShelfChip label="All" on={catFilter === ""} onClick={() => setCatFilter("")} testid="vendor-cat-filter-all" />
              {filterCats.map((c) => (
                <ShelfChip
                  key={c}
                  label={c}
                  on={catFilter === c}
                  onClick={() => setCatFilter(catFilter === c ? "" : c)}
                  testid={`vendor-cat-filter-${c}`}
                />
              ))}
            </div>
          )}
          {canEdit && (
            <Button onClick={() => openDraft({ ...emptyDraft })} className="bg-violet-600 text-white hover:bg-violet-700" data-testid="vendor-new">
              <Plus className="mr-1.5 h-4 w-4" /> New Vendor
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden" data-testid="vendor-table-card">
        <CardContent className="p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendors</p>
          </div>

          {empty ? (
            <p className="px-4 py-14 text-center text-sm text-slate-400" data-testid="vendor-empty">
              {loading ? "Loading vendors..."
                : vendors.length === 0 ? "No vendors yet — add the ones the branch buys stock from."
                  : "Nothing matches that search."}
            </p>
          ) : (
            <>
              {/* Cards on a phone. The row is eight columns wide before it is readable and
                  the actions are the first thing to fall off the right edge. */}
              <div className="space-y-2 p-3 sm:hidden" data-testid="vendor-list-mobile">
                {visible.map((v, i) => (
                  <div key={v.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`vendor-card-${v.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">
                          <span className="mr-1.5 font-semibold text-slate-300">{i + 1}.</span>{v.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">{v.contact_person || "No contact person"}{v.phone ? ` · ${v.phone}` : ""}</p>
                      </div>
                      {v.active === false && (
                        <span className="shrink-0 rounded-[5px] border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-500">Off</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {vendorTags(v).map((c) => <ShelfChip key={c} label={c} />)}
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      {v.items_count} item{v.items_count === 1 ? "" : "s"} · {v.deliveries} deliver{v.deliveries === 1 ? "y" : "ies"} · {fmt(v.spend)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <RowActions vendor={v} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block" data-testid="vendor-list-desktop">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="w-12 px-4 py-2.5 font-semibold">S.No</th>
                      <th className="px-4 py-2.5 font-semibold">Vendor</th>
                      <th className="px-4 py-2.5 font-semibold">Contact</th>
                      <th className="px-4 py-2.5 font-semibold">Category</th>
                      <th className="px-4 py-2.5 font-semibold">Stock Linked</th>
                      <th className="px-4 py-2.5 font-semibold">Deliveries</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((v, i) => (
                      <tr key={v.id} className={`hover:bg-slate-50 ${v.active === false ? "opacity-60" : ""}`} data-testid={`vendor-row-${v.id}`}>
                        {/* A position in the list on screen, never an id — every action
                            here goes against the vendor's own id. */}
                        <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">
                            {v.name}
                            {v.active === false && <span className="ml-1.5 rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Off</span>}
                          </p>
                          <p className="text-[11px] text-slate-400">{v.city || "—"}{v.gst_number ? ` · ${v.gst_number}` : ""}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <p>{v.contact_person || "—"}</p>
                          <p className="text-[11px] text-slate-400">{v.phone || v.email || "No number"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {vendorTags(v).length === 0
                              ? <span className="text-[11px] text-slate-400">—</span>
                              : vendorTags(v).map((c) => <ShelfChip key={c} label={c} />)}
                          </div>
                        </td>
                        <td className="px-4 py-3"><Supplies vendor={v} /></td>
                        <td className="px-4 py-3 text-slate-600">
                          {v.deliveries}
                          <span className="block text-[11px] text-slate-400">{fmt(v.spend)} · {v.last_supplied_at ? when(v.last_supplied_at) : "never"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <RowActions vendor={v} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {draft && (
        <Modal
          title={draft.id ? "Edit Vendor" : "New Vendor"}
          subtitle="Shared across branches — each branch books its own deliveries"
          onClose={closeDraft}
          testid="vendor-modal"
          footer={<>
            <Button variant="outline" onClick={closeDraft} data-testid="vendor-cancel">Cancel</Button>
            <Button className="bg-violet-600 text-white hover:bg-violet-700" disabled={busy} onClick={saveVendor} data-testid="vendor-save">
              {draft.id ? "Save Changes" : "Add Vendor"}
            </Button>
          </>}
        >
          {/* What the form is for, said once at the top rather than inferred from eight
              labels. Only on a new vendor: by the time somebody is editing one they know
              what a vendor is, and a note that never goes away stops being read. */}
          {!draft.id && (
            <div className="rounded-lg border border-violet-100 bg-violet-50/70 px-3 py-2.5 text-[12px] leading-relaxed" data-testid="vendor-explainer">
              <p className="font-semibold text-violet-900">A vendor is anyone the branch pays for something that arrives.</p>
              <p className="mt-0.5 text-violet-700">
                The water can supplier, the broadband and phone line, the AC man, the housekeeping agency, the tablet
                distributor. Add them once — every branch shares the list. For a vendor that supplies stock, pick them under{" "}
                <span className="font-semibold">Add</span> on a Tablet, Supplement or Equipment row and their deliveries,
                spend and supply list fill in on their own.
              </p>
            </div>
          )}

          <Field label="Vendor Name *">
            <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Sri Medicals Distributors" data-testid="vendor-name" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact Person">
              <input className={inputCls} value={draft.contact_person} onChange={(e) => setDraft({ ...draft, contact_person: e.target.value })} placeholder="Who to call" data-testid="vendor-contact" />
            </Field>
            <Field label="Phone">
              <input className={inputCls} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="10 digits" data-testid="vendor-phone" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input className={inputCls} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="orders@vendor.com" data-testid="vendor-email" />
            </Field>
            <Field label="GST Number" hint="15 characters, if they bill with one">
              <input className={inputCls} value={draft.gst_number} onChange={(e) => setDraft({ ...draft, gst_number: e.target.value.toUpperCase() })} placeholder="33ABCDE1234F1Z5" data-testid="vendor-gst" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <input className={inputCls} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="Chennai" data-testid="vendor-city" />
            </Field>
            <Field label="Payment Terms">
              <input className={inputCls} value={draft.payment_terms} onChange={(e) => setDraft({ ...draft, payment_terms: e.target.value })} placeholder="e.g. 30 days credit" data-testid="vendor-terms" />
            </Field>
          </div>
          <Field label="Address">
            <textarea rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Where the invoices come from" data-testid="vendor-address" />
          </Field>

          {/* What the vendor is. The suggestions are the categories a payment to them is
              filed under on the Finance side, so the two screens say the same word about
              the same supplier — and the box underneath is for the ones that list has no
              word for, which is every branch's most interesting vendor. */}
          <Field
            label="Category"
            hint={draft.services.length
              ? `${draft.services.length} of ${VENDOR_SERVICE_MAX_COUNT} · first one shows on the list`
              : "What they supply — tap the ones that fit, or type your own"}
          >
            <div className="flex flex-wrap gap-1.5" data-testid="vendor-services">
              {VENDOR_SERVICE_CATEGORIES.map((c) => (
                <ShelfChip
                  key={c}
                  label={c}
                  on={draft.services.includes(c)}
                  onClick={() => toggleService(c)}
                  testid={`vendor-service-${c}`}
                />
              ))}
              {draft.services.filter((c) => !VENDOR_SERVICE_CATEGORIES.includes(c)).map((c) => (
                <CustomChip key={c} label={c} onRemove={() => toggleService(c)} testid={`vendor-service-own-${c}`} />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                className={inputCls}
                value={typed}
                maxLength={VENDOR_SERVICE_MAX_LEN}
                onChange={(e) => setTyped(e.target.value)}
                // Enter inside a form field would otherwise submit nothing and close
                // nothing — here it is the obvious way to finish typing a category.
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
                placeholder="Something else — e.g. Laundry, Lift AMC, Pest Control"
                data-testid="vendor-service-input"
              />
              <Button
                type="button" variant="outline" className="shrink-0 border-violet-200 text-violet-700 hover:bg-violet-50"
                onClick={addTyped} disabled={!typed.trim()} data-testid="vendor-service-add"
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </Field>

          <Field label="Supplies These Shelves" hint="Only for stock vendors — picks which stock can be linked below">
            <div className="flex flex-wrap gap-1.5" data-testid="vendor-shelves">
              {SHELVES.map((s) => (
                <ShelfChip
                  key={s.key}
                  label={s.label}
                  on={draft.categories.includes(s.key)}
                  onClick={() => toggleShelf(s.key)}
                  testid={`vendor-shelf-${s.key}`}
                />
              ))}
            </div>
          </Field>

          {/* The link to stock. Booking a delivery against this vendor in Add Stock ticks
              an item here on its own, so this is for saying so up front — before anything
              has been bought — and for correcting it afterwards. */}
          <Field
            label={<span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />Stock They Supply</span>}
            hint={`${draft.item_ids.length} linked · ticked automatically when stock is booked in against them`}
          >
            {pickableItems.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400" data-testid="vendor-items-empty">
                {catalogue.length === 0
                  ? "No stock in the catalogue yet — add tablets, supplements or equipment first."
                  : "Nothing on the picked shelves yet."}
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-1.5" data-testid="vendor-items">
                {pickableItems.map((i) => {
                  const on = draft.item_ids.includes(i.id);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, item_ids: toggleIn(draft.item_ids, i.id) })}
                      className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs ${
                        on ? "border-violet-200 bg-violet-50 font-semibold text-violet-700" : "border-transparent text-slate-600 hover:bg-slate-50"
                      }`}
                      data-testid={`vendor-item-${i.id}`}
                    >
                      <span className="truncate">{i.name}{i.brand ? ` · ${i.brand}` : ""}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{SHELF_LABEL[i.category] || i.category}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Notes">
            <textarea rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Delivery days, minimum order, anything worth remembering" data-testid="vendor-notes" />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} data-testid="vendor-active" />
            Available in Add Stock
          </label>
        </Modal>
      )}

      {ledger && (
        <Modal
          title="Deliveries"
          subtitle={`${ledger.vendor.name} · ${ledger.rows.length} booked in`}
          accent="bg-sky-600"
          onClose={() => setLedger(null)}
          testid="vendor-ledger-modal"
          footer={<Button variant="outline" onClick={() => setLedger(null)} data-testid="vendor-ledger-close">Close</Button>}
        >
          {ledger.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400" data-testid="vendor-ledger-empty">
              Nothing has come in from this vendor yet. Book it in from the stock shelf's Add button.
            </p>
          ) : (
            <div className="space-y-2">
              {ledger.rows.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-2.5" data-testid={`vendor-ledger-${m.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{m.item_name}</p>
                    <p className="shrink-0 text-sm font-bold text-slate-700">+{m.qty}</p>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {when(m.created_at)} · {fmt(m.amount)}
                    {m.note ? ` · ${m.note}` : ""}
                    {m.by_user_name ? ` · ${m.by_user_name}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Where the contact details actually get used, said once rather than on every row:
          the tab is a directory, and a directory that doesn't say how to reach anyone is
          a list of names. */}
      {!loading && vendors.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />Shared across every branch</span>
          <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />Ordering contact</span>
          <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />Invoices</span>
        </p>
      )}
    </div>
  );
};

export default VendorPanel;
