import { useMemo, useState } from "react";
import { Eye, Wallet, MessageCircle, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { markInstallmentPaid } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const STATUS_META = {
  paid: { label: "Paid", classes: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  overdue: { label: "Overdue", classes: "bg-rose-100 text-rose-700 border-rose-200" },
  due_today: { label: "Due Today", classes: "bg-amber-100 text-amber-700 border-amber-200" },
  upcoming: { label: "Upcoming", classes: "bg-sky-100 text-sky-700 border-sky-200" },
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.upcoming;
  return (
    <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
      {meta.label}
    </span>
  );
};

const ProgressBar = ({ paid, total }) => {
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-500">{paid}/{total}</span>
    </div>
  );
};

const SummaryCard = ({ label, value, color }) => (
  <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
  </div>
);

const DUE_PRESETS = [
  { key: "all", label: "All Due Dates" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due Today" },
  { key: "week", label: "Next 7 Days" },
];

export const PaymentSchedulesBoard = ({ rows, onView, onChanged }) => {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [status, setStatus] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [marking, setMarking] = useState(null);

  const today = todayIso();
  const weekAhead = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const branches = useMemo(() => [...new Set(rows.map((r) => r.branch_name).filter(Boolean))], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (search && !(r.client_name || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (branch !== "all" && r.branch_name !== branch) return false;
    if (status !== "all" && r.status !== status) return false;
    if (dueFilter === "overdue" && r.status !== "overdue") return false;
    if (dueFilter === "today" && r.due_date !== today) return false;
    if (dueFilter === "week" && !(r.due_date >= today && r.due_date <= weekAhead)) return false;
    return true;
  }), [rows, search, branch, status, dueFilter, today, weekAhead]);

  const totals = useMemo(() => ({
    total: rows.length,
    paid: rows.filter((r) => r.status === "paid").length,
    pending: rows.filter((r) => r.status === "upcoming" || r.status === "due_today").length,
    overdue: rows.filter((r) => r.status === "overdue").length,
  }), [rows]);

  const markPaid = async (row) => {
    const key = `${row.lead_id}-${row.installment_number}`;
    setMarking(key);
    try {
      await markInstallmentPaid(row.lead_id, row.installment_number);
      toast.success(`Installment #${row.installment_number} for ${row.client_name} marked as paid`);
      onChanged && onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to mark as paid");
    }
    setMarking(null);
  };

  const sendReminder = (row) => {
    if (!row.phone) return;
    const digits = row.phone.replace(/[^0-9]/g, "");
    const msg = encodeURIComponent(`Hi ${row.client_name}, this is a reminder that installment #${row.installment_number} of ${fmt(row.amount)} is due on ${row.due_date}. Kindly clear it at your earliest convenience.`);
    window.open(`https://wa.me/${digits}?text=${msg}`, "_blank");
  };

  return (
    <div className="space-y-4" data-testid="payment-schedules-board">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Scheduled" value={totals.total} color="#7c3aed" />
        <SummaryCard label="Paid Installments" value={totals.paid} color="#059669" />
        <SummaryCard label="Pending Installments" value={totals.pending} color="#0284c7" />
        <SummaryCard label="Overdue Installments" value={totals.overdue} color="#e11d48" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client..."
            className="h-9 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="schedules-search"
          />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="schedules-branch-filter">
            <option value="all">All Branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="schedules-status-filter">
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="upcoming">Upcoming</option>
            <option value="due_today">Due Today</option>
            <option value="overdue">Overdue</option>
          </select>
          <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-sm" data-testid="schedules-due-filter">
            {DUE_PRESETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <button
            type="button" onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            data-testid="schedules-print"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-schedules">
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Schedules</p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[5%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[15%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Consultation/Session</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[8%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Installment</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due Date</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Progress</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">No scheduled installments.</td></tr>
                ) : filtered.map((r, i) => {
                  const key = `${r.lead_id}-${r.installment_number}`;
                  return (
                    <tr key={key} data-testid={`accountant-manage-schedule-${key}`}>
                      <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{r.client_name}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center capitalize text-slate-600">{r.category}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{r.branch_name || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">#{r.installment_number}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{r.due_date}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-slate-800">{fmt(r.amount)}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><StatusBadge status={r.status} /></td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center">
                        <ProgressBar paid={r.installments_paid} total={r.installments_total} />
                      </td>
                      <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => onView && onView(r.lead_id)} title="View Details" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button" onClick={() => markPaid(r)} title={r.status === "paid" ? "Already paid" : "Collect Payment"}
                            disabled={r.status === "paid" || marking === key}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button" onClick={() => sendReminder(r)} title="Send Reminder"
                            disabled={r.status === "paid" || !r.phone}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button" onClick={() => window.print()} title="Print Receipt"
                            disabled={r.status !== "paid"}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentSchedulesBoard;
