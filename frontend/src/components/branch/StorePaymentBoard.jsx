import { useMemo, useState } from "react";
import { Pill, FlaskConical, Dumbbell, ShoppingBag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// The three Fitsiomax Store shelves that hold stock, in the order their tabs sit in.
const SHELVES = [
  { key: "tablet", label: "Tablet", icon: Pill, color: "#7c3aed" },
  { key: "supplementary", label: "Supplementary", icon: FlaskConical, color: "#0284c7" },
  { key: "equipment", label: "Equipment", icon: Dumbbell, color: "#d97706" },
];
const SHELF_BY_KEY = Object.fromEntries(SHELVES.map((s) => [s.key, s]));

const MODE_LABELS = { upi: "UPI", account_transfer: "Account Transfer" };
const MODE_STYLES = {
  cash: "bg-emerald-50 text-emerald-700 border-emerald-200",
  upi: "bg-sky-50 text-sky-700 border-sky-200",
  card: "bg-violet-50 text-violet-700 border-violet-200",
  account_transfer: "bg-cyan-50 text-cyan-700 border-cyan-200",
};
const formatMode = (m) => (m ? (MODE_LABELS[m] || m.charAt(0).toUpperCase() + m.slice(1)) : "—");

const ModeBadge = ({ mode }) => (
  <span className={`inline-flex shrink-0 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${MODE_STYLES[mode] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
    {formatMode(mode)}
  </span>
);

const ShelfBadge = ({ category }) => {
  const shelf = SHELF_BY_KEY[category];
  if (!shelf) return <span className="text-slate-300">—</span>;
  const Icon = shelf.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold"
      style={{ color: shelf.color, borderColor: `${shelf.color}55`, backgroundColor: `${shelf.color}14` }}
    >
      <Icon className="h-3 w-3" />{shelf.label}
    </span>
  );
};

const when = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(0, 16); }
};

const Tile = ({ label, value, sub, icon: Icon, color, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition ${
      active ? "border-transparent" : "border-slate-200 hover:shadow-md"
    }`}
    style={active ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
    data-testid={`store-payment-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
  >
    <span
      aria-hidden
      className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full"
      style={{ background: `linear-gradient(135deg, ${color}2E, ${color}0D)` }}
    />
    <Icon aria-hidden className="absolute right-3.5 top-3.5 h-4 w-4" style={{ color }} />
    <p className="pr-9 text-[11px] font-bold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-extrabold sm:text-2xl" style={{ color }}>{value}</p>
    <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>
  </button>
);

/**
 * Accountant Manage > Store Payment — every counter sale off the three Fitsiomax Store
 * shelves, in one list.
 *
 * The rows arrive in the same revenue-overview payload as consultations and sessions,
 * already scoped to the branch and date range the rest of the board is showing, so this
 * makes no call of its own and cannot disagree with the Total Revenue figure above it.
 *
 * There is no client eye here as there is on the other tabs. A counter sale is to whoever
 * was standing at the desk and carries no lead, so there is no history to open.
 */
export const StorePaymentBoard = ({ rows = [] }) => {
  const [shelf, setShelf] = useState(null);

  const totals = useMemo(() => {
    const acc = { all: { amount: 0, count: 0 } };
    SHELVES.forEach((s) => { acc[s.key] = { amount: 0, count: 0 }; });
    rows.forEach((r) => {
      const amount = Number(r.gross) || 0;
      acc.all.amount += amount;
      acc.all.count += 1;
      const bucket = acc[r.store_category];
      if (bucket) { bucket.amount += amount; bucket.count += 1; }
    });
    return acc;
  }, [rows]);

  const visible = useMemo(
    () => (shelf ? rows.filter((r) => r.store_category === shelf) : rows),
    [rows, shelf],
  );

  const toggle = (key) => setShelf((cur) => (cur === key ? null : key));

  return (
    <div className="space-y-4" data-testid="store-payment-board">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Store Total" value={fmt(totals.all.amount)} sub={`${totals.all.count} sale${totals.all.count === 1 ? "" : "s"}`}
          icon={ShoppingBag} color="#059669" active={shelf === null} onClick={() => setShelf(null)}
        />
        {SHELVES.map((s) => (
          <Tile
            key={s.key}
            label={s.label} value={fmt(totals[s.key].amount)} sub={`${totals[s.key].count} sale${totals[s.key].count === 1 ? "" : "s"}`}
            icon={s.icon} color={s.color} active={shelf === s.key} onClick={() => toggle(s.key)}
          />
        ))}
      </div>

      <Card className="overflow-hidden" data-testid="store-payment-table-card">
        <CardContent className="p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {shelf ? `${SHELF_BY_KEY[shelf].label} Payments` : "Store Payments"}
            </p>
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-14 text-center text-sm text-slate-400" data-testid="store-payment-empty">
              {rows.length === 0 ? "No store sales yet." : "No sales off that shelf."}
            </p>
          ) : (
            <>
              {/* Cards on a phone: ten columns behind a scroll means a sale can only be
                  read a fragment at a time, and a sale is only useful read whole. */}
              <div className="space-y-2 p-3 md:hidden" data-testid="store-payment-mobile">
                {visible.map((tx, i) => (
                  <div key={tx.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`store-payment-card-${tx.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">
                          <span className="mr-1.5 font-semibold text-slate-300">{i + 1}.</span>{tx.item_name || "—"}
                        </p>
                        <p className="truncate text-xs text-slate-500">{tx.client_name}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-emerald-600">{fmt(tx.gross)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                      <ShelfBadge category={tx.store_category} />
                      <span>× {tx.qty}</span>
                      <ModeBadge mode={tx.payment_mode} />
                      <span>{when(tx.date)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block" data-testid="store-payment-desktop">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="w-12 px-4 py-2.5 font-semibold">S.No</th>
                      <th className="px-4 py-2.5 font-semibold">Item</th>
                      <th className="px-4 py-2.5 font-semibold">Shelf</th>
                      <th className="px-4 py-2.5 font-semibold">Qty</th>
                      <th className="px-4 py-2.5 font-semibold">Customer</th>
                      <th className="px-4 py-2.5 font-semibold">Transaction ID</th>
                      <th className="px-4 py-2.5 font-semibold">Amount</th>
                      <th className="px-4 py-2.5 font-semibold">Payment Mode</th>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">Branch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((tx, i) => (
                      <tr key={tx.id} className="hover:bg-slate-50" data-testid={`store-payment-row-${tx.id}`}>
                        <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{tx.item_name || "—"}</p>
                          {tx.collected_by && <p className="text-[11px] text-slate-400">by {tx.collected_by}</p>}
                        </td>
                        <td className="px-4 py-3"><ShelfBadge category={tx.store_category} /></td>
                        <td className="px-4 py-3 text-slate-600">{tx.qty}</td>
                        <td className="px-4 py-3 text-slate-600">{tx.client_name}</td>
                        <td className="px-4 py-3">
                          {tx.transaction_id
                            ? <span className="font-mono text-[11px] text-slate-700">{tx.transaction_id}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 font-semibold text-emerald-600">{fmt(tx.gross)}</td>
                        <td className="px-4 py-3"><ModeBadge mode={tx.payment_mode} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{when(tx.date)}</td>
                        <td className="px-4 py-3 text-slate-600">{tx.branch_name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StorePaymentBoard;
