import { useMemo, useState } from "react";
import { Eye, Banknote, CreditCard, Smartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const MODE_META = {
  cash: { label: "Cash", icon: Banknote, classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  upi: { label: "UPI", icon: Smartphone, classes: "bg-sky-50 text-sky-700 border-sky-200" },
  card: { label: "Card", icon: CreditCard, classes: "bg-violet-50 text-violet-700 border-violet-200" },
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

const StatusBadge = ({ paid }) => (
  <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${paid ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
    {paid ? "Paid" : "Pending"}
  </span>
);

const SummaryCard = ({ label, value, color, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-xl border bg-white p-4 text-left shadow-sm transition ${active ? "ring-2 ring-offset-1" : "hover:shadow-md"}`}
    style={{ borderLeftColor: color, borderLeftWidth: 4, ...(active ? { boxShadow: `0 0 0 2px ${color}33` } : {}) }}
    data-testid={`consultation-summary-${label.toLowerCase().replace(/\s+/g, "-")}`}
  >
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
  </button>
);

export const ConsultationCollectionsBoard = ({ rows, onView }) => {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [mode, setMode] = useState("all");
  const [date, setDate] = useState("");
  const [activeCard, setActiveCard] = useState(null);

  const today = todayIso();
  const monthPrefix = today.slice(0, 7);

  const branches = useMemo(() => [...new Set(rows.map((r) => r.branch_name).filter(Boolean))], [rows]);

  const toggleCard = (key, modeValue) => {
    const next = activeCard === key ? null : key;
    setActiveCard(next);
    if (modeValue) setMode(next ? modeValue : "all");
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (search && !(r.client_name || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (branch !== "all" && r.branch_name !== branch) return false;
    if (mode !== "all" && r.payment_mode !== mode) return false;
    if (date && (r.date || "").slice(0, 10) !== date) return false;
    if (activeCard === "today" && (r.date || "").slice(0, 10) !== today) return false;
    if (activeCard === "month" && (r.date || "").slice(0, 7) !== monthPrefix) return false;
    if (activeCard === "outstanding" && !(r.client_balance > 0)) return false;
    return true;
  }), [rows, search, branch, mode, date, activeCard, today, monthPrefix]);

  const totals = useMemo(() => {
    const uniqueBalances = new Map();
    rows.forEach((r) => uniqueBalances.set(r.lead_id, r.client_balance || 0));
    const todayTotal = rows.filter((r) => (r.date || "").slice(0, 10) === today).reduce((s, r) => s + r.gross, 0);
    const monthTotal = rows.filter((r) => (r.date || "").slice(0, 7) === monthPrefix).reduce((s, r) => s + r.gross, 0);
    const cash = rows.filter((r) => r.payment_mode === "cash").reduce((s, r) => s + r.gross, 0);
    const card = rows.filter((r) => r.payment_mode === "card").reduce((s, r) => s + r.gross, 0);
    const upi = rows.filter((r) => r.payment_mode === "upi").reduce((s, r) => s + r.gross, 0);
    const outstanding = [...uniqueBalances.values()].reduce((s, b) => s + b, 0);
    return { todayTotal, monthTotal, cash, card, upi, outstanding };
  }, [rows, today, monthPrefix]);

  return (
    <div className="space-y-4" data-testid="consultation-collections-board">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Today's Collection" value={fmt(totals.todayTotal)} color="#059669" active={activeCard === "today"} onClick={() => toggleCard("today")} />
        <SummaryCard label="This Month" value={fmt(totals.monthTotal)} color="#0284c7" active={activeCard === "month"} onClick={() => toggleCard("month")} />
        <SummaryCard label="Cash" value={fmt(totals.cash)} color="#16a34a" active={activeCard === "cash"} onClick={() => toggleCard("cash", "cash")} />
        <SummaryCard label="Card" value={fmt(totals.card)} color="#7c3aed" active={activeCard === "card"} onClick={() => toggleCard("card", "card")} />
        <SummaryCard label="UPI" value={fmt(totals.upi)} color="#0ea5e9" active={activeCard === "upi"} onClick={() => toggleCard("upi", "upi")} />
        <SummaryCard label="Outstanding" value={fmt(totals.outstanding)} color="#d97706" active={activeCard === "outstanding"} onClick={() => toggleCard("outstanding")} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client..."
            className="h-9 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="consultation-collections-search"
          />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="consultation-collections-branch-filter">
            <option value="all">All Branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setActiveCard(["cash", "card", "upi"].includes(e.target.value) ? e.target.value : null);
            }}
            className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="consultation-collections-mode-filter">
            <option value="all">All Payment Modes</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
          </select>
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            data-testid="consultation-collections-date-filter"
          />
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-consultation">
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Consultation Collections</p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[5%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[19%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[16%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</td></tr>
                ) : filtered.map((tx, i) => (
                  <tr key={tx.id} data-testid={`collections-row-${tx.id}`}>
                    <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.branch_name || "—"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><PaymentModeBadge mode={tx.payment_mode} /></td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-slate-800">{fmt(tx.gross)}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><StatusBadge paid={!(tx.client_balance > 0)} /></td>
                    <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onView && onView(tx.lead_id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                        data-testid={`collections-view-${tx.id}`}
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

export default ConsultationCollectionsBoard;
