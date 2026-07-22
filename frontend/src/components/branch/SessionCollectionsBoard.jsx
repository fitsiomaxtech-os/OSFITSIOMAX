import { useMemo, useState } from "react";
import { Eye, Banknote, CreditCard, Smartphone, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const MODE_META = {
  cash: { label: "Cash", icon: Banknote, classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  upi: { label: "UPI", icon: Smartphone, classes: "bg-sky-50 text-sky-700 border-sky-200" },
  card: { label: "Card", icon: CreditCard, classes: "bg-violet-50 text-violet-700 border-violet-200" },
  cheque: { label: "Cheque", icon: Banknote, classes: "bg-amber-50 text-amber-700 border-amber-200" },
  partial: { label: "Partial", icon: Layers, classes: "bg-orange-50 text-orange-700 border-orange-200" },
};

const PaymentModeBadge = ({ mode }) => {
  const meta = MODE_META[mode] || { label: mode || "—", icon: Banknote, classes: "bg-slate-50 text-slate-600 border-slate-200" };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
};

const STATUS_META = {
  paid: { label: "Paid", classes: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  partial: { label: "Partial", classes: "bg-amber-100 text-amber-700 border-amber-200" },
  pending: { label: "Pending", classes: "bg-rose-100 text-rose-700 border-rose-200" },
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return (
    <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
      {meta.label}
    </span>
  );
};

const SummaryCard = ({ label, value, color }) => (
  <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
  </div>
);

export const SessionCollectionsBoard = ({ rows, onView }) => {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [mode, setMode] = useState("all");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const today = todayIso();
  const monthPrefix = today.slice(0, 7);

  const branches = useMemo(() => [...new Set(rows.map((r) => r.branch_name).filter(Boolean))], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (search && !(r.client_name || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (branch !== "all" && r.branch_name !== branch) return false;
    if (mode !== "all" && r.payment_mode !== mode) return false;
    if (status !== "all" && r.session_status !== status) return false;
    const d = (r.date || "").slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  }), [rows, search, branch, mode, status, fromDate, toDate]);

  const totals = useMemo(() => {
    const todayTotal = rows.filter((r) => (r.date || "").slice(0, 10) === today).reduce((s, r) => s + r.gross, 0);
    const monthTotal = rows.filter((r) => (r.date || "").slice(0, 7) === monthPrefix).reduce((s, r) => s + r.gross, 0);
    const cash = rows.filter((r) => r.payment_mode === "cash").reduce((s, r) => s + r.gross, 0);
    const card = rows.filter((r) => r.payment_mode === "card").reduce((s, r) => s + r.gross, 0);
    const upi = rows.filter((r) => r.payment_mode === "upi").reduce((s, r) => s + r.gross, 0);
    const partial = rows.filter((r) => r.session_status === "partial").reduce((s, r) => s + (r.session_due || 0), 0);
    const uniqueDue = new Map();
    rows.forEach((r) => uniqueDue.set(r.lead_id, r.session_due || 0));
    const outstanding = [...uniqueDue.values()].reduce((s, v) => s + v, 0);
    return { todayTotal, monthTotal, cash, card, upi, partial, outstanding };
  }, [rows, today, monthPrefix]);

  return (
    <div className="space-y-4" data-testid="session-collections-board">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <SummaryCard label="Today's Collection" value={fmt(totals.todayTotal)} color="#059669" />
        <SummaryCard label="Monthly Collection" value={fmt(totals.monthTotal)} color="#0284c7" />
        <SummaryCard label="Cash" value={fmt(totals.cash)} color="#16a34a" />
        <SummaryCard label="Card" value={fmt(totals.card)} color="#7c3aed" />
        <SummaryCard label="UPI" value={fmt(totals.upi)} color="#0ea5e9" />
        <SummaryCard label="Partial Payments" value={fmt(totals.partial)} color="#ea580c" />
        <SummaryCard label="Outstanding Amount" value={fmt(totals.outstanding)} color="#d97706" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client..."
            className="h-9 min-w-[180px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="session-collections-search"
          />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="session-collections-branch-filter">
            <option value="all">All Branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="session-collections-mode-filter">
            <option value="all">All Payment Modes</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="partial">Partial</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="session-collections-status-filter">
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
          </select>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="session-collections-from-date" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="session-collections-to-date" />
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-session">
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Session Collections</p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[4%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[14%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Package</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Collection Date</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">No session collections yet.</td></tr>
                ) : filtered.map((tx, i) => (
                  <tr key={tx.id} data-testid={`session-collections-row-${tx.id}`}>
                    <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.branch_name || "—"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.session_package_label || "—"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><PaymentModeBadge mode={tx.payment_mode} /></td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-emerald-600">{fmt(tx.session_paid)}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-amber-600">{tx.session_due > 0 ? fmt(tx.session_due) : "—"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><StatusBadge status={tx.session_status} /></td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{(tx.date || "").slice(0, 10)}</td>
                    <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onView && onView(tx.lead_id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                        data-testid={`session-collections-view-${tx.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SessionCollectionsBoard;
