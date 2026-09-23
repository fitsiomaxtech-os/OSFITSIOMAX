import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Truck, Plus, Search, Pencil, Trash2, History, IndianRupee, Power, Wallet,
  Building2, Phone, Mail, Boxes, X, UserRound, Package,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { StatTile } from "@/components/ui/stat-tile";
import {
  listVendors, vendorSummary, vendorDeliveries, createVendor, updateVendor, deleteVendor,
  vendorStock, createVendorStock, deleteVendorStock, getBranches,
} from "@/lib/api";
// The dialog shell, the labelled field and the input class the stock panel already uses.
// Imported rather than copied: the two boards sit on the same tab row and a vendor form
// with its own geometry would read as a different product.
import { Modal, Field, inputCls, fmt, when, errText } from "@/components/branch/StoreInventoryPanel";

/**
 * The three stock shelves a vendor can turn out to supply — the same keys the inventory
 * catalogue and the backend's VALID_CATEGORIES use.
 *
 * Nothing on this tab sets them. They are written by booking a delivery against a vendor
 * in Add Stock, so a vendor's shelves are where their stock actually landed rather than
 * where somebody said it would.
 */
const SHELVES = [
  { key: "tablet", label: "Tablet" },
  { key: "supplementary", label: "Supplementary" },
  { key: "equipment", label: "Equipment" },
];

const SHELF_LABEL = Object.fromEntries(SHELVES.map((s) => [s.key, s.label]));

/**
 * How a unit of stock is counted — VALID_UNITS in backend/routers/v3_inventory.py, whole
 * rather than the per-shelf subsets the sales catalogue offers.
 *
 * The Stock Detail book is what gets bought, which is wider than what gets sold: the same
 * supplement is sold by the bottle and bought by the box, and a water can is neither.
 */
const UNITS = ["Strip", "Bottle", "Tube", "Sachet", "Pack", "Piece", "Box", "Set", "Pair"];

/** Matches VALID_PAYMENT_MODES in backend/routers/v3_inventory.py. */
const PAYMENT_MODES = [
  { key: "cash", label: "Cash" },
  { key: "upi", label: "UPI" },
  { key: "card", label: "Card" },
  { key: "account_transfer", label: "Account Transfer" },
];

/** The typed-in city, kept out of the branch list by a value no branch can have. */
const OTHER_CITY = "__other__";

// Row keys, so a row being removed doesn't make React reuse the one below it and carry
// the wrong text into it. Never saved — the server sees the fields and nothing else.
let rowKey = 0;
const blankRow = () => ({ key: `r${++rowKey}`, name: "", stock_type: "", count: "", unit: "", unit_price: "" });

const rowTotal = (r) => (Number(r.count) || 0) * (Number(r.unit_price) || 0);

/**
 * The vendor draft carries more than the form shows.
 *
 * Email, GST, address, payment terms and notes came off the form in the redesign, but a
 * vendor saved before that still holds them and a save sends the whole record — so they
 * ride along untouched rather than being blanked by a form that no longer asks. The same
 * goes for `active`, which the row's own power button owns now.
 */
const emptyDraft = {
  id: null, name: "", contact_person: "", phone: "", email: "", gst_number: "",
  city: "", address: "", payment_terms: "", notes: "",
  stock_ids: [], amount: "", paid_amount: "", payment_mode: "", payment_date: "",
  active: true,
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
  stock_ids: v.stock_ids || [],
  amount: v.amount ? String(v.amount) : "",
  paid_amount: v.paid_amount ? String(v.paid_amount) : "",
  payment_mode: v.payment_mode || "",
  payment_date: v.payment_date || "",
  active: v.active !== false,
});

/** A shelf chip, and the filter row above the table. */
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

/** A required field's label — the red star the reference marks four of them with. */
const Req = ({ children }) => <>{children} <span className="text-rose-500">*</span></>;

/**
 * One titled section of a form. A tinted strip with an icon and a name, then the fields.
 *
 * The strip is doing real work, not decoration: the vendor form asks for three unrelated
 * things at once — who they are, what they supply, what has been paid — and without a
 * line between them it reads as one list of eleven boxes.
 */
