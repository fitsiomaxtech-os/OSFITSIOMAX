import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pill, Plus, PackagePlus, ShoppingCart, ArrowRightLeft, Pencil, Trash2,
  Search, AlertTriangle, Boxes, IndianRupee, X, History,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  listInventoryItems, inventorySummary, inventoryMovements,
  createInventoryItem, updateInventoryItem, deleteInventoryItem,
  addInventoryStock, sellInventoryItem, transferInventoryItem,
  getBranches,
} from "@/lib/api";

const UNITS = ["Strip", "Bottle", "Tube", "Sachet", "Pack", "Piece", "Box"];
const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "account_transfer", label: "Account Transfer" },
];

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const errText = (e, fallback) => e?.response?.data?.detail || fallback;

const MOVEMENT_META = {
  add: { label: "Added", classes: "border-sky-200 bg-sky-50 text-sky-700", sign: "+" },
  sale: { label: "Sold", classes: "border-emerald-200 bg-emerald-50 text-emerald-700", sign: "−" },
  transfer_out: { label: "Moved out", classes: "border-amber-200 bg-amber-50 text-amber-700", sign: "−" },
  transfer_in: { label: "Moved in", classes: "border-violet-200 bg-violet-50 text-violet-700", sign: "+" },
};

const when = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(0, 16); }
};

/** One dialog shell for all four forms, so a fifth doesn't arrive with its own geometry. */
const Modal = ({ title, subtitle, accent = "bg-violet-600", onClose, children, footer, testid }) => (
  <div
    className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4"
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    data-testid={testid}
  >
    <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className={`flex items-start justify-between gap-3 px-5 py-4 text-white ${accent}`}>
        <div className="min-w-0">
          <p className="text-base font-semibold">{title}</p>
          {subtitle && <p className="truncate text-xs text-white/80">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid={`${testid}-close`}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-5">{children}</div>
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>
    </div>
  </div>
);

const Field = ({ label, children, hint }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
  </div>
);

const inputCls = "h-9 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400";

/** Stock reads as a state, not a number: out, nearly out, or fine. */
const StockBadge = ({ qty, low }) => {
  const tone = qty <= 0 ? "border-rose-200 bg-rose-50 text-rose-700"
    : low ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 text-xs font-bold ${tone}`}>
      {qty <= 0 ? "Out of stock" : qty}
    </span>
  );
};

const StatTile = ({ label, value, sub, icon: Icon, color }) => (
  <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <span
      aria-hidden
      className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full"
      style={{ background: `linear-gradient(135deg, ${color}2E, ${color}0D)` }}
    />
    <Icon aria-hidden className="absolute right-3.5 top-3.5 h-4 w-4" style={{ color }} />
    <p className="pr-9 text-[11px] font-bold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-extrabold sm:text-2xl" style={{ color }}>{value}</p>
    <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>
  </div>
);

export const TabletInventoryPanel = () => {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [movements, setMovements] = useState([]);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // One at a time: whichever of the four forms is open, and the row it is about.
  const [itemDraft, setItemDraft] = useState(null);    // create / edit catalogue entry
  const [addDraft, setAddDraft] = useState(null);      // stock in
  const [sellDraft, setSellDraft] = useState(null);    // counter sale
  const [moveDraft, setMoveDraft] = useState(null);    // send to another branch

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, totals, ledger] = await Promise.all([
        listInventoryItems(),
        inventorySummary(),
        inventoryMovements({ limit: 50 }),
      ]);
      setItems(rows);
      setSummary(totals);
      setMovements(ledger.movements || []);
    } catch (e) {
      toast.error(errText(e, "Couldn't load the tablet stock"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Only needed by the move form, but fetched once here rather than on each open.
  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  // Filtered in the browser: the whole catalogue is already loaded, and a round trip per
  // keystroke would be slower than the list is long.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.name} ${i.brand || ""}`.toLowerCase().includes(q));
  }, [items, search]);

  const branchOptions = useMemo(
    () => branches.map((b) => ({ id: b.id, name: b.branch_name || b.name || "Unnamed branch" })),
    [branches],
  );

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

  const saveItem = async () => {
    const d = itemDraft;
    if (!d.name.trim()) { toast.error("Name is required"); return; }
    const payload = {
      category: "tablet",
      name: d.name.trim(),
      brand: d.brand.trim(),
      unit: d.unit,
      sale_price: Number(d.sale_price) || 0,
      cost_price: Number(d.cost_price) || 0,
      low_stock_at: Number(d.low_stock_at) || 0,
      notes: d.notes.trim(),
    };
    const ok = await run(
      () => (d.id ? updateInventoryItem(d.id, payload) : createInventoryItem(payload)),
      d.id ? "Tablet updated" : "Tablet added to the catalogue",
    );
    if (ok) setItemDraft(null);
  };

  const removeItem = async (item) => {
    // The server refuses while any branch still holds stock and says where it is, so the
    // only thing worth confirming here is the intent.
    if (!window.confirm(`Remove ${item.name} from the catalogue?`)) return;
    await run(() => deleteInventoryItem(item.id), "Tablet removed");
  };

  const submitAdd = async () => {
    const qty = Number(addDraft.qty);
    if (!qty || qty < 1) { toast.error("Quantity must be at least 1"); return; }
    const ok = await run(() => addInventoryStock(addDraft.item.id, {
      qty,
      cost_price: addDraft.cost_price === "" ? null : Number(addDraft.cost_price),
      supplier: addDraft.supplier.trim(),
      note: addDraft.note.trim(),
    }), "Stock added");
    if (ok) setAddDraft(null);
  };

  const submitSell = async () => {
    const qty = Number(sellDraft.qty);
    if (!qty || qty < 1) { toast.error("Quantity must be at least 1"); return; }
    if (qty > sellDraft.item.stock) { toast.error(`Only ${sellDraft.item.stock} in stock`); return; }
    const ok = await run(() => sellInventoryItem(sellDraft.item.id, {
      qty,
      unit_price: sellDraft.unit_price === "" ? null : Number(sellDraft.unit_price),
      customer_name: sellDraft.customer_name.trim(),
      payment_mode: sellDraft.payment_mode,
      note: sellDraft.note.trim(),
    }), "Sale recorded");
    if (ok) setSellDraft(null);
  };

  const submitMove = async () => {
    const qty = Number(moveDraft.qty);
    if (!qty || qty < 1) { toast.error("Quantity must be at least 1"); return; }
    if (qty > moveDraft.item.stock) { toast.error(`Only ${moveDraft.item.stock} in stock`); return; }
    if (!moveDraft.to_branch_id) { toast.error("Pick the branch it is going to"); return; }
    const ok = await run(() => transferInventoryItem(moveDraft.item.id, {
      qty,
      to_branch_id: moveDraft.to_branch_id,
      note: moveDraft.note.trim(),
    }), "Stock moved");
    if (ok) setMoveDraft(null);
  };

  const newItem = () => setItemDraft({
    id: null, name: "", brand: "", unit: "Strip",
    sale_price: "", cost_price: "", low_stock_at: 10, notes: "",
  });

  const editItem = (it) => setItemDraft({
    id: it.id, name: it.name, brand: it.brand || "", unit: it.unit || "Strip",
    sale_price: it.sale_price ?? "", cost_price: it.cost_price ?? "",
    low_stock_at: it.low_stock_at ?? 10, notes: it.notes || "",
  });

  const sellTotal = sellDraft
    ? (Number(sellDraft.qty) || 0) * (sellDraft.unit_price === "" ? Number(sellDraft.item.sale_price) || 0 : Number(sellDraft.unit_price) || 0)
    : 0;

  const empty = loading || visible.length === 0;

  // The same three actions on a table row and on a phone card. Holds no state of its own,
  // so being re-created each render costs nothing and keeps the two lists in step by
  // construction rather than by remembering to edit both.
  const RowActions = ({ item }) => (
    <>
      <Button
        size="sm" variant="outline" className="h-8 border-sky-200 text-sky-700 hover:bg-sky-50"
        onClick={() => setAddDraft({ item, qty: "", cost_price: "", supplier: "", note: "" })}
        data-testid={`tablet-add-stock-${item.id}`}
      >
        <PackagePlus className="mr-1 h-3.5 w-3.5" /> Add
      </Button>
      <Button
        size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
        disabled={item.stock <= 0}
        onClick={() => setSellDraft({ item, qty: 1, unit_price: item.sale_price ?? "", customer_name: "", payment_mode: "cash", note: "" })}
        data-testid={`tablet-sell-${item.id}`}
      >
        <ShoppingCart className="mr-1 h-3.5 w-3.5" /> Sell
      </Button>
      <Button
        size="sm" variant="outline" className="h-8 border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-40"
        disabled={item.stock <= 0}
        onClick={() => setMoveDraft({ item, qty: 1, to_branch_id: "", note: "" })}
        data-testid={`tablet-move-${item.id}`}
      >
        <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Move
      </Button>
      <button
        onClick={() => editItem(item)}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-600"
        title="Edit" data-testid={`tablet-edit-${item.id}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => removeItem(item)}
        className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        title="Delete" data-testid={`tablet-delete-${item.id}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </>
  );

  return (
    <div className="space-y-4" data-testid="tablet-inventory-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Tablets" value={summary?.items ?? "—"} sub="in the catalogue" icon={Pill} color="#7c3aed" />
        <StatTile label="In Stock" value={summary?.units ?? "—"} sub={`worth ${fmt(summary?.stock_value)}`} icon={Boxes} color="#0284c7" />
        <StatTile label="Low Stock" value={summary?.low_stock ?? "—"} sub={`${summary?.out_of_stock ?? 0} fully out`} icon={AlertTriangle} color="#d97706" />
        <StatTile label="Sold Today" value={fmt(summary?.sold_today_amount)} sub={`${summary?.sold_today_qty ?? 0} units`} icon={IndianRupee} color="#059669" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tablet or brand..."
              className={`${inputCls} pl-9`}
              data-testid="tablet-inventory-search"
            />
          </div>
          <Button onClick={newItem} className="bg-violet-600 text-white hover:bg-violet-700" data-testid="tablet-inventory-new">
            <Plus className="mr-1.5 h-4 w-4" /> New Tablet
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden" data-testid="tablet-inventory-table-card">
        <CardContent className="p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tablet Stock</p>
          </div>

          {empty ? (
            <p className="px-4 py-14 text-center text-sm text-slate-400" data-testid="tablet-inventory-empty">
              {loading ? "Loading stock..."
                : items.length === 0 ? "No tablets yet — add one to start tracking stock."
                  : "Nothing matches that search."}
            </p>
          ) : (
            <>
              {/* A phone gets cards. The desktop table is 720px before it is readable, and
                  a row whose whole point is three buttons is the worst thing to make
                  someone find by scrolling sideways. */}
              <div className="space-y-2 p-3 sm:hidden" data-testid="tablet-list-mobile">
                {visible.map((it) => (
                  <div key={it.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`tablet-card-${it.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">{it.name}</p>
                        <p className="truncate text-xs text-slate-500">{it.brand || "No brand"}</p>
                      </div>
                      <StockBadge qty={it.stock} low={it.low} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{fmt(it.sale_price)} per {(it.unit || "unit").toLowerCase()}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <RowActions item={it} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block" data-testid="tablet-list-desktop">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Tablet</th>
                      <th className="px-4 py-2.5 font-semibold">Unit</th>
                      <th className="px-4 py-2.5 font-semibold">Price</th>
                      <th className="px-4 py-2.5 font-semibold">Stock</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50" data-testid={`tablet-row-${it.id}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{it.name}</p>
                          <p className="text-[11px] text-slate-400">{it.brand || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {it.unit}
                          <span className="block text-[11px] text-slate-400">low at {it.low_stock_at ?? 0}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {fmt(it.sale_price)}
                          <span className="block text-[11px] text-slate-400">cost {fmt(it.cost_price)}</span>
                        </td>
                        <td className="px-4 py-3"><StockBadge qty={it.stock} low={it.low} /></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <RowActions item={it} />
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

      <Card className="overflow-hidden" data-testid="tablet-inventory-movements">
        <CardContent className="p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <History className="h-3.5 w-3.5" /> Stock Movements
            </p>
          </div>
          {movements.length === 0 ? (
            <p className="px-4 py-14 text-center text-sm text-slate-400">Nothing has moved yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">When</th>
                    <th className="px-4 py-2.5 font-semibold">Tablet</th>
                    <th className="px-4 py-2.5 font-semibold">What</th>
                    <th className="px-4 py-2.5 font-semibold">Qty</th>
                    <th className="px-4 py-2.5 font-semibold">Amount</th>
                    <th className="px-4 py-2.5 font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => {
                    const meta = MOVEMENT_META[m.kind] || { label: m.kind, classes: "border-slate-200 bg-slate-50 text-slate-600", sign: "" };
                    const detail = m.kind === "sale" ? (m.customer_name || "Counter sale")
                      : m.kind === "add" ? (m.supplier || "Stock in")
                        : m.kind === "transfer_out" ? `to ${m.to_branch_name || "another branch"}`
                          : `from ${m.from_branch_name || "another branch"}`;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50" data-testid={`tablet-movement-${m.id}`}>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{when(m.created_at)}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{m.item_name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex shrink-0 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${meta.classes}`}>{meta.label}</span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{meta.sign}{m.qty}</td>
                        <td className="px-4 py-3 text-slate-600">{m.kind === "sale" ? fmt(m.amount) : "—"}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {detail}
                          {m.by_user_name && <span className="text-[11px] text-slate-400"> · {m.by_user_name}</span>}
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

      {itemDraft && (
        <Modal
          title={itemDraft.id ? "Edit Tablet" : "New Tablet"}
          subtitle="Shared across branches — each branch keeps its own count"
          onClose={() => setItemDraft(null)}
          testid="tablet-item-modal"
          footer={<>
            <Button variant="outline" onClick={() => setItemDraft(null)} data-testid="tablet-item-cancel">Cancel</Button>
            <Button className="bg-violet-600 text-white hover:bg-violet-700" disabled={busy} onClick={saveItem} data-testid="tablet-item-save">
              {itemDraft.id ? "Save Changes" : "Add Tablet"}
            </Button>
          </>}
        >
          <Field label="Name *">
            <input className={inputCls} value={itemDraft.name} onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })} placeholder="e.g. Paracetamol 500mg" data-testid="tablet-item-name" />
          </Field>
          <Field label="Brand">
            <input className={inputCls} value={itemDraft.brand} onChange={(e) => setItemDraft({ ...itemDraft, brand: e.target.value })} placeholder="e.g. Calpol" data-testid="tablet-item-brand" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sold As">
              <select className={inputCls} value={itemDraft.unit} onChange={(e) => setItemDraft({ ...itemDraft, unit: e.target.value })} data-testid="tablet-item-unit">
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Low Stock At" hint="Flagged at or below this">
              <input type="number" min="0" className={inputCls} value={itemDraft.low_stock_at} onChange={(e) => setItemDraft({ ...itemDraft, low_stock_at: e.target.value })} data-testid="tablet-item-low" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sale Price">
              <input type="number" min="0" className={inputCls} value={itemDraft.sale_price} onChange={(e) => setItemDraft({ ...itemDraft, sale_price: e.target.value })} placeholder="0" data-testid="tablet-item-sale-price" />
            </Field>
            <Field label="Cost Price">
              <input type="number" min="0" className={inputCls} value={itemDraft.cost_price} onChange={(e) => setItemDraft({ ...itemDraft, cost_price: e.target.value })} placeholder="0" data-testid="tablet-item-cost-price" />
            </Field>
          </div>
          <Field label="Notes">
            <textarea rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" value={itemDraft.notes} onChange={(e) => setItemDraft({ ...itemDraft, notes: e.target.value })} placeholder="Storage, dosage, anything worth remembering" data-testid="tablet-item-notes" />
          </Field>
        </Modal>
      )}

      {addDraft && (
        <Modal
          title="Add Stock"
          subtitle={`${addDraft.item.name} · ${addDraft.item.stock} in stock now`}
          accent="bg-sky-600"
          onClose={() => setAddDraft(null)}
          testid="tablet-add-modal"
          footer={<>
            <Button variant="outline" onClick={() => setAddDraft(null)} data-testid="tablet-add-cancel">Cancel</Button>
            <Button className="bg-sky-600 text-white hover:bg-sky-700" disabled={busy} onClick={submitAdd} data-testid="tablet-add-save">
              <PackagePlus className="mr-1.5 h-4 w-4" /> Add to Stock
            </Button>
          </>}
        >
          <Field label={`Quantity (${addDraft.item.unit}) *`}>
            <input type="number" min="1" className={inputCls} value={addDraft.qty} onChange={(e) => setAddDraft({ ...addDraft, qty: e.target.value })} placeholder="0" data-testid="tablet-add-qty" />
          </Field>
          <Field label="Cost Price" hint="Leave blank to keep the price already on the tablet">
            <input type="number" min="0" className={inputCls} value={addDraft.cost_price} onChange={(e) => setAddDraft({ ...addDraft, cost_price: e.target.value })} placeholder={String(addDraft.item.cost_price ?? 0)} data-testid="tablet-add-cost" />
          </Field>
          <Field label="Supplier">
            <input className={inputCls} value={addDraft.supplier} onChange={(e) => setAddDraft({ ...addDraft, supplier: e.target.value })} placeholder="Who it came from" data-testid="tablet-add-supplier" />
          </Field>
          <Field label="Note">
            <input className={inputCls} value={addDraft.note} onChange={(e) => setAddDraft({ ...addDraft, note: e.target.value })} placeholder="Invoice number, batch, anything" data-testid="tablet-add-note" />
          </Field>
        </Modal>
      )}

      {sellDraft && (
        <Modal
          title="Sell Tablet"
          subtitle={`${sellDraft.item.name} · ${sellDraft.item.stock} in stock`}
          accent="bg-emerald-600"
          onClose={() => setSellDraft(null)}
          testid="tablet-sell-modal"
          footer={<>
            <Button variant="outline" onClick={() => setSellDraft(null)} data-testid="tablet-sell-cancel">Cancel</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy} onClick={submitSell} data-testid="tablet-sell-save">
              <ShoppingCart className="mr-1.5 h-4 w-4" /> Record Sale
            </Button>
          </>}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Quantity (${sellDraft.item.unit}) *`}>
              <input type="number" min="1" max={sellDraft.item.stock} className={inputCls} value={sellDraft.qty} onChange={(e) => setSellDraft({ ...sellDraft, qty: e.target.value })} data-testid="tablet-sell-qty" />
            </Field>
            <Field label="Price Each">
              <input type="number" min="0" className={inputCls} value={sellDraft.unit_price} onChange={(e) => setSellDraft({ ...sellDraft, unit_price: e.target.value })} data-testid="tablet-sell-price" />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total</span>
            <span className="text-lg font-extrabold text-emerald-700" data-testid="tablet-sell-total">{fmt(sellTotal)}</span>
          </div>
          <Field label="Patient / Customer">
            <input className={inputCls} value={sellDraft.customer_name} onChange={(e) => setSellDraft({ ...sellDraft, customer_name: e.target.value })} placeholder="Who is buying it" data-testid="tablet-sell-customer" />
          </Field>
          <Field label="Payment Mode">
            <select className={inputCls} value={sellDraft.payment_mode} onChange={(e) => setSellDraft({ ...sellDraft, payment_mode: e.target.value })} data-testid="tablet-sell-mode">
              {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Note">
            <input className={inputCls} value={sellDraft.note} onChange={(e) => setSellDraft({ ...sellDraft, note: e.target.value })} placeholder="Optional" data-testid="tablet-sell-note" />
          </Field>
        </Modal>
      )}

      {moveDraft && (
        <Modal
          title="Move to Another Branch"
          subtitle={`${moveDraft.item.name} · ${moveDraft.item.stock} in stock here`}
          accent="bg-amber-600"
          onClose={() => setMoveDraft(null)}
          testid="tablet-move-modal"
          footer={<>
            <Button variant="outline" onClick={() => setMoveDraft(null)} data-testid="tablet-move-cancel">Cancel</Button>
            <Button className="bg-amber-600 text-white hover:bg-amber-700" disabled={busy} onClick={submitMove} data-testid="tablet-move-save">
              <ArrowRightLeft className="mr-1.5 h-4 w-4" /> Move Stock
            </Button>
          </>}
        >
          <Field label={`Quantity (${moveDraft.item.unit}) *`}>
            <input type="number" min="1" max={moveDraft.item.stock} className={inputCls} value={moveDraft.qty} onChange={(e) => setMoveDraft({ ...moveDraft, qty: e.target.value })} data-testid="tablet-move-qty" />
          </Field>
          <Field label="Move To *" hint="It lands in that branch's stock straight away">
            <select className={inputCls} value={moveDraft.to_branch_id} onChange={(e) => setMoveDraft({ ...moveDraft, to_branch_id: e.target.value })} data-testid="tablet-move-branch">
              <option value="">-- choose a branch --</option>
              {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Note">
            <input className={inputCls} value={moveDraft.note} onChange={(e) => setMoveDraft({ ...moveDraft, note: e.target.value })} placeholder="Why it is moving" data-testid="tablet-move-note" />
          </Field>
        </Modal>
      )}
    </div>
  );
};

export default TabletInventoryPanel;