const Panel = ({ title, icon: Icon, tint, children, className = "", testid }) => (
  <section className={`overflow-hidden rounded-xl border border-slate-200 ${className}`} data-testid={`vendor-panel-${testid}`}>
    <div className={`flex items-center gap-2 px-4 py-2.5 ${tint}`}>
      <Icon className="h-4 w-4" />
      <p className="text-sm font-bold">{title}</p>
    </div>
    <div className="space-y-3 p-4">{children}</div>
  </section>
);

/** A money figure with its name over it, read-only. */
const Readout = ({ label, value, tone = "text-slate-600" }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">{label}</label>
    <div className={`flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold ${tone}`}>{value}</div>
  </div>
);

/**
 * FITSIOMAX STORE > Vendor — who the organisation buys from, what it buys, what it owes.
 *
 * Two books, added from the two buttons above the table. Stock Detail is what gets bought
 * and at what rate, typed by hand because a purchase is known long before anybody decides
 * whether the thing is ever sold over a counter. Vendor is who supplies it, which of it
 * they supply, and what has been paid against the bill.
 *
 * Both are org-wide, exactly as the sales catalogue is: one vendor across the whole
 * organisation is what makes a spend figure add up and what lets two branches recognise
 * the same supplier. `branchId` only narrows the delivery totals on each row — a Branch
 * Admin is pinned to their own branch by the server whatever this sends, and a Super
 * Admin with none sees every branch's.
 *
 * The delivery totals, the Shelves column and the Supplies list come from somewhere else
 * entirely: the stock ledger, written by Add Stock on the shelf itself. Nothing on this
 * tab moves stock, which is why nothing on it needs to know which branch you are.
 */
export const VendorPanel = ({ branchId, canEdit = true, reloadToken }) => {
  const scope = branchId ? { branch_id: branchId } : {};

  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [stock, setStock] = useState([]);
  const [search, setSearch] = useState("");
  const [shelfFilter, setShelfFilter] = useState("");
  // Where the City dropdown's options come from. Branches carry no city of their own, so
  // this is their names — which is what the org calls the places it operates in — with
  // the cities already on vendors folded in and a typed one always possible.
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState(null);            // the vendor form
  const [stockDraft, setStockDraft] = useState(null);  // the stock detail form
  const [ledger, setLedger] = useState(null);          // { vendor, rows }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = branchId ? { branch_id: branchId } : {};
      const [rows, totals, book] = await Promise.all([listVendors(s), vendorSummary(s), vendorStock()]);
      setVendors(rows);
      setSummary(totals);
      setStock(book);
    } catch (e) {
      toast.error(errText(e, "Couldn't load the vendors"));
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load, reloadToken]);

  // The branch list doesn't change while a vendor is being typed in, so it is fetched once
  // rather than with every reload. A failure costs the dropdown its suggestions and
  // nothing else — the city can still be typed.
  useEffect(() => {
    getBranches()
      .then((rows) => setPlaces(rows.map((b) => (b.branch_name || "").trim()).filter(Boolean)))
      .catch(() => {});
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (shelfFilter && !(v.categories || []).includes(shelfFilter)) return false;
      if (!q) return true;
      return `${v.name} ${v.contact_person || ""} ${v.phone || ""} ${v.city || ""}`.toLowerCase().includes(q);
    });
  }, [vendors, search, shelfFilter]);

  /** Branch names and the cities already in use, deduplicated and sorted. */
  const cityOptions = useMemo(() => {
    const all = [...places, ...vendors.map((v) => (v.city || "").trim())].filter(Boolean);
    return [...new Set(all)].sort((a, b) => a.localeCompare(b));
  }, [places, vendors]);

  const stockById = useMemo(() => Object.fromEntries(stock.map((r) => [r.id, r])), [stock]);

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

  // ---------------------------------------------------------------- the vendor form

  // A city the dropdown doesn't offer can only have been typed, so the box stays open on
  // it — including for a vendor saved before the dropdown existed.
  const isTypedCity = !!draft && !!draft.city.trim() && !cityOptions.includes(draft.city);

  const linkedTotal = (ids) => ids.reduce((sum, id) => sum + Number(stockById[id]?.total || 0), 0);

  /**
   * Ticking a stock row also refills the bill.
   *
   * The amount stays typeable afterwards, because a bill carries delivery, discount and
   * tax that no rate on a line knows about — but it opens on what the lines add up to,
   * which is right far more often than nought is.
   */
  const toggleStock = (id) => setDraft((d) => {
    const stock_ids = d.stock_ids.includes(id) ? d.stock_ids.filter((x) => x !== id) : [...d.stock_ids, id];
    return { ...d, stock_ids, amount: stock_ids.length ? String(linkedTotal(stock_ids)) : "" };
  });

  const payloadOf = (d) => ({
    name: d.name.trim(),
    contact_person: d.contact_person.trim(),
    phone: d.phone.trim(),
    city: d.city.trim(),
    stock_ids: d.stock_ids,
    amount: Number(d.amount) || 0,
    paid_amount: Number(d.paid_amount) || 0,
    payment_mode: d.payment_mode,
    payment_date: d.payment_date,
    // Carried through untouched — the form stopped asking for these, it didn't delete
    // them. See emptyDraft.
    email: d.email.trim(),
    gst_number: d.gst_number.trim(),
    address: d.address.trim(),
    payment_terms: d.payment_terms.trim(),
    notes: d.notes.trim(),
    active: d.active,
  });

  const saveVendor = async () => {
    // The four stars on the form, in the order they are read. Checked here rather than on
    // the server, which still asks only for a name: an existing vendor saved before these
    // were required would otherwise be unsavable, and the row's power button sends the
    // whole record through this same endpoint just to switch one off.
    const missing = [
      [!draft.name.trim(), "Vendor name is required"],
      [!draft.contact_person.trim(), "Person name is required"],
      [!draft.phone.trim(), "Phone number is required"],
      [!draft.city.trim(), "City is required"],
    ].find(([bad]) => bad);
    if (missing) { toast.error(missing[1]); return; }
    const ok = await run(
      () => (draft.id ? updateVendor(draft.id, payloadOf(draft), scope) : createVendor(payloadOf(draft))),
      draft.id ? "Vendor updated" : "Vendor added",
    );
    if (ok) setDraft(null);
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

  // ---------------------------------------------------------------- the stock form

  const setRow = (key, patch) => setStockDraft((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setStockDraft((rows) => [...rows, blankRow()]);
  const dropRow = (key) => setStockDraft((rows) => {
    const left = rows.filter((r) => r.key !== key);
    return left.length ? left : [blankRow()];
  });

  const saveStock = async () => {
    // An untouched row is not an entry — somebody hit Add Another Stock and changed their
    // mind, which shouldn't be an error message.
    const filled = stockDraft.filter((r) => r.name.trim() || r.stock_type.trim() || r.count || r.unit_price);
    if (filled.length === 0) { toast.error("Type at least one stock name"); return; }
    if (filled.some((r) => !r.name.trim())) { toast.error("Every row needs a stock name"); return; }
    const ok = await run(
      () => createVendorStock(filled.map((r) => ({
        name: r.name.trim(),
        stock_type: r.stock_type.trim(),
        count: Number(r.count) || 0,
        unit: r.unit,
        unit_price: Number(r.unit_price) || 0,
      }))),
      "Stock added",
    );
    if (ok) setStockDraft(null);
  };

  const removeStock = async (row) => {
    const msg = row.vendor_count
      ? `${row.name} is on ${row.vendor_count} vendor${row.vendor_count === 1 ? "" : "s"}. Remove it from the stock list and unlink it from them?`
      : `Remove ${row.name} from the stock list?`;
    if (!window.confirm(msg)) return;
    await run(() => deleteVendorStock(row.id), "Stock removed");
  };

  // ---------------------------------------------------------------- the table

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
            onClick={() => setDraft(toDraft(vendor))}
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
      {(vendor.stock || []).length === 0 ? (
        <span className="text-[11px] text-slate-400">Nothing linked yet</span>
      ) : (
        <>
          {vendor.stock.slice(0, 3).map((r) => (
            <span key={r.id} className="rounded-[5px] border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{r.name}</span>
          ))}
          {vendor.stock.length > 3 && (
            <span className="text-[11px] font-semibold text-slate-400">+{vendor.stock.length - 3} more</span>
          )}
        </>
      )}
    </div>
  );

  /** What is on the bill and what is left of it. */
  const Payment = ({ vendor }) => {
    if (!vendor.amount) return <span className="text-[11px] text-slate-400">—</span>;
    const owed = Number(vendor.balance || 0);
    return (
      <>
        <p className="font-medium text-slate-700">{fmt(vendor.amount)}</p>
        <p className={`text-[11px] ${owed > 0 ? "font-semibold text-amber-600" : "text-emerald-600"}`}>
          {owed > 0 ? `${fmt(owed)} due` : "Settled"}
          {vendor.payment_date ? ` · ${vendor.payment_date}` : ""}
        </p>
      </>
    );
  };

  return (
    <div className="space-y-4" data-testid="vendor-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Vendors" value={summary?.vendors ?? "—"} sub={`${summary?.active ?? 0} switched on`} icon={Truck} color="#7c3aed" />
        <StatTile label="Stock Items" value={stock.length || "—"} sub="in the stock list" icon={Boxes} color="#0284c7" />
        <StatTile label="Outstanding" value={fmt(summary?.outstanding)} sub="still to pay vendors" icon={Wallet} color="#d97706" />
        <StatTile label="Purchase Spend" value={fmt(summary?.spend)} sub="stock booked in, at cost" icon={IndianRupee} color="#059669" />
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
          <div className="flex flex-wrap items-center gap-1.5" data-testid="vendor-shelf-filter">
            <ShelfChip label="All shelves" on={shelfFilter === ""} onClick={() => setShelfFilter("")} testid="vendor-shelf-filter-all" />
            {SHELVES.map((sh) => (
              <ShelfChip
                key={sh.key}
                label={sh.label}
                on={shelfFilter === sh.key}
                onClick={() => setShelfFilter(shelfFilter === sh.key ? "" : sh.key)}
                testid={`vendor-shelf-filter-${sh.key}`}
              />
            ))}
          </div>
          {canEdit && (
            <>
              {/* Stock first, and in its own colour: it is the one that has to happen
                  first. A vendor form opened before anything is in the stock list has
                  nothing to link, and this is the button that says so. */}
              <Button
                variant="outline"
                onClick={() => setStockDraft([blankRow()])}
                className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                data-testid="vendor-stock-new"
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add Stock Detail
              </Button>
              <Button onClick={() => setDraft({ ...emptyDraft })} className="bg-violet-600 text-white hover:bg-violet-700" data-testid="vendor-new">
                <Plus className="mr-1.5 h-4 w-4" /> Add Vendor
              </Button>
            </>
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
                : vendors.length === 0 ? "No vendors yet — add the stock first, then the vendor who supplies it."
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
                      {(v.categories || []).map((c) => <ShelfChip key={c} label={SHELF_LABEL[c] || c} />)}
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      {v.stock_count} stock · {v.deliveries} deliver{v.deliveries === 1 ? "y" : "ies"}
                      {v.amount ? ` · ${fmt(v.amount)} billed` : ""}
                      {v.balance > 0 ? ` · ${fmt(v.balance)} due` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <RowActions vendor={v} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block" data-testid="vendor-list-desktop">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="w-12 px-4 py-2.5 font-semibold">S.No</th>
                      <th className="px-4 py-2.5 font-semibold">Vendor</th>
                      <th className="px-4 py-2.5 font-semibold">Contact</th>
                      <th className="px-4 py-2.5 font-semibold">Shelves</th>
                      <th className="px-4 py-2.5 font-semibold">Stock</th>
                      <th className="px-4 py-2.5 font-semibold">Payment</th>
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
                            {(v.categories || []).length === 0
                              ? <span className="text-[11px] text-slate-400">—</span>
                              : v.categories.map((c) => <ShelfChip key={c} label={SHELF_LABEL[c] || c} />)}
                          </div>
                        </td>
                        <td className="px-4 py-3"><Supplies vendor={v} /></td>
                        <td className="px-4 py-3"><Payment vendor={v} /></td>
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

      {stockDraft && (
        <Modal
          title="Add Stock Detail"
          onClose={() => setStockDraft(null)}
          testid="stock-modal"
          light
          width="max-w-3xl"
          bodyCls="p-4 space-y-4"
          footer={<>
            <Button variant="outline" onClick={() => setStockDraft(null)} data-testid="stock-cancel">Cancel</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy} onClick={saveStock} data-testid="stock-save">
              Save Stock
            </Button>
          </>}
        >
          <Panel title="Stock Details" icon={Package} tint="bg-emerald-50/70 text-emerald-700" testid="stock-entry">
            {stockDraft.map((r, idx) => (
              <div key={r.key} className={idx > 0 ? "border-t border-slate-100 pt-3" : ""} data-testid={`stock-row-${idx}`}>
                {stockDraft.length > 1 && (
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Stock {idx + 1}</span>
                    <button type="button" onClick={() => dropRow(r.key)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove this row" data-testid={`stock-row-drop-${idx}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={<Req>Stock Name</Req>}>
                    <input className={inputCls} value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} placeholder="Enter stock name" data-testid={`stock-row-name-${idx}`} />
                  </Field>
                  <Field label="Stock Type">
                    <input className={inputCls} value={r.stock_type} onChange={(e) => setRow(r.key, { stock_type: e.target.value })} placeholder="e.g. Individual" data-testid={`stock-row-type-${idx}`} />
                  </Field>
                  <Field label="Stock Count">
                    <input type="number" min="0" className={inputCls} value={r.count} onChange={(e) => setRow(r.key, { count: e.target.value })} placeholder="Enter count" data-testid={`stock-row-count-${idx}`} />
                  </Field>
                  <Field label="Unit">
                    <select className={inputCls} value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} data-testid={`stock-row-unit-${idx}`}>
                      <option value="">Select unit</option>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Field>
                  <Field label="Unit Price">
                    <input type="number" min="0" className={inputCls} value={r.unit_price} onChange={(e) => setRow(r.key, { unit_price: e.target.value })} placeholder="Enter unit price" data-testid={`stock-row-price-${idx}`} />
                  </Field>
                  {/* Read-only because it is the count times the price and nothing else. A
                      box you could type a different number into would be a third figure
                      disagreeing with the two above it. */}
                  <Readout label="Total Price" value={fmt(rowTotal(r))} />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-300 px-3 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              data-testid="stock-row-add"
            >
              <Plus className="h-4 w-4" /> Add Another Stock
            </button>
          </Panel>

          {/* What is already in the book, so the same thing isn't typed twice under two
              spellings — the server refuses a duplicate name, and seeing the list is
              kinder than being told. */}
          {stock.length > 0 && (
            <div data-testid="stock-existing">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Already in the list</p>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
                {stock.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-slate-50" data-testid={`stock-existing-${r.id}`}>
                    <span className="min-w-0 truncate text-slate-700">
                      <span className="font-semibold">{r.name}</span>
                      {r.stock_type ? ` · ${r.stock_type}` : ""}
                      {r.count ? ` · ${r.count}${r.unit ? ` ${r.unit}` : ""}` : ""}
                      {r.unit_price ? ` · ${fmt(r.unit_price)} each` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStock(r)}
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Remove" data-testid={`stock-existing-drop-${r.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}

      {draft && (
        <Modal
          title={draft.id ? "Edit Vendor" : "Add Vendor"}
          onClose={() => setDraft(null)}
          testid="vendor-modal"
          light
          width="max-w-4xl"
          bodyCls="p-4"
          footer={<>
            <Button variant="outline" onClick={() => setDraft(null)} data-testid="vendor-cancel">Cancel</Button>
            <Button className="bg-violet-600 text-white hover:bg-violet-700" disabled={busy} onClick={saveVendor} data-testid="vendor-save">
              {draft.id ? "Save Changes" : "Save Vendor"}
            </Button>
          </>}
        >
          {/* Who they are is four short answers; what they supply and what has been paid
              are the other two thirds. They stack on a phone, vendor first. */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Vendor Details" icon={UserRound} tint="bg-violet-50/70 text-violet-700" testid="vendor-details">
              <Field label={<Req>Vendor Name</Req>}>
                <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Enter vendor name" data-testid="vendor-name" />
              </Field>
              <Field label={<Req>Person Name</Req>}>
                <input className={inputCls} value={draft.contact_person} onChange={(e) => setDraft({ ...draft, contact_person: e.target.value })} placeholder="Enter person name" data-testid="vendor-contact" />
              </Field>
              <Field label={<Req>Phone Number</Req>}>
                <input className={inputCls} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Enter phone number" data-testid="vendor-phone" />
              </Field>
              <Field label={<Req>City</Req>}>
                {/* The list is branch names and the cities already on vendors. Neither is
                    a city master — the OS has none — so Other keeps the box typeable
                    rather than making a vendor in a new town unsaveable. */}
                <select
                  className={inputCls}
                  value={isTypedCity ? OTHER_CITY : draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value === OTHER_CITY ? " " : e.target.value })}
                  data-testid="vendor-city"
                >
                  <option value="">Select city</option>
                  {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value={OTHER_CITY}>Other...</option>
                </select>
                {isTypedCity && (
                  <input
                    className={`${inputCls} mt-2`}
                    value={draft.city.trim()}
                    onChange={(e) => setDraft({ ...draft, city: e.target.value || " " })}
                    placeholder="Type the city"
                    data-testid="vendor-city-other"
                  />
                )}
              </Field>
            </Panel>

            <div className="space-y-4 lg:col-span-2">
              <Panel title="Linked Stock" icon={Package} tint="bg-emerald-50/70 text-emerald-700" testid="vendor-stock">
                {stock.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400" data-testid="vendor-stock-empty">
                    Nothing in the stock list yet. Close this and use <span className="font-semibold">Add Stock Detail</span> first.
                  </p>
                ) : (
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-1.5" data-testid="vendor-stock-list">
                    {stock.map((r) => {
                      const on = draft.stock_ids.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggleStock(r.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs ${
                            on ? "border-emerald-200 bg-emerald-50 font-semibold text-emerald-800" : "border-transparent text-slate-600 hover:bg-slate-50"
                          }`}
                          data-testid={`vendor-stock-${r.id}`}
                        >
                          <span className="min-w-0 truncate">
                            {r.name}
                            <span className="ml-1 font-normal text-slate-400">
                              {r.stock_type ? `· ${r.stock_type} ` : ""}
                              {r.count ? `· ${r.count}${r.unit ? ` ${r.unit}` : ""} ` : ""}
                              {r.unit_price ? `· ${fmt(r.unit_price)} each` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold">{fmt(r.total)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <Panel title="Payment to Vendor" icon={Wallet} tint="bg-amber-50/70 text-amber-700" testid="vendor-payment">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Total Amount">
                    {/* Filled in from the ticked stock and left typeable: a bill carries
                        delivery, discount and tax that no rate on a line knows about. */}
                    <input type="number" min="0" className={inputCls} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="Enter amount" data-testid="vendor-amount" />
                  </Field>
                  <Field label="Paid Amount">
                    <input type="number" min="0" className={inputCls} value={draft.paid_amount} onChange={(e) => setDraft({ ...draft, paid_amount: e.target.value })} placeholder="Enter paid" data-testid="vendor-paid" />
                  </Field>
                  <Readout
                    label="Balance"
                    value={fmt((Number(draft.amount) || 0) - (Number(draft.paid_amount) || 0))}
                    tone={(Number(draft.amount) || 0) - (Number(draft.paid_amount) || 0) > 0 ? "text-amber-700" : "text-emerald-700"}
                  />
                  <Field label="Payment Mode">
                    <select className={inputCls} value={draft.payment_mode} onChange={(e) => setDraft({ ...draft, payment_mode: e.target.value })} data-testid="vendor-mode">
                      <option value="">Not paid yet</option>
                      {PAYMENT_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Payment Date">
                    <input type="date" className={inputCls} value={draft.payment_date} onChange={(e) => setDraft({ ...draft, payment_date: e.target.value })} data-testid="vendor-paid-on" />
                  </Field>
                </div>
              </Panel>
            </div>
          </div>
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
